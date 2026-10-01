/**
 * Unison Canva relay
 *
 *   Unison frontend  ->  this endpoint  ->  Canva Connect API
 *
 * Everything secret lives here. The browser never receives the client secret,
 * an access token or a refresh token — there is no route that returns one.
 *
 * WHY SESSIONS ARE COOKIES, NOT MEMORY
 * The first version kept sessions and the PKCE verifier in this process's
 * memory. On Vercel each request can land on a different function instance,
 * and instances are recycled after a few idle minutes — so the OAuth round
 * trip could fail with "authorization expired", and a working connection
 * could vanish between two clicks. Now both live in a sealed cookie:
 *   - AES-256-GCM encrypted, with a key derived from CANVA_CLIENT_SECRET
 *     (or CANVA_SESSION_SECRET if set), so the browser holds ciphertext it
 *     cannot read or alter;
 *   - HttpOnly, so no script on the page can touch it;
 *   - SameSite=Lax and Path=/api/canva, so it is sent only to this relay and
 *     never with a cross-site POST;
 *   - Secure whenever the request arrived over HTTPS.
 * No new environment variable is required and the redirect URL is unchanged.
 *
 * Canva refresh tokens are single-use: replaying one revokes the whole
 * connection. The refreshed pair is written straight back to the cookie, and
 * the client sends one request at a time so two calls never race to refresh.
 *
 * Configuration (server-side only):
 *   CANVA_CLIENT_ID, CANVA_CLIENT_SECRET, CANVA_REDIRECT_URI
 *   CANVA_SESSION_SECRET (optional) — rotate sessions without rotating the secret
 */

import crypto from "node:crypto";
import zlib from "node:zlib";

const ENV = {
  clientId: process.env.CANVA_CLIENT_ID || "",
  clientSecret: process.env.CANVA_CLIENT_SECRET || "",
  redirectUri: process.env.CANVA_REDIRECT_URI || "",
};

/* Runtime configuration for local development only. Memory only. */
const runtime = { clientId: "", clientSecret: "", redirectUri: "" };
const cfg = () => ({
  clientId: runtime.clientId || ENV.clientId,
  clientSecret: runtime.clientSecret || ENV.clientSecret,
  redirectUri: runtime.redirectUri || ENV.redirectUri,
  source: (runtime.clientId || runtime.clientSecret) ? "runtime" : (ENV.clientId ? "env" : "none"),
});

const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";
const IS_PRODUCTION = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
const TIMEOUT_MS = Number(process.env.CANVA_TIMEOUT_MS || 30000);
const DOWNLOAD_LIMIT = 200 * 1024 * 1024;
const UPLOAD_LIMIT = 25 * 1024 * 1024;

const AUTH_BASE = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const REVOKE_URL = "https://api.canva.com/rest/v1/oauth/revoke";
const API = "https://api.canva.com/rest/v1";

/* Only what the features need — unchanged from the first version, so an
   integration already approved for these scopes needs no change. */
export const SCOPES = [
  "design:meta:read",
  "design:content:read",
  "design:content:write",
  "asset:read",
  "asset:write",
  "brandtemplate:meta:read",
  "brandtemplate:content:read",
];

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const err = (message, code, status) => Object.assign(new Error(message), { code, status });
const fail = (res, status, code, message) => res.status(status).json({ ok: false, code, message });

/* ---------- sealed cookies ---------- */

const SESSION = "uc_s";
const PKCE = "uc_p";
const CHUNK = 3600;          /* under the 4096-byte cookie limit with room for attributes */
const MAX_CHUNKS = 4;
const SESSION_AGE = 60 * 60 * 24 * 30;
const PKCE_AGE = 60 * 10;

function keyFor(purpose) {
  const ikm = process.env.CANVA_SESSION_SECRET || cfg().clientSecret;
  if (!ikm) return null;
  return Buffer.from(crypto.hkdfSync("sha256", ikm, "unison-canva-relay", `v1:${purpose}`, 32));
}

export function seal(obj, purpose) {
  const key = keyFor(purpose);
  if (!key) throw err("Canva is not configured on the server.", "not_configured", 503);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(zlib.deflateRawSync(Buffer.from(JSON.stringify(obj)))), c.final()]);
  return b64url(Buffer.concat([iv, c.getAuthTag(), ct]));
}

