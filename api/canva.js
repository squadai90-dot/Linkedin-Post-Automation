/**
 * Unison Canva relay
 *
 *   Unison frontend  ->  this endpoint  ->  Canva Connect API
 *
 * Everything secret lives here. The browser is given a random, opaque session
 * id and nothing else: no client secret, no access token, no refresh token.
 * There is no route that returns a token, by design — the frontend asks this
 * relay to do things on its behalf instead of being handed credentials.
 *
 * OAuth is the Authorization Code flow with PKCE, which is what Canva
 * Connect documents. The code verifier is generated and kept HERE, never sent
 * to the browser, so a stolen authorization code is useless on its own.
 *
 * Configuration (server-side only):
 *   CANVA_CLIENT_ID       from https://www.canva.com/developers/
 *   CANVA_CLIENT_SECRET   same place — never put this in the frontend
 *   CANVA_REDIRECT_URI    must match the integration's configured redirect
 *
 * The client id and secret may also be supplied at runtime through the
 * `configure` action, for local development where there is no secrets store.
 * That configuration is HELD IN MEMORY ONLY: it is gone on restart, it is
 * never written to disk, and `status` says so plainly so nobody mistakes it
 * for a deployment.
 *
 * TOKEN STORAGE. Sessions are in-memory here too. On a single long-lived
 * server that is fine. On a serverless host that recycles instances, a
 * session may vanish between calls and the user simply reconnects — which is
 * a worse experience than a shared store but never a security problem, and
 * is far better than putting tokens in the browser. `status` reports
 * `persistence: "memory"` so the UI can warn rather than pretend.
 */

import crypto from "node:crypto";

const ENV = {
  clientId: process.env.CANVA_CLIENT_ID || "",
  clientSecret: process.env.CANVA_CLIENT_SECRET || "",
  redirectUri: process.env.CANVA_REDIRECT_URI || "",
};

/* Runtime configuration for local development. Memory only. */
const runtime = { clientId: "", clientSecret: "", redirectUri: "", fromEnv: false };
const cfg = () => ({
  clientId: runtime.clientId || ENV.clientId,
  clientSecret: runtime.clientSecret || ENV.clientSecret,
  redirectUri: runtime.redirectUri || ENV.redirectUri,
  source: (runtime.clientId || runtime.clientSecret) ? "runtime" : (ENV.clientId ? "env" : "none"),
});

const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";
const IS_PRODUCTION = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
const TIMEOUT_MS = Number(process.env.CANVA_TIMEOUT_MS || 30000);

const AUTH_BASE = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const API = "https://api.canva.com/rest/v1";

/* Only what the implemented features need. Asking for more than this would
   be rejected at review and is not honest about what the integration does. */
export const SCOPES = [
  "design:meta:read",
  "design:content:read",
  "design:content:write",
  "asset:read",
  "asset:write",
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
];

/* sessionId -> { accessToken, refreshToken, expiresAt, scope } */
const sessions = new Map();
/* state -> { verifier, createdAt } — short-lived, for the OAuth round trip. */
const pending = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

/* A connection that can no longer be renewed is dead weight, and a Map that
   only ever grows is a slow leak on a long-lived server. Both are swept; a
   refreshable session is left alone until the process restarts. */
const SESSION_GRACE_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 200;

