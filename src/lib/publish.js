import { relayAuthHeaders } from "./store.js";


/* ============================================================
   LINKEDIN PUBLISHING BRIDGE — makeLinkedInService
   For this prototype the approved post goes to a Make scenario that owns the
   LinkedIn connection and authorization. Unison never calls LinkedIn here and
   never holds a LinkedIn credential. This module is the only place that
   talks to that endpoint, and the URL lives in exactly one constant.
   ============================================================ */

export const MAKE_LINKEDIN_WEBHOOK_URL = "https://hook.eu1.make.com/5sva21xc67b9vne5zovgbohnqgbll15k";

/* Publishing settings kept on this device (Settings → LinkedIn). The webhook
   above is the team's default; it can be swapped without a code change. */
export const PUBLISH_SETTINGS_KEY = "unison:publish:v1";

const debugOn = () => { try { return (typeof window !== "undefined" && window.UNISON_DEBUG === true) || localStorage.getItem("unison:debug") === "1"; } catch { return false; } };
export function loadPublishSettings() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PUBLISH_SETTINGS_KEY) : null;
    const s = raw ? JSON.parse(raw) : {};
    if (typeof s.webhookUrl === "string" && s.webhookUrl.trim()) MAKE_CONFIG.url = s.webhookUrl.trim();
  } catch { /* first run */ }
  return snapshotPublishSettings();
}
export const snapshotPublishSettings = () => ({ webhookUrl: MAKE_CONFIG.url, defaultWebhookUrl: MAKE_LINKEDIN_WEBHOOK_URL, isDefault: MAKE_CONFIG.url === MAKE_LINKEDIN_WEBHOOK_URL });
export function savePublishSettings({ webhookUrl } = {}) {
  const url = String(webhookUrl || "").trim();
  MAKE_CONFIG.url = url || MAKE_LINKEDIN_WEBHOOK_URL;
  try { localStorage.setItem(PUBLISH_SETTINGS_KEY, JSON.stringify({ webhookUrl: url && url !== MAKE_LINKEDIN_WEBHOOK_URL ? url : "" })); } catch { /* private mode */ }
  return snapshotPublishSettings();
}

/* The relay is the production path: same-origin, so no CORS and no preflight,
   and the webhook URL stays on the server. The direct browser POST is kept
   only as a fallback for running this file standalone with no API behind it. */
export const PUBLISH_RELAY_PATH = (typeof window !== "undefined" && window.UNISON_PUBLISH_API) || "/api/publish";

export const MAKE_CONFIG = {
  relay: PUBLISH_RELAY_PATH,
  url: MAKE_LINKEDIN_WEBHOOK_URL,   // used by the relay; only used in the browser as a fallback
  source: "unison-content-os",
  timeoutMs: 45000,
  maxPayloadBytes: 4 * 1024 * 1024,
  /* Which Company Page the scenario posts to. Make owns the authorization, so
     Unison can't discover this — set it here (or in Settings) purely so the
     scenario receives it alongside the post. */
  company: { name: null, urn: null },
  /* Every post type is handed to Make; the scenario routes on postType. */
  supportedPostTypes: ["text", "image", "multi", "video", "document", "poll", "article", "carousel"],
  debug: debugOn(),   // console tracing; set localStorage["unison:debug"]="1" to turn on
};

/* Direct-to-Make bodies. A browser POST with Content-Type: application/json
   is not a simple CORS request, so the browser preflights it and Make's
   webhook does not answer preflights. These keep the same JSON inside a
   safelisted content type. The relay has no such constraint. */
export const MAKE_TRANSPORTS = {
  text: (json) => ({ headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: json }),
  form: (json) => ({ headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: "payload=" + encodeURIComponent(json) }),
  json: (json) => ({ headers: { "Content-Type": "application/json" }, body: json }),
};
export const MAKE_TRANSPORT_ORDER = ["text", "form"];

export const mkLog = (...a) => { if (MAKE_CONFIG.debug) console.log("[unison:publish]", ...a); };

/* Did something tell us LinkedIn actually published? Only an unambiguous
   reply counts. Make's default "Accepted" means delivered and nothing more. */
