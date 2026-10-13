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

const STATES = ["published", "queued", "unsupported", "rejected", "failed", "unknown"];
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

/**
 * What Make's answer means for this Page, from the evidence in it.
 *
 *   JSON from the scenario      its own status: published (with urn), failed,
 *                               rejected, queued …
 *   2xx, body "Accepted"        Make's default reply. The scenario did NOT run
 *                               for this request: it was switched off, or busy,
 *                               so Make put the request in the webhook queue.
 *                               It runs — and posts — when the scenario next
 *                               runs. Resending would post twice.
 *   2xx, anything else          the scenario ran but said nothing we can read
 *   400/404/410, no JSON        the webhook address is gone: nothing ran
 *   other non-2xx, no JSON      Make failed somewhere; LinkedIn may already
 *                               have the post. Unknown, not failed.
 *
 * Only "failed" and "rejected" may be retried automatically.
 */
export const MAKE_QUEUED_MESSAGE = "Make received this but did not run it: the Make scenario is switched off or was busy (or out of operations), so the request is waiting in its webhook queue. It will be posted when the scenario next runs. Do not send it again.";
export function classifyResponse(r) {
  if (r.parsed && typeof r.parsed === "object") {
    const reply = readReply(r.parsed);
    if (r.ok) return reply;
    if (["failed", "rejected"].includes(reply.state)) return reply;
    return { ...reply, state: "unknown", message: reply.message || `Make answered ${r.status} without saying what happened. Check the Page before sending again.` };
  }
  const raw = String(r.raw || "").trim();
  const none = { published: false, urn: null, url: null };
  if (r.ok && /^accepted\.?$/i.test(raw)) return { ...none, state: "accepted", stage: "make-queue", message: MAKE_QUEUED_MESSAGE };
  if (r.ok) return { ...none, state: "unknown", stage: "make", message: "Make answered without a result for this Page. Check the Page before sending again." };
  if ([400, 404, 410].includes(r.status)) return { ...none, state: "failed", stage: "webhook", message: `Make says this webhook does not exist (${r.status}). Nothing was run.` };
  return { ...none, state: "unknown", stage: "make", message: `Make answered ${r.status}${raw ? ` (“${raw.slice(0, 80)}”)` : ""}. LinkedIn may or may not have the post — check the Page before sending again.` };
}

/* LinkedIn's own limits for a poll (Poll API) and Unison's four durations. */
export const POLL_LIMITS = { question: 140, option: 30, minOptions: 2, maxOptions: 4, durations: ["1 day", "3 days", "1 week", "2 weeks"] };
const BASE64 = /^[A-Za-z0-9+/=\s]+$/;

/** Why this post cannot be published as it stands, or null. Checked here so a
    malformed post is refused before it reaches Make, where the scenario would
    take the first media item as the file and fill a missing poll duration
    with a default. */
