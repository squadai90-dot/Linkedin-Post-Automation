/**
 * Unison video relay
 *
 *   Unison frontend  ->  this endpoint  ->  Google Veo (default) or Runway
 *
 * Video generation is long-running, so this relay is two calls: POST to
 * start, then POST {action:"status", id} to poll. Nothing is streamed and
 * nothing is stored here — the frontend holds the job id and asks again.
 *
 * Set ONE of:
 *   GOOGLE_API_KEY   — https://aistudio.google.com   (Veo)
 *   RUNWAY_API_KEY   — https://dev.runwayml.com      (Gen-4)
 *
 * With neither set, GET reports configured:false and the frontend keeps using
 * its own browser renderer, which is free and always available. A paid video
 * is never generated unless the user asks for one.
 */

const KEYS = {
  google: process.env.GOOGLE_API_KEY || "",
  runway: process.env.RUNWAY_API_KEY || "",
};

const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";
const TIMEOUT_MS = Number(process.env.VIDEO_TIMEOUT_MS || 60000);

/* Per-second pricing from each provider's published rates at the time of
   writing, used to show a cost before spending anything. Verify against the
   provider before relying on it for billing. */
const MODELS = {
  google: {
    model: process.env.GOOGLE_VIDEO_MODEL || "veo-3.1-fast-generate-001",
    usdPerSecond: Number(process.env.GOOGLE_VIDEO_USD_SEC || 0.05),
    maxSeconds: 8,
    base: "https://generativelanguage.googleapis.com/v1beta",
  },
  runway: {
    model: process.env.RUNWAY_VIDEO_MODEL || "gen4_turbo",
    usdPerSecond: Number(process.env.RUNWAY_VIDEO_USD_SEC || 0.12),
    maxSeconds: 10,
    base: "https://api.dev.runwayml.com/v1",
  },
};

const DEFAULT_PROVIDER = KEYS.google ? "google" : KEYS.runway ? "runway" : null;
const MAX_PROMPT = 2000;

