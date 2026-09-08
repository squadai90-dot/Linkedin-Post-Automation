import { makeLinkedInService } from "./publish.js";

/* ============================================================
   LINKEDIN — client service
   The browser talks to Unison's own API, never to LinkedIn and never to a
   secret. If that API isn't running, the app says so and stays in prototype
   mode rather than pretending a connection exists.
   ============================================================ */

export const LI_API = (typeof window !== "undefined" && window.UNISON_API_BASE) || "/api/linkedin";

/* status is the whole truth about the connection; nothing else may set it */
export const LI_STATES = ["disconnected", "connecting", "authorized", "connected", "expired", "revoked", "error", "simulated", "workflow"];
/* "workflow": publishing goes through a connected LinkedIn workflow that owns
   the Page authorization. Unison holds no credential and can't name the Page. */

export const EMPTY_CONNECTION = {
  provider: "linkedin",
  status: "disconnected",
  mode: "unknown",              // real | simulation | misconfigured | unknown
  organizationId: null,
  organizationUrn: null,
  organizationName: null,
  organizationLogo: null,
  followers: null,
  roles: [],
  permissions: [],
  connectedAt: null,
  expiresAt: null,
  lastCheckedAt: null,
  error: null,
};

/* Compatibility shims so the rest of the app keeps reading the fields it
   already reads, while status stays the single source of truth. */
export const withDerived = (c) => ({
  ...c,
  connected: c.status === "connected" || c.status === "simulated" || c.status === "workflow",
  simulated: c.status === "simulated",
  viaWorkflow: c.status === "workflow",
  needsAttention: c.status === "expired" || c.status === "revoked" || c.status === "error",
  canPublish: (c.permissions || []).includes("PUBLISH"),
  org: c.organizationName || "",
  role: (c.roles || [])[0] || null,
  expires: c.expiresAt ? String(c.expiresAt).slice(0, 10) : null,
});

export async function liFetch(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
  try {
    const res = await fetch(`${LI_API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      ...opts,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.message || "Request failed"), { code: body.error, status: res.status, body });
    return body;
  } finally {
    clearTimeout(t);
  }
}

export const linkedinService = {
  /* Is the Unison API there, and is real OAuth configured behind it? */
  async status() {
    try {
      const r = await liFetch("/status", { timeout: 4000 });
      return {
        reachable: true,
        mode: r.mode,
        apiVersion: r.apiVersion,
        scopes: r.scopes || [],
        connection: { ...EMPTY_CONNECTION, ...r.connection, mode: r.mode },
      };
    } catch (e) {
      /* No Unison API. If the LinkedIn publishing workflow is configured, that
         is the publishing path; otherwise fall back to the prototype. */
      if (makeLinkedInService.configured()) {
        return { reachable: false, mode: "workflow", scopes: [], connection: { ...EMPTY_CONNECTION, mode: "workflow", status: "workflow", permissions: ["PUBLISH"], connectedAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() } };
      }
      return { reachable: false, mode: "simulation", scopes: [], connection: { ...EMPTY_CONNECTION, mode: "simulation" } };
    }
  },
  /* A full page navigation, not a fetch — the user must land on LinkedIn. */
  beginAuthorization() {
    window.location.href = `${LI_API}/connect`;
  },
  organizations() { return liFetch("/organizations"); },
  select(urn) { return liFetch("/select", { method: "POST", body: JSON.stringify({ urn }) }); },
  disconnect() { return liFetch("/disconnect", { method: "POST" }); },
  publish(payload) { return liFetch("/publish", { method: "POST", body: JSON.stringify(payload), timeout: 30000 }); },
};

/* What the callback told us, read once on load. */
export function readCallbackParams() {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const v = q.get("linkedin");
  if (!v) return null;
  const reason = q.get("reason");
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("linkedin");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  } catch { /* ignore */ }
  return { result: v, reason };
}