export function invalid(post, mode) {
  if (!post || typeof post !== "object") return "post must be an object.";
  if (!String(post.postId || "").trim()) return "post.postId is required.";
  if (/~/.test(post.postId)) return "post.postId cannot contain ~ (it separates a post from its Page).";
  if (!String(post.content || "").trim()) return "post.content is required and cannot be empty.";
  if (!POST_TYPES.includes(post.postType)) return `post.postType must be one of: ${POST_TYPES.join(", ")}.`;
  if (post.media && !Array.isArray(post.media)) return "post.media must be an array.";
  if (post.poll && !Array.isArray(post.poll.options)) return "post.poll.options must be an array.";
  if (mode === "scheduled" && (!post.scheduledDate || !post.scheduledTime || !post.timezone)) return "A scheduled post needs scheduledDate, scheduledTime and timezone.";
  if (post.postType === "image" || post.postType === "video") {
    /* The scenario uploads the first media item, so that must be the file. */
    const first = (post.media || [])[0];
    if (!first) return `A ${post.postType} post needs its ${post.postType} file. None was attached.`;
    if (first.kind !== post.postType) return `The first media item must be the ${post.postType}; it is ${first.kind ? `a ${first.kind}` : "unlabelled"}.`;
    if (!first.data) return `The ${post.postType} file was not read into the request${first.url ? " (it arrived as a link, which the scenario cannot upload)" : ""}.`;
    if (typeof first.data !== "string" || !BASE64.test(first.data)) return `The ${post.postType} file is not valid base64.`;
    if (post.postType === "image" && first.mimeType && !/^image\/(jpeg|png|gif)$/.test(first.mimeType)) return `LinkedIn takes JPG, PNG or GIF images, not ${first.mimeType}.`;
    if (post.postType === "video" && first.mimeType && !/^video\//.test(first.mimeType)) return `The video file has the type ${first.mimeType}.`;
  }
  if (post.postType === "poll") {
    const p = post.poll;
    const q = String(p?.question || "").trim();
    const opts = Array.isArray(p?.options) ? p.options.map((o) => String(o ?? "").trim()) : [];
    if (!q) return "A poll needs a question.";
    if (q.length > POLL_LIMITS.question) return `The poll question is ${q.length} characters; LinkedIn allows ${POLL_LIMITS.question}.`;
    if (opts.length < POLL_LIMITS.minOptions || opts.length > POLL_LIMITS.maxOptions) return `A poll needs ${POLL_LIMITS.minOptions} to ${POLL_LIMITS.maxOptions} options; this one has ${opts.length}.`;
    if (opts.some((o) => !o)) return "A poll option is empty.";
    const long = opts.find((o) => o.length > POLL_LIMITS.option);
    if (long) return `The poll option "${long}" is ${long.length} characters; LinkedIn allows ${POLL_LIMITS.option}.`;
    if (p.duration && !POLL_LIMITS.durations.includes(p.duration)) return `"${p.duration}" is not a poll duration Unison offers (${POLL_LIMITS.durations.join(", ")}).`;
  }
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
export function buildJob(post, dest, { fanout, scheduled, destinations, resend = 0 } = {}) {
  /* Whatever the browser said about where the post goes is dropped here;
     the destination comes from the registry. A token is never forwarded. */
  const rest = { ...post };
  for (const k of ["companyUrn", "company", "destinations", "destinationId", "linkedinAccessToken"]) delete rest[k];
  if (scheduled) {
    return { ...rest, publishMode: "scheduled", company: "", companyUrn: "", parentPostId: post.postId,
      destinations: destinations.map((d) => ({ id: d.id, name: d.name, organizationUrn: d.organizationUrn })) };
  }
  /* A Page someone checked by hand and cleared for sending again gets a new
     key, so the scenario does not answer it from the unfinished attempt. */
  const key = jobKey(post.postId, dest.id, fanout) + (resend > 0 ? `~r${resend}` : "");
  return { ...rest, publishMode: "now", postId: key, idempotencyKey: key, parentPostId: post.postId,
    destinationId: dest.id, company: dest.name, companyUrn: dest.organizationUrn };
}

/* ---------------- status ----------------
   What Make has recorded for each Page of a post: the scheduled jobs, and the
   immediate attempts. Records are matched to Pages by organization, never by
   anything the browser says. */
const MAKE_STATUS = {
  queued: "queued", "page-queued": "queued",
  publishing: "processing", "page-publishing": "processing",
  published: "published", failed: "failed", stuck: "unknown", unsupported: "rejected", cancelled: "cancelled",
};
/* When a Page has several records (an attempt, then a resend), the one that
   says the most about whether LinkedIn has the post wins. */
const RANK = ["published", "processing", "queued", "unknown", "failed", "rejected", "cancelled"];

export function readReport(parsed, registry) {
  const pages = {};
  for (const j of Array.isArray(parsed?.jobs) ? parsed.jobs : []) {
    if (!j?.key || j.status === "parent") continue;
    const dest = registry.find((d) => d.organizationUrn === j.companyUrn);
    const state = MAKE_STATUS[j.status];
    if (!dest || !state) continue;
    const urn = /^urn:li:/.test(String(j.publishedUrn || "")) ? j.publishedUrn : null;
    const page = {
      state: state === "published" && !urn ? "unknown" : state, makeStatus: j.status, key: j.key, urn,
      url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null, message: j.note || null,
    };
    const was = pages[dest.id];
    if (!was || RANK.indexOf(page.state) < RANK.indexOf(was.state)) pages[dest.id] = page;
  }
  return pages;
}

async function statusReport(res, url, registry, body) {
  const postId = String(body?.postId || "").trim();
  if (!postId || /~/.test(postId)) return res.status(400).json({ error: "postId is required.", delivered: false });
  const r = await forward(url, { source: "unison-content-os", publishMode: "status", postId, idempotencyKey: `${postId}@status` }, `${postId}@status`);
  if (r.error || !r.ok || r.parsed?.status !== "report") {
    return res.status(502).json({
      error: r.error ? "Make did not answer." : r.parsed?.message || (/^accepted\.?$/i.test(String(r.raw || "").trim())
        ? "Make queued the status request instead of running it: the scenario is off or busy."
        : `Make answered ${r.status} without a report.`),
      delivered: false, state: "unknown",
    });
  }
  return res.status(200).json({ delivered: true, state: "report", postId, pages: readReport(r.parsed, registry), at: new Date().toISOString() });
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
  if (body?.action === "status") return statusReport(res, url, registry, body);
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
  const resend = Math.max(0, Math.floor(Number(body?.resend) || 0));
  const attempt = Math.max(0, Math.floor(Number(body?.attempt) || 0));
  const job = buildJob(post, dest, { fanout, scheduled: mode === "scheduled", destinations: ok, resend: mode === "now" ? resend : 0 });
  /* A scheduled request is idempotent in Make (one job per post~Page key), so
     a later attempt for the same Pages must reach it rather than this cache. */
  const key = mode === "scheduled" ? `${post.postId}@scheduled:${ok.map((d) => d.id).sort().join(",")}#${attempt}` : job.idempotencyKey;

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
  let reply = classifyResponse(r);
  if (mode === "scheduled" && reply.state === "queued" && Number.isFinite(r.parsed?.destinations) && r.parsed.destinations < ok.length) {
    /* The scenario's own allow-list refused a Page the server's list allows. */
    reply = { ...reply, state: "failed", stage: "destination", message: `Make queued ${r.parsed.destinations} of ${ok.length} Pages: its allow-list and LINKEDIN_DESTINATIONS differ. Fix the list, then send again (queued Pages are not duplicated).` };
  }
  if (!r.ok) {
    return res.status(502).json({
      error: reply.message || `The publishing workflow answered ${r.status}.`,
      delivered: false, state: reply.state, stage: reply.stage,
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
