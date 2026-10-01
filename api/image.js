/**
 * Unison image relay
 *
 *   Unison frontend  ->  this endpoint  ->  OpenAI Images (default) or Google Imagen
 *
 * The browser never holds an image key. This endpoint does, from the
 * environment, and nothing the client sends is forwarded wholesale — every
 * upstream field is rebuilt here, so a client cannot reach a parameter or an
 * endpoint this file does not name.
 *
 * Set ONE of:
 *   OPENAI_API_KEY   — https://platform.openai.com  (gpt-image-1, Copyright Shield on paid API tiers)
 *   GOOGLE_API_KEY   — https://aistudio.google.com  (Imagen)
 *
 * With neither set, GET reports configured:false and the frontend keeps using
 * its own renderer instead. It never silently substitutes one for the other.
 */

const KEYS = {
  openai: process.env.OPENAI_API_KEY || "",
  google: process.env.GOOGLE_API_KEY || "",
};

const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";
const TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 120000);

/* Prices are per image, from each provider's published pricing at the time of
   writing. They are shown to the user before a paid call, so they are kept
   here rather than in the browser where they could drift out of sync with the
   model actually being called. Verify against the provider before relying on
   them for billing. */
const MODELS = {
  openai: {
    endpoint: "https://api.openai.com/v1/images/generations",
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    usd: Number(process.env.OPENAI_IMAGE_USD || 0.04),
    sizes: { wide: "1536x1024", square: "1024x1024", tall: "1024x1536" },
  },
  google: {
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    model: process.env.GOOGLE_IMAGE_MODEL || "imagen-4.0-generate-001",
    usd: Number(process.env.GOOGLE_IMAGE_USD || 0.04),
    sizes: { wide: "16:9", square: "1:1", tall: "3:4" },
  },
};

const DEFAULT_PROVIDER = KEYS.openai ? "openai" : KEYS.google ? "google" : null;
const MAX_PROMPT = 3000;
/* Vercel rejects a function response over 4.5 MB. Leave headroom for the JSON
   around the image. */
const RESPONSE_CEILING = 4.3 * 1024 * 1024;

const fail = (res, status, code, message) => res.status(status).json({ ok: false, code, message });

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      service: "unison-image-relay",
      version: 1,
      configured: !!DEFAULT_PROVIDER,
      providers: { openai: !!KEYS.openai, google: !!KEYS.google },
      defaultProvider: DEFAULT_PROVIDER,
      /* So the UI can show a cost before spending anything. */
      pricing: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { usdPerImage: m.usd, model: m.model }])),
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
      "No image key is set on the server. Add OPENAI_API_KEY or GOOGLE_API_KEY and redeploy.");
  }

  const prompt = String(body.prompt || "").trim().slice(0, MAX_PROMPT);
  if (prompt.length < 8) return fail(res, 400, "bad_prompt", "The prompt is too short to generate from.");

  const shape = ["wide", "square", "tall"].includes(body.shape) ? body.shape : "wide";
  const spec = MODELS[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const out = provider === "openai"
      ? await callOpenAI(spec, prompt, shape, controller.signal)
      : await callGoogle(spec, prompt, shape, controller.signal);
    clearTimeout(timer);
    if (out.b64.length > RESPONSE_CEILING) {
      return fail(res, 502, "too_large",
        "The provider returned an image too large to pass back through this server (Vercel caps a response at 4.5 MB). Try again, or use a smaller shape.");
    }
    return res.status(200).json({
      ok: true, provider, model: spec.model, shape,
      usd: spec.usd,
      /* base64 only — the frontend composites text over it and hands the
         result to the existing publishing path unchanged. */
      b64: out.b64, mime: out.mime || "image/png",
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e?.name === "AbortError";
    return fail(res, aborted ? 504 : 502, aborted ? "timeout" : "upstream",
      aborted ? `${provider} did not answer within ${Math.round(TIMEOUT_MS / 1000)}s.` : String(e?.message || "The image provider refused the request."));
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function callOpenAI(spec, prompt, shape, signal) {
  const r = await fetch(spec.endpoint, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.openai}` },
    /* JPEG rather than the default PNG: a 1536×1024 PNG can approach Vercel's
       4.5 MB response cap once base64-encoded; a quality-90 JPEG is a few
       hundred kilobytes and indistinguishable once text is composited on it. */
    body: JSON.stringify({
      model: spec.model, prompt, size: spec.sizes[shape], n: 1,
      ...(/^gpt-image/.test(spec.model) ? { output_format: "jpeg", output_compression: 90 } : {}),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `OpenAI returned ${r.status}.`);
  const first = j?.data?.[0];
  if (!first?.b64_json) throw new Error("OpenAI returned no image data.");
  return { b64: first.b64_json, mime: /^gpt-image/.test(spec.model) ? "image/jpeg" : "image/png" };
}

async function callGoogle(spec, prompt, shape, signal) {
  const url = `${spec.endpoint}/${spec.model}:predict?key=${encodeURIComponent(KEYS.google)}`;
  const r = await fetch(url, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: spec.sizes[shape] },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Google returned ${r.status}.`);
  const first = j?.predictions?.[0];
  if (!first?.bytesBase64Encoded) throw new Error("Google returned no image data.");
  return { b64: first.bytesBase64Encoded, mime: first.mimeType || "image/png" };
}
