/* AI-assisted mapping.
 *
 * The model is the last resort and is never trusted. Two halves are checked
 * here:
 *
 *   1. The pure helpers -- parsing a possibly-malformed answer, normalising a
 *      proposal, and the rate-limit machinery -- run against BOTH the
 *      implementation shipping in dist (EN9AI-PURE and EN9GROQ sentinels) and
 *      the src port, and must agree.
 *   2. The gate: a stubbed model that hallucinates a line id, names a bank
 *      account, contradicts a section banner, or answers with an invented
 *      confidence must be refused; a good answer must be booked; a
 *      low-confidence answer must be booked AND flagged.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const SRC = load("src/prototype/wp/aiMapping.ts");

const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
function region(startTag, endTag) {
  const b = dist.indexOf(startTag), e = dist.indexOf(endTag);
  assert.ok(b > 0 && e > b, startTag + " present in dist");
  return dist.slice(b + startTag.length, e);
}
const SHIPPED = (() => {
  const sandbox = {};
  new Function("exports",
    region("/*EN9AI-PURE-START*/", "/*EN9AI-PURE-END*/") +
    region("/*EN9GROQ-BEGIN*/", "/*EN9GROQ-END*/") +
    region("/*EN9AIMODE-BEGIN*/", "/*EN9AIMODE-END*/") +
    ";exports.chunk=EN9chunk;exports.parseMap=EN9parseMap;exports.norm1=EN9norm1;exports.ok=EN9ok;" +
    "exports.estTokens=EN9estTokens;exports.tpmWaitMs=EN9tpmWaitMs;exports.tpmNote=EN9tpmNote;" +
    "exports.tpmReset=EN9tpmReset;exports.tpmUsed=EN9tpmUsed;exports.classifyFailure=EN9classifyGroq;" +
    "exports.retryAfterMs=EN9retryAfterMs;exports.backoffMs=EN9backoffMs;exports.splitChunk=EN9splitChunk;" +
    "exports.maxTokensFor=EN9maxTokensFor;exports.aiMode=EN9aiMode;exports.aiModeLabel=EN9aiModeLabel;" +
    "exports.TPM=EN9TPM;exports.BATCH=EN9AI_BATCH;")(sandbox);
  return sandbox;
})();

/* ---- reading a model's answer ---- */

const REPLIES = [
  ['{"map":{"0":{"t":"BS:46","c":"high","r":"payables"}}}', "clean JSON"],
  ['```json\n{"map":{"0":{"t":"IS:26","c":"high","r":"staff"}}}\n```', "fenced JSON"],
  ['{"map":{"0":{"t":"BS:46","c":"high","r":"payables"},"1":{"t":"IS:26","c":"low","r":"gue', "truncated mid-object"],
  ['{"map":{"0":"BS:46","1":"IS:26"}}', "bare target strings"],
  ['I could not map these.', "prose, no JSON at all"],
  ['{"map":{}}', "an empty map"],
  ['', "nothing at all"],
];

t("a well-formed reply parses", () => {
  const m = SRC.parseMap(REPLIES[0][0]);
  assert.deepStrictEqual(m["0"], { t: "BS:46", c: "high", r: "payables" });
});

t("a reply truncated mid-caption still yields the captions that arrived", () => {
  // Losing 25 answers because the 25th was cut off is the outcome being
  // avoided -- the salvage pass scrapes whole entries out of a broken document.
  const m = SRC.parseMap(REPLIES[2][0]);
  assert.deepStrictEqual(m["0"], { t: "BS:46", c: "high", r: "payables" });
  assert.strictEqual(m["1"], undefined, "the incomplete entry must be dropped, not guessed at");
});

t("parseMap matches the shipped implementation on every reply shape", () => {
  for (const [reply, what] of REPLIES) {
    assert.deepStrictEqual(SRC.parseMap(reply), SHIPPED.parseMap(reply), what);
  }
});

/* ---- normalising a proposal ---- */

t("the three field names models actually use are all accepted", () => {
  for (const key of ["t", "k", "target"]) {
    assert.strictEqual(SRC.norm1({ [key]: "BS:46", c: "high" }).t, "BS:46", key);
  }
});

t("an invented confidence is LOW, never high", () => {
  // Reading an unknown word as high confidence is how an unverified guess
  // gets booked without a flag.
  for (const c of ["very high", "certain", "0.9", "HIGH!", "", undefined]) {
    const p = SRC.norm1({ t: "BS:46", c });
    assert.strictEqual(p.c, "low", JSON.stringify(c));
  }
  assert.strictEqual(SRC.norm1({ t: "BS:46", c: "HIGH" }).c, "high", "case-insensitive on the real values");
  assert.strictEqual(SRC.norm1({ t: "BS:46", c: "medium" }).c, "medium");
});

