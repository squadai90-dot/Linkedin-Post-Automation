/**
 * Unison AI relay
 *
 *   Unison frontend  ->  this endpoint  ->  Anthropic Messages API
 *
 * Deployed, the browser has no Anthropic key — this endpoint holds it.
 * Set ANTHROPIC_API_KEY in the project's environment variables.
 * The frontend probes GET /api/ai on first use; if this file is deployed it
 * routes all hosted AI calls here, otherwise it falls back to whatever the
 * environment allows (the Claude artifact preview provides keyless access).
 */

const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const UPSTREAM = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS_CAP = 8000;
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 55000);
const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({ service: "unison-ai-relay", version: 2, keyConfigured: !!API_KEY, tokenRequired: !!RELAY_TOKEN });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: { message: "Method not allowed." } });
  }
  if (RELAY_TOKEN && req.headers["x-unison-token"] !== RELAY_TOKEN) {
    return res.status(401).json({ error: { message: "This relay requires a team token. Add it under Settings → Advanced." } });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: { message: "ANTHROPIC_API_KEY is not set on the server." } });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!body || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: { message: "Body must include a messages array." } });
  }
  if (body.model && !/^claude-/.test(String(body.model))) {
    return res.status(400).json({ error: { message: "Only Claude models are allowed here." } });
  }

  const forward = {
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(forward),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e?.name === "AbortError";
    console.error("[unison:ai] upstream failed", { timedOut, error: String(e?.message || e) });
    return res.status(timedOut ? 504 : 502).json({ error: { message: timedOut ? "The AI service did not respond in time." : "Could not reach the AI service." } });
  }
  clearTimeout(timer);

  const text = await upstream.text().catch(() => "");
  res.status(upstream.status);
  res.setHeader("Content-Type", "application/json");
  return res.send(text || JSON.stringify({ error: { message: "Empty upstream response." } }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

export const config = { api: { bodyParser: { sizeLimit: "2mb" } }, maxDuration: 60 };