export function unseal(str, purpose) {
  try {
    const key = keyFor(purpose);
    if (!key || !str) return null;
    const raw = unb64url(str);
    const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(zlib.inflateRawSync(Buffer.concat([d.update(raw.subarray(28)), d.final()])).toString());
  } catch { return null; }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const isSecure = (req) => String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https" || IS_PRODUCTION;
function setCookie(req, res, name, value, maxAge) {
  const c = `${name}=${value}; Path=/api/canva; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req) ? "; Secure" : ""}`;
  res.__cookies = [...(res.__cookies || []).filter((x) => !x.startsWith(`${name}=`)), c];
  res.setHeader("Set-Cookie", res.__cookies);
}

function readSession(req) {
  const jar = cookies(req);
  let joined = "";
  for (let i = 0; i < MAX_CHUNKS; i++) { if (!jar[`${SESSION}${i}`]) break; joined += jar[`${SESSION}${i}`]; }
  return joined ? unseal(joined, "session") : null;
}

function writeSession(req, res, s) {
  const sealed = seal(s, "session");
  const parts = sealed.match(new RegExp(`.{1,${CHUNK}}`, "g")) || [];
  if (parts.length > MAX_CHUNKS) throw err("The Canva session is too large to store.", "session_size", 500);
  for (let i = 0; i < MAX_CHUNKS; i++) {
    if (parts[i]) setCookie(req, res, `${SESSION}${i}`, parts[i], SESSION_AGE);
    else if (cookies(req)[`${SESSION}${i}`]) setCookie(req, res, `${SESSION}${i}`, "", 0);
  }
}

function clearSession(req, res) {
  for (let i = 0; i < MAX_CHUNKS; i++) setCookie(req, res, `${SESSION}${i}`, "", 0);
}

/* ---------- handler ---------- */

const STREAMED = Symbol("streamed");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const c = cfg();
    return res.status(200).json({
      service: "unison-canva-relay",
      version: 2,
      configured: !!(c.clientId && c.clientSecret && c.redirectUri),
      configSource: c.source,
      hasSecret: !!c.clientSecret,                       /* never the secret itself */
      clientId: c.clientId ? `${c.clientId.slice(0, 6)}…` : "",
      redirectUri: c.redirectUri,
      scopes: SCOPES,
      persistence: c.source === "runtime" ? "memory" : "cookie",
      memoryWarning: c.source === "runtime" ? "The client ID and secret were typed into Settings and are held in this server's memory — gone when it restarts." : "",
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

  const binary = Buffer.isBuffer(req.body) ? req.body : null;
  const body = binary ? {} : (typeof req.body === "string" ? safeParse(req.body) : req.body || {});
  const action = body.action || req.query?.action;
  try {
    let out;
    switch (action) {
      case "configure": out = configure(body); break;
      case "start": out = start(req, res); break;
      case "exchange": out = await exchange(req, res, body); break;
      case "status": out = status(req); break;
      case "disconnect": out = await disconnect(req, res); break;
      case "templates": out = await templates(req, res, body); break;
      case "dataset": out = await dataset(req, res, body); break;
      case "autofill": out = await autofill(req, res, body); break;
      case "job": out = await autofillJob(req, res, body); break;
      case "designs": out = await designs(req, res, body); break;
      case "design": out = await design(req, res, body); break;
      case "createDesign": out = await createDesign(req, res, body); break;
      case "exportFormats": out = await exportFormats(req, res, body); break;
      case "export": out = await startExport(req, res, body); break;
      case "exportJob": out = await exportJob(req, res, body); break;
      case "download": out = await download(req, res, body); break;
      case "upload": out = await assetUpload(req, res, binary, body, req.query || {}); break;
      case "uploadJob": out = await assetJob(req, res, body); break;
      case "uploadUrl": out = await urlUpload(req, res, body); break;
      case "uploadUrlJob": out = await urlUploadJob(req, res, body); break;
      default: return fail(res, 400, "unknown_action", `Unknown action "${action}".`);
    }
    if (out === STREAMED) return undefined;
    return res.status(200).json(out);
  } catch (e) {
    const code = e?.status || 502;
    /* The action and status are enough to diagnose. Never a token or secret. */
    console.error("[unison:canva]", action, code, String(e?.code || ""));
    if (res.headersSent) { try { res.end(); } catch { /* already closed */ } return undefined; }
    return fail(res, code, e?.code || "upstream", String(e?.message || "Canva refused the request."));
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

/* ---------- configuration ---------- */

function configure({ clientId, clientSecret, redirectUri }) {
  if (ENV.clientId && ENV.clientSecret) {
    throw err("This deployment is configured from its environment, which cannot be overridden at runtime.", "env_locked", 409);
  }
  /* On a public deployment an unauthenticated caller could otherwise point
     this relay at their own Canva integration. */
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
    warning: "Held in memory only — gone when this server restarts. Set CANVA_CLIENT_ID, CANVA_CLIENT_SECRET and CANVA_REDIRECT_URI in the environment for anything deployed.",
  };
}

/* ---------- OAuth ---------- */

function start(req, res) {
  const c = cfg();
  if (!c.clientId || !c.clientSecret) throw err("Add the Canva client ID and secret first.", "not_configured", 503);
  if (!c.redirectUri) throw err("Set the redirect URI to match the one on the Canva integration.", "not_configured", 503);
  /* PKCE. The verifier never leaves this server in readable form: it travels
     in a sealed, HttpOnly cookie that only this relay can open. */
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(24));
  setCookie(req, res, PKCE, seal({ state, verifier, at: Date.now() }, "pkce"), PKCE_AGE);

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

async function exchange(req, res, { code, state }) {
  const c = cfg();
  if (!c.clientId || !c.clientSecret) throw err("Canva is not configured on the server.", "not_configured", 503);
  const held = unseal(cookies(req)[PKCE], "pkce");
  setCookie(req, res, PKCE, "", 0);                    /* single use, whatever happens next */
  if (!held || held.state !== String(state || "") || Date.now() - held.at > PKCE_AGE * 1000) {
    throw err("That authorization has expired or was already used. Start again.", "bad_state", 400);
  }
  if (!code) throw err("Canva did not return an authorization code.", "no_code", 400);

  const tok = await token({ grant_type: "authorization_code", code: String(code), code_verifier: held.verifier, redirect_uri: c.redirectUri });
  writeSession(req, res, { a: tok.access_token, r: tok.refresh_token || "", e: Date.now() + (Number(tok.expires_in) || 3600) * 1000, s: tok.scope || SCOPES.join(" ") });
  return { ok: true, connected: true, scope: tok.scope || "", expiresIn: Number(tok.expires_in) || 3600 };
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

/* The only place a token is read. Renews it shortly before expiry and writes
   the new pair back, because the old refresh token is now spent. */
async function withToken(req, res, fn) {
  const s = readSession(req);
  if (!s?.a) throw err("Not connected to Canva. Connect in Settings → AI.", "not_connected", 401);
  if (Date.now() > s.e - 60000) {
    if (!s.r) { clearSession(req, res); throw err("The Canva connection expired. Connect again.", "expired", 401); }
    try {
      const tok = await token({ grant_type: "refresh_token", refresh_token: s.r });
      s.a = tok.access_token;
      s.r = tok.refresh_token || s.r;
      s.e = Date.now() + (Number(tok.expires_in) || 3600) * 1000;
      writeSession(req, res, s);
    } catch {
      clearSession(req, res);
      throw err("The Canva connection expired and could not be renewed. Connect again.", "expired", 401);
    }
  }
  return fn(s.a);
}

function status(req) {
  const s = readSession(req);
  return { ok: true, connected: !!s?.a, scope: s?.s || "", expiresAt: s?.e || null };
}

async function disconnect(req, res) {
  const s = readSession(req);
  clearSession(req, res);
  /* Revoking the refresh token ends the whole connection on Canva's side too,
     so "Disconnect" means what it says. Best effort: the cookie is gone either way. */
  if (s?.r && cfg().clientSecret) {
    const c = cfg();
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}` },
        body: new URLSearchParams({ token: s.r }).toString(),
      });
    } catch { /* already disconnected locally */ }
  }
  return { ok: true, connected: false };
}

/* ---------- Canva calls ---------- */

async function call(accessToken, path, { method = "GET", json, query, binary, headers, kind } = {}) {
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
  } catch (e) {
    throw err(e?.name === "AbortError" ? "Canva did not answer in time." : "Canva could not be reached.", "network", 504);
  } finally { clearTimeout(t); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw err("Canva rejected the connection. Connect again.", "expired", 401);
  if (r.status === 403) {
    throw err(kind === "enterprise"
      ? "Canva refused this for the connected account. Brand templates and Autofill are available to Canva Enterprise organisations (paid plans get a limited trial while an integration is in development). Everything else — opening designs in Canva and exporting them — still works."
      : (j?.message || "Canva refused this request for the connected account."), kind === "enterprise" ? "enterprise_required" : "forbidden", 403);
  }
  if (r.status === 404) throw err(j?.message || "Canva could not find that design or job.", "not_found", 404);
  if (r.status === 429) throw err("Canva is rate-limiting this integration. Wait a minute and try again.", "rate_limited", 429);
  if (!r.ok) throw err(j?.message || `Canva returned ${r.status}.`, "upstream", 502);
  return j;
}

const designOut = (d) => d && ({
  id: d.id,
  title: d.title || "Untitled design",
  editUrl: d.urls?.edit_url || null,
  viewUrl: d.urls?.view_url || null,
  thumbnail: d.thumbnail?.url || null,
  width: d.thumbnail?.width || null,
  height: d.thumbnail?.height || null,
  pageCount: d.page_count || null,
  updatedAt: d.updated_at || null,
});

/* The connected account's own brand templates. Canva has no public API for
   searching its whole template library. */
const templates = (req, res, { query, continuation }) =>
  withToken(req, res, async (tk) => {
    const j = await call(tk, "/brand-templates", { query: { query, continuation, ownership: "any" }, kind: "enterprise" });
    return {
      ok: true,
      continuation: j.continuation || null,
      items: (j.items || []).map((t) => ({
        id: t.id, title: t.title || "Untitled",
        thumbnail: t.thumbnail?.url || null, width: t.thumbnail?.width || null, height: t.thumbnail?.height || null,
        updatedAt: t.updated_at || null, createUrl: t.create_url || null, viewUrl: t.view_url || null,
      })),
    };
  });

const dataset = (req, res, { templateId }) =>
  withToken(req, res, async (tk) => {
    if (!templateId) throw err("No template chosen.", "bad_request", 400);
    const j = await call(tk, `/brand-templates/${encodeURIComponent(templateId)}/dataset`, { kind: "enterprise" });
    return { ok: true, fields: Object.entries(j.dataset || {}).map(([name, spec]) => ({ name, type: spec?.type || "text" })) };
  });

const autofill = (req, res, { templateId, data, title }) =>
  withToken(req, res, async (tk) => {
    if (!templateId) throw err("No template chosen.", "bad_request", 400);
    const j = await call(tk, "/autofills", { method: "POST", kind: "enterprise", json: { brand_template_id: templateId, title: String(title || "Unison post").slice(0, 120), data: data || {} } });
    return { ok: true, jobId: j?.job?.id || null, state: j?.job?.status || "in_progress" };
  });

const autofillJob = (req, res, { jobId }) =>
  withToken(req, res, async (tk) => {
    if (!jobId) throw err("No job to check.", "bad_request", 400);
    const j = await call(tk, `/autofills/${encodeURIComponent(jobId)}`, { kind: "enterprise" });
    const st = j?.job?.status;
    if (st === "failed") throw err(j?.job?.error?.message || "Canva could not fill that template.", "job_failed", 502);
    if (st !== "success") return { ok: true, state: "running" };
    return { ok: true, state: "done", design: designOut(j?.job?.result?.design) };
  });

/* The account's own designs — so a design made or finished in Canva can be
   brought back, whether or not Unison created it. */
const designs = (req, res, { query, continuation }) =>
  withToken(req, res, async (tk) => {
    const j = await call(tk, "/designs", { query: { query, continuation, ownership: "any", sort_by: "modified_descending" } });
    return { ok: true, continuation: j.continuation || null, items: (j.items || []).map(designOut) };
  });

const design = (req, res, { designId }) =>
  withToken(req, res, async (tk) => {
    if (!designId) throw err("No design given.", "bad_request", 400);
    const j = await call(tk, `/designs/${encodeURIComponent(designId)}`);
    return { ok: true, design: designOut(j.design) };
  });

/* A new design of an exact size, optionally starting from an uploaded image.
   This is what makes "Edit in Canva" work on every Canva plan: it needs no
   brand template and no Autofill. */
const createDesign = (req, res, { assetId, width, height, title }) =>
  withToken(req, res, async (tk) => {
    const w = Math.round(Number(width)), h = Math.round(Number(height));
    if (!(w >= 40 && w <= 8000 && h >= 40 && h <= 8000)) throw err("A Canva design must be between 40 and 8000 pixels on each side.", "bad_request", 400);
    const j = await call(tk, "/designs", { method: "POST", json: {
      design_type: { type: "custom", width: w, height: h },
      ...(assetId ? { asset_id: String(assetId) } : {}),
      title: String(title || "Unison design").slice(0, 255),
    } });
    return { ok: true, design: designOut(j.design) };
  });

const exportFormats = (req, res, { designId }) =>
  withToken(req, res, async (tk) => {
    if (!designId) throw err("No design given.", "bad_request", 400);
    const j = await call(tk, `/designs/${encodeURIComponent(designId)}/export-formats`);
    return { ok: true, formats: Object.keys(j.formats || {}) };
  });

const MP4_QUALITY = new Set(["horizontal_480p", "horizontal_720p", "horizontal_1080p", "vertical_480p", "vertical_720p", "vertical_1080p"]);
const startExport = (req, res, { designId, format, quality }) =>
  withToken(req, res, async (tk) => {
    if (!designId) throw err("No design to export.", "bad_request", 400);
    const f = format === "mp4"
      ? { type: "mp4", quality: MP4_QUALITY.has(quality) ? quality : "horizontal_1080p" }
      : format === "jpg" ? { type: "jpg", quality: 92 } : { type: "png" };
    const j = await call(tk, "/exports", { method: "POST", json: { design_id: String(designId), format: f } });
    return { ok: true, jobId: j?.job?.id || null, state: j?.job?.status || "in_progress", format: f.type };
  });

/* The download addresses stay here. The browser asks for "file N of export
   job X" and this relay looks the address up with the user's own token — so
   no client can make this relay fetch a URL of its choosing. */
const exportJob = (req, res, { jobId }) =>
  withToken(req, res, async (tk) => {
    if (!jobId) throw err("No export to check.", "bad_request", 400);
    const j = await call(tk, `/exports/${encodeURIComponent(jobId)}`);
    const st = j?.job?.status;
    if (st === "failed") throw err(j?.job?.error?.message || "Canva could not export that design.", "export_failed", 502);
    if (st !== "success") return { ok: true, state: "running" };
    return { ok: true, state: "done", files: (j?.job?.urls || []).length };
  });

/* What a file actually is, from its first bytes — not what anyone says it is. */
export function sniff(head) {
  const b = Buffer.from(head || []);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { kind: "png", mime: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "jpg", mime: "image/jpeg" };
  if (b.length >= 6 && b.subarray(0, 3).toString("latin1") === "GIF") return { kind: "gif", mime: "image/gif" };
  if (b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp") return { kind: "mp4", mime: "video/mp4" };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "webm", mime: "video/webm" };
  if (b.length >= 4 && b.subarray(0, 4).toString("latin1") === "%PDF") return { kind: "pdf", mime: "application/pdf" };
  return null;
}

/* Streamed, not buffered into JSON: a function response on Vercel is capped
   at 4.5 MB unless it is streamed, and a 1080p MP4 is usually larger. */
const download = (req, res, { jobId, index = 0, expect }) =>
  withToken(req, res, async (tk) => {
    if (!jobId) throw err("No export to download.", "bad_request", 400);
    const j = await call(tk, `/exports/${encodeURIComponent(jobId)}`);
    if (j?.job?.status !== "success") throw err("That export has not finished yet.", "not_ready", 409);
    const url = (j.job.urls || [])[Number(index) || 0];
    if (!url) throw err("Canva reported the export finished but returned no file.", "no_file", 502);

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), Math.max(TIMEOUT_MS, 120000));
    let r;
    try { r = await fetch(url, { signal: ctl.signal }); } catch { clearTimeout(t); throw err("The exported file could not be downloaded from Canva.", "download", 502); }
    if (!r.ok || !r.body) { clearTimeout(t); throw err(`Could not download the export (${r.status}).`, "download", 502); }

    /* The type is read from the file's first bytes, and the network decides
       how many arrive per chunk — so gather enough before deciding. */
    const reader = r.body.getReader();
    let head = Buffer.alloc(0);
    while (head.length < 16) {
      const { done, value } = await reader.read();
      if (done) break;
      head = Buffer.concat([head, Buffer.from(value)]);
    }
    const kind = sniff(head);
    if (!kind) { clearTimeout(t); try { await reader.cancel(); } catch { /* ignore */ } throw err("Canva returned a file that is not an image or a video.", "bad_file", 502); }
    if (expect && expect !== kind.kind && !(expect === "jpg" && kind.kind === "jpg")) {
      clearTimeout(t); try { await reader.cancel(); } catch { /* ignore */ }
      throw err(`Canva returned a ${kind.kind.toUpperCase()} where a ${String(expect).toUpperCase()} was expected.`, "wrong_type", 502);
    }
    const len = Number(r.headers.get("content-length") || 0);
    if (len > DOWNLOAD_LIMIT) { clearTimeout(t); try { await reader.cancel(); } catch { /* ignore */ } throw err("That export is too large to bring into Unison.", "too_large", 413); }

    res.statusCode = 200;
    res.setHeader("Content-Type", kind.mime);
    res.setHeader("X-Unison-Kind", kind.kind);
    if (len) res.setHeader("Content-Length", String(len));
    let total = head.length;
    res.write(head);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > DOWNLOAD_LIMIT) throw err("That export is too large to bring into Unison.", "too_large", 413);
        res.write(Buffer.from(value));
      }
    } finally { clearTimeout(t); }
    res.end();
    return STREAMED;
  });

/* A picked or rendered file, turned into a Canva asset. Sent as raw bytes —
   a third smaller than base64 — because a Vercel function will not accept a
   request body over 4.5 MB. Larger videos go through uploadUrl instead. */
const assetUpload = (req, res, binary, body, query) =>
  withToken(req, res, async (tk) => {
    let buf = binary;
    if (!buf && body.b64) { try { buf = Buffer.from(String(body.b64), "base64"); } catch { buf = null; } }
    if (!buf?.length) throw err("No file to upload.", "bad_request", 400);
    if (buf.length > UPLOAD_LIMIT) throw err("That file is too large to send through this server. Upload it in Canva's editor instead.", "too_large", 413);
    if (!sniff(buf.subarray(0, 16))) throw err("That file is not an image or a video Canva can use.", "bad_file", 400);
    const label = String(query.name || body.name || "unison-upload").slice(0, 80);
    const j = await call(tk, "/asset-uploads", {
      method: "POST", binary: buf,
      headers: { "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(label, "utf8").toString("base64") }) },
    });
    return { ok: true, jobId: j?.job?.id || null, state: j?.job?.status || "in_progress" };
  });

const assetJob = (req, res, { jobId }) =>
  withToken(req, res, async (tk) => {
    if (!jobId) throw err("No upload to check.", "bad_request", 400);
    const j = await call(tk, `/asset-uploads/${encodeURIComponent(jobId)}`);
    const st = j?.job?.status;
    if (st === "failed") throw err(j?.job?.error?.message || "Canva could not accept that file.", "upload_failed", 502);
    if (st !== "success") return { ok: true, state: "running" };
    return { ok: true, state: "done", assetId: j?.job?.asset?.id || null, type: j?.job?.asset?.type || null };
  });

/* Canva fetches the file itself, so there is no size limit on this side.
   Used for AI video clips that already sit at a public address. */
const urlUpload = (req, res, { url, name }) =>
  withToken(req, res, async (tk) => {
    let u;
    try { u = new URL(String(url || "")); } catch { throw err("That is not a web address.", "bad_request", 400); }
    if (u.protocol !== "https:") throw err("Only https addresses can be imported into Canva.", "bad_request", 400);
    const j = await call(tk, "/url-asset-uploads", { method: "POST", json: { name: String(name || "unison-upload").slice(0, 255), url: u.toString() } });
    return { ok: true, jobId: j?.job?.id || null, state: j?.job?.status || "in_progress" };
  });

const urlUploadJob = (req, res, { jobId }) =>
  withToken(req, res, async (tk) => {
    if (!jobId) throw err("No upload to check.", "bad_request", 400);
    const j = await call(tk, `/url-asset-uploads/${encodeURIComponent(jobId)}`);
    const st = j?.job?.status;
    if (st === "failed") throw err(j?.job?.error?.message || "Canva could not import that file.", "upload_failed", 502);
    if (st !== "success") return { ok: true, state: "running" };
    return { ok: true, state: "done", assetId: j?.job?.asset?.id || null, type: j?.job?.asset?.type || null };
  });

/* Exposed for tests. */
export const __test = { runtime, cfg, seal, unseal, readSession, cookies };