t("a reason is truncated to what a review row can show", () => {
  assert.strictEqual(SRC.norm1({ t: "BS:46", r: "x".repeat(400) }).r.length, 140);
});

t("norm1 and ok match the shipped implementation", () => {
  const cases = [
    { t: "BS:46", c: "high", r: "ok" }, { k: "IS:26", confidence: "MEDIUM" },
    { target: "IS:7", c: "certain" }, { t: null, c: "high" }, { t: "", c: "high" },
    "BS:46", "", null, undefined, 42, { c: "high" },
  ];
  for (const c of cases) {
    assert.deepStrictEqual(SRC.norm1(c), SHIPPED.norm1(c), JSON.stringify(c));
    assert.strictEqual(SRC.ok(SRC.norm1(c)), SHIPPED.ok(SHIPPED.norm1(c)), JSON.stringify(c));
  }
});

t("low confidence is still an answer -- it is booked AND flagged", () => {
  assert.strictEqual(SRC.ok({ t: "BS:46", c: "low" }), false, "not confident");
  assert.strictEqual(SRC.ok({ t: null, c: "high" }), false, "no target is no answer");
  assert.strictEqual(SRC.ok({ t: "BS:46", c: "high" }), true);
});

/* ---- staying inside the rate limit ---- */

t("the token estimate over-counts on purpose", () => {
  const msgs = [{ role: "user", content: "x".repeat(350) }];
  assert.ok(SRC.estTokens(msgs, 0) >= 100, "under-counting causes the 429 this exists to prevent");
  assert.strictEqual(SRC.estTokens(msgs, 500), SHIPPED.estTokens(msgs, 500));
});

t("a request that fits the budget does not wait", () => {
  SRC.tpmReset();
  assert.strictEqual(SRC.tpmWaitMs(1000), 0);
});

t("a request that does not fit waits only until room frees up", () => {
  SRC.tpmReset(); SHIPPED.tpmReset();
  const now = 1_000_000;
  // Two spends, 30s apart, filling the budget.
  SRC.tpmNote(5000, now - 50000); SHIPPED.tpmNote(5000, now - 50000);
  SRC.tpmNote(3000, now - 20000); SHIPPED.tpmNote(3000, now - 20000);
  const wait = SRC.tpmWaitMs(2000, now);
  assert.ok(wait > 0, "the budget is full; it must wait");
  assert.strictEqual(wait, 10000, "only until the OLDEST spend ages out, not a flat minute");
  assert.strictEqual(wait, SHIPPED.tpmWaitMs(2000, now));
  SRC.tpmReset(); SHIPPED.tpmReset();
});

t("spends older than a minute stop counting", () => {
  SRC.tpmReset();
  const now = 1_000_000;
  SRC.tpmNote(8000, now - 61000);
  assert.strictEqual(SRC.tpmUsed(now), 0);
  assert.strictEqual(SRC.tpmWaitMs(4000, now), 0);
  SRC.tpmReset();
});

/* ---- classifying a failure ---- */

const FAILURES = [
  [401, "invalid_api_key", "credential"],
  [403, "forbidden", "credential"],
  [200, "no api key configured", "credential"],
  [503, "no server-side AI key", "fatal"],
  [429, "rate_limit_exceeded", "transient"],
  [413, "request_too_large", "transient"],
  [500, "server_error", "transient"],
  [0, "network error", "transient"],
  [400, "model_decommissioned", "fatal"],
  [404, "not found", "fatal"],
];

t("each kind of failure is recognised, because each needs a different answer", () => {
  for (const [status, msg, want] of FAILURES) {
    assert.strictEqual(SRC.classifyFailure(status, msg), want, `${status} ${msg}`);
    assert.strictEqual(SRC.classifyFailure(status, msg), SHIPPED.classifyFailure(status, msg), `${status} ${msg}`);
  }
});

t("what the server says about waiting beats any guess", () => {
  assert.strictEqual(SRC.retryAfterMs(429, "", "4.2"), 4200, "Retry-After header first");
  assert.strictEqual(SRC.retryAfterMs(429, "please try again in 7.5s", null), 7500, "then the message body");
  assert.strictEqual(SRC.retryAfterMs(429, "no hint", null), 20000, "then a default per status");
  assert.strictEqual(SRC.retryAfterMs(413, "no hint", null), 0, "a 413 is not a wait, it is a split");
  assert.strictEqual(SRC.retryAfterMs(429, "try again in 2m", null), 60000, "capped at a minute");
  for (const [status, msg] of FAILURES) {
    assert.strictEqual(SRC.retryAfterMs(status, msg, null), SHIPPED.retryAfterMs(status, msg, null), `${status}`);
  }
});

