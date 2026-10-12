/**
 * POST /api/publish-to — publish one post to chosen LinkedIn Pages.
 *
 *   Unison  ->  this endpoint  ->  Make (multi-account scenario)  ->  each Page
 *
 * Body: { post, destinationIds, fanout }
 *   post            the payload Unison already builds for api/publish.js
 *                   (postId, postType, content, media, poll, schedule …).
 *                   Any companyUrn / company / destinations it carries are
 *                   ignored and replaced from the server's registry.
 *   destinationIds  Page ids from GET /api/destinations.
 *   fanout          true when the post is going to more than one Page. Each
 *                   Page then gets its own job key, postId~destinationId.
 *
 * Immediate posts ("now"): exactly one destination per request. The browser
 * sends one request per Page, so a video upload to three Pages is three
 * requests that each fit a function's time limit, and every Page gets its own
 * answer.
 *
 * Scheduled posts: one request for all Pages. The scenario stores the content
 * and media once and queues one job per Page.
 *
 * Nothing here decides that a post was published. The scenario's own reply
 * is passed through; only a LinkedIn urn counts as proof.
 *
 * api/publish.js is untouched and still serves single-Page publishing on
 * deployments that do not set the multi-destination variables.
 */
import { readRegistry, multiWebhook, resolveDestinations, jobKey } from "./_destinations.js";

const FORWARD_TIMEOUT_MS = Number(process.env.PUBLISH_TIMEOUT_MS || 55000);
const RELAY_TOKEN = process.env.UNISON_RELAY_TOKEN || "";
const POST_TYPES = ["text", "image", "video", "poll"];

/* Repeats on the same warm instance — a double click, a network retry — get
   the first answer back instead of a second post. The browser also refuses to
   resend a Page that already published. */
const DELIVERED = new Map();
const TTL = 24 * 60 * 60 * 1000;
const remember = (k, v) => {
  DELIVERED.set(k, { at: Date.now(), v });
  for (const [key, e] of DELIVERED) if (Date.now() - e.at > TTL) DELIVERED.delete(key);
};
const prior = (k) => {
  const e = DELIVERED.get(k);
  if (!e) return null;
  if (Date.now() - e.at > TTL) { DELIVERED.delete(k); return null; }
  return e.v;
};
/** For tests. */
export const forgetDeliveries = () => DELIVERED.clear();

const STATES = ["published", "queued", "unsupported", "rejected", "failed"];
export function readReply(body) {
  const none = { state: "accepted", published: false, urn: null, url: null, message: null, stage: null };
  if (!body || typeof body !== "object") return none;
  const urn = [body.urn, body.postUrn, body.linkedinUrn].map((x) => (x == null ? "" : String(x))).find((x) => /^urn:li:/.test(x)) || null;
  const url = typeof body.url === "string" && /^https:\/\/www\.linkedin\.com\//.test(body.url) ? body.url : null;
  const status = String(body.status || "").toLowerCase();
  /* "published" without a urn is not proof; it stays a claim we cannot check. */
  const published = !!urn;
  const state = published ? "published" : status === "published" ? "unknown" : STATES.includes(status) ? status : "accepted";
  return { state, published, urn, url, message: body.message || body.error || null, stage: body.stage || null };
}

function invalid(post, mode) {
  if (!post || typeof post !== "object") return "post must be an object.";
  if (!String(post.postId || "").trim()) return "post.postId is required.";
  if (!String(post.content || "").trim()) return "post.content is required and cannot be empty.";
  if (!POST_TYPES.includes(post.postType)) return `post.postType must be one of: ${POST_TYPES.join(", ")}.`;
  if (post.media && !Array.isArray(post.media)) return "post.media must be an array.";
  if (post.poll && !Array.isArray(post.poll.options)) return "post.poll.options must be an array.";
  if (mode === "scheduled" && (!post.scheduledDate || !post.scheduledTime || !post.timezone)) return "A scheduled post needs scheduledDate, scheduledTime and timezone.";
  return null;
}

