import { relayAuthHeaders } from "./store.js";

/* ============================================================
   LINKEDIN DESTINATIONS — which Company Pages a post goes to

   The list of Pages comes from the server (GET /api/destinations). The
   browser only ever chooses among them by id; it never sends an organization
   URN of its own, and the server refuses an id it does not know.

   When the server has no list (every deployment that has not opted in), this
   module reports "not enabled" and Unison publishes exactly as it always has,
   through api/publish.js, to the one Page configured there.

   Results are kept per Page. A Page that published is never sent again; a
   Page that failed can be retried on its own.
   ============================================================ */

export const DESTINATIONS_PATH = "/api/destinations";
export const PUBLISH_TO_PATH = "/api/publish-to";

/** States a Page can be in for one post. Only `published` is proof. */
export const DEST_STATES = ["idle", "sending", "published", "queued", "accepted", "processing", "unknown", "failed", "rejected", "cancelled"];
/* Sent and not refused: resending could post twice, so these are never resent
   automatically. `accepted`/`unknown` mean Make took it but did not confirm;
   `processing` means Make has claimed it; `cancelled` was stopped on purpose. */
export const SETTLED = ["published", "queued", "accepted", "processing", "unknown", "cancelled"];

/**
 * The one vocabulary Unison reports a Page in, whatever it was built from:
 *
 *   scheduled   held in Make for a future time (internal: queued)
 *   queued      Make has the request but has not run it (internal: accepted)
 *   processing  being sent now, or claimed by Make (internal: sending, processing)
 *   published   LinkedIn returned the post's urn
 *   failed      definitely not posted, and safe to send again (failed, rejected)
 *   unknown     cannot tell whether LinkedIn has it: check before resending
 *   cancelled   stopped before publishing
 *   not sent    nothing has been sent (idle)
 */
export const CANONICAL = {
  idle: "not sent", sending: "processing", processing: "processing", queued: "scheduled", accepted: "queued",
  published: "published", failed: "failed", rejected: "failed", unknown: "unknown", cancelled: "cancelled",
};
export const canonicalState = (r) => CANONICAL[r?.state || "idle"] || "unknown";
/* The only states a retry may send again: never tried, or refused outright.
   "sending" is not here: a send cut off by a reload may have reached Make. */
export const RETRYABLE = ["idle", "failed", "rejected"];

/** Results as saved with a post. A Page still "sending" when the page was
    closed may or may not have reached Make, so it comes back as unknown. */
export function restoreResults(saved) {
  const out = {};
  for (const [id, r] of Object.entries(saved && typeof saved === "object" ? saved : {})) {
    out[id] = r?.state === "sending" ? { ...r, state: "unknown", message: "The page was closed while this Page was being sent. Check LinkedIn before sending again." } : r;
  }
  return out;
}

/** A person checked LinkedIn and the post is not on this Page: only then may
    an unknown or unconfirmed Page be sent again. */
export function markNotPublished(results, id) {
  const r = results[id] || {};
  /* resends gives the next attempt its own key, so Make does not answer it
     from the unfinished one. */
  return { ...results, [id]: { ...r, state: "failed", message: "Checked on LinkedIn: not there. It can be sent again.", checkedAt: new Date().toISOString(), resends: (r.resends || 0) + 1 } };
}

export async function fetchDestinations({ fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(DESTINATIONS_PATH, { headers: { Accept: "application/json" }, cache: "no-store" });
    const raw = await r.text();
    const body = raw ? JSON.parse(raw) : null;
    if (!r.ok || body?.service !== "unison-destinations") return { enabled: false, destinations: [], reason: "absent" };
    return {
      enabled: !!body.enabled,
      destinations: Array.isArray(body.destinations) ? body.destinations : [],
      problems: body.problems || [],
      webhookConfigured: !!body.webhookConfigured,
      reason: body.enabled ? null : "not-configured",
    };
  } catch {
    return { enabled: false, destinations: [], reason: "absent" };
  }
}