const sweep = () => {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > PENDING_TTL_MS) pending.delete(k);
  for (const [k, v] of sessions) {
    if (!v.refreshToken && now > v.expiresAt + SESSION_GRACE_MS) sessions.delete(k);
  }
  /* Oldest first — Map preserves insertion order. */
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
};

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fail = (res, status, code, message) => res.status(status).json({ ok: false, code, message });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const c = cfg();
    return res.status(200).json({
      service: "unison-canva-relay",
      version: 1,
      configured: !!(c.clientId && c.clientSecret && c.redirectUri),
      configSource: c.source,
      /* Never the secret itself — only whether one is present. */
      hasSecret: !!c.clientSecret,
      clientId: c.clientId ? `${c.clientId.slice(0, 6)}…` : "",
      redirectUri: c.redirectUri,
      scopes: SCOPES,
      persistence: "memory",
      memoryWarning: "Connections and any runtime configuration are held in memory and are lost when the server restarts.",
      tokenRequired: !!RELAY_TOKEN,
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method", "Use GET or POST.");
  }
  if (RELAY_TOKEN && req.headers["x-unison-token"] !== RELAY_TOKEN) {
    return fail(res, 401, "unauthorized", "This relay needs a token.");
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  try {
    switch (body.action) {
      case "configure": return res.status(200).json(configure(body));
      case "start": return res.status(200).json(start(body));
      case "exchange": return res.status(200).json(await exchange(body));
      case "status": return res.status(200).json(sessionStatus(body));
      case "disconnect": return res.status(200).json(disconnect(body));
      case "templates": return res.status(200).json(await templates(body));
      case "dataset": return res.status(200).json(await dataset(body));
      case "upload": return res.status(200).json(await assetUpload(body));
      case "uploadJob": return res.status(200).json(await assetJob(body));
      case "autofill": return res.status(200).json(await autofill(body));
      case "job": return res.status(200).json(await job(body));
      case "export": return res.status(200).json(await startExport(body));
      case "exportJob": return res.status(200).json(await exportJob(body));
      case "fetch": return res.status(200).json(await fetchExported(body));
      default: return fail(res, 400, "unknown_action", `Unknown action "${body.action}".`);
    }
  } catch (e) {
    const status = e?.status || 502;
    /* Never log a token or a secret. The action and the status are enough to
       diagnose, and anything more would end up in a hosting provider's logs. */
    console.error("[unison:canva]", body.action, status, String(e?.code || ""));
    return fail(res, status, e?.code || "upstream", String(e?.message || "Canva refused the request."));
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
const err = (message, code, status) => Object.assign(new Error(message), { code, status });

/* ---------- configuration ---------- */

function configure({ clientId, clientSecret, redirectUri }) {
  if (ENV.clientId && ENV.clientSecret) {
    throw err("This deployment is configured from its environment, which cannot be overridden at runtime.", "env_locked", 409);
  }
  /* Runtime configuration exists for local development. On a public
     deployment an unauthenticated caller could otherwise point this relay at
     their own Canva integration, so there it is refused unless the relay is
     behind a token. */
  if (IS_PRODUCTION && !RELAY_TOKEN) {
    throw err("On a deployed instance, set CANVA_CLIENT_ID, CANVA_CLIENT_SECRET and CANVA_REDIRECT_URI in the environment — or set UNISON_RELAY_TOKEN if you really want to configure it from the browser.", "needs_env", 403);
  }
  if (clientId !== undefined) runtime.clientId = String(clientId || "").trim();
  if (clientSecret !== undefined) runtime.clientSecret = String(clientSecret || "").trim();
  if (redirectUri !== undefined) runtime.redirectUri = String(redirectUri || "").trim();
  const c = cfg();
  return {
    ok: true,
    configured: !!(c.clientId && c.clientSecret && c.redirectUri),
    configSource: c.source,
    persistence: "memory",
    warning: "Held in memory only — it is gone when this server restarts. Set CANVA_CLIENT_ID, CANVA_CLIENT_SECRET and CANVA_REDIRECT_URI in the environment for anything deployed.",
  };
}

/* ---------- OAuth ---------- */

function start() {
  const c = cfg();
  if (!c.clientId || !c.clientSecret) throw err("Add the Canva client ID and secret first.", "not_configured", 503);
  if (!c.redirectUri) throw err("Set the redirect URI to match the one on the Canva integration.", "not_configured", 503);

  sweep();
  /* PKCE. The verifier never leaves this process — only its hash does. */
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));
  pending.set(state, { verifier, createdAt: Date.now() });

  const url = new URL(AUTH_BASE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", c.clientId);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", c.redirectUri);
  return { ok: true, url: url.toString(), state };
}

async function exchange({ code, state }) {
  const c = cfg();
  if (!c.clientId || !c.clientSecret) throw err("Canva is not configured on the server.", "not_configured", 503);
  sweep();
  const held = pending.get(String(state || ""));
  if (!held) throw err("That authorization has expired or was already used. Start again.", "bad_state", 400);
  pending.delete(state);
  if (!code) throw err("Canva did not return an authorization code.", "no_code", 400);

  const tok = await token({
    grant_type: "authorization_code",
    code: String(code),
    code_verifier: held.verifier,
    redirect_uri: c.redirectUri,
  });
  const sessionId = b64url(crypto.randomBytes(32));
  sessions.set(sessionId, {
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || "",
    expiresAt: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
    scope: tok.scope || SCOPES.join(" "),
  });
  /* The session id is a handle to server-side state, not a credential for
     Canva — it cannot be replayed anywhere else. */
  return { ok: true, sessionId, scope: tok.scope || "", expiresIn: Number(tok.expires_in) || 3600 };
}

async function token(params) {
  const c = cfg();
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(TOKEN_URL, {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: new URLSearchParams(params).toString(),
    });
  } finally { clearTimeout(t); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err(j?.message || j?.error_description || `Canva returned ${r.status} from the token endpoint.`, "oauth", r.status === 401 ? 401 : 502);
  if (!j?.access_token) throw err("Canva returned no access token.", "oauth", 502);
  return j;
}

/* Every API call goes through here, which is the only place a token is read. */
async function withToken(sessionId, fn) {
  const s = sessions.get(String(sessionId || ""));
  if (!s) throw err("Not connected to Canva. Connect in Settings → AI.", "not_connected", 401);
  if (Date.now() > s.expiresAt - 60000) {
    if (!s.refreshToken) { sessions.delete(sessionId); throw err("The Canva authorization expired. Connect again.", "expired", 401); }
    try {
      const tok = await token({ grant_type: "refresh_token", refresh_token: s.refreshToken });
      s.accessToken = tok.access_token;
      if (tok.refresh_token) s.refreshToken = tok.refresh_token;
      s.expiresAt = Date.now() + (Number(tok.expires_in) || 3600) * 1000;
    } catch {
      sessions.delete(sessionId);
      throw err("The Canva authorization expired and could not be renewed. Connect again.", "expired", 401);
    }
  }
  return fn(s.accessToken);
}

const sessionStatus = ({ sessionId }) => {
  const s = sessions.get(String(sessionId || ""));
  return { ok: true, connected: !!s, scope: s?.scope || "", expiresAt: s?.expiresAt || null, persistence: "memory" };
};

const disconnect = ({ sessionId }) => {
  sessions.delete(String(sessionId || ""));
  return { ok: true, connected: false };
};

/* ---------- Canva Connect calls ---------- */

async function call(accessToken, path, { method = "GET", json, query, binary, headers } = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== "") url.searchParams.set(k, String(v));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), binary ? Math.max(TIMEOUT_MS, 120000) : TIMEOUT_MS);
  let r;
  try {
    r = await fetch(url, {
      method, signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(binary ? { "Content-Type": "application/octet-stream" } : {}),
        ...(headers || {}),
      },
      body: binary || (json ? JSON.stringify(json) : undefined),
    });
  } finally { clearTimeout(t); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw err("Canva rejected the authorization. Connect again.", "expired", 401);
  if (r.status === 403) {
    throw err(j?.message || "Canva refused this on the connected account's plan. Autofill and brand templates need a Canva Enterprise organisation (paid plans get a limited trial while an integration is in development).", "forbidden", 403);
  }
  if (r.status === 429) throw err("Canva is rate-limiting this integration. Try again shortly.", "rate_limited", 429);
  if (!r.ok) throw err(j?.message || `Canva returned ${r.status}.`, "upstream", 502);
  return j;
}