async function forward(url, job, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    /* text/plain: the scenario parses the raw body ({{1.value}}), the same
       contract api/publish.js keeps. */
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8", "X-Unison-Idempotency-Key": key },
      body: JSON.stringify(job),
      signal: controller.signal,
    });
    const raw = await r.text().catch(() => "");
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
    return { ok: r.ok, status: r.status, parsed, raw };
  } catch (e) {
    return { ok: false, status: 0, error: e?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/* What one Page's job looks like on the wire: the post as Unison built it,
   with the destination stamped in by the server. */
export function buildJob(post, dest, { fanout, scheduled, destinations } = {}) {
  /* Whatever the browser said about where the post goes is dropped here;
     the destination comes from the registry. A token is never forwarded. */
  const rest = { ...post };
  for (const k of ["companyUrn", "company", "destinations", "destinationId", "linkedinAccessToken"]) delete rest[k];
  if (scheduled) {
    return { ...rest, publishMode: "scheduled", company: "", companyUrn: "", parentPostId: post.postId,
      destinations: destinations.map((d) => ({ id: d.id, name: d.name, organizationUrn: d.organizationUrn })) };
  }
  const key = jobKey(post.postId, dest.id, fanout);
  return { ...rest, publishMode: "now", postId: key, idempotencyKey: key, parentPostId: post.postId,
    destinationId: dest.id, company: dest.name, companyUrn: dest.organizationUrn };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (RELAY_TOKEN && req.headers["x-unison-token"] !== RELAY_TOKEN) {
    return res.status(401).json({ error: "This relay requires a team token. Add it under Settings → AI → Deployment check.", delivered: false });
  }
  const url = multiWebhook();
  const { destinations: registry } = readRegistry();
  if (!url || !registry.length) {
    return res.status(503).json({ error: "Publishing to several Pages is not set up on this deployment.", delivered: false, state: "rejected", stage: "config" });
  }

  const body = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;
  const post = body?.post;
  const mode = post?.publishMode === "scheduled" ? "scheduled" : "now";
  const bad = invalid(post, mode);
  if (bad) return res.status(400).json({ error: bad, delivered: false });

  const { ok, refused } = resolveDestinations(body?.destinationIds, registry);
  if (!ok.length) {
    return res.status(422).json({
      error: refused.length ? "None of the chosen Pages may be published to from here." : "Choose at least one Page.",
      delivered: false, state: "rejected", stage: "destination", refused,
    });
  }
  if (refused.length) {
    /* Never drop a Page quietly and publish to the rest: the user chose all of them. */
    return res.status(422).json({ error: "One or more chosen Pages may not be published to from here. Nothing was sent.", delivered: false, state: "rejected", stage: "destination", refused });
  }
  if (mode === "now" && ok.length !== 1) {
    return res.status(400).json({ error: "Send one request per Page for an immediate post.", delivered: false });
  }

  const fanout = !!body?.fanout;
  const dest = ok[0];
  const job = buildJob(post, dest, { fanout, scheduled: mode === "scheduled", destinations: ok });
  const key = mode === "scheduled" ? `${post.postId}@scheduled:${ok.map((d) => d.id).sort().join(",")}` : job.idempotencyKey;

  const already = prior(key);
  if (already) return res.status(200).json({ ...already, duplicate: true });

  console.log("[unison:publish-to] forwarding", {
    mode, postId: job.postId, postType: job.postType, destinations: ok.map((d) => d.id),
    media: (job.media || []).map((m) => ({ kind: m.kind, bytes: m.data ? m.data.length : 0 })),
  });
  const r = await forward(url, job, key);
  if (r.error) {
    return res.status(r.error === "timeout" ? 504 : 502).json({
      error: r.error === "timeout"
        ? "The publishing workflow did not answer in time. The post may still have reached it — check before sending again."
        : "Could not reach the publishing workflow. Nothing was sent.",
      delivered: false, state: r.error === "timeout" ? "unknown" : "failed", destinationIds: ok.map((d) => d.id),
    });
  }
  const reply = readReply(r.parsed);
  if (!r.ok) {
    return res.status(502).json({
      error: reply.message || `The publishing workflow refused the post (${r.status}).`,
      delivered: false, state: reply.state === "accepted" ? "failed" : reply.state, stage: reply.stage,
      makeStatus: r.status, destinationIds: ok.map((d) => d.id),
    });
  }
  const result = {
    delivered: true, makeStatus: r.status, mode, postId: post.postId, jobKey: mode === "now" ? job.postId : null,
    destinationIds: ok.map((d) => d.id), at: new Date().toISOString(), ...reply,
  };
  /* A refusal is not remembered, so a retry really retries. */
  if (["published", "queued", "unknown", "accepted"].includes(result.state)) remember(key, result);
  return res.status(200).json(result);
}

export const config = { api: { bodyParser: { sizeLimit: "8mb" } }, maxDuration: 60 };