/** The ids from `selected` that are still on the list and available. A Page
    that has gone is reported, never swapped for another. */
export function reconcileSelection(selected, destinations) {
  const byId = new Map((destinations || []).map((d) => [d.id, d]));
  const ids = [...new Set((selected || []).filter(Boolean))];
  return {
    valid: ids.filter((id) => byId.get(id)?.enabled !== false && byId.has(id)),
    missing: ids.filter((id) => !byId.has(id)),
    unavailable: ids.filter((id) => byId.has(id) && byId.get(id).enabled === false),
  };
}

/** What a new post starts with: the first available Page — one Page, as
    before. The user widens it. */
export function defaultSelection(destinations) {
  const first = (destinations || []).find((d) => d.enabled !== false);
  return first ? [first.id] : [];
}

export const selectAll = (destinations) => (destinations || []).filter((d) => d.enabled !== false).map((d) => d.id);

export function toggle(selected, id) {
  const s = new Set(selected || []);
  if (s.has(id)) s.delete(id); else s.add(id);
  return [...s];
}

export const publishLabel = (n) => (n === 0 ? "Choose a Page" : n === 1 ? "Publish to 1 Page" : `Publish to ${n} Pages`);

/** Which of the chosen Pages may be sent now: those never sent, and those
    that genuinely failed. Published, queued, unconfirmed, unknown and
    in-flight Pages are never resent automatically. */
export function pendingFor(selected, results = {}) {
  return (selected || []).filter((id) => RETRYABLE.includes(results[id]?.state || "idle"));
}

/** One line for the whole post, from its Pages' states. */
export function overall(selected, results = {}) {
  const states = (selected || []).map((id) => results[id]?.state || "idle");
  if (!states.length) return "idle";
  if (states.some((s) => s === "sending")) return "sending";
  if (states.every((s) => s === "published")) return "published";
  if (states.every((s) => s === "queued")) return "queued";
  if (states.some((s) => s === "failed" || s === "rejected")) return states.some((s) => SETTLED.includes(s)) ? "partial" : "failed";
  if (states.every((s) => SETTLED.includes(s))) return "sent";
  return "idle";
}

/* ---------- sending ---------- */

