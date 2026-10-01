/* ============================================================
   CANVA CLIENT

   Talks to /api/canva, which holds the client secret and every OAuth token
   in a sealed, HttpOnly cookie. Nothing here can read a token, and there is no
   session id to keep: the cookie travels with each same-origin request on its
   own, so a connection survives a page reload and a Vercel cold start.

   Two rules this file enforces:

   — One request at a time. Canva refresh tokens are single-use, and replaying
     one revokes the whole connection; two parallel calls that both decided to
     refresh would do exactly that. Every relay call goes through one queue.
   — A file is never trusted by its name. Exports come back as bytes, checked
     against their own signature on the server and here, with the real
     dimensions and duration measured before anything is offered for approval.
   ============================================================ */

import { measureMedia, validateMedia } from "./mediacheck.js";

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

let connection = { connected: false, scope: "", expiresAt: null, checked: false };
const listeners = new Set();
const announce = () => { for (const fn of listeners) { try { fn({ ...connection }); } catch { /* a listener must not break the client */ } } };
const setConnection = (c) => { connection = { ...connection, ...c, checked: true }; announce(); };

export const onCanvaChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const connectionState = () => ({ ...connection });

/* ---------- the queue ---------- */
let tail = Promise.resolve();
function queued(fn) {
  const run = tail.then(fn, fn);
  tail = run.catch(() => {});
  return run;
}

async function raw(body, { signal, query = "", bytes } = {}) {
  let r;
  try {
    r = await fetch(`${PATH}${query}`, {
      method: "POST", signal, credentials: "same-origin",
      headers: bytes ? { "Content-Type": "application/octet-stream", ...relayHeaders() } : { "Content-Type": "application/json", ...relayHeaders() },
      body: bytes || JSON.stringify(body),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new CanvaError("Could not reach the Canva relay. It needs the deployed backend — it does not work from the standalone file.", "offline");
  }
  return r;
}

async function readError(r) {
  const j = await r.json().catch(() => ({}));
  const code = j?.code || String(r.status);
  if (code === "expired" || code === "not_connected") setConnection({ connected: false, scope: "", expiresAt: null });
  if (r.status === 413) return new CanvaError(j?.message || "That file is larger than this server will accept (4.5 MB on Vercel). Upload it in Canva's editor instead.", "too_large");
  return new CanvaError(j?.message || `The Canva relay answered ${r.status}.`, code);
}

const post = (body, opts = {}) => queued(async () => {
  const r = await raw(body, opts);
  if (!r.ok) throw await readError(r);
  const j = await r.json().catch(() => ({}));
  if (j?.ok === false) throw new CanvaError(j?.message || "Canva refused the request.", j?.code);
  return j;
});

/* ---------- configuration ---------- */

const NOT_DEPLOYED = {
  present: false, configured: false, configSource: "none", hasSecret: false,
  clientId: "", redirectUri: "", scopes: [], persistence: "cookie",
  reason: "No backend is deployed here, so Canva cannot be configured or connected.",
};

let probe = null;
export function canvaStatus({ fresh = false } = {}) {
  if (fresh) probe = null;
  if (probe) return probe;
  probe = (async () => {
    try {
      const r = await fetch(PATH, { headers: relayHeaders(), credentials: "same-origin" });
      if (!r.ok) return { ...NOT_DEPLOYED, reason: `The Canva relay answered ${r.status}.` };
      const j = await r.json();
      return { ...j, present: true, reason: j?.configured ? null : "Add the Canva client ID, secret and redirect URI to connect." };
    } catch { return { ...NOT_DEPLOYED }; }
  })();
  return probe;
}

export async function configureCanva({ clientId, clientSecret, redirectUri }) {
  const j = await post({ action: "configure", clientId, clientSecret, redirectUri });
  probe = null;
  return j;
}

/* ---------- non-secret preferences ---------- */

const PREFS_KEY = "unison:canva:prefs";
export function defaultCanvaRedirect() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
}
export function loadCanvaPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { clientId: String(v.clientId || ""), redirectUri: String(v.redirectUri || "") };
  } catch { return { clientId: "", redirectUri: "" }; }
}
export function saveCanvaPrefs({ clientId, redirectUri } = {}) {
  const next = { clientId: String(clientId || "").trim(), redirectUri: String(redirectUri || "").trim() };
  if (next.clientId.length > 80) next.clientId = "";      /* never a secret, whatever was passed */
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

/* ---------- OAuth ---------- */

/* Runs in the pop-up Canva redirects back to: hand the code to the opener
   and close. The code is useless alone — the PKCE verifier is sealed in a
   cookie only the relay can open. */
export function captureRedirect() {
  if (typeof window === "undefined") return false;
  let params;
  try { params = new URLSearchParams(window.location.search); } catch { return false; }
  const hasAuth = (params.get("code") && params.get("state")) || params.get("error");
  if (!hasAuth || !window.opener) return false;
  try {
    window.opener.postMessage({
      source: "unison-canva", code: params.get("code") || "", state: params.get("state") || "",
      error: params.get("error") || "", errorDescription: params.get("error_description") || "",
    }, window.location.origin);
  } catch { return false; }
  try { window.close(); } catch { /* the message is already sent */ }
  return true;
}

const POPUP_FEATURES = "width=620,height=760,menubar=no,toolbar=no,location=yes";

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
      const timer = setTimeout(() => { try { popup.close(); } catch { /* ignore */ } done(reject, new CanvaError("The Canva sign-in took too long.", "timeout")); }, timeoutMs);
      function cleanup() { clearInterval(poll); clearTimeout(timer); window.removeEventListener("message", onMessage); }
      window.addEventListener("message", onMessage);
    });

    const j = await post({ action: "exchange", code: got.code, state: got.state });
    setConnection({ connected: !!j.connected, scope: j.scope || "", expiresAt: Date.now() + (j.expiresIn || 3600) * 1000 });
    return connectionState();
  })();
}

