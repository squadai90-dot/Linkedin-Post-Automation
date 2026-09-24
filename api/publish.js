/**
 * Unison publishing relay
 *
 *   Unison frontend  ->  this endpoint  ->  Make webhook  ->  LinkedIn Company Page
 *
 * Why it exists: the browser cannot POST to the Make webhook reliably. A JSON
 * body triggers a CORS preflight that Make does not answer, and preview or
 * embedded environments block cross-origin requests outright. Server to server
 * there is no CORS and no preflight, and the webhook URL stays off the client.
 *
 * Deploy: drop this file at /api/publish.js in the Vercel project that serves
 * Unison. Set MAKE_LINKEDIN_WEBHOOK_URL in the project's environment
 * variables. Nothing about the Make scenario or the LinkedIn connection
 * changes — this only carries the payload to the webhook that already works.
 */

const WEBHOOK_URL =
  process.env.MAKE_LINKEDIN_WEBHOOK_URL ||
  "https://hook.eu1.make.com/mkm7o4tvytb4cgfs91se3qnjy5pvucge";

const FORWARD_TIMEOUT_MS = Number(process.env.PUBLISH_TIMEOUT_MS || 55000);
const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";
/* The types the scenario has a route for. Anything else is rejected here
   rather than forwarded to a router that would silently drop it. */
const POST_TYPES = ["text", "image", "video", "poll"];

/**
 * Idempotency.
 *
 * Serverless instances are not shared, so this in-process cache only catches
 * repeats that land on the same warm instance — enough for a double click or a
 * quick retry, which is what it is for. The client also refuses to resend a
 * key it has already used. For a guarantee across instances, back this with
 * Vercel KV / Upstash and keep the same read-then-write shape below.
 */
const DELIVERED = new Map(); // idempotencyKey -> { at, result }
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function rememberDelivery(key, result) {
  DELIVERED.set(key, { at: Date.now(), result });
  for (const [k, v] of DELIVERED) if (Date.now() - v.at > IDEMPOTENCY_TTL_MS) DELIVERED.delete(k);
}

function priorDelivery(key) {
  const hit = DELIVERED.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > IDEMPOTENCY_TTL_MS) { DELIVERED.delete(key); return null; }
  return hit.result;
}

/** What the scenario said, in the six answers it can give: published,
    queued, unsupported, rejected, failed, or a bare accepted. Only a real
    LinkedIn urn counts as proof of publishing — the post's own id is not
    one, and neither is the webhook's default "Accepted". */
const REPLY_STATES = ["published", "queued", "unsupported", "rejected", "failed"];

