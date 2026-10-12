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
export const DEST_STATES = ["idle", "sending", "published", "queued", "accepted", "unknown", "failed", "rejected"];
/* Sent and not refused: resending could post twice, so these are never resent
   automatically. `accepted`/`unknown` mean Make took it but did not confirm. */
export const SETTLED = ["published", "queued", "accepted", "unknown"];

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

/** Which of the chosen Pages still need sending: everything not already
    settled. A retry therefore never touches a Page that published. */
export function pendingFor(selected, results = {}) {
  return (selected || []).filter((id) => !SETTLED.includes(results[id]?.state));
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
    if (!parsed) return { state: r.ok ? "accepted" : "failed", message: r.ok ? null : `The publishing service answered ${r.status}.` };
    if (!r.ok) return { state: parsed.state === "unknown" ? "unknown" : parsed.state === "rejected" ? "rejected" : "failed", message: parsed.error || null, refused: parsed.refused || null };
    return { state: parsed.state || "accepted", urn: parsed.urn || null, url: parsed.url || null, message: parsed.message || null, duplicate: !!parsed.duplicate, at: parsed.at || null };
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
    next[id] = { state: "sending" };
    onUpdate?.({ ...next });
    const r = await call({ post: payload, destinationIds: [id], fanout }, { fetchImpl, timeoutMs });
    next[id] = { ...r, at: r.at || new Date().toISOString() };
    onUpdate?.({ ...next });
  }
  return next;
}

/** Schedule: one request for every Page still to send; Make keeps one job per Page. */
export async function scheduleTo({ payload, selected, results = {}, onUpdate, fetchImpl, timeoutMs }) {
  const todo = pendingFor(selected, results);
  if (!todo.length) return results;
  const next = { ...results };
  for (const id of todo) next[id] = { state: "sending" };
  onUpdate?.({ ...next });
  const r = await call({ post: payload, destinationIds: todo, fanout: (selected || []).length > 1 }, { fetchImpl, timeoutMs });
  for (const id of todo) next[id] = { ...r, at: r.at || new Date().toISOString() };
  onUpdate?.({ ...next });
  return next;
}

export const STATE_LABEL = {
  idle: "Not sent", sending: "Sending…", published: "Published", queued: "Scheduled in Make",
  accepted: "Sent — not confirmed", unknown: "Unknown — check the Page", failed: "Failed", rejected: "Refused",
};