export async function disconnect() {
  setConnection({ connected: false, scope: "", expiresAt: null });
  try { await post({ action: "disconnect" }); } catch { /* already gone is the desired state */ }
  return connectionState();
}

/* Asks the relay whether the cookie still holds a connection. Called on load,
   so a reload no longer forgets that Canva is connected. */
export async function refreshConnection() {
  try {
    const j = await post({ action: "status" });
    setConnection({ connected: !!j.connected, scope: j.scope || "", expiresAt: j.expiresAt || null });
  } catch {
    setConnection({ connected: false, scope: "", expiresAt: null });
  }
  return connectionState();
}

/* ---------- jobs ---------- */

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.("abort", () => { clearTimeout(t); reject(Object.assign(new Error("Cancelled."), { name: "AbortError" })); }, { once: true });
});

async function waitFor(action, jobId, { signal, onState, pollMs = 2000, maxWaitMs = 5 * 60 * 1000 } = {}) {
  if (!jobId) throw new CanvaError("Canva did not start the job.", "no_job");
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (Date.now() > deadline) throw new CanvaError("Canva is taking longer than expected. It may still finish there.", "timeout");
    await sleep(pollMs, signal);
    const s = await post({ action, jobId }, { signal });
    if (s.state === "done") return s;
    onState?.({ state: "running" });
  }
}

/* ---------- designs ---------- */

export async function listTemplates({ query, continuation, signal } = {}) {
  const j = await post({ action: "templates", query, continuation }, { signal });
  return { items: j.items || [], continuation: j.continuation || null };
}

export async function templateFields(templateId, { signal } = {}) {
  return (await post({ action: "dataset", templateId }, { signal })).fields || [];
}

export async function listDesigns({ query, continuation, signal } = {}) {
  const j = await post({ action: "designs", query, continuation }, { signal });
  return { items: j.items || [], continuation: j.continuation || null };
}

export async function getDesign(designId, { signal } = {}) {
  return (await post({ action: "design", designId }, { signal })).design;
}

export async function exportFormats(designId, { signal } = {}) {
  return (await post({ action: "exportFormats", designId }, { signal })).formats || [];
}

export async function createDesign({ assetId, width, height, title, signal } = {}) {
  return (await post({ action: "createDesign", assetId, width, height, title }, { signal })).design;
}

export function buildAutofillData(fields, values) {
  const out = {};
  for (const f of fields || []) {
    const v = values?.[f.name];
    if (v == null || v === "") continue;
    if (f.type === "image") out[f.name] = { type: "image", asset_id: String(v) };
    else if (f.type === "text") out[f.name] = { type: "text", text: String(v) };
    /* chart and sheet fields are preview features Unison does not fill */
  }
  return out;
}

export async function fillTemplate({ templateId, fields, values, data, title, signal, onState } = {}) {
  const payload = data || buildAutofillData(fields, values);
  if (!Object.keys(payload).length) throw new CanvaError("There is nothing to fill into that template.", "empty");
  onState?.({ state: "filling" });
  const started = await post({ action: "autofill", templateId, data: payload, title }, { signal });
  return (await waitFor("job", started.jobId, { signal, onState })).design;
}

/* ---------- assets ---------- */

/* Raw bytes, not base64: a third smaller, which matters because a Vercel
   function will not accept a request body over 4.5 MB. */
export const UPLOAD_CEILING = 4.4 * 1024 * 1024;

export async function uploadBlob(blob, { name = "unison-upload", signal, onState } = {}) {
  if (!blob?.size) throw new CanvaError("There is no file to send to Canva.", "empty");
  if (blob.size > UPLOAD_CEILING) {
    throw new CanvaError(`That file is ${(blob.size / 1048576).toFixed(1)} MB, more than the 4.5 MB a Vercel function accepts. Open the design in Canva and add the file from your device there instead.`, "too_large");
  }
  onState?.({ state: "uploading" });
  const started = await queued(async () => {
    const r = await raw(null, { signal, bytes: blob, query: `?action=upload&name=${encodeURIComponent(name)}` });
    if (!r.ok) throw await readError(r);
    return r.json();
  });
  return (await waitFor("uploadJob", started.jobId, { signal, onState, pollMs: 1500 })).assetId;
}

