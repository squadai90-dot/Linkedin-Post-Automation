/* AI-assisted mapping: everything that does not touch the store.
 *
 * The model is asked to place captions the keyword rules could not. It is
 * never trusted: every proposal it returns goes through the same gate a manual
 * assignment does, plus two vetoes the rules cannot express. What lives here
 * is the machinery around that — parsing an answer that may be malformed,
 * staying inside a rate limit, and recovering from the four different things
 * that can go wrong with a request.
 *
 * All of it is pure or self-contained, so it can be tested without a network
 * and against the shipped implementation.
 */

/* ---------- reading the model's answer ---------- */

export const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Parse a mapping response, degrading in three tiers.
 *
 * Well-behaved models return `{"map": {...}}`. Under load they truncate
 * mid-object, wrap the JSON in a ``` fence, or emit a bare target string
 * instead of the object. The first tier is strict JSON; the second scrapes
 * whole `"<index>": {...}` pairs out of a broken document, so a reply cut off
 * at caption 19 still yields the first 18; the third accepts a bare line id.
 * Losing 25 answers because the 25th was truncated is the outcome being
 * avoided — and a malformed entry is dropped, never guessed at. */
export function parseMap(raw: string): Record<string, unknown> {
  const text = String(raw || "").replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && parsed.map && typeof parsed.map === "object") return parsed.map;
  } catch { /* fall through to salvage */ }

  const out: Record<string, unknown> = {};
  for (const m of text.matchAll(/"(\d+)"\s*:\s*(\{[^{}]*\})/g)) {
    try { out[m[1]] = JSON.parse(m[2]); } catch { /* that one entry is lost */ }
  }
  for (const m of text.matchAll(/"(\d+)"\s*:\s*"((?:IS|BS):[A-Za-z0-9]+)"/g)) {
    if (out[m[1]] === undefined) out[m[1]] = m[2];
  }
  return out;
}

export type Proposal = { t: string | null; c: "high" | "medium" | "low"; r: string };

/** Normalise one proposal to a fixed shape.
 *
 * Models name the target field `t`, `k` or `target` depending on the prompt
 * they last saw; all three are accepted. Anything that is not exactly "high"
 * or "medium" becomes LOW — including a confidence the model invented, like
 * "very high" or "certain". Reading an unknown word as high confidence is how
 * an unverified guess gets booked without a flag. The reason is truncated at
 * 140 characters because it is shown in a review row, not read by anything. */
export function norm1(value: unknown): Proposal | null {
  if (value == null) return null;
  if (typeof value === "string") return value ? { t: value, c: "medium", r: "" } : null;
  if (typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const target = v.t !== undefined ? v.t : v.k !== undefined ? v.k : v.target !== undefined ? v.target : null;
  const conf = String(v.c || v.confidence || "").toLowerCase();
  const reason = String(v.r || v.reason || "").slice(0, 140);
  return {
    t: typeof target === "string" && target ? target : null,
    c: conf === "high" || conf === "medium" ? conf : "low",
    r: reason,
  };
}

/** Confident enough to book without flagging it. A low-confidence proposal is
    still booked — the figure belongs somewhere — but it is flagged too. */
export const ok = (p: Proposal | null | undefined) => !!(p && p.t && (p.c === "high" || p.c === "medium"));

/* ---------- staying inside the rate limit ---------- */

/* Groq's free tier is metered in tokens per minute, not requests. Exceeding it
   returns 429 for the whole account, so a run that blows the budget on caption
   40 leaves the preparer with a half-mapped entity and a rate-limit error. The
   budget is therefore tracked locally and requests WAIT rather than fail. */
export const TPM_BUDGET = 8000;

type TpmEntry = { at: number; tokens: number };
let tpmLog: TpmEntry[] = [];

/** Rough token count for a request. Deliberately an over-estimate (3.5 chars
    per token, plus 8 per message for the role envelope): under-counting is
    what causes the 429 this exists to prevent. */
export function estTokens(messages: Array<{ content?: string }>, maxTokens = 0): number {
  let n = 0;
  for (const m of messages || []) n += Math.ceil(String((m && m.content) || "").length / 3.5) + 8;
  return n + (maxTokens || 0);
}

/** Tokens spent in the last rolling minute. */
export function tpmUsed(now?: number): number {
  const cutoff = (now || Date.now()) - 60000;
  tpmLog = tpmLog.filter((e) => e.at > cutoff);
  return tpmLog.reduce((n, e) => n + e.tokens, 0);
}

/** How long to wait before `need` tokens fit inside the budget. Walks the log
    oldest-first and returns the moment the first entry that frees enough room
    ages out — not a flat minute, which would idle for no reason. */
export function tpmWaitMs(need: number, now?: number): number {
  const at = now || Date.now();
  const used = tpmUsed(at);
  if (used + need <= TPM_BUDGET) return 0;
  const oldestFirst = tpmLog.slice().sort((a, b) => a.at - b.at);
  let remaining = used;
  for (const e of oldestFirst) {
    remaining -= e.tokens;
    if (remaining + need <= TPM_BUDGET) return Math.max(0, e.at + 60000 - at);
  }
  return 60000;
}

export const tpmNote = (tokens: number, at?: number) => { tpmLog.push({ at: at || Date.now(), tokens }); };
export const tpmReset = () => { tpmLog = []; };
/** The last recorded estimate, corrected once the response reports the truth. */
export function tpmCorrectLast(actual: number) {
  const last = tpmLog[tpmLog.length - 1];
  if (last && actual > 0) last.tokens = actual;
}

/* ---------- what kind of failure was that ---------- */

export type FailureKind = "credential" | "transient" | "fatal";

/** Three kinds, because each needs a different response: a credential problem
    means every remaining request will fail too (stop); a transient one means
    try again (retry); a fatal one is specific to this batch (skip it and keep
    going). Treating them alike either gave up on a recoverable hiccup or
    retried a bad key twenty times. */
export function classifyFailure(status: number, message: string): FailureKind {
  const m = String(message || "").toLowerCase();
  if (status === 401 || status === 403 || /invalid_api_key|authentication|no api key|unauthor/.test(m)) return "credential";
  if (status === 503 && /no server-side ai key|no ai key configured/.test(m)) return "fatal";
  if (status === 413 || status === 429 || status === 408 || status === 409 || status === 0 || status >= 500) return "transient";
  if (/rate_limit|request_too_large|server_error|over_capacity|timeout/.test(m)) return "transient";
  return "fatal";
}

/** How long to wait, preferring what the server said over any guess: the
    Retry-After header first, then the "try again in 4.2s" many APIs put in the
    message body, then a default per status. Capped at a minute — a longer wait
    is indistinguishable from a hang. */
export function retryAfterMs(status: number, message?: string, header?: string | null): number {
  const fromHeader = parseFloat(String(header || ""));
  if (isFinite(fromHeader) && fromHeader > 0) return Math.min(60000, Math.ceil(fromHeader * 1000));
  const m = /try again in ([0-9.]+)\s*(ms|s|m)\b/i.exec(String(message || ""));
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2].toLowerCase() === "ms" ? 1 : m[2].toLowerCase() === "m" ? 60000 : 1000;
    return Math.min(60000, Math.ceil(n * unit));
  }
  return status === 429 ? 20000 : status === 413 ? 0 : 3000;
}

/** Exponential backoff with jitter. `rand` is injectable so the spread can be
    tested rather than hoped for. */
export const backoffMs = (attempt: number, rand?: number) =>
  Math.min(30000, Math.round(Math.pow(2, attempt) * 1000 * (0.75 + (typeof rand === "number" ? rand : Math.random()) * 0.5)));

/** Halve a batch that came back 413. Null when there is nothing left to split:
    a single caption too large for the model cannot be rescued by splitting. */
export function splitChunk<T>(items: T[]): [T[], T[]] | null {
  if (!Array.isArray(items) || items.length < 2) return null;
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}

/** Output budget for n captions: about 45 tokens each plus overhead, clamped.
    Too small truncates the reply mid-caption; too large is charged against the
    per-minute budget whether or not it is used. */
export const maxTokensFor = (n: number) => Math.max(400, Math.min(2400, n * 45 + 300));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const AI_BATCH = 25;

/** An error carrying what the caller needs to decide what to do next. */
export type AiError = Error & { kind?: FailureKind; status?: number; retryMs?: number };

/**
 * Run `send` over `items` in batches, recovering from each kind of failure in
 * the way that kind deserves. Returns the error that stopped everything, or
 * null when the run completed (with or without individual batches lost).
 *
 *   credential  -> stop; every remaining request would fail the same way
 *   fatal       -> drop that batch, keep going; the rest may be fine
 *   413         -> halve the batch and re-queue both halves
 *   transient   -> back off and retry, up to four times, then abandon THAT
 *                  batch and carry on with the next
 *
 * `note` receives messages meant for the processing log, so the preparer can
 * see a run slowed down rather than wondering why it is taking a minute.
 */
export async function askResume<T, R>(
  items: T[],
  send: (batch: T[]) => Promise<R>,
  receive: (batch: T[], result: R) => void,
  note?: (message: string) => void,
): Promise<AiError | null> {
  const queue = chunk(items, AI_BATCH);
  let stopped: AiError | null = null;
  let attempt = 0;

  while (queue.length) {
    const batch = queue.shift()!;
    try {
      receive(batch, await send(batch));
      attempt = 0;
    } catch (e) {
      const err = e as AiError;
      const kind = err?.kind || "fatal";
      if (kind === "credential") { stopped = err; break; }
      if (kind !== "transient") {
        note?.("AI mapping batch failed — " + (err?.message || String(err)));
        continue;
      }
      const halves = err?.status === 413 ? splitChunk(batch) : null;
      if (halves) {
        note?.(`AI mapping: ${batch.length} caption(s) exceeded the model’s per-minute token limit — split into ${halves[0].length}+${halves[1].length} and continuing`);
        queue.unshift(halves[0], halves[1]);
        continue;
      }
      if (attempt < 4) {
        attempt++;
        const wait = Math.max(err?.retryMs || 0, backoffMs(attempt));
        note?.(`AI mapping: ${err.message} — retrying in ${Math.round(wait / 1000)}s (attempt ${attempt} of 4)`);
        await sleep(wait);
        queue.unshift(batch);
        continue;
      }
      note?.("AI mapping batch abandoned after 4 retries — " + (err?.message || String(err)));
      attempt = 0;
    }
  }
  return stopped;
}

/* ---------- where the key comes from ---------- */

export type AiMode = "proxy" | "personal-on-server" | "offline" | "personal";

/** Which key this deployment uses, from three facts: whether a backend is
    configured at all, whether it answered, and whether it reported having a
    key of its own. The distinction matters to the preparer — "the server has
    no key" and "the server is unreachable" need different actions from them,
    and both look like "AI unavailable" if collapsed. */
export function aiMode(remote: boolean, connected?: boolean, serverHasKey?: boolean): AiMode {
  if (remote && connected === true && serverHasKey === true) return "proxy";
  if (remote && connected === true) return "personal-on-server";
  if (remote && connected === false) return "offline";
  return "personal";
}

export const aiModeLabel = (mode: AiMode) =>
  mode === "proxy" ? "Server key (shared deployment)"
  : mode === "personal-on-server" ? "Personal key — backend has no key configured"
  : mode === "offline" ? "Personal key — backend unreachable"
  : "Personal key (this browser only)";