export function readMakeReply(body) {
  if (!body || typeof body !== "object") return { published: false, urn: null, url: null, message: null };
  const inner = body.make && typeof body.make === "object" ? body.make : body;
  const cand = [inner.urn, inner.postUrn, inner.linkedinUrn, inner.linkedinPostId, inner.shareUrn, inner.ugcPostUrn].map((x) => (x == null ? "" : String(x))).find((x) => /^urn:li:/.test(x)) || null;
  const url = [inner.url, inner.postUrl, inner.linkedinUrl].find((x) => typeof x === "string" && /^https?:\/\//.test(x)) || null;
  const st = String(inner.status || inner.result || "").toLowerCase();
  /* "Accepted"/"ok"/"success" from a webhook only means Make has it. */
  const published = st === "published" || !!cand || (!!url && /linkedin\.com/.test(url));
  return { published, urn: cand, url, message: inner.message || inner.error || null };
}

export const makeLinkedInService = {
  configured: () => /^https:\/\/hook\.[a-z0-9.-]+\.make\.com\//.test(MAKE_CONFIG.url),
  supports: (postType) => MAKE_CONFIG.supportedPostTypes.includes(postType),

  /* ---- production path: Unison frontend → Unison API → Make → LinkedIn ----
     Same origin, so the request is never subject to CORS. The relay forwards
     the whole payload and reports back what Make said. */
  async viaRelay(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MAKE_CONFIG.timeoutMs);
    const startedAt = Date.now();
    mkLog("sending via relay", { endpoint: MAKE_CONFIG.relay, postId: payload.postId, postType: payload.postType, idempotencyKey: payload.idempotencyKey, media: payload.media?.length || 0, poll: !!payload.poll });
    let res;
    try {
      res = await fetch(MAKE_CONFIG.relay, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": payload.idempotencyKey || payload.postId, ...relayAuthHeaders() },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = e?.name === "AbortError";
      mkLog(timedOut ? "relay timed out" : "relay unreachable", { error: String(e?.message || e), ms: Date.now() - startedAt });
      throw Object.assign(new Error(timedOut ? "Timed out." : "Relay unreachable."), { kind: timedOut ? "timeout" : "relay-down", cause: e });
    }
    clearTimeout(timer);
    const raw = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
    mkLog("relay response", { status: res.status, ok: res.ok, ms: Date.now() - startedAt, body: parsed ?? raw.slice(0, 300) });

    /* No API deployed behind this page: the request was answered by the static
       host, not by the relay. Distinguishable, and not a publishing failure. */
    if (res.status === 404 || res.status === 405 || (!parsed && /<!doctype html/i.test(raw))) {
      throw Object.assign(new Error("No publishing service at this address."), { kind: "relay-missing", status: res.status });
    }
    if (!res.ok) {
      throw Object.assign(new Error(parsed?.error || `Publishing service returned ${res.status}.`), { kind: "relay-error", status: res.status, body: parsed ?? raw });
    }
    if (parsed?.duplicate) mkLog("relay reported this post was already delivered — not sent again");
    return { ok: true, delivered: true, confirmed: true, status: res.status, transport: "relay", duplicate: !!parsed?.duplicate, raw: parsed ?? raw, ...readMakeReply(parsed), at: new Date().toISOString() };
  },

  /* ---- fallback: browser straight to Make ----
     Only reached when no relay is deployed. ONE request, ever. A browser POST
     with text/plain needs no preflight, so the request reaches Make even when
     the reply cannot be read; when that happens the post is reported as sent
     but unconfirmed rather than retried, because a retry would post it twice. */
  async viaBrowser(payload) {
    if (!makeLinkedInService.configured()) throw Object.assign(new Error("Publishing endpoint not configured."), { kind: "unconfigured" });
    const json = JSON.stringify(payload);
    if (json.length > MAKE_CONFIG.maxPayloadBytes) throw Object.assign(new Error("Payload too large."), { kind: "too-large", bytes: json.length });
    const { headers, body } = MAKE_TRANSPORTS.text(json);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MAKE_CONFIG.timeoutMs);
    const startedAt = Date.now();
    mkLog("sending direct", { transport: "text", postId: payload.postId, postType: payload.postType, bytes: json.length });
    let res;
    try {
      res = await fetch(MAKE_CONFIG.url, { method: "POST", mode: "cors", headers, body, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (e?.name === "AbortError") {
        mkLog("timed out", { hint: "The post may already have reached Make. Check the scenario history before resending." });
        throw Object.assign(new Error("Timed out."), { kind: "timeout", transport: "text", cause: e });
      }
      /* Either the browser blocked the request before sending, or Make
         received it and the reply was not readable (no CORS header on the
         scenario's Webhook Response). Tell them apart before saying anything. */
      const d = await makeLinkedInService.diagnose();
      mkLog(d.networkAllowed ? "sent, reply unreadable" : "browser refused the request", { error: String(e?.message || e), ms: Date.now() - startedAt, framed: d.framed });
      if (d.networkAllowed) {
        return { ok: true, delivered: null, confirmed: false, unverified: true, status: 0, transport: "text", published: false, urn: null, url: null, message: null, at: new Date().toISOString(), framed: d.framed };
      }
      throw Object.assign(new Error("Request blocked."), { kind: "sandbox", transport: "text", framed: d.framed, cause: e });
    }
    clearTimeout(timer);
    const raw = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
    mkLog("response", { status: res.status, ok: res.ok, ms: Date.now() - startedAt, body: parsed ?? raw.slice(0, 300) });
    if (!res.ok) throw Object.assign(new Error(`Make returned ${res.status}.`), { kind: "http", status: res.status, transport: "text", body: parsed ?? raw });
    return { ok: true, delivered: true, confirmed: true, status: res.status, transport: "text", raw: parsed ?? raw, ...readMakeReply(parsed), at: new Date().toISOString() };
  },

  /* Relay first, browser second. One logical send: the fallback only runs
     when the relay was never there to receive the post. */
  async publish(payload) {
    try {
      return await makeLinkedInService.viaRelay(payload);
    } catch (e) {
      if (e?.kind !== "relay-missing" && e?.kind !== "relay-down") throw e;
      mkLog("no relay available — falling back to a direct request", { reason: e.kind });
      const r = await makeLinkedInService.viaBrowser(payload);
      return { ...r, fallback: true };
    }
  },

  /* Is a relay deployed, and can it reach Make? Cheap, no post involved. */
  async health() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(MAKE_CONFIG.relay, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: ctrl.signal });
      const raw = await res.text().catch(() => "");
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      if (!res.ok || !body?.service) return { relay: false };
      mkLog("relay health", body);
      return { relay: true, ...body };
    } catch { return { relay: false }; }
    finally { clearTimeout(timer); }
  },

  /* Tells apart "the environment allows outside requests but Make's reply is
     unreadable" from "this page cannot make outside requests at all". A GET
     to the host root, never the webhook path, so no scenario is triggered. */
  async diagnose() {
    let origin;
    try { origin = new URL(MAKE_CONFIG.url).origin; } catch { return { networkAllowed: false, reason: "bad-url" }; }
    const framed = typeof window !== "undefined" && window.self !== window.top;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      await fetch(origin + "/", { method: "GET", mode: "no-cors", cache: "no-store", signal: ctrl.signal });
      mkLog("diagnosis: outside requests are allowed — Make's reply was unreadable, the request itself was not blocked", { framed });
      return { networkAllowed: true, framed };
    } catch (e) {
      mkLog("diagnosis: this environment blocks outside requests", { framed, hint: framed ? "Running inside a sandboxed preview frame. Deploy Unison with its API to publish." : "Check the network, an extension, or the page's content security policy." });
      return { networkAllowed: false, framed };
    } finally { clearTimeout(timer); }
  },

  /* Last resort, only on an explicit user action. A no-cors POST does leave
     the browser, but the response is opaque, so delivery cannot be verified
     from here — the result says exactly that and never claims success. */
  async sendUnverified(payload) {
    const { headers, body } = MAKE_TRANSPORTS.text(JSON.stringify(payload));
    mkLog("sending without response access (no-cors)", { postId: payload.postId, idempotencyKey: payload.idempotencyKey });
    await fetch(MAKE_CONFIG.url, { method: "POST", mode: "no-cors", headers, body });
    mkLog("no-cors request completed — the response is opaque, so delivery is unverifiable from the browser");
    return { ok: true, delivered: null, confirmed: false, status: 0, transport: "no-cors", published: false, urn: null, url: null, at: new Date().toISOString() };
  },
};