async function call(body, { fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(PUBLISH_TO_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...relayAuthHeaders() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await r.text().catch(() => "");
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
    if (!parsed) {
      /* No JSON from our own relay. 404/405: there is no relay, nothing was
         sent. Anything else (a platform timeout page, a proxy error) may have
         come after the job reached Make: unknown, never retried blindly. */
      if (r.status === 404 || r.status === 405) return { state: "failed", message: "There is no publishing service at this address. Nothing was sent." };
      return { state: "unknown", message: `The publishing service answered ${r.status} without a result. Check the Page before sending again.` };
    }
    const known = (x) => (DEST_STATES.includes(x) && !["idle", "sending"].includes(x) ? x : null);
    if (!r.ok) return { state: known(parsed.state) || "failed", stage: parsed.stage || null, message: parsed.error || parsed.message || null, refused: parsed.refused || null };
    return { state: known(parsed.state) || "unknown", stage: parsed.stage || null, urn: parsed.urn || null, url: parsed.url || null, message: parsed.message || null, duplicate: !!parsed.duplicate, at: parsed.at || null };
  } catch (e) {
    /* No answer: the job may or may not have reached Make. Unknown, not failed,
       so it is not resent without someone checking first. */
    return { state: e?.name === "AbortError" ? "unknown" : "failed", message: e?.name === "AbortError" ? "No answer in time — check the Page before sending again." : "The publishing service could not be reached. Nothing was sent." };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Publish now: one request per Page, one after another, each reported as it
 * lands. Pages already settled in `results` are skipped. `fanout` stays true
 * for every request of a multi-Page post, including a retry of one Page, so
 * the job key a Page got the first time is the key it keeps.
 */
export async function publishNowTo({ payload, selected, results = {}, onUpdate, fetchImpl, timeoutMs }) {
  const todo = pendingFor(selected, results);
  const fanout = (selected || []).length > 1;
  const next = { ...results };
  for (const id of todo) {
    const before = results[id] || {};
    const keep = { postId: payload.postId, attempt: (before.attempt || 0) + 1, resends: before.resends || 0 };
    next[id] = { state: "sending", ...keep };
    onUpdate?.({ ...next });
    const r = await call({ post: payload, destinationIds: [id], fanout, attempt: keep.attempt, resend: keep.resends }, { fetchImpl, timeoutMs });
    next[id] = { ...r, ...keep, at: r.at || new Date().toISOString() };
    onUpdate?.({ ...next });
  }
  return next;
}

/** Schedule: one request for every Page still to send; Make keeps one job per Page. */
export async function scheduleTo({ payload, selected, results = {}, onUpdate, fetchImpl, timeoutMs }) {
  const todo = pendingFor(selected, results);
  if (!todo.length) return results;
  const next = { ...results };
  const keep = Object.fromEntries(todo.map((id) => [id, { postId: payload.postId, attempt: (results[id]?.attempt || 0) + 1, resends: results[id]?.resends || 0 }]));
  for (const id of todo) next[id] = { state: "sending", ...keep[id] };
  onUpdate?.({ ...next });
  const attempt = Math.max(...todo.map((id) => keep[id].attempt));
  const r = await call({ post: payload, destinationIds: todo, fanout: (selected || []).length > 1, attempt }, { fetchImpl, timeoutMs });
  for (const id of todo) next[id] = { ...r, ...keep[id], at: r.at || new Date().toISOString() };
  onUpdate?.({ ...next });
  return next;
}

/** The post id the results belong to, if any Page has been sent. */
export const postIdOf = (results) => Object.values(results || {}).map((r) => r?.postId).find(Boolean) || null;

/**
 * Ask Make what it has recorded for each Page of a post, and bring the
 * results up to date. A Page that has the post is never changed; a Page Make
 * has no record of keeps what it had (absence is not evidence either way).
 */
export async function checkStatus({ postId, selected, results = {}, fetchImpl = fetch, timeoutMs = 30000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(PUBLISH_TO_PATH, {
      method: "POST", headers: { "Content-Type": "application/json", ...relayAuthHeaders() },
      body: JSON.stringify({ action: "status", postId }), signal: ctrl.signal,
    });
    const body = await r.json().catch(() => null);
    if (!r.ok || body?.state !== "report") return { ok: false, results, message: body?.error || `The status check answered ${r.status}.` };
    const next = { ...results };
    const changed = [];
    for (const id of selected || []) {
      const page = body.pages?.[id];
      if (!page || next[id]?.state === "published") continue;
      if (next[id]?.state !== page.state) changed.push(id);
      next[id] = { ...(next[id] || {}), state: page.state, stage: "make-record", urn: page.urn, url: page.url, message: page.message || next[id]?.message || null, makeStatus: page.makeStatus, checkedInMakeAt: body.at };
    }
    return { ok: true, results: next, changed };
  } catch (e) {
    return { ok: false, results, message: e?.name === "AbortError" ? "Make did not answer in time." : "The publishing service could not be reached." };
  } finally {
    clearTimeout(timer);
  }
}

export const STATE_LABEL = {
  idle: "Not sent", sending: "Sending…", published: "Published", queued: "Scheduled in Make",
  accepted: "Sent — not confirmed", processing: "Publishing in Make…", unknown: "Unknown — check the Page", failed: "Failed", rejected: "Refused",
  cancelled: "Cancelled",
};

/** The label for one Page's result, using what Make said where it matters. */
export const labelFor = (r) => (r?.state === "accepted" && r?.stage === "make-queue" ? "Waiting in Make — not run yet" : STATE_LABEL[r?.state] || r?.state || STATE_LABEL.idle);
