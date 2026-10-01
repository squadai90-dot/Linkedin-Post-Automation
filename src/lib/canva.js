/* ============================================================
   CANVA CLIENT

   Talks to /api/canva, which holds the client secret and every OAuth token.
   This file deliberately has no way to obtain a token: there is no route on
   the relay that returns one, so nothing here can leak one.

   What the browser does hold is a session id — an opaque handle to state on
   the relay. It is not a Canva credential and cannot be replayed against
   Canva. It is kept in a module variable and written to NO browser storage,
   so a Canva connection never appears in localStorage or sessionStorage. The
   cost is that a full page reload means reconnecting, which is honest anyway:
   the relay keeps sessions in memory and loses them when it restarts.
   ============================================================ */

const PATH = (typeof window !== "undefined" && window.UNISON_CANVA_API) || "/api/canva";

const relayHeaders = () => {
  try {
    const t = localStorage.getItem("unison:relay-token");
    return t ? { "X-Unison-Token": t } : {};
  } catch { return {}; }
};

export class CanvaError extends Error {
  constructor(message, code) { super(message); this.name = "CanvaError"; this.code = code || "failed"; }
}

/* The one piece of state. Not persisted, on purpose. */
let sessionId = "";
let connection = { connected: false, scope: "", expiresAt: null };
const listeners = new Set();
const announce = () => { for (const fn of listeners) { try { fn(connection); } catch { /* a listener must not break the client */ } } };

export const onCanvaChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const connectionState = () => ({ ...connection });

/* ---------- relay ---------- */

async function post(body, { signal } = {}) {
  let r;
  try {
    r = await fetch(PATH, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", ...relayHeaders() },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new CanvaError("Could not reach the Canva relay. It needs a backend, so this does not work from a file:// build.", "offline");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) {
    const code = j?.code || String(r.status);
    /* A dropped server-side session is not an error to show as a failure —
       the caller re-connects instead. Reflect it in state immediately. */
    if (code === "expired" || code === "not_connected") {
      sessionId = "";
      connection = { connected: false, scope: "", expiresAt: null };
      announce();
    }
    throw new CanvaError(j?.message || `The Canva relay answered ${r.status}.`, code);
  }
  return j;
}

const NOT_DEPLOYED = {
  present: false, configured: false, configSource: "none", hasSecret: false,
  clientId: "", redirectUri: "", scopes: [], persistence: "memory",
  reason: "No backend is deployed here, so Canva cannot be configured or connected.",
};

/* Probed on demand and cached, because Settings re-renders often and a probe
   that re-runs on every keystroke is just noise in the network tab. */
let probe = null;
export function canvaStatus({ fresh = false } = {}) {
  if (fresh) probe = null;
  if (probe) return probe;
  probe = (async () => {
    try {
      const r = await fetch(PATH, { headers: relayHeaders() });
      if (!r.ok) return { ...NOT_DEPLOYED, reason: `The Canva relay answered ${r.status}.` };
      const j = await r.json();
      return { ...j, present: true, reason: j?.configured ? null : "Add the Canva client ID, secret and redirect URI to connect." };
    } catch {
      return { ...NOT_DEPLOYED };
    }
  })();
  return probe;
}

/* The secret goes straight to the relay and is never kept here. Callers clear
   their input as soon as this resolves. */
export async function configureCanva({ clientId, clientSecret, redirectUri }) {
  const j = await post({ action: "configure", clientId, clientSecret, redirectUri });
  probe = null;
  return j;
}

/* ---------- non-secret preferences ----------
   The client ID and redirect URI are public halves of an OAuth integration —
   the client ID is visible in the authorize URL by design. Remembering them
   saves retyping after the relay restarts. THE SECRET IS NOT KEPT HERE, or
   anywhere else in the browser: it is posted once to the relay and forgotten. */

const PREFS_KEY = "unison:canva:prefs";

export function defaultCanvaRedirect() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
}

export function loadCanvaPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { clientId: String(raw.clientId || ""), redirectUri: String(raw.redirectUri || "") };
  } catch { return { clientId: "", redirectUri: "" }; }
}

