import { relayAuthHeaders } from "./store.js";

/* ============================================================
   SHARED TEAM WORKSPACE (optional)

   Unison is frontend-only, so by default everything a person does lives in
   their own browser. For one person that is right — nothing to set up, no
   account, nothing to leak. For a team it means the calendar one person fills
   in is invisible to everyone else.

   This module is the optional shared half. When api/workspace.js is deployed
   with a store behind it, the parts of a session that are genuinely shared —
   published and scheduled posts, the content calendar, the team list, the
   audit trail — are kept in one document everyone reads and writes.

   Deliberately NOT shared:
     · API keys and the LinkedIn token, which are per-person by design
     · the draft someone is in the middle of writing, which would fight
     · uploaded media, which is far too large for a shared document

   When nothing is deployed every function here reports "off" and the app
   behaves exactly as it did before. Nothing degrades silently.
   ============================================================ */

export const WORKSPACE_PATH = (typeof window !== "undefined" && window.UNISON_WORKSPACE_API) || "/api/workspace";

/* The slice of a session that belongs to the team rather than to a person. */
export const SHARED_KEYS = ["posts", "schedule", "team", "audit", "profile", "voice", "makeCompany"];

export const sharedSlice = (session) => {
  const out = {};
  for (const k of SHARED_KEYS) if (session && k in session) out[k] = session[k];
  return out;
};

export const SYNC = {
  status: "unknown",   // unknown | off | ready | error | conflict
  version: 0,
  updatedAt: null,
  updatedBy: null,
  lastError: null,
};

const ac = (ms) => {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
};

/* Is a shared workspace available? Answered once, then remembered. */
let probe = null;
export async function workspaceHealth({ force = false } = {}) {
  if (probe && !force) return probe;
  probe = (async () => {
    try {
      const res = await fetch(`${WORKSPACE_PATH}?health`, { headers: { Accept: "application/json" }, cache: "no-store", signal: ac(4000) });
      const body = await res.json().catch(() => null);
      const ok = res.ok && body?.service === "unison-workspace" && body.configured === true;
      SYNC.status = ok ? "ready" : "off";
      return ok ? body : false;
    } catch {
      SYNC.status = "off";
      return false;
    }
  })();
  return probe;
}

export const resetWorkspaceProbe = () => { probe = null; SYNC.status = "unknown"; };

/* Read the shared document. Returns null when there is nothing to share yet. */
export async function pull() {
  if (!(await workspaceHealth())) return null;
  try {
    const res = await fetch(WORKSPACE_PATH, { headers: { Accept: "application/json", ...relayAuthHeaders() }, cache: "no-store", signal: ac(12000) });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) throw new Error(body?.error || `HTTP ${res.status}`);
    SYNC.status = "ready";
    SYNC.version = body.version || 0;
    SYNC.updatedAt = body.updatedAt || null;
    SYNC.updatedBy = body.updatedBy || null;
    SYNC.lastError = null;
    return body.value ?? body.data ?? null;
  } catch (e) {
    SYNC.status = "error";
    SYNC.lastError = String(e?.message || e);
    return null;
  }
}

/* Write the shared document.
 *
 * A refused write is the useful case: it means someone else saved while this
 * browser was working, and their version comes back so the caller can merge
 * rather than overwrite. */
export async function push(session, by) {
  if (!(await workspaceHealth())) return { ok: false, reason: "off" };
  const data = sharedSlice(session);
  try {
    const res = await fetch(WORKSPACE_PATH, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...relayAuthHeaders() },
      body: JSON.stringify({ baseVersion: SYNC.version, data, by }),
      signal: ac(15000),
    });
    const body = await res.json().catch(() => null);

    if (res.status === 409) {
      SYNC.status = "conflict";
      SYNC.version = body?.version || SYNC.version;
      SYNC.updatedBy = body?.updatedBy || null;
      return { ok: false, reason: "conflict", theirs: body?.data ?? null, version: SYNC.version, by: body?.updatedBy || null };
    }
    if (!res.ok || body?.error) throw new Error(body?.error || `HTTP ${res.status}`);

    SYNC.status = "ready";
    SYNC.version = body.version || SYNC.version + 1;
    SYNC.updatedAt = body.updatedAt || new Date().toISOString();
    SYNC.updatedBy = body.updatedBy || by || null;
    SYNC.lastError = null;
    return { ok: true, version: SYNC.version };
  } catch (e) {
    SYNC.status = "error";
    SYNC.lastError = String(e?.message || e);
    return { ok: false, reason: "error", error: SYNC.lastError };
  }
}

/* Merge two versions of the shared slice.
 *
 * Posts and audit rows are append-only records of things that happened, so a
 * union keyed by id keeps both people's work — the alternative is that
 * whoever saves second erases the other's afternoon. Everything else is a
 * setting, where the newer edit is the intended one. */
export function mergeShared(mine = {}, theirs = {}) {
  const byId = (a = [], b = [], key = "id") => {
    const seen = new Map();
    for (const row of [...(Array.isArray(b) ? b : []), ...(Array.isArray(a) ? a : [])]) {
      const k = row?.[key] ?? JSON.stringify(row);
      /* Later in this list wins, and `a` (mine) is later — so my edit to a row
         we both touched is kept, while rows only they have survive. */
      seen.set(k, seen.has(k) ? { ...seen.get(k), ...row } : row);
    }
    return [...seen.values()];
  };

  return {
    ...theirs,
    ...mine,
    posts: byId(mine.posts, theirs.posts),
    team: byId(mine.team, theirs.team, "email"),
    /* The audit trail is a log: keep every line, newest first, and cap it the
       way the local log is capped. */
    audit: [...(mine.audit || []), ...(theirs.audit || [])]
      .filter((row, i, all) => all.findIndex((x) => x?.t === row?.t && x?.text === row?.text) === i)
      .sort((x, y) => String(y?.t || "").localeCompare(String(x?.t || "")))
      .slice(0, 200),
  };
}

export const syncSummary = () => {
  if (SYNC.status === "off" || SYNC.status === "unknown") return "Local to this browser. Export a session to share it.";
  if (SYNC.status === "error") return `Shared workspace unreachable — working locally. ${SYNC.lastError || ""}`.trim();
  if (SYNC.status === "conflict") return "Someone else saved first — merge and save again.";
  const who = SYNC.updatedBy ? ` by ${SYNC.updatedBy}` : "";
  return SYNC.updatedAt ? `Shared with your team · last saved${who}` : "Shared with your team";
};