/* Canva fetches it itself — no size ceiling. For files at a public address. */
export async function uploadFromUrl(url, { name = "unison-upload", signal, onState } = {}) {
  onState?.({ state: "uploading" });
  const started = await post({ action: "uploadUrl", url, name }, { signal });
  return (await waitFor("uploadUrlJob", started.jobId, { signal, onState, pollMs: 2000, maxWaitMs: 10 * 60 * 1000 })).assetId;
}

/* Kept for the template fields that take an image. */
export async function uploadAsset({ name, file, blob, signal, onState } = {}) {
  return uploadBlob(file || blob, { name, signal, onState });
}

export const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();
export async function dataUrlToFile(dataUrl, name) {
  const blob = await dataUrlToBlob(dataUrl);
  return new File([blob], name, { type: blob.type || "application/octet-stream" });
}

/* ---------- export, download, validate ---------- */

export { measureMedia };

/* Export, download through the relay, and validate. Resolves only when the
   file has been retrieved, its signature matches the requested format, and the
   browser has actually decoded its dimensions (and, for video, its duration). */
export async function exportDesign({ designId, format = "png", quality, signal, onState } = {}) {
  onState?.({ state: "exporting" });
  const started = await post({ action: "export", designId, format, quality }, { signal });
  const done = await waitFor("exportJob", started.jobId, { signal, onState, pollMs: 2500, maxWaitMs: 15 * 60 * 1000 });
  if (!done.files) throw new CanvaError("Canva reported the export finished but returned no file.", "no_file");
  onState?.({ state: "downloading" });
  const expect = started.format || format;
  const blob = await queued(async () => {
    const r = await raw({ action: "download", jobId: started.jobId, index: 0, expect }, { signal });
    if (!r.ok) throw await readError(r);
    return r.blob();
  });
  let checked;
  try {
    checked = await validateMedia(blob, { expect: expect === "jpg" ? "jpeg" : expect, label: "file Canva returned" });
  } catch (e) {
    throw new CanvaError(e.message, e.code);
  }
  onState?.({ state: "validated" });
  const { video: _video, ...props } = checked;
  return { ...props, files: done.files };
}

/* ---------- return navigation ----------
   Canva's editor can send the user back to Unison when they finish: the
   design's edit_url carries a correlation_state, and Canva redirects to the
   Return URL configured on the integration with that state inside a signed
   correlation_jwt. The state here is only a lookup key into what this browser
   remembered — the design id is never taken from the URL, so a crafted link
   cannot make Unison export some other design. */

const PENDING_KEY = "unison:canva:pending";
const CHANNEL = "unison-canva-return";

export function rememberEdit(entry) {
  const state = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  try {
    const all = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}");
    for (const [k, v] of Object.entries(all)) if (Date.now() - (v.at || 0) > 7 * 864e5) delete all[k];
    all[state] = { ...entry, at: Date.now() };
    localStorage.setItem(PENDING_KEY, JSON.stringify(all));
  } catch { /* the manual "bring back" still works */ }
  return state;
}

export function pendingEdit(state) {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}")[state] || null; } catch { return null; }
}

export function forgetEdit(state) {
  try { const all = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}"); delete all[state]; localStorage.setItem(PENDING_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

export function editUrlWithReturn(editUrl, state) {
  try { const u = new URL(editUrl); u.searchParams.set("correlation_state", state); return u.toString(); } catch { return editUrl; }
}

const jwtPayload = (jwt) => {
  try {
    const p = String(jwt).split(".")[1];
    return JSON.parse(decodeURIComponent(escape(atob(p.replace(/-/g, "+").replace(/_/g, "/")))));
  } catch { return null; }
};

/* Runs on load. Returns the correlation state if this page is a return from
   Canva's editor, tells any other open Unison tab, and cleans the URL. */
export function captureReturn() {
  if (typeof window === "undefined") return null;
  let q;
  try { q = new URLSearchParams(window.location.search); } catch { return null; }
  const jwt = q.get("correlation_jwt");
  const state = jwt ? (jwtPayload(jwt)?.correlation_state || null) : q.get("correlation_state");
  if (!state) return null;
  try { new BroadcastChannel(CHANNEL).postMessage({ state }); } catch { /* single tab is fine */ }
  try {
    q.delete("correlation_jwt"); q.delete("correlation_state");
    window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}${window.location.hash}`);
  } catch { /* ignore */ }
  try { sessionStorage.setItem("unison:canva:returned", state); } catch { /* ignore */ }
  return state;
}

export function onReturn(fn) {
  const handlers = [];
  try { const ch = new BroadcastChannel(CHANNEL); ch.onmessage = (e) => e.data?.state && fn(e.data.state); handlers.push(() => ch.close()); } catch { /* no BroadcastChannel */ }
  try {
    const s = sessionStorage.getItem("unison:canva:returned");
    if (s) { sessionStorage.removeItem("unison:canva:returned"); setTimeout(() => fn(s), 0); }
  } catch { /* ignore */ }
  return () => handlers.forEach((h) => h());
}