/* The user's OWN brand templates. Canva has no public API to search its whole
   public template library, so this is the real, supported source of designs —
   and it is the one the connected account is actually allowed to autofill. */
const templates = ({ sessionId, query, continuation }) =>
  withToken(sessionId, async (tk) => {
    const j = await call(tk, "/brand-templates", { query: { query, continuation, ownership: "any" } });
    return {
      ok: true,
      continuation: j.continuation || null,
      items: (j.items || []).map((t) => ({
        id: t.id,
        title: t.title || "Untitled",
        thumbnail: t.thumbnail?.url || null,
        width: t.thumbnail?.width || null,
        height: t.thumbnail?.height || null,
        updatedAt: t.updated_at || null,
        createUrl: t.create_url || null,
        viewUrl: t.view_url || null,
      })),
    };
  });

/* Which fields a template can actually be filled with. Read before offering
   an editor, so the fields shown are the template's real ones. */
const dataset = ({ sessionId, templateId }) =>
  withToken(sessionId, async (tk) => {
    if (!templateId) throw err("No template chosen.", "bad_request", 400);
    const j = await call(tk, `/brand-templates/${encodeURIComponent(templateId)}/dataset`);
    const fields = Object.entries(j.dataset || {}).map(([name, spec]) => ({ name, type: spec?.type || "text" }));
    return { ok: true, fields };
  });

const autofill = ({ sessionId, templateId, data, title }) =>
  withToken(sessionId, async (tk) => {
    if (!templateId) throw err("No template chosen.", "bad_request", 400);
    const j = await call(tk, "/autofills", { method: "POST", json: {
      brand_template_id: templateId,
      title: String(title || "Unison post").slice(0, 120),
      data: data || {},
    } });
    return { ok: true, jobId: j?.job?.id || null, state: j?.job?.status || "in_progress" };
  });