function readMakeReply(body) {
  const none = { state: "accepted", published: false, urn: null, url: null, message: null, stage: null };
  if (!body || typeof body !== "object") return none;
  const urn = [body.urn, body.postUrn, body.linkedinUrn, body.shareUrn, body.ugcPostUrn]
    .map((x) => (x == null ? "" : String(x))).find((x) => /^urn:li:/.test(x)) || null;
  const url = [body.url, body.postUrl, body.linkedinUrl].find((x) => typeof x === "string" && /^https?:\/\//.test(x)) || null;
  const status = String(body.status || body.result || "").toLowerCase();
  const published = status === "published" || !!urn || (!!url && /linkedin\.com/.test(url));
  const state = published ? "published" : REPLY_STATES.includes(status) ? status : "accepted";
  return { state, published, urn, url, message: body.message || body.error || null, stage: body.stage || null };
}

/** Keep base64 media out of the logs; keep everything else. */
function loggable(payload) {
  return {
    postId: payload.postId,
    idempotencyKey: payload.idempotencyKey,
    postType: payload.postType,
    chars: String(payload.content || "").length,
    media: (payload.media || []).map((m) => ({ kind: m.kind, filename: m.filename, mimeType: m.mimeType, bytes: m.data ? m.data.length : 0, hasAlt: !!m.altText })),
    poll: payload.poll ? { options: (payload.poll.options || []).length, duration: payload.poll.duration } : null,
    company: payload.company || null,
    companyUrn: payload.companyUrn || null,
    scheduledDate: payload.scheduledDate || null,
    scheduledTime: payload.scheduledTime || null,
    timezone: payload.timezone || null,
  };
}

function validate(payload) {
  if (!payload || typeof payload !== "object") return "Body must be a JSON object.";
  if (!String(payload.content || "").trim()) return "content is required and cannot be empty.";
  if (!payload.postType) return "postType is required.";
  if (!POST_TYPES.includes(payload.postType)) return `postType must be one of: ${POST_TYPES.join(", ")}.`;
  if (payload.media && !Array.isArray(payload.media)) return "media must be an array.";
  if (payload.poll && !Array.isArray(payload.poll.options)) return "poll.options must be an array.";
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  /* Health check — lets the client show an honest connection state without
     sending a post. Never reveals the webhook URL. */
  if (req.method === "GET") {
    return res.status(200).json({
      service: "unison-publish-relay",
      version: 1,
      webhookConfigured: /^https:\/\/hook\.[a-z0-9.-]+\.make\.com\//.test(WEBHOOK_URL),
      tokenRequired: !!RELAY_TOKEN,
      supportedPostTypes: POST_TYPES,
      cachedDeliveries: DELIVERED.size,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (RELAY_TOKEN && req.headers["x-unison-token"] !== RELAY_TOKEN) {
    return res.status(401).json({ error: "This relay requires a team token. Add it under Settings → Advanced.", delivered: false });
  }
  if (!/^https:\/\/hook\.[a-z0-9.-]+\.make\.com\//.test(WEBHOOK_URL)) {
    return res.status(500).json({ error: "Publishing is not configured on the server." });
  }

  const payload = typeof req.body === "string" ? safeParse(req.body) : req.body;
  const invalid = validate(payload);
  if (invalid) return res.status(400).json({ error: invalid });

  const key = String(req.headers["idempotency-key"] || payload.idempotencyKey || payload.postId || "");
  if (key) {
    const already = priorDelivery(key);
    if (already) {
      console.log("[unison:relay] duplicate suppressed", { idempotencyKey: key });
      return res.status(200).json({ ...already, duplicate: true });
    }
  }

  console.log("[unison:relay] forwarding to Make", loggable(payload));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  const startedAt = Date.now();

  let upstream;
  try {
    /* Server to server: real application/json, no CORS, no preflight. The
       payload is forwarded whole — text, media, poll, company, schedule. */
    upstream = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Unison-Idempotency-Key": key },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const timedOut = e?.name === "AbortError";
    console.error("[unison:relay] forward failed", { timedOut, error: String(e?.message || e), ms: Date.now() - startedAt });
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? "The publishing workflow did not respond in time. The post may still have reached it — check before sending again."
        : "Could not reach the publishing workflow. Nothing was sent.",
      delivered: false,
    });
  }
  clearTimeout(timer);

  const raw = await upstream.text().catch(() => "");
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }

  console.log("[unison:relay] Make responded", { status: upstream.status, ms: Date.now() - startedAt, body: String(raw).slice(0, 300) });

  if (!upstream.ok) {
    /* The scenario answers a refused post with its own reason. Passing that
       through is the difference between "something went wrong" and "LinkedIn
       said the video is too long". */
    const refusal = readMakeReply(parsed);
    return res.status(502).json({
      error: refusal.message || `The publishing workflow rejected the post (${upstream.status}).`,
      delivered: false,
      state: refusal.state === "accepted" ? "failed" : refusal.state,
      stage: refusal.stage,
      makeStatus: upstream.status,
      make: parsed ?? String(raw).slice(0, 500),
    });
  }

  /* A 2xx means Make has the post. It means nothing about LinkedIn unless the
     scenario says so explicitly — so that is passed through as-is and never
     invented here. */
  const confirmation = readMakeReply(parsed);
  const result = {
    delivered: true,
    makeStatus: upstream.status,
    make: parsed ?? String(raw).slice(0, 500),
    postId: payload.postId || null,
    idempotencyKey: key || null,
    at: new Date().toISOString(),
    ...confirmation,
  };
  if (key) rememberDelivery(key, result);
  return res.status(200).json(result);
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

/* Media payloads are large. Vercel's default body limit is 1 MB. */
export const config = { api: { bodyParser: { sizeLimit: "8mb" } }, maxDuration: 60 };
