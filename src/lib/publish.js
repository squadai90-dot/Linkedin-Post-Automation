import { relayAuthHeaders } from "./store.js";
import { bridge, bridgeHealth, isBridgeConfigured, getLinkedInSettings } from "./linkedinAuth.js";


/* ============================================================
   LINKEDIN PUBLISHING BRIDGE — makeLinkedInService
   For this prototype the approved post goes to a Make scenario that owns the
   LinkedIn connection and authorization. Unison never calls LinkedIn here and
   never holds a LinkedIn credential. This module is the only place that
   talks to that endpoint, and the URL lives in exactly one constant.
   ============================================================ */

/* Scenario "Unison LinkedIn Publisher" (7482325). It parses the payload below,
   stamps a due time, and queues the post in a data store; a second scenario
   drains that queue on a timer. The older hook that used to sit here fed a
   scenario that is now retired. */
export const MAKE_LINKEDIN_WEBHOOK_URL = "https://hook.eu1.make.com/mkm7o4tvytb4cgfs91se3qnjy5pvucge";

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
  supportedPostTypes: ["text", "image", "video", "poll"],
  /* How often "Unison Scheduled Publisher" looks for posts that have come
     due. Make's free plan allows 1,000 operations a month and every check
     spends one, so a check an hour is what fits with room left to publish.
     A paid plan allows 15-minute checks; change this and the scenario's own
     interval together, or Unison will promise something Make does not do. */
  schedulerIntervalMs: 60 * 60 * 1000,
  debug: debugOn(),   // console tracing; set localStorage["unison:debug"]="1" to turn on
};

/* Direct-to-Make bodies. A browser POST with Content-Type: application/json
   is not a simple CORS request, so the browser preflights it and Make's
   webhook does not answer preflights. These keep the same JSON inside a
   safelisted content type. The relay has no such constraint. */
/* A scheduled post is parked in Make's data store until it is due, and that
   store is capped for the whole team, not per record. Anything queued has to
   fit inside it alongside everything else already waiting. Immediate posts
   stream straight through and are not subject to this. */
export const DATA_STORE_BYTES = 1024 * 1024;
export const SCHEDULED_MEDIA_BUDGET = Math.floor(DATA_STORE_BYTES * 0.6);

export function scheduledMediaFit(payload) {
  const bytes = (payload?.media || []).reduce((n, m) => n + String(m?.data || "").length, 0);
  if (!bytes) return { ok: true, bytes: 0 };
  if (bytes > SCHEDULED_MEDIA_BUDGET) {
    return {
      ok: false, bytes,
      reason: `This post carries ${(bytes / 1048576).toFixed(1)} MB of media. Make's data store holds ${(DATA_STORE_BYTES / 1048576).toFixed(0)} MB in total for the whole team, so a scheduled post cannot take more than about ${(SCHEDULED_MEDIA_BUDGET / 1048576).toFixed(1)} MB without crowding out everything else waiting. Publish it now instead, or use a smaller file.`,
    };
  }
  return { ok: true, bytes };
}

/* When a post handed to Make will actually appear, said honestly: the
   scheduler checks on a timer, so the post goes out at the first check at or
   after its time, never before it. */