t("backoff grows and stays jittered", () => {
  assert.strictEqual(SRC.backoffMs(1, 0.5), SHIPPED.backoffMs(1, 0.5));
  assert.ok(SRC.backoffMs(1, 0) < SRC.backoffMs(3, 0), "must grow with the attempt");
  assert.ok(SRC.backoffMs(10, 1) <= 30000, "capped");
  assert.notStrictEqual(SRC.backoffMs(2, 0), SRC.backoffMs(2, 1), "jitter must actually vary");
});

t("an over-sized batch halves; a single caption cannot be rescued by splitting", () => {
  assert.deepStrictEqual(SRC.splitChunk([1, 2, 3, 4, 5]), [[1, 2, 3], [4, 5]]);
  assert.strictEqual(SRC.splitChunk([1]), null);
  assert.strictEqual(SRC.splitChunk([]), null);
  assert.deepStrictEqual(SRC.splitChunk([1, 2, 3, 4, 5]), SHIPPED.splitChunk([1, 2, 3, 4, 5]));
});

t("the output budget is clamped at both ends", () => {
  assert.strictEqual(SRC.maxTokensFor(1), 400, "too small truncates the reply mid-caption");
  assert.strictEqual(SRC.maxTokensFor(1000), 2400, "too large is charged whether used or not");
  for (const n of [1, 2, 25, 60, 1000]) assert.strictEqual(SRC.maxTokensFor(n), SHIPPED.maxTokensFor(n), String(n));
});

t("the batch size matches the shipped one", () => {
  assert.strictEqual(SRC.AI_BATCH, SHIPPED.BATCH);
  assert.strictEqual(SRC.TPM_BUDGET, SHIPPED.TPM);
});

/* ---- askResume: the four recoveries ---- */

const err = (kind, status) => Object.assign(new Error(kind + " failure"), { kind, status, retryMs: 0 });

/* askResume is async, so its cases are collected inside the IIFE below and
   reported through the same `t` as everything else. */