export function saveCanvaPrefs({ clientId, redirectUri } = {}) {
  const next = { clientId: String(clientId || "").trim(), redirectUri: String(redirectUri || "").trim() };
  /* Belt and braces: a client ID is short. Anything long enough to be a
     secret is dropped rather than written to storage, whatever was passed. */
  if (next.clientId.length > 80) next.clientId = "";
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

/* ---------- OAuth ---------- */

const REDIRECT_KEYS = ["code", "state"];

/* Runs in the window Canva redirects back to. That window is a popup opened by
   connect(), so its whole job is to hand the code to the opener and close —
   the code is useless without the PKCE verifier, which only the relay has. */
export function captureRedirect() {
  if (typeof window === "undefined") return false;
  let params;
  try { params = new URLSearchParams(window.location.search); } catch { return false; }
  const hasAuth = REDIRECT_KEYS.every((k) => params.get(k)) || params.get("error");
  if (!hasAuth || !window.opener) return false;
  try {
    window.opener.postMessage({
      source: "unison-canva",
      code: params.get("code") || "",
      state: params.get("state") || "",
      error: params.get("error") || "",
      errorDescription: params.get("error_description") || "",
    }, window.location.origin);
  } catch { return false; }
  try { window.close(); } catch { /* the browser may refuse; the message is already sent */ }
  return true;
}

const POPUP_FEATURES = "width=620,height=760,menubar=no,toolbar=no,location=yes";

/* Resolves when the popup comes back with a code, then exchanges it through
   the relay. `onUrl` is called with the authorize URL so the UI can offer a
   plain link when a popup is blocked. */
export function connect({ onUrl, timeoutMs = 5 * 60 * 1000 } = {}) {
  return (async () => {
    const started = await post({ action: "start" });
    onUrl?.(started.url);
    const popup = window.open(started.url, "unison-canva", POPUP_FEATURES);
    if (!popup) throw new CanvaError("The browser blocked the Canva sign-in window. Allow pop-ups for this site, or open the link shown.", "popup_blocked");

    const got = await new Promise((resolve, reject) => {
      const done = (fn, v) => { cleanup(); fn(v); };
      const onMessage = (e) => {
        if (e.origin !== window.location.origin) return;
        const d = e.data;
        if (!d || d.source !== "unison-canva") return;
        if (d.error) return done(reject, new CanvaError(d.errorDescription || `Canva refused the connection (${d.error}).`, "denied"));
        if (d.state !== started.state) return done(reject, new CanvaError("That sign-in did not match the request that started it.", "bad_state"));
        done(resolve, { code: d.code, state: d.state });
      };
      /* Some browsers block the message from a closing window. Reading the
         popup's own URL works once Canva has redirected back to our origin. */
      const poll = setInterval(() => {
        try {
          if (popup.closed) return done(reject, new CanvaError("The Canva sign-in window was closed before it finished.", "cancelled"));
          const q = new URLSearchParams(popup.location.search);
          if (!q.get("code") && !q.get("error")) return;
          if (q.get("error")) return done(reject, new CanvaError(q.get("error_description") || "Canva refused the connection.", "denied"));
          if (q.get("state") !== started.state) return done(reject, new CanvaError("That sign-in did not match the request that started it.", "bad_state"));
          const code = q.get("code");
          try { popup.close(); } catch { /* ignore */ }
          done(resolve, { code, state: q.get("state") });
        } catch { /* cross-origin while still on canva.com — expected */ }
      }, 400);
      const timer = setTimeout(() => {
        try { popup.close(); } catch { /* ignore */ }
        done(reject, new CanvaError("The Canva sign-in took too long.", "timeout"));
      }, timeoutMs);
      function cleanup() {
        clearInterval(poll); clearTimeout(timer);
        window.removeEventListener("message", onMessage);
      }
      window.addEventListener("message", onMessage);
    });

    const j = await post({ action: "exchange", code: got.code, state: got.state });
    sessionId = j.sessionId;
    connection = { connected: true, scope: j.scope || "", expiresAt: Date.now() + (j.expiresIn || 3600) * 1000 };
    announce();
    return connectionState();
  })();
}

export async function disconnect() {
  const id = sessionId;
  sessionId = "";
  connection = { connected: false, scope: "", expiresAt: null };
  announce();
  if (id) { try { await post({ action: "disconnect", sessionId: id }); } catch { /* already gone is the desired state */ } }
  return connectionState();
}

/* Confirms the relay still holds the session — worth doing before a long
   sequence so the user is told to reconnect up front rather than halfway. */
export async function refreshConnection() {
  if (!sessionId) return connectionState();
  try {
    const j = await post({ action: "status", sessionId });
    connection = { connected: !!j.connected, scope: j.scope || "", expiresAt: j.expiresAt || null };
    if (!j.connected) sessionId = "";
  } catch {
    connection = { connected: false, scope: "", expiresAt: null };
    sessionId = "";
  }
  announce();
  return connectionState();
}

const need = () => {
  if (!sessionId) throw new CanvaError("Connect Canva in Settings → AI first.", "not_connected");
  return sessionId;
};

/* ---------- handing the result to the rest of the product ----------
   A finished export becomes an ordinary File. That matters: the publishing
   path already accepts an uploaded file, so a Canva design reaches LinkedIn
   through the contract that exists rather than a second one built beside it.
   Nothing in the publishing code changes. */

export async function dataUrlToFile(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || "").replace(/^data:[^;]*;base64,/, ""));
  r.onerror = () => reject(new CanvaError("That file could not be read.", "read_failed"));
  r.readAsDataURL(file);
});