const job = ({ sessionId, jobId }) =>
  withToken(sessionId, async (tk) => {
    if (!jobId) throw err("No job to check.", "bad_request", 400);
    const j = await call(tk, `/autofills/${encodeURIComponent(jobId)}`);
    const st = j?.job?.status;
    if (st === "failed") throw err(j?.job?.error?.message || "Canva could not fill that template.", "job_failed", 502);
    if (st !== "success") return { ok: true, state: "running" };
    const d = j?.job?.result?.design || {};
    return { ok: true, state: "done", design: { id: d.id, title: d.title, editUrl: d.urls?.edit_url || null, viewUrl: d.urls?.view_url || null, thumbnail: d.thumbnail?.url || null } };
  });

/* Image and logo fields can only be filled with an asset the account owns, so
   a picked file has to be uploaded to Canva first. The bytes come through as
   base64 because that is what the browser already has for an uploaded file;
   they are sent on to Canva as the binary body its API documents.
   POST /v1/asset-uploads, with the name base64-encoded in a header. */
const UPLOAD_LIMIT = 25 * 1024 * 1024;

const assetUpload = ({ sessionId, name, b64 }) =>
  withToken(sessionId, async (tk) => {
    if (!b64) throw err("No file to upload.", "bad_request", 400);
    let buf;
    try { buf = Buffer.from(String(b64), "base64"); } catch { buf = null; }
    if (!buf?.length) throw err("That file could not be read.", "bad_request", 400);
    if (buf.length > UPLOAD_LIMIT) throw err("That file is too large for Canva to accept.", "too_large", 413);
    const label = String(name || "unison-upload").slice(0, 80);
    const j = await call(tk, "/asset-uploads", {
      method: "POST",
      binary: buf,
      headers: { "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(label, "utf8").toString("base64") }) },
    });
    return { ok: true, jobId: j?.job?.id || null, state: j?.job?.status || "in_progress" };
  });

const assetJob = ({ sessionId, jobId }) =>
  withToken(sessionId, async (tk) => {
    if (!jobId) throw err("No upload to check.", "bad_request", 400);
    const j = await call(tk, `/asset-uploads/${encodeURIComponent(jobId)}`);
    const st = j?.job?.status;
    if (st === "failed") throw err(j?.job?.error?.message || "Canva could not accept that file.", "upload_failed", 502);
    if (st !== "success") return { ok: true, state: "running" };
    return { ok: true, state: "done", assetId: j?.job?.asset?.id || null };
  });

const startExport = ({ sessionId, designId, format }) =>
  withToken(sessionId, async (tk) => {
    if (!designId) throw err("No design to export.", "bad_request", 400);
    const f = format === "mp4" ? { type: "mp4", quality: "horizontal_1080p" } : { type: "png", lossless: true };
    const j = await call(tk, "/exports", { method: "POST", json: { design_id: designId, format: f } });
    return { ok: true, jobId: j?.job?.id || null, state: j?.job?.status || "in_progress", format: f.type };
  });

const exportJob = ({ sessionId, jobId }) =>
  withToken(sessionId, async (tk) => {
    if (!jobId) throw err("No export to check.", "bad_request", 400);
    const j = await call(tk, `/exports/${encodeURIComponent(jobId)}`);
    const st = j?.job?.status;
    if (st === "failed") throw err(j?.job?.error?.message || "Canva could not export that design.", "export_failed", 502);
    if (st !== "success") return { ok: true, state: "running" };
    return { ok: true, state: "done", urls: j?.job?.urls || [] };
  });

/* Canva's export URLs are short-lived and cross-origin. Fetching them here
   keeps the browser out of it and hands back bytes the existing publishing
   path already accepts. */
const fetchExported = ({ sessionId, url }) =>
  withToken(sessionId, async () => {
    const u = String(url || "");
    let parsed;
    try { parsed = new URL(u); } catch { throw err("That is not a URL.", "bad_request", 400); }
    /* Only ever fetch from Canva's own export hosts — this must not become an
       open proxy that will fetch anything a client names. */
    if (parsed.protocol !== "https:" || !/(^|\.)canva\.com$/.test(parsed.hostname)) {
      throw err("Only Canva export URLs can be fetched through this relay.", "bad_host", 400);
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), Math.max(TIMEOUT_MS, 120000));
    let r;
    try { r = await fetch(parsed, { signal: ctl.signal }); } finally { clearTimeout(t); }
    if (!r.ok) throw err(`Could not download the export (${r.status}).`, "download", 502);
    const buf = Buffer.from(await r.arrayBuffer());
    const mime = r.headers.get("content-type") || (u.includes(".mp4") ? "video/mp4" : "image/png");
    return { ok: true, mime, bytes: buf.length, b64: buf.toString("base64") };
  });

/* Exposed for tests. */
export const __test = { sessions, pending, runtime, cfg };
