/* ============================================================
   LINKEDIN SIGN-IN FROM THE BROWSER
   What a browser can do on its own: send the user to LinkedIn's consent
   screen (OAuth 2.0 authorization code flow) and receive the code back.
   What it cannot do: exchange that code for a token or call the LinkedIn
   API — both require the app's client secret and neither endpoint answers
   cross-origin requests. So the exchange goes through a small "bridge": any
   URL that accepts the code and returns a token (the team's Make.com
   scenario is the obvious one, since Make already owns the LinkedIn side).
   Without a bridge, an admin can still paste a token from the LinkedIn
   developer portal's token generator. Nothing here pretends otherwise.
   ============================================================ */

export const LI_AUTH_KEY = "unison:linkedin:v1";
export const LI_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const DEFAULT_SCOPES = ["openid", "profile", "email", "w_member_social", "r_organization_social", "w_organization_social", "rw_organization_admin"];
const STATE_KEY = "unison:linkedin:state";

const EMPTY_SETTINGS = { clientId: "", redirectUri: "", scopes: DEFAULT_SCOPES.join(" "), bridgeUrl: "", sendToken: false, connection: null };

let current = { ...EMPTY_SETTINGS };

export const defaultRedirectUri = () => {
  if (typeof window === "undefined") return "";
  return (window.location.origin + window.location.pathname).replace(/index\.html$/, "");
};

export function loadLinkedInSettings() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LI_AUTH_KEY) : null;
    current = { ...EMPTY_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch { current = { ...EMPTY_SETTINGS }; }
  return { ...current };
}
export function saveLinkedInSettings(patch) {
  current = { ...current, ...patch };
  if (patch && "clientId" in patch) current.clientId = String(patch.clientId || "").trim();
  if (patch && "bridgeUrl" in patch) current.bridgeUrl = String(patch.bridgeUrl || "").trim();
  if (patch && "redirectUri" in patch) current.redirectUri = String(patch.redirectUri || "").trim();
  try { localStorage.setItem(LI_AUTH_KEY, JSON.stringify(current)); } catch { /* private mode */ }
  return { ...current };
}
export const getLinkedInSettings = () => ({ ...current });
export const isLinkedInConfigured = (s = current) => !!String(s.clientId || "").trim();
export const isBridgeConfigured = (s = current) => /^https?:\/\//.test(String(s.bridgeUrl || ""));

const randomState = () => {
  const a = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues?.(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("") || Math.random().toString(36).slice(2);
};

/* Build the consent URL. Exported so it can be shown and unit-tested. */
export function authorizationUrl(s = current, state = randomState()) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: s.clientId,
    redirect_uri: s.redirectUri || defaultRedirectUri(),
    state,
    scope: String(s.scopes || DEFAULT_SCOPES.join(" ")).trim(),
  });
  return `${LI_AUTHORIZE_URL}?${q.toString()}`;
}

/* Full-page navigation to LinkedIn. The state survives the round trip in sessionStorage. */
export function beginAuthorization(s = current) {
  if (!isLinkedInConfigured(s)) throw new Error("LinkedIn client ID is not set.");
  const state = randomState();
  try { sessionStorage.setItem(STATE_KEY, state); } catch { /* ignore */ }
  window.location.assign(authorizationUrl(s, state));
}

/* Read ?code=&state= (or ?error=) once, clean the URL, verify the state. */
export function readAuthCallback(loc = typeof window !== "undefined" ? window.location : null) {
  if (!loc) return null;
  const q = new URLSearchParams(loc.search);
  const code = q.get("code"), state = q.get("state"), error = q.get("error");
  if (!code && !error) return null;
  let expected = null;
  try { expected = sessionStorage.getItem(STATE_KEY); sessionStorage.removeItem(STATE_KEY); } catch { /* ignore */ }
  try {
    const url = new URL(loc.href);
    ["code", "state", "error", "error_description"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, "", url.toString());
  } catch { /* ignore */ }
  if (error) return { error, description: q.get("error_description") || (error === "user_cancelled_login" || error === "user_cancelled_authorize" ? "You cancelled on LinkedIn." : "LinkedIn returned an error.") };
  if (!expected || expected !== state) return { error: "invalid_state", description: "The response failed a security check (state mismatch). Try connecting again." };
  return { code };
}

/* POST JSON as text/plain: a "simple" request, so Make's webhook (which does
   not answer CORS preflights) receives it. The reply is readable only if the
   scenario's Webhook Response sets Access-Control-Allow-Origin. */