/* ---------- designs ---------- */

/* The connected account's own brand templates. Canva has no public API for
   searching its whole template library, so these — and only these — are the
   real templates this integration can fill. */
export async function listTemplates({ query, continuation, signal } = {}) {
  const j = await post({ action: "templates", sessionId: need(), query, continuation }, { signal });
  return { items: j.items || [], continuation: j.continuation || null };
}

export async function templateFields(templateId, { signal } = {}) {
  const j = await post({ action: "dataset", sessionId: need(), templateId }, { signal });
  return j.fields || [];
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(t); reject(Object.assign(new Error("Cancelled."), { name: "AbortError" })); }, { once: true });
});

/* Canva's long-running work is all the same shape: start a job, poll it. */
async function waitFor(action, jobId, { signal, onState, pollMs = 2000, maxWaitMs = 5 * 60 * 1000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (Date.now() > deadline) throw new CanvaError("Canva is taking longer than expected. It may still finish there.", "timeout");
    await sleep(pollMs, signal);
    const s = await post({ action, sessionId: need(), jobId }, { signal });
    if (s.state === "done") return s;
    onState?.({ state: "running" });
  }
}

/* A file the user picked, turned into a Canva asset id that an image or logo
   field can be filled with. */
export async function uploadAsset({ name, b64, signal, onState } = {}) {
  onState?.({ state: "uploading" });
  const started = await post({ action: "upload", sessionId: need(), name, b64 }, { signal });
  const done = await waitFor("uploadJob", started.jobId, { signal, onState, pollMs: 1500 });
  if (!done.assetId) throw new CanvaError("Canva accepted the file but returned no asset.", "no_asset");
  return done.assetId;
}

/* Values are a plain { fieldName: value } map; this turns them into the shape
   the autofill API documents, using the template's own field types so a text
   field is never sent as an image or the other way round. */
export function buildAutofillData(fields, values) {
  const out = {};
  for (const f of fields || []) {
    const v = values?.[f.name];
    if (v == null || v === "") continue;
    if (f.type === "image") out[f.name] = { type: "image", asset_id: String(v) };
    else if (f.type === "text") out[f.name] = { type: "text", text: String(v) };
    /* Chart and sheet fields exist but are preview features Unison does not
       fill; leaving them out keeps the template's own content. */
  }
  return out;
}

export async function fillTemplate({ templateId, fields, values, data, title, signal, onState } = {}) {
  const payload = data || buildAutofillData(fields, values);
  if (!Object.keys(payload).length) throw new CanvaError("There is nothing to fill into that template.", "empty");
  onState?.({ state: "filling" });
  const started = await post({ action: "autofill", sessionId: need(), templateId, data: payload, title }, { signal });
  const done = await waitFor("job", started.jobId, { signal, onState });
  return done.design;
}

/* Export, then bring the bytes back through the relay. Canva's download URLs
   are short-lived and cross-origin; the relay fetches them so the browser
   ends up with a data URL the existing publishing path already accepts. */
export async function exportDesign({ designId, format = "png", signal, onState } = {}) {
  onState?.({ state: "exporting" });
  const started = await post({ action: "export", sessionId: need(), designId, format }, { signal });
  const done = await waitFor("exportJob", started.jobId, { signal, onState, pollMs: 2500, maxWaitMs: 10 * 60 * 1000 });
  const url = (done.urls || [])[0];
  if (!url) throw new CanvaError("Canva reported the export finished but returned no file.", "no_file");
  onState?.({ state: "downloading" });
  const file = await post({ action: "fetch", sessionId: need(), url }, { signal });
  return {
    dataUrl: `data:${file.mime};base64,${file.b64}`,
    mime: file.mime, bytes: file.bytes, format: started.format || format,
  };
}