export function scheduledWindow(date, time, intervalMs = MAKE_CONFIG.schedulerIntervalMs) {
  const mins = Math.round(intervalMs / 60000);
  const label = mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? "" : "s"}` : `${mins} minutes`;
  return {
    minutes: mins,
    label,
    sentence: `Make checks for due posts every ${label}, so this goes out at ${time || "the chosen time"} on ${date || "the chosen day"} or within the next ${label} — never earlier.`,
  };
}

export const MAKE_TRANSPORTS = {
  text: (json) => ({ headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: json }),
  form: (json) => ({ headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: "payload=" + encodeURIComponent(json) }),
  json: (json) => ({ headers: { "Content-Type": "application/json" }, body: json }),
};
export const MAKE_TRANSPORT_ORDER = ["text", "form"];

export const mkLog = (...a) => { if (MAKE_CONFIG.debug) console.log("[unison:publish]", ...a); };

/* What did Make actually say? The six answers the scenarios can give are
   genuinely different things, and collapsing them into "sent" or "published"
   is how a post that LinkedIn refused ends up showing a tick.

     published   — LinkedIn has it, and the reply carries the urn to prove it
     queued      — Make stored it; LinkedIn has nothing yet
     unsupported — Make kept it; LinkedIn's API cannot post this type
     rejected    — Make would not take it at all
     failed      — Make tried and LinkedIn (or the data store) refused
     accepted    — a bare 2xx: Make has the request, and that is all we know

   "ok"/"success"/"Accepted" is the webhook's own default reply. It says the
   request arrived. It says nothing about LinkedIn, so it lands on accepted. */
const REPLY_STATES = ["published", "queued", "unsupported", "rejected", "failed"];

export function readMakeReply(body) {
  const none = { state: "accepted", published: false, urn: null, url: null, message: null, stage: null };
  if (!body || typeof body !== "object") return none;
  const inner = body.make && typeof body.make === "object" ? body.make : body;
  const cand = [inner.urn, inner.postUrn, inner.linkedinUrn, inner.linkedinPostId, inner.shareUrn, inner.ugcPostUrn].map((x) => (x == null ? "" : String(x))).find((x) => /^urn:li:/.test(x)) || null;
  const url = [inner.url, inner.postUrl, inner.linkedinUrl].find((x) => typeof x === "string" && /^https?:\/\//.test(x)) || null;
  const st = String(inner.status || inner.result || "").toLowerCase();
  const published = st === "published" || !!cand || (!!url && /linkedin\.com/.test(url));
  const state = published ? "published" : REPLY_STATES.includes(st) ? st : "accepted";
  return { state, published, urn: cand, url, message: inner.message || inner.error || null, stage: inner.stage || null };
}

/* A video has to be uploaded to LinkedIn before the scenario can answer, and
   that is measured in tens of seconds, not the couple a text post takes. */
export const publishTimeout = (payload) =>
  payload?.postType === "video" || (payload?.media || []).some((m) => m?.kind === "video")
    ? 120000
    : MAKE_CONFIG.timeoutMs;

export const makeLinkedInService = {
  configured: () => /^https:\/\/hook\.[a-z0-9.-]+\.make\.com\//.test(MAKE_CONFIG.url),
  supports: (postType) => MAKE_CONFIG.supportedPostTypes.includes(postType),

  /* ---- production path: Unison frontend → Unison API → Make → LinkedIn ----
     Same origin, so the request is never subject to CORS. The relay forwards
     the whole payload and reports back what Make said. */
  async viaRelay(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), publishTimeout(payload));
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
      /* The relay hands back whatever the scenario said about the refusal.
         When that names LinkedIn or the data store, say so rather than
         blaming the relay, which only carried the message. */
      const named = parsed?.state === "failed" || parsed?.state === "rejected";
      throw Object.assign(
        new Error(parsed?.error || `Publishing service returned ${res.status}.`),
        { kind: named ? parsed.state : "relay-error", status: res.status, stage: parsed?.stage || null, body: parsed ?? raw }
      );
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
    const timer = setTimeout(() => ctrl.abort(), publishTimeout(payload));
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
    if (!res.ok) {
      /* Make returns 4xx for a webhook whose scenario was deleted or turned
         off. The post is fine; the address is not. Saying so is the whole
         difference between a five-second fix and an afternoon of guessing. */
      const dead = res.status === 400 || res.status === 404 || res.status === 410;
      const reply = readMakeReply(parsed);
      const text = String(reply.message || parsed?.error || raw || "").toLowerCase();
      /* The scenario answers a refused post with 502 and the reason. Only a
         4xx with no such answer means the address itself is wrong. */
      const looksDead = (dead && reply.state === "accepted") || /not exist|no longer|gone|deactivat|disabled|deleted/.test(text);
      const named = reply.state === "failed" || reply.state === "rejected";
      throw Object.assign(
        new Error(looksDead ? "That webhook no longer exists in Make."
          : named && reply.message ? reply.message
          : `Make returned ${res.status}.`),
        { kind: looksDead ? "hook-dead" : named ? reply.state : "http",
          status: res.status, transport: "text", stage: reply.stage, body: parsed ?? raw }
      );
    }
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

/* ---------- straight to LinkedIn (#6) ----------
 With the bridge deployed (api/linkedin.js) and a signed-in Page, a text post
 needs no Make scenario at all: the bridge holds the token and posts through
 LinkedIn's own API, and LinkedIn confirms the post id in the reply.

 Media is deliberately not handled here. An image or video post has to be
 registered and uploaded to LinkedIn before the post can reference it, which
 is several round trips and exactly the part a Make scenario already does
 well. Those keep going to Make. */
export const DIRECT_POST_TYPES = ["text"];

export const directLinkedInService = {
supports: (postType) => DIRECT_POST_TYPES.includes(postType),

/* Can this post go direct right now? Requires a bridge, a token and a Page. */
async available(payload) {
  if (!directLinkedInService.supports(payload?.postType)) return false;
  await bridgeHealth();
  const li = getLinkedInSettings();
  return !!(isBridgeConfigured(li) && li.connection?.accessToken && (payload?.companyUrn || li.connection?.selectedUrn));
},

async publish(payload) {
  const li = getLinkedInSettings();
  const author = payload.companyUrn || li.connection?.selectedUrn;
  if (!author) throw Object.assign(new Error("No Company Page selected."), { kind: "unconfigured" });

  mkLog("sending direct to LinkedIn", { postId: payload.postId, author, postType: payload.postType });
  let r;
  try {
    r = await bridge("publish", {
      access_token: li.connection.accessToken,
      author,
      text: payload.content,
    }, li, { timeoutMs: MAKE_CONFIG.timeoutMs });
  } catch (e) {
    /* An expired token is worth saying plainly — it is the one failure the
       team can fix in ten seconds by signing in again. */
    if (e?.status === 401) throw Object.assign(new Error("LinkedIn rejected the token. Reconnect under Settings → LinkedIn."), { kind: "li-auth", cause: e });
    if (e?.status === 403) throw Object.assign(new Error("This LinkedIn account cannot post to that Page."), { kind: "li-permission", cause: e });
    throw Object.assign(new Error(e?.message || "LinkedIn refused the post."), { kind: e?.kind || "li-error", cause: e });
  }
  mkLog("linkedin accepted", r);
  return {
    ok: true, delivered: true, confirmed: true, published: true, status: 200, transport: "linkedin",
    urn: r.urn || null, url: r.url || null, message: null, raw: r, at: r.at || new Date().toISOString(),
  };
},
};

/* Which way this post will go, so the UI can say so before it goes. */
export async function publishRoute(payload) {
if (await directLinkedInService.available(payload)) return "linkedin";
const h = await makeLinkedInService.health();
if (h.relay) return "relay";
return makeLinkedInService.configured() ? "make" : "none";
}

/* One entry point. Direct when it can be, Make otherwise — and a direct
 failure never silently re-sends through Make, because the post may already
 be live. */
export async function publishPost(payload) {
  /* A scheduled post has to survive in the data store until it is due. Check
     it fits before sending, because the failure otherwise happens inside Make
     where nobody sees it. */
  if (payload?.publishMode === "scheduled") {
    const fit = scheduledMediaFit(payload);
    if (!fit.ok) throw Object.assign(new Error(fit.reason), { kind: "store-full", bytes: fit.bytes });
  }
  if (await directLinkedInService.available(payload)) {
    return { ...(await directLinkedInService.publish(payload)), route: "linkedin" };
  }
  return { ...(await makeLinkedInService.publish(payload)), route: "make" };
}

/* Is the configured webhook real and attached to a live scenario? Make answers
   a bare GET on a webhook URL, so this costs nothing and sends no post. */
export async function webhookHealth(url = MAKE_CONFIG.url) {
  if (!/^https:\/\/hook\.[a-z0-9.-]+\.make\.com\//.test(String(url || ""))) {
    return { ok: false, state: "not-a-make-url", detail: "That is not a Make webhook address." };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { method: "GET", mode: "cors", signal: ctrl.signal });
    const raw = await res.text().catch(() => "");
    if (res.ok) return { ok: true, state: "live", detail: "Make answered. The webhook exists and its scenario is reachable." };
    const dead = res.status === 400 || res.status === 404 || res.status === 410;
    return {
      ok: false,
      state: dead ? "gone" : "error",
      status: res.status,
      detail: dead
        ? "Make says this webhook no longer exists — its scenario was probably deleted. Open the scenario in Make, copy the webhook address shown on its first module, and paste it here."
        : `Make answered ${res.status}: ${raw.slice(0, 120)}`,
    };
  } catch {
    /* A browser that cannot read the reply is not proof the hook is dead. */
    return { ok: null, state: "unreadable", detail: "The reply could not be read from this page, so the webhook could not be checked from here. That on its own is not a fault." };
  } finally { clearTimeout(timer); }
}

