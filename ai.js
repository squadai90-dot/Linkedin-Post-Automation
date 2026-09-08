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
const MAX_TOKENS_CAP = 4000;
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 60000);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({ service: "unison-ai-relay", version: 1, keyConfigured: !!API_KEY });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: { message: "Method not allowed." } });
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
    model: body.model || "claude-sonnet-4-6",
    max_tokens: Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS_CAP),
    messages: body.messages,
  };
  if (body.system) forward.system = body.system;
  if (body.tools) forward.tools = body.tools; // e.g. web_search — passed through as-is

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

export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };
