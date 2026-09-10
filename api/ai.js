/**
 * Unison AI relay
 *
 *   Unison frontend  ->  this endpoint  ->  Groq (default) or Anthropic
 *
 * Deployed, the browser holds no key — this endpoint does. Set GROQ_API_KEY
 * (free, from console.groq.com) and optionally ANTHROPIC_API_KEY.
 *
 * The frontend probes GET /api/ai on first use; if this file is deployed it
 * routes all hosted AI calls here, otherwise it calls the provider directly
 * with a key from the browser's own settings.
 *
 * The provider comes from the x-unison-provider header. Everything forwarded
 * upstream is rebuilt field by field below — nothing is passed through
 * wholesale, so a client cannot reach an endpoint or parameter this file does
 * not name.
 */

const KEYS = {
  groq: process.env.GROQ_API_KEY || "",
  anthropic: process.env.ANTHROPIC_API_KEY || "",
};

const UPSTREAM = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

const MAX_TOKENS_CAP = 8000;
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 55000);
const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";
const DEFAULT_PROVIDER = KEYS.groq ? "groq" : "anthropic";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      service: "unison-ai-relay",
      version: 3,
      providers: { groq: !!KEYS.groq, anthropic: !!KEYS.anthropic },
      defaultProvider: DEFAULT_PROVIDER,
      /* Kept so a frontend built before multi-provider support still reads a
         truthful answer from a newer relay. */
      keyConfigured: !!(KEYS.groq || KEYS.anthropic),
      tokenRequired: !!RELAY_TOKEN,
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: { message: "Method not allowed." } });
  }
  if (RELAY_TOKEN && req.headers["x-unison-token"] !== RELAY_TOKEN) {
    return res.status(401).json({ error: { message: "This relay requires a team token. Add it under Settings → Advanced." } });
  }

  const provider = String(req.headers["x-unison-provider"] || DEFAULT_PROVIDER).toLowerCase();
  if (!UPSTREAM[provider]) {
    return res.status(400).json({ error: { message: `Unknown AI provider "${provider}".` } });
  }
  if (!KEYS[provider]) {
    return res.status(500).json({ error: { message: `${provider === "groq" ? "GROQ_API_KEY" : "ANTHROPIC_API_KEY"} is not set on the server.` } });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!body || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: { message: "Body must include a messages array." } });
  }

  let forward, headers;
  if (provider === "groq") {
    if (body.model && !/^[\w.-]+(\/[\w.-]+)?$/.test(String(body.model))) {
      return res.status(400).json({ error: { message: "That model name is not valid." } });
    }
    forward = {
      model: body.model || "llama-3.3-70b-versatile",
      messages: body.messages,
    };
    /* The compound systems reject the tuning parameters, so only send them
       to the models that accept them. */
    if (!/^groq\/compound/.test(forward.model)) {
      forward.max_completion_tokens = Math.min(Number(body.max_completion_tokens) || 4000, MAX_TOKENS_CAP);
      const temp = Number(body.temperature);
      if (Number.isFinite(temp) && temp >= 0 && temp <= 2) forward.temperature = temp;
      if (body.response_format?.type === "json_object") forward.response_format = { type: "json_object" };
    }
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.groq}` };
  } else {
    if (body.model && !/^claude-/.test(String(body.model))) {
      return res.status(400).json({ error: { message: "Only Claude models are allowed here." } });
    }
    forward = {
      model: body.model || "claude-opus-5",
      max_tokens: Math.min(Number(body.max_tokens) || 4000, MAX_TOKENS_CAP),
      messages: body.messages,
    };
    if (body.system) forward.system = body.system;
    if (body.tools) forward.tools = body.tools; // e.g. web_search — passed through as-is
    if (body.output_config && typeof body.output_config === "object") {
      // effort only; nothing else from the client reaches the upstream request
      const effort = String(body.output_config.effort || "");
      if (["low", "medium", "high"].includes(effort)) forward.output_config = { effort };
    }
    headers = { "Content-Type": "application/json", "x-api-key": KEYS.anthropic, "anthropic-version": "2023-06-01" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(UPSTREAM[provider], { method: "POST", headers, body: JSON.stringify(forward), signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e?.name === "AbortError";
    console.error("[unison:ai] upstream failed", { provider, timedOut, error: String(e?.message || e) });
    return res.status(timedOut ? 504 : 502).json({ error: { message: timedOut ? "The AI service did not respond in time." : "Could not reach the AI service." } });
  }
  clearTimeout(timer);

  /* The daily-allowance headers are the whole point of the free tier, so pass
     them back rather than making the browser guess what is left. */
  for (const h of ["x-ratelimit-limit-requests", "x-ratelimit-remaining-requests", "x-ratelimit-reset-requests",
                   "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens", "x-ratelimit-reset-tokens"]) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }

  const text = await upstream.text().catch(() => "");
  res.status(upstream.status);
  res.setHeader("Content-Type", "application/json");
  return res.send(text || JSON.stringify({ error: { message: "Empty upstream response." } }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export const config = { api: { bodyParser: { sizeLimit: "2mb" } }, maxDuration: 60 };