const fail = (res, status, code, message) => res.status(status).json({ ok: false, code, message });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      service: "unison-video-relay",
      version: 1,
      configured: !!DEFAULT_PROVIDER,
      providers: { google: !!KEYS.google, runway: !!KEYS.runway },
      defaultProvider: DEFAULT_PROVIDER,
      pricing: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, {
        usdPerSecond: m.usdPerSecond, maxSeconds: m.maxSeconds, model: m.model,
      }])),
      tokenRequired: !!RELAY_TOKEN,
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method", "Use GET or POST.");
  }
  if (RELAY_TOKEN && req.headers["x-unison-token"] !== RELAY_TOKEN) {
    return fail(res, 401, "unauthorized", "This relay needs a token.");
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const provider = MODELS[body.provider] && KEYS[body.provider] ? body.provider : DEFAULT_PROVIDER;
  if (!provider) {
    return fail(res, 503, "not_configured",
      "No video key is set on the server. Add GOOGLE_API_KEY or RUNWAY_API_KEY and redeploy.");
  }
  const spec = MODELS[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    if (body.action === "status") {
      const id = String(body.id || "").slice(0, 400);
      if (!id) throw new Error("No job id to check.");
      const out = await (provider === "google" ? googleStatus(spec, id, controller.signal) : runwayStatus(spec, id, controller.signal));
      clearTimeout(timer);
      return res.status(200).json({ ok: true, provider, ...out });
    }

    const prompt = String(body.prompt || "").trim().slice(0, MAX_PROMPT);
    if (prompt.length < 8) return fail(res, 400, "bad_prompt", "The prompt is too short to generate from.");
    const seconds = Math.min(Math.max(Number(body.seconds) || 8, 2), spec.maxSeconds);

    const id = await (provider === "google"
      ? googleStart(spec, prompt, seconds, controller.signal)
      : runwayStart(spec, prompt, seconds, body.imageB64, controller.signal));
    clearTimeout(timer);
    return res.status(202).json({
      ok: true, provider, model: spec.model, id, seconds,
      usd: Number((spec.usdPerSecond * seconds).toFixed(3)),
      state: "running",
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e?.name === "AbortError";
    return fail(res, aborted ? 504 : 502, aborted ? "timeout" : "upstream",
      aborted ? `${provider} did not answer within ${Math.round(TIMEOUT_MS / 1000)}s.` : String(e?.message || "The video provider refused the request."));
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function googleStart(spec, prompt, seconds, signal) {
  const r = await fetch(`${spec.base}/models/${spec.model}:predictLongRunning?key=${encodeURIComponent(KEYS.google)}`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { durationSeconds: seconds, aspectRatio: "16:9" } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Google returned ${r.status}.`);
  if (!j?.name) throw new Error("Google did not return a job to poll.");
  return j.name;
}

async function googleStatus(spec, id, signal) {
  const r = await fetch(`${spec.base}/${id}?key=${encodeURIComponent(KEYS.google)}`, { signal });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Google returned ${r.status}.`);
  if (!j.done) return { state: "running" };
  if (j.error) throw new Error(j.error.message || "Generation failed.");
  const v = j?.response?.generateVideoResponse?.generatedSamples?.[0]?.video
    || j?.response?.generatedSamples?.[0]?.video;
  const uri = v?.uri || v?.url;
  if (!uri) throw new Error("Google reported success but returned no video.");
  /* The download URL needs the key, which must not leave the server, so the
     bytes are fetched here and handed back inline.

     The address comes out of Google's job response rather than from this file,
     and the next line attaches an API key to it. So the host is checked first:
     a key must never be appended to a URL that is not Google's, however that
     URL came to be there. */
  let target;
  try { target = new URL(uri); } catch { throw new Error("Google returned a video address that could not be read."); }
  if (target.protocol !== "https:" || !/(^|\.)googleapis\.com$/.test(target.hostname)) {
    throw new Error("Google returned the video at an unexpected address, so it was not downloaded.");
  }
  if (!target.searchParams.has("key")) target.searchParams.set("key", KEYS.google);
  const dl = await fetch(target, { signal });
  if (!dl.ok) throw new Error(`Could not download the finished video (${dl.status}).`);
  const buf = Buffer.from(await dl.arrayBuffer());
  return { state: "done", mime: "video/mp4", b64: buf.toString("base64"), bytes: buf.length };
}

async function runwayStart(spec, prompt, seconds, imageB64, signal) {
  /* Runway's Gen-4 endpoints are image-to-video: the still comes from the
     image relay, so the two stay consistent. */
  if (!imageB64) throw new Error("Runway needs a starting image. Generate the artwork first.");
  const r = await fetch(`${spec.base}/image_to_video`, {
    method: "POST", signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEYS.runway}`,
      "X-Runway-Version": process.env.RUNWAY_API_VERSION || "2024-11-06",
    },
    body: JSON.stringify({
      model: spec.model, promptText: prompt, duration: seconds, ratio: "1280:720",
      promptImage: `data:image/png;base64,${imageB64}`,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || j?.message || `Runway returned ${r.status}.`);
  if (!j?.id) throw new Error("Runway did not return a job to poll.");
  return j.id;
}

async function runwayStatus(spec, id, signal) {
  const r = await fetch(`${spec.base}/tasks/${encodeURIComponent(id)}`, {
    signal,
    headers: { Authorization: `Bearer ${KEYS.runway}`, "X-Runway-Version": process.env.RUNWAY_API_VERSION || "2024-11-06" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Runway returned ${r.status}.`);
  if (j.status === "FAILED") throw new Error(j.failure || "Generation failed.");
  if (j.status !== "SUCCEEDED") return { state: "running" };
  const uri = j?.output?.[0];
  if (!uri) throw new Error("Runway reported success but returned no video.");
  const dl = await fetch(uri, { signal });
  if (!dl.ok) throw new Error(`Could not download the finished video (${dl.status}).`);
  const buf = Buffer.from(await dl.arrayBuffer());
  return { state: "done", mime: "video/mp4", b64: buf.toString("base64"), bytes: buf.length };
}