(async () => {
  const runs = [];

  {
    let calls = 0;
    const stopped = await SRC.askResume([1, 2, 3, 4, 5, 6], async () => { calls++; throw err("credential", 401); },
      () => {}, () => {});
    runs.push(["a credential failure stops after the first batch", () => {
      assert.strictEqual(calls, 1);
      assert.ok(stopped, "must return the error that stopped the run");
    }]);
  }

  {
    const seen = [];
    const items = Array.from({ length: 60 }, (_, i) => i);   // 3 batches of 25/25/10
    let n = 0;
    const stopped = await SRC.askResume(items, async (batch) => {
      n++;
      if (n === 2) throw err("fatal", 404);
      return batch;
    }, (batch) => seen.push(...batch), () => {});
    runs.push(["a fatal failure drops that batch and keeps going", () => {
      assert.strictEqual(stopped, null);
      assert.strictEqual(n, 3, "all three batches attempted");
      assert.strictEqual(seen.length, 35, "the failed batch of 25 is lost, the other 35 survive");
    }]);
  }

  {
    const sizes = [];
    const stopped = await SRC.askResume(Array.from({ length: 20 }, (_, i) => i), async (batch) => {
      sizes.push(batch.length);
      if (batch.length === 20) throw err("transient", 413);
      return batch;
    }, () => {}, () => {});
    runs.push(["a 413 halves the batch and re-queues both halves", () => {
      assert.strictEqual(stopped, null);
      assert.deepStrictEqual(sizes, [20, 10, 10]);
    }]);
  }

  {
    let attempts = 0;
    const notes = [];
    const stopped = await SRC.askResume([1], async () => {
      attempts++;
      if (attempts <= 2) throw err("transient", 500);
      return "fine";
    }, () => {}, (m) => notes.push(m));
    runs.push(["a transient failure retries and then succeeds", () => {
      assert.strictEqual(stopped, null);
      assert.strictEqual(attempts, 3);
      assert.ok(notes.some((m) => /retrying in/.test(m)), "the preparer is told the run is slow, not stuck");
    }]);
  }

  {
    let attempts = 0;
    const notes = [];
    await SRC.askResume([1], async () => { attempts++; throw err("transient", 500); }, () => {}, (m) => notes.push(m));
    runs.push(["a transient failure gives up after four retries", () => {
      assert.strictEqual(attempts, 5, "the first try plus four retries");
      assert.ok(notes.some((m) => /abandoned after 4 retries/.test(m)));
    }]);
  }

  for (const [name, fn] of runs) t(name, fn);

  /* ---- which key is in play ---- */

  t("the four AI modes are distinguished, because each needs different advice", () => {
    assert.strictEqual(SRC.aiMode(true, true, true), "proxy");
    assert.strictEqual(SRC.aiMode(true, true, false), "personal-on-server");
    assert.strictEqual(SRC.aiMode(true, false, false), "offline");
    assert.strictEqual(SRC.aiMode(false, undefined, undefined), "personal");
    // "the server has no key" and "the server is unreachable" look alike if
    // collapsed, and need different actions from the preparer.
    assert.notStrictEqual(SRC.aiModeLabel("personal-on-server"), SRC.aiModeLabel("offline"));
    for (const args of [[true, true, true], [true, true, false], [true, false, false], [false], [true, null, false]]) {
      assert.strictEqual(SRC.aiMode(...args), SHIPPED.aiMode(...args), JSON.stringify(args));
    }
  });

  /* ---- the gate ---- */

  const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");

  t("a caption naming a bank account is refused for any income line", () => {
    const BANK = /\biban\b|account\s*(?:#|no\.?\s|number)|\(#\d+\)|\b[a-z]{2}\d{2}[a-z]{4}\d{6,}\b|\b(?:cheque|savings|transaction|cash management)\s+account\b/i;
    assert.ok(store.includes("const BANK_ACCOUNT = "), "the veto is gone");
    for (const caption of ["Cash management account 1234", "IBAN NL91ABNA0417164300", "Savings account", "Account no. 5567", "Current account (#42)"]) {
      assert.ok(BANK.test(caption), caption);
    }
    assert.ok(!BANK.test("Accountancy fees"), "must not swallow a genuine expense caption");
    assert.ok(store.includes("but the caption names a bank account — a balance, not income or expense; refused."));
  });

  t("a proposal contradicting the section banner is refused as documentary evidence", () => {
    assert.ok(store.includes("if (row.section && !sectionOk(row.section, p.t))"));
    assert.ok(store.includes("refused as a documentary contradiction."));
  });

  t("every proposal goes through manualApply, the same gate a human assignment does", () => {
    assert.ok(store.includes('if (!manualApply(fresh, lines, contributions, relabels, p.t, row, "groq"))'));
    assert.ok(store.includes("AI proposed an invalid line id"), "a hallucinated line id must be named as such");
  });

  t("a low-confidence answer is booked AND flagged, naming the model as its author", () => {
    assert.ok(store.includes("id: `ai-low-${key}`"));
    assert.ok(store.includes("by the model with LOW confidence"));
    assert.ok(store.includes("The figure is booked; verify the line before filing"));
  });

  t("only captions the RULES could not place are sent, and never over an override", () => {
    assert.ok(store.includes("/No mapping rule matches/.test(x.row.reason || \"\") && !(ent.mapOverrides && ent.mapOverrides[norm(x.row.label)])"));
  });

  t("pass two is only for what pass one could not settle", () => {
    assert.ok(store.includes("const retry = rows.filter((x) => {"));
    assert.ok(store.includes("return !p || !p.t || !aiOk(p);"), "low confidence must also be retried");
    assert.ok(store.includes("if (p && p.t) answers.set(norm(x.row.label), p);"),
      "a pass-two blank must not erase a pass-one answer");
  });

  t("the profile pass names a field and never invents a value", () => {
    assert.ok(store.includes("Never guess a value - you only name the field the caption denotes."));
    assert.ok(store.includes("if (target[p.t]) continue;    // already known; a proposal never overwrites"));
  });

  t("the profile pass refuses rather than writing a bad date or currency", () => {
    assert.ok(store.includes('if (/^(cyEnd|pyEnd|formed)$/.test(p.t) && !looksLikeDate(value))'));
    assert.ok(store.includes('if (p.t === "currency" && !/^[A-Za-z]{3}$/.test(String(value).trim()))'));
    assert.ok(store.includes("which does not parse as a date — NOT applied"));
    assert.ok(store.includes("which is not a 3-letter code — NOT applied"));
  });

  t("the pass runs last, and a failure does not sink the work paper", () => {
    assert.ok(store.includes('"Map the remainder with AI",'), "step 6 is not in PROCESS_STEPS");
    assert.ok(store.includes("if (step === 5) {"), "the step is not wired");
    assert.ok(store.includes("log.push(`AI mapping did not run — ${(err as Error).message}`);"),
      "an AI failure must not fail processing");
  });

  t("a run with no key says so instead of failing 25 requests", () => {
    assert.ok(store.includes("AI mapping skipped — no AI key available"));
    assert.ok(store.includes("export const aiReady = () => useProxy() || !!state.groq.key;"));
  });

  t("profile candidates are capped and deduped before they are sent", () => {
    assert.ok(store.includes("if (unmatchedProfile.length >= 60) break;"));
    assert.ok(store.includes("if (matchRule(cand.caption, state.rules) !== null) continue;"),
      "a caption a mapping rule claims is a line item, not a particular");
    const detect = fs.readFileSync(path.join(root, "src", "prototype", "wp", "detectProfile.ts"), "utf8");
    assert.ok(detect.includes("unmatched.length < 40"), "no per-grid cap");
  });

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
