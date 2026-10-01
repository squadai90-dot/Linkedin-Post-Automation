/* ============================================================
   AI GENERATION CLIENT

   Talks to /api/image and /api/video, which hold the keys. The browser never
   sees a provider key and there is no way to pass one from here.

   Three things this is careful about, because all three cost money or
   credibility:

   — Nothing paid happens unless the user asked for it. `capabilities()` is a
     read-only probe; generation only runs from an explicit action.
   — A repeated click does not pay twice. Identical in-flight requests share
     one promise.
   — A failure never silently becomes something else. If artwork generation
     fails, the caller is told, and the existing renderer is offered as a
     labelled alternative rather than substituted behind the user's back.
   ============================================================ */

import { validateMedia } from "./mediacheck.js";

const IMAGE_PATH = (typeof window !== "undefined" && window.UNISON_IMAGE_API) || "/api/image";
const VIDEO_PATH = (typeof window !== "undefined" && window.UNISON_VIDEO_API) || "/api/video";

const relayHeaders = () => {
  try {
    const t = localStorage.getItem("unison:relay-token");
    return t ? { "X-Unison-Token": t } : {};
  } catch { return {}; }
};

const NOT_CONFIGURED = {
  configured: false, providers: {}, defaultProvider: null, pricing: {},
  reason: "No image or video key is set on the server, so nothing paid can run.",
};

/* Probed once per page. A probe is free; a generation is not. */
const probes = new Map();
async function probe(path) {
  if (probes.has(path)) return probes.get(path);
  const p = (async () => {
    try {
      const r = await fetch(path, { headers: relayHeaders() });
      if (!r.ok) return { ...NOT_CONFIGURED, reason: `The relay answered ${r.status}.` };
      const j = await r.json();
      /* A relay that exists but has no key is not configured, and saying so
         plainly is the difference between "try again" and "add a key". */
      if (!j?.configured) return { ...NOT_CONFIGURED, ...j, configured: false };
      return { ...j, configured: true, reason: null };
    } catch {
      return { ...NOT_CONFIGURED, reason: "No backend is deployed, so AI artwork is unavailable here." };
    }
  })();
  probes.set(path, p);
  return p;
}

export const imageCapabilities = () => probe(IMAGE_PATH);
export const videoCapabilities = () => probe(VIDEO_PATH);
export const resetCapabilities = () => probes.clear();

/* ---------- de-duplication ---------- */
const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

class GenError extends Error {
  constructor(message, code) { super(message); this.code = code || "failed"; }
}

async function post(path, body, signal) {
  let r;
  try {
    r = await fetch(path, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", ...relayHeaders() },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new GenError("Could not reach the generation service.", "offline");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) {
    throw new GenError(j?.message || `The service answered ${r.status}.`, j?.code || String(r.status));
  }
  return j;
}

/* A binary answer from a relay: the file on success, the relay's own JSON
   explanation on failure. */
async function download(path, body, signal) {
  let r;
  try {
    r = await fetch(path, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", ...relayHeaders() },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new GenError("Could not reach the generation service to fetch the finished file.", "offline");
  }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new GenError(j?.message || `The service answered ${r.status} when fetching the file.`, j?.code || String(r.status));
  }
  return r.blob();
}

/* ---------- images ---------- */

export async function generateArtwork({ prompt, shape = "wide", provider, signal } = {}) {
  if (!prompt || prompt.length < 8) throw new GenError("There is no prompt to generate from.", "bad_prompt");
  const key = `img:${provider || "-"}:${shape}:${prompt}`;
  return once(key, async () => {
    const j = await post(IMAGE_PATH, { prompt, shape, provider }, signal);
    return {
      dataUrl: `data:${j.mime || "image/png"};base64,${j.b64}`,
      provider: j.provider, model: j.model, usd: j.usd, shape: j.shape,
      generated: true, source: "ai",
    };
  });
}

/* ---------- video ----------
   Two steps, because generation is long-running. `onState` reports progress
   so the UI can show something truthful rather than a spinner that never
   explains itself. */

export async function generateClip({ prompt, seconds = 8, provider, imageB64, imageMime, signal, onState, pollMs = 5000, maxWaitMs = 8 * 60 * 1000 } = {}) {
  if (!prompt || prompt.length < 8) throw new GenError("There is no prompt to generate from.", "bad_prompt");
  const started = await post(VIDEO_PATH, { prompt, seconds, provider, imageB64, imageMime }, signal);
  onState?.({ state: "running", id: started.id, usd: started.usd, provider: started.provider });

  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error("Cancelled."), { name: "AbortError" });
    if (Date.now() > deadline) {
      throw new GenError("The video is taking longer than expected. It may still finish at the provider.", "timeout");
    }
    await new Promise((r) => setTimeout(r, pollMs));
    const s = await post(VIDEO_PATH, { action: "status", id: started.id, provider: started.provider }, signal);
    if (s.state === "done") {
      /* "Done" at the provider is not a video yet. The file is fetched through
         the relay (which holds the key), then checked by its own bytes and
         decoded by this browser before it is offered for approval. */
      onState?.({ state: "downloading" });
      const blob = await download(VIDEO_PATH, { action: "download", id: started.id, provider: started.provider }, signal);
      onState?.({ state: "validating" });
      let checked;
      try { checked = await validateMedia(blob, { expect: "video", label: "generated video" }); } catch (e) { throw new GenError(e.message, e.code); }
      onState?.({ state: "done" });
      return {
        blob: checked.blob, url: checked.url, mime: checked.mime, bytes: checked.bytes,
        width: checked.width, height: checked.height, duration: checked.duration,
        sourceUrl: s.sourceUrl || null,
        provider: started.provider, model: started.model, usd: started.usd,
        seconds: started.seconds, generated: true, source: "ai",
      };
    }
    onState?.({ state: "running", id: started.id });
  }
}

export { GenError };
