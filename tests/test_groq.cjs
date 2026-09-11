/* Item D: Groq resilience. Evals the /*EN9GROQ-BEGIN*​/ block straight out of
   dist/index.html so it pins the shipped code, then drives the resumable batch
   driver against a fake provider that reproduces the real failure from the
   Exception center: 413 "Request too large for gpt-oss-120b, TPM 8000,
   requested 9202". */
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const m = dist.match(/\/\*EN9GROQ-BEGIN\*\/([\s\S]*?)\/\*EN9GROQ-END\*\//);
a(!!m, "EN9GROQ sentinel block present in dist");
if (!m) { process.exit(1); }

// the block closes over EN9chunk, which lives elsewhere in the bundle
function EN9chunk(t, e) { let i = []; for (let s = 0; s < t.length; s += e) i.push(t.slice(s, s + e)); return i; }
void EN9chunk;

eval(m[1]);

(async () => {
  // --- 1. Token estimation and the TPM gate -------------------------------
  a(EN9TPM === 8e3, "the per-minute ceiling matches the model's actual TPM limit");
  const big = [{ role: "user", content: "x".repeat(4200) }];
  a(EN9estTokens(big, 8e3) > 8e3,
    "REGRESSION: the old call (max_tokens 8000 + a real prompt) is estimated over the limit");
  a(EN9estTokens(big, EN9maxTokensFor(25)) < 8e3,
    "the new budget for a 25-row batch fits inside the limit");
  a(EN9maxTokensFor(40) <= 2400 && EN9maxTokensFor(1) >= 400, "completion budget scales with batch size and is bounded");
  a(EN9AI_BATCH <= 25, "batches are small enough to pace under the limit");

  EN9tpmReset();
  const t0 = 1e12;
  a(EN9tpmWaitMs(3e3, t0) === 0, "gate: an empty window admits a request immediately");
  EN9tpmNote(6e3, t0);
  a(EN9tpmWaitMs(3e3, t0 + 1e3) === 59e3, "gate: a request that would breach the limit waits for the window to roll");
  a(EN9tpmWaitMs(1e3, t0 + 1e3) === 0, "gate: a request that still fits is not delayed");
  a(EN9tpmWaitMs(3e3, t0 + 61e3) === 0, "gate: the window expires after 60s");
  EN9tpmReset();
  a(EN9tpmUsed(t0) === 0, "gate: reset clears the rolling window");

  // --- 2. Error classification -------------------------------------------
  a(EN9classifyGroq(401, "") === "credential", "401 is a credential failure");
  a(EN9classifyGroq(200, "invalid_api_key") === "credential", "invalid_api_key is a credential failure");
  a(EN9classifyGroq(413, "request_too_large") === "transient", "413 is TRANSIENT, not a bad key");
  a(EN9classifyGroq(429, "rate_limit_exceeded") === "transient", "429 is transient");
  a(EN9classifyGroq(500, "") === "transient" && EN9classifyGroq(503, "") === "transient", "5xx is transient");
  a(EN9classifyGroq(0, "") === "transient", "a dropped connection is transient");
  a(EN9classifyGroq(404, "model_not_found") === "fatal", "a genuinely wrong request is fatal");

  // --- 3. Retry timing ----------------------------------------------------
  a(EN9retryAfterMs(429, "", "12") === 12e3, "retry-after header is honoured");
  a(EN9retryAfterMs(429, "Rate limit reached. Please try again in 7.5s", null) === 7500,
    "the wait is parsed out of Groq's own message");
  a(EN9retryAfterMs(429, "try again in 800ms", null) === 800, "millisecond form parsed");
  a(EN9retryAfterMs(429, "", null) === 2e4, "a bare 429 falls back to a sane wait");
  a(EN9retryAfterMs(413, "", null) === 0, "413 does not wait — it splits instead");
  a(EN9backoffMs(1, 0.5) === 2000 && EN9backoffMs(3, 0.5) === 8000, "backoff doubles");
  a(EN9backoffMs(9, 0.5) === 3e4, "backoff is capped at 30s");
  a(EN9backoffMs(2, 0) !== EN9backoffMs(2, 1), "backoff is jittered");

  // --- 4. Chunk splitting -------------------------------------------------
  let sp = EN9splitChunk([1, 2, 3, 4, 5]);
  a(sp && sp[0].length === 3 && sp[1].length === 2, "a batch splits in half");
  a(EN9splitChunk([1]) === null, "a single row cannot be split further");

  // --- 5. THE REAL BUG: a 413 must not abandon the run --------------------
  const err = (status, code, msg) => {
    const e = new Error(msg || code);
    e.EN9kind = EN9classifyGroq(status, code); e.EN9status = status;
    e.EN9retryMs = 0;
    return e;
  };
  const sleepPatch = () => { EN9sleep = () => Promise.resolve(); };
  sleepPatch();

  let rows = Array.from({ length: 25 }, (_, i) => i);
  let seen = [], logs = [];
  let stop = await EN9askResume(rows,
    async c => { if (c.length > 8) throw err(413, "request_too_large", "Request too large for gpt-oss-120b, TPM 8000, requested 9202"); return c; },
    (c) => { seen.push(...c); },
    l => logs.push(l));
  a(stop === null, "413: the run is not stopped");
  a(seen.length === 25, `413: every row is still processed after splitting (${seen.length}/25)`);
  a(seen.slice().sort((x, y) => x - y).join() === rows.join(), "413: no row is lost or duplicated");
  a(logs.some(l => /split into/.test(l)), "413: the split is reported in the processing log");

  // --- 6. 429 backs off and resumes, keeping earlier work -----------------
  let calls = 0; seen = []; logs = [];
  stop = await EN9askResume(Array.from({ length: 50 }, (_, i) => i),
    async c => { calls++; if (calls === 2) throw err(429, "rate_limit_exceeded", "Rate limit reached. Please try again in 3s"); return c; },
    c => { seen.push(...c); }, l => logs.push(l));
  a(stop === null && seen.length === 50, "429: the batch is retried and the run completes");
  a(logs.some(l => /retrying in/.test(l)), "429: the retry is reported with its wait");

  // --- 7. A credential failure DOES stop the run --------------------------
  seen = []; logs = [];
  stop = await EN9askResume(Array.from({ length: 50 }, (_, i) => i),
    async () => { throw err(401, "invalid_api_key"); },
    c => { seen.push(...c); }, l => logs.push(l));
  a(stop && stop.EN9kind === "credential", "a bad key stops the run and is handed back");
  a(seen.length === 0, "nothing is booked from a run with a bad key");

  // --- 8. A persistently failing batch is abandoned, not looped forever ---
  calls = 0; seen = []; logs = [];
  stop = await EN9askResume([1, 2, 3],
    async () => { calls++; throw err(500, "server_error"); },
    c => { seen.push(...c); }, l => logs.push(l));
  a(stop === null, "a dead batch does not masquerade as a credential failure");
  a(calls === 5, `the batch is tried once then retried 4 times, then abandoned (${calls} calls)`);
  a(logs.some(l => /abandoned after 4 retries/.test(l)), "abandoning the batch is stated plainly in the log");

  // --- 9. dist wiring smoke -----------------------------------------------
  a(!dist.includes("maxTokens:8e3"), "REGRESSION: the flat 8000-token request is gone from every call site");
  a(dist.includes("EN9maxTokensFor(u.length)") && dist.includes("EN9maxTokensFor(d.length)"),
    "mapping and profile passes both size their budget to the batch");
  a(dist.includes("await EN9askResume(EN9rows,EN9send"), "the mapping pass runs through the resumable driver");
  a(dist.includes("await EN9askResume(a,EN9psend"), "the profile pass runs through the resumable driver");
  a(dist.includes('status:EN9kind==="transient"?EN9prev:"error"'),
    "REGRESSION: a transient failure no longer parks the status in a sticky error");
  a(dist.includes('EN9notice:EN9kind==="transient"?r:""'), "transient trouble is recorded as a notice instead");
  a(dist.includes('title:"Temporary \\u2014 no action needed",tone:"amber"'),
    "Settings distinguishes temporary trouble from a key problem");
  a(dist.includes("async EN9revalidateGroq()"), "a quiet revalidation action exists");
  a(dist.includes("Be.EN9revalidateGroq()"), "revalidation is wired into boot");
  a(dist.includes("if(s.status===413||s.status===429)EN9tpmNote(EN9TPM)"),
    "a rejected call assumes the minute's budget is spent so the gate paces the next one");
  a(dist.includes('EN9e.EN9kind="transient",EN9e.EN9status=0'), "a network drop is classified before it reaches the caller");

  if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
  console.log("ALL GROQ TESTS PASSED");
})().catch(e => { console.error("UNCAUGHT:", e); process.exit(1); });