export async function bridge(action, payload, s = current, { timeoutMs = 30000 } = {}) {
  if (!isBridgeConfigured(s)) throw Object.assign(new Error("No LinkedIn bridge URL configured."), { kind: "unconfigured" });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(s.bridgeUrl, { method: "POST", mode: "cors", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ action, source: "unison-content-os", ...payload }), signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    throw Object.assign(new Error(e?.name === "AbortError" ? "The bridge did not respond in time." : "The bridge could not be reached from this browser."), { kind: e?.name === "AbortError" ? "timeout" : "network", cause: e });
  }
  clearTimeout(timer);
  const raw = await res.text().catch(() => "");
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  if (!res.ok) throw Object.assign(new Error(body?.error || body?.message || `The bridge returned ${res.status}.`), { kind: "http", status: res.status, body });
  if (!body || typeof body !== "object") throw Object.assign(new Error("The bridge replied, but not with JSON."), { kind: "unreadable", raw: raw.slice(0, 200) });
  if (body.error) throw Object.assign(new Error(body.error_description || body.error), { kind: "api", body });
  return body;
}

export const normalizeOrgs = (list) => (Array.isArray(list) ? list : []).map((o) => {
  const urn = o.urn || o.organizationUrn || (o.id ? `urn:li:organization:${String(o.id).split(":").pop()}` : null);
  if (!urn) return null;
  const role = o.role || o.roleAssignee || (o.roles || [])[0] || "ADMINISTRATOR";
  return {
    urn, name: o.name || o.localizedName || o.organizationName || urn,
    role, followers: o.followers ?? o.followerCount ?? null, logo: o.logo || o.logoUrl || null,
    canPublish: o.canPublish !== false && !/ANALYST|CURATOR/i.test(String(role)),
  };
}).filter(Boolean);

export const normalizeProfile = (p) => (p && typeof p === "object" ? {
  sub: p.sub || p.id || null,
  name: p.name || [p.given_name || p.localizedFirstName, p.family_name || p.localizedLastName].filter(Boolean).join(" ") || null,
  email: p.email || null,
  picture: p.picture || null,
} : null);

/* Turn whatever the bridge or the user gave us into a connection record. */
export function connectionFromToken({ accessToken, expiresIn, expiresAt, profile, organizations, via }) {
  const exp = expiresAt || (expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString() : null);
  const orgs = normalizeOrgs(organizations);
  return {
    status: accessToken ? "connected" : "authorized",
    accessToken: accessToken || null,
    expiresAt: exp,
    obtainedAt: new Date().toISOString(),
    profile: normalizeProfile(profile),
    organizations: orgs,
    selectedUrn: orgs.length === 1 ? orgs[0].urn : null,
    via: via || "bridge",
    error: null,
  };
}

/* Exchange the code. Without a bridge this records the authorization only. */
export async function exchangeCode(code, s = current) {
  if (!isBridgeConfigured(s)) {
    return { status: "authorized", code, accessToken: null, expiresAt: null, obtainedAt: new Date().toISOString(), profile: null, organizations: [], selectedUrn: null, via: "code", error: null };
  }
  const r = await bridge("exchange", { grant_type: "authorization_code", code, redirect_uri: s.redirectUri || defaultRedirectUri(), client_id: s.clientId }, s);
  const token = r.access_token || r.accessToken;
  if (!token) throw Object.assign(new Error("The bridge did not return an access token."), { kind: "api", body: r });
  return connectionFromToken({ accessToken: token, expiresIn: r.expires_in || r.expiresIn, profile: r.profile || r.userinfo || null, organizations: r.organizations || r.orgs || [], via: "bridge" });
}

/* Ask the bridge for the Pages this token administers. */
export async function fetchOrganizations(connection, s = current) {
  const r = await bridge("organizations", { access_token: connection?.accessToken }, s);
  return normalizeOrgs(r.organizations || r.elements || r);
}

export const isExpired = (c) => !!(c?.expiresAt && Date.parse(c.expiresAt) < Date.now());

/* The shape the rest of the app reads (see EMPTY_CONNECTION in linkedin.js). */
export function toAppConnection(s = current) {
  const c = s.connection;
  if (!c) return null;
  const org = (c.organizations || []).find((o) => o.urn === c.selectedUrn) || null;
  const expired = isExpired(c);
  return {
    provider: "linkedin",
    status: expired ? "expired" : c.status === "connected" ? (org ? "connected" : "authorized") : c.status === "authorized" ? "authorized" : "disconnected",
    mode: "browser",
    organizationId: org ? String(org.urn).split(":").pop() : null,
    organizationUrn: org?.urn || null,
    organizationName: org?.name || null,
    organizationLogo: org?.logo || null,
    followers: org?.followers ?? null,
    roles: org ? [org.role] : [],
    permissions: org?.canPublish ? ["PUBLISH"] : [],
    connectedAt: c.obtainedAt || null,
    expiresAt: c.expiresAt || null,
    lastCheckedAt: new Date().toISOString(),
    error: c.error || null,
    profile: c.profile || null,
    via: c.via || null,
    hasToken: !!c.accessToken,
  };
}

export function disconnectLinkedIn() { return saveLinkedInSettings({ connection: null }); }
