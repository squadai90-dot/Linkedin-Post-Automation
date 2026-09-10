/**
 * Unison LinkedIn bridge
 *
 *   Unison frontend  ->  this endpoint  ->  LinkedIn
 *
 * A browser can send someone to LinkedIn's consent screen and receive the
 * code back, but it can do nothing with that code: the token exchange needs
 * the app's client secret, and neither the token endpoint nor the API answers
 * cross-origin requests. This function is the missing half.
 *
 * Deploy it and set:
 *   LINKEDIN_CLIENT_ID       from the LinkedIn developer portal
 *   LINKEDIN_CLIENT_SECRET   never goes near the browser
 *   UNISON_RELAY_TOKEN       optional shared secret, same value as the others
 *
 * It implements the same contract as any other bridge the app can be pointed
 * at (Settings -> LinkedIn -> Bridge URL): POST JSON {action, ...}, get JSON
 * back. Actions: exchange, organizations, publish, refresh.
 *
 * Without this, the team can still use a Make.com scenario or paste a token
 * from LinkedIn's own token generator. Nothing here is required.
 */

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "";
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "";
const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const API = "https://api.linkedin.com";
const TIMEOUT_MS = Number(process.env.LINKEDIN_TIMEOUT_MS || 20000);
const API_VERSION = process.env.LINKEDIN_API_VERSION || "202506";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      service: "unison-linkedin-bridge",
      version: 1,
      configured: !!(CLIENT_ID && CLIENT_SECRET),
      clientId: CLIENT_ID || null,          // public half; the app pre-fills it
      tokenRequired: !!RELAY_TOKEN,
      actions: ["exchange", "refresh", "organizations", "publish"],
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (RELAY_TOKEN && req.headers["x-unison-token"] !== RELAY_TOKEN) {
    return res.status(401).json({ error: "This bridge requires a team token. Add it under Settings → Advanced." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Body must be JSON." });

  try {
    switch (body.action) {
      case "exchange": return res.status(200).json(await exchange(body));
      case "refresh": return res.status(200).json(await refresh(body));
      case "organizations": return res.status(200).json({ organizations: await organizations(body.access_token) });
      case "publish": return res.status(200).json(await publish(body));
      default: return res.status(400).json({ error: `Unknown action "${body.action}".` });
    }
  } catch (e) {
    /* Upstream status codes travel back so the app can tell an expired token
       from a permission it was never granted. */
    const status = Number(e?.status) || 502;
    console.error("[unison:linkedin]", body.action, status, String(e?.message || e));
    return res.status(status).json({ error: String(e?.message || e), error_description: e?.detail || undefined });
  }
}

/* ---------- helpers ---------- */

const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

async function call(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let r;
  try {
    r = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw Object.assign(new Error(e?.name === "AbortError" ? "LinkedIn did not respond in time." : "Could not reach LinkedIn."), { status: e?.name === "AbortError" ? 504 : 502 });
  } finally { clearTimeout(timer); }

  const raw = await r.text().catch(() => "");
  const data = raw ? safeParse(raw) : null;
  if (!r.ok) {
    const msg = data?.message || data?.error_description || data?.error || `LinkedIn returned ${r.status}.`;
    throw Object.assign(new Error(String(msg)), { status: r.status, detail: data?.error_description });
  }
  return { data, raw, headers: r.headers };
}

const authed = (token) => ({
  Authorization: `Bearer ${token}`,
  "X-Restli-Protocol-Version": "2.0.0",
  "LinkedIn-Version": API_VERSION,
});

function requireApp() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw Object.assign(new Error("LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET are not set on the server."), { status: 500 });
  }
}

/* ---------- actions ---------- */

async function exchange({ code, redirect_uri }) {
  requireApp();
  if (!code) throw Object.assign(new Error("No authorization code was supplied."), { status: 400 });

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect_uri || "",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const { data } = await call(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const token = data?.access_token;
  if (!token) throw Object.assign(new Error("LinkedIn did not return an access token."), { status: 502 });

  /* Fetch what the app needs to show a connected state, but never fail the
     sign-in because an optional scope was not granted. */
  const [profile, orgs] = await Promise.all([
    call(`${API}/v2/userinfo`, { headers: authed(token) }).then((r) => r.data).catch(() => null),
    organizations(token).catch(() => []),
  ]);

  return {
    access_token: token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token || undefined,
    refresh_token_expires_in: data.refresh_token_expires_in || undefined,
    scope: data.scope,
    profile,
    organizations: orgs,
  };
}

async function refresh({ refresh_token }) {
  requireApp();
  if (!refresh_token) throw Object.assign(new Error("No refresh token was supplied."), { status: 400 });
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
  const { data } = await call(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  return { access_token: data.access_token, expires_in: data.expires_in, refresh_token: data.refresh_token };
}

/* The Pages this token administers, with the names filled in. */
async function organizations(token) {
  if (!token) throw Object.assign(new Error("No access token was supplied."), { status: 400 });

  const { data } = await call(
    `${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(role,state,organization~(id,localizedName,vanityName,logoV2)))`,
    { headers: authed(token) }
  );

  return (data?.elements || []).map((el) => {
    const org = el["organization~"] || {};
    const urn = el.organization || (org.id ? `urn:li:organization:${org.id}` : null);
    if (!urn) return null;
    return {
      urn,
      name: org.localizedName || org.vanityName || urn,
      role: el.role || "ADMINISTRATOR",
      canPublish: !/ANALYST|CURATOR/i.test(String(el.role || "")),
    };
  }).filter(Boolean);
}

/* Post to a Company Page. Text and article link only — an image or video has
   to be registered and uploaded first, which the app does through Make. */
async function publish({ access_token, author, text, link, linkTitle, linkDescription, visibility = "PUBLIC" }) {
  if (!access_token) throw Object.assign(new Error("No access token was supplied."), { status: 400 });
  if (!author) throw Object.assign(new Error("No Page was selected to post as."), { status: 400 });
  if (!String(text || "").trim()) throw Object.assign(new Error("The post has no text."), { status: 400 });

  const post = {
    author,
    commentary: String(text),
    visibility,
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (link) {
    post.content = { article: { source: link, title: linkTitle || undefined, description: linkDescription || undefined } };
  }

  const { headers } = await call(`${API}/rest/posts`, {
    method: "POST",
    headers: { ...authed(access_token), "Content-Type": "application/json" },
    body: JSON.stringify(post),
  });

  /* LinkedIn returns the new post's id in a header, not the body. */
  const urn = headers.get("x-restli-id") || headers.get("x-linkedin-id") || null;
  return {
    published: true,
    urn,
    url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null,
    at: new Date().toISOString(),
  };
}

export const config = { api: { bodyParser: { sizeLimit: "1mb" } }, maxDuration: 30 };
