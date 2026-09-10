/**
 * Unison shared workspace
 *
 *   Unison frontend  ->  this endpoint  ->  a key/value store the team owns
 *
 * Without this, every person's posts, calendar, approvals and team list live
 * in their own browser and the only way to share is to export a file. That is
 * fine for one person and wrong for a team, so this is the optional shared
 * half: one document, read and written by everyone who can reach it.
 *
 * Storage is Upstash Redis over its REST API — free tier, no SDK, two
 * environment variables:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *   UNISON_RELAY_TOKEN        strongly recommended; without it anyone who
 *                             knows the URL can read and write the workspace
 *
 * Not configured, it answers honestly and the app stays local-only. It never
 * pretends to have saved something it did not.
 *
 * Concurrency is last-write-wins with a version check: a client sends the
 * version it started from, and a write against a stale version is refused
 * rather than silently overwriting someone else's work.
 */

const URL_BASE = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const STORE_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";
const KEY = process.env.UNISON_WORKSPACE_KEY || "unison:workspace";
const MAX_BYTES = 900 * 1024;
const TIMEOUT_MS = 10000;

const configured = () => !!(URL_BASE && STORE_TOKEN);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET" && req.query?.health !== undefined) {
    return res.status(200).json({ service: "unison-workspace", version: 1, configured: configured(), tokenRequired: !!RELAY_TOKEN });
  }
  if (RELAY_TOKEN && req.headers["x-unison-token"] !== RELAY_TOKEN) {
    return res.status(401).json({ error: "This workspace requires a team token. Add it under Settings → Advanced." });
  }
  if (!configured()) {
    return res.status(200).json({
      service: "unison-workspace",
      configured: false,
      error: "No shared store is configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or keep working locally.",
    });
  }

  try {
    if (req.method === "GET") {
      const doc = await load();
      return res.status(200).json({ configured: true, ...(doc || { version: 0, data: null, updatedAt: null, updatedBy: null }) });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
      if (!body || typeof body.data !== "object" || body.data === null) {
        return res.status(400).json({ error: "Body must be {baseVersion, data, by}." });
      }
      const json = JSON.stringify(body.data);
      if (json.length > MAX_BYTES) {
        return res.status(413).json({ error: `The workspace is ${Math.round(json.length / 1024)}KB, over the ${Math.round(MAX_BYTES / 1024)}KB limit. Remove some uploaded media and try again.` });
      }

      const current = await load();
      const currentVersion = current?.version || 0;
      /* A stale write means someone else saved while this browser was editing.
         Refusing and handing back the newer document is the only answer that
         does not quietly destroy their work. */
      if (Number.isFinite(body.baseVersion) && body.baseVersion !== currentVersion) {
        return res.status(409).json({ error: "Someone else saved first.", conflict: true, version: currentVersion, data: current?.value ?? null, updatedAt: current?.updatedAt || null, updatedBy: current?.updatedBy || null });
      }

      const doc = { version: currentVersion + 1, value: body.data, updatedAt: new Date().toISOString(), updatedBy: String(body.by || "").slice(0, 80) || null };
      await store(doc);
      return res.status(200).json({ ok: true, version: doc.version, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
    }

    if (req.method === "DELETE") {
      await redis(["DEL", KEY]);
      return res.status(200).json({ ok: true, version: 0 });
    }

    res.setHeader("Allow", "GET, PUT, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    console.error("[unison:workspace]", String(e?.message || e));
    return res.status(502).json({ error: "The shared store did not respond." });
  }
}

/* ---------- storage ---------- */

async function redis(command) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(URL_BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${STORE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!r.ok) throw new Error(`store returned ${r.status}`);
  const out = await r.json();
  if (out?.error) throw new Error(String(out.error));
  return out?.result ?? null;
}

async function load() {
  const raw = await redis(["GET", KEY]);
  if (!raw) return null;
  const doc = typeof raw === "string" ? safeParse(raw) : raw;
  return doc && typeof doc === "object" ? doc : null;
}

const store = (doc) => redis(["SET", KEY, JSON.stringify(doc)]);

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

export const config = { api: { bodyParser: { sizeLimit: "2mb" } }, maxDuration: 20 };
