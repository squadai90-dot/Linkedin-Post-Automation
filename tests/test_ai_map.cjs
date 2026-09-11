/* Always-on AI mapping tests (CHANGE 1).
   Pins the pure helpers (chunking, response parsing, confidence gate) and the
   detectProfile candidate capture — all evaluated straight out of dist/index.html. */
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- pure helpers ----------------------------------------------------------
const pm = dist.match(/\/\*EN9AI-PURE-START\*\/([\s\S]*?)\/\*EN9AI-PURE-END\*\//);
a(!!pm, "EN9AI pure-helper block present in dist");
eval(pm[1]);

a(JSON.stringify(EN9chunk([1, 2, 3, 4, 5], 2)) === "[[1,2],[3,4],[5]]", "EN9chunk slices with a remainder");
a(EN9chunk(Array.from({ length: 100 }), 40).map(c => c.length).join(",") === "40,40,20", "EN9chunk 100 -> 40/40/20");
a(EN9chunk([], 40).length === 0, "EN9chunk empty input");

let map = EN9parseMap('{"map":{"0":{"t":"IS:26","c":"high","r":"depreciation"},"1":{"t":null,"c":"low","r":""}}}');
a(map["0"] && map["0"].t === "IS:26" && map["1"] && map["1"].t === null, "parseMap: valid object form");
map = EN9parseMap('```json\n{"map":{"0":"IS:26"}}\n```');
a(map["0"] === "IS:26", "parseMap: legacy string form with code fences");
map = EN9parseMap('{"map":{"0":{"t":"IS:7","c":"high","r":"sales"},"1":{"t":"IS:2');
a(map["0"] && map["0"].t === "IS:7" && map["1"] === undefined, "parseMap: truncated JSON salvages the complete entries");
a(JSON.stringify(EN9parseMap("total garbage")) === "{}", "parseMap: garbage yields empty map");

a(EN9norm1({ k: "formed", c: "HIGH", r: "x" }).t === "formed", "norm1: profile k alias + case-folded confidence");
a(EN9norm1({ t: "IS:7", c: "certain", r: "" }).c === "low", "norm1: unknown confidence downgraded to low");
a(EN9norm1("IS:26").c === "medium", "norm1: bare string normalizes to medium");
a(EN9norm1({ t: 42 }).t === null, "norm1: non-string target nulled");
a(EN9norm1(null) === null, "norm1: null passthrough");
a(EN9ok({ t: "IS:7", c: "high" }) && EN9ok({ t: "IS:7", c: "medium" }), "EN9ok: high and medium pass");
a(!EN9ok({ t: "IS:7", c: "low" }) && !EN9ok({ t: null, c: "high" }), "EN9ok: low or null target refused");

// --- live QF: profile candidate capture ------------------------------------
const qi = dist.indexOf("function QF(t){");
const qj = dist.indexOf("var t_=[[", qi);
a(qi > 0 && qj > qi, "QF extraction boundaries found");
const XJ = v => String(v).toLowerCase().replace(/[\s ]+/g, " ").replace(/[:\-–—*]+$/, "").trim();
const EF = (row, idx) => { for (let k = idx + 1; k < row.length; k++) { const v = row[k]; if (v !== undefined && String(v).trim() !== "") return { value: String(v).trim() }; } return null; };
const zh = v => /^(y|yes|true|x|✓)$/i.test(String(v).trim()) ? "Yes" : "No";
const $J = [{ key: "formed", labels: ["date of formation", "date of incorporation"], clean: v => v }];
const e_ = [];
// QF reads boxed tax forms (a caption row over a value row) through the
// EN9BOX helpers, which live at module scope alongside it — extract them too,
// or the live function throws on its first row.
const box = /\/\*EN9BOX-BEGIN\*\/[\s\S]*?\/\*EN9BOX-END\*\//.exec(dist);
a(!!box, "EN9BOX helper block found in dist");
const QF = new Function("$J", "e_", "XJ", "EF", "zh", box[0] + dist.slice(qi, qj) + ";return QF;")($J, e_, XJ, EF, zh);

let res = QF([["Date of formation", "12/05/2014"], ["Company formation date", "12/05/2014"], ["Cash", "9,703"]]);
a(res.profile.length === 1 && res.profile[0].key === "formed", "QF: matched caption still lands in profile (regression)");
a(!res.EN9unmatched.some(u => u.norm === "date of formation"), "QF: matched caption NOT double-reported to AI");
const cand = res.EN9unmatched.find(u => u.norm === "company formation date");
a(cand && cand.value === "12/05/2014" && cand.caption === "Company formation date",
  "QF: unmatched fuzzy caption captured with caption/norm/value");
// value-shape filter: profile values are names/dates/percentages, never page numbers or money
res = QF([["Directors Statement", "3"], ["Commissions Received", "9,703"], ["Freight & Cartage", "842"]]);
a(res.EN9unmatched.length === 0, "QF: table-of-contents page numbers and P&L money amounts are not profile candidates");
res = QF([["Country of incorporation of the entity", "Australia"], ["Incorporated on this date", "10/25/2010"], ["Ownership at start", "100%"]]);
a(res.EN9unmatched.length === 3, "QF: names, dates and percentages still qualify as profile candidates");
res = QF([["Company formation date", ""]]);
a(res.EN9unmatched.length === 0, "QF: caption with empty value cell excluded");
res = QF([["1234567", "12/05/2014", "x"]]);
a(res.EN9unmatched.length === 0, "QF: all-digit caption excluded");
res = QF(Array.from({ length: 45 }, (_, i) => [`unknown caption number ${i}`, "value " + i]));
a(res.EN9unmatched.length === 40, "QF: candidate cap at 40 per grid");
a(JSON.stringify(QF(null).EN9unmatched) === "[]", "QF: null-grid early return carries EN9unmatched:[]");

// --- one-pass behaviour (book everything safe, flag low confidence) --------
const air = dist.slice(dist.indexOf("async function EN9aiRun"), dist.indexOf("var Be={EN9_expose"));
a(air.includes("EN9retry=A.filter(x=>{let v=h.get($h(x.row.label));return!v||!v.t||!EN9ok(v)})"),
  "pass 2 retries exactly the rows pass 1 left null or low-confidence (content-keyed)");
a(air.includes("h.set($h(x.row.label),f)") && !air.includes("h.set(x.idx"),
  "AI results are keyed by caption, not array index (no wrong-caption race)");
a(air.includes("EN9retry.length&&!EN9err&&await EN9ask(EN9retry,!0)"), "pass 2 fires only when there are leftovers and pass 1 did not hard-fail");
a(air.includes("f&&f.t&&h.set($h(x.row.label),f)"), "a null reply in pass 2 cannot erase a pass-1 suggestion");
a(/year tags: \$\{\(x\.row\.years\|\|\[\]\)/.test(air) && air.includes("amounts: ${(x.row.values||[]).join"),
  "pass 2 prompt carries amounts and year tags as extra evidence");
a(air.includes("Other income") && air.includes("only use null when the caption is a subtotal".replace("only","Only")),
  "pass 2 prompt allows Other-income/deduction pools and restricts null to subtotals");
// booking no longer gated on confidence: bF is called before any EN9ok test
const bookIdx = air.indexOf('bF(U,d,C,I,v.t,x,"groq")');
const okIdx = air.indexOf("EN9ok(v)||(l++");
a(bookIdx > 0 && okIdx > bookIdx, "low confidence is booked first, then flagged (confidence no longer gates booking)");
a(air.includes('level:"warn",category:"mapping",applied:!0'), "low-confidence ledger booking raises an applied warn review item");
a(air.includes('level:"warn",category:"profile",applied:!0'), "low-confidence profile fill raises an applied warn review item");
a(!/EN9ok\(v\)\)\{[^}]*E\.push\(x\)/.test(air), "no path parks a low-confidence row back into unmatched");
a(air.includes("could not be placed"), "log reports what genuinely could not be placed");

// --- P0 guards: live models, reasoning effort, visible failures -------------
a(dist.includes('y8=["openai/gpt-oss-120b","openai/gpt-oss-20b"]'),
  "model list contains only currently-served Groq production models");
a(!dist.includes("llama-3.3-70b-versatile"), "decommissioned default model fully removed");
a(dist.includes('reasoning_effort:"low"'), "gpt-oss reasoning effort set (prevents empty JSON under the token cap)");
a(dist.includes("model:t.groq&&y8.includes(t.groq.model)?t.groq.model:y8[0]"),
  "persisted saves migrate a dead model on restore");
a(dist.includes('EN9c==="model_decommissioned"'), "decommissioned-model error mapped to plain English");
// item D widened this: a bad key is now recognised from 401/403 and from the
// message as well as the bare code, and only that class is treated as fatal.
a(dist.includes('EN9kind==="credential"'), "bad-key error mapped to plain English");
a(dist.includes('/invalid_api_key|authentication|no api key|unauthor/.test(i)'),
  "and recognised however Groq happens to phrase it");
a(air.includes('id:"EN9-ai-error"'), "AI failure raises a stored warn review item, not just a log line");
// item D: 8000 max_tokens plus a real prompt exceeded the model's 8000 TPM
// limit, so the first mapping call always 413'd. The budget now scales.
a(!air.includes("maxTokens:8e3"), "REGRESSION: the flat 8k completion cap that caused the 413 is gone");
a(air.includes("maxTokens:EN9maxTokensFor(u.length)"), "mapping calls size their completion budget to the batch");
a(air.includes("AI proposed an invalid line id"), "hallucinated target ids get an honest refusal reason");
a(air.includes("could not place any of them"), "an all-null model reply logs a neutral line instead of silence");

// --- dist wiring smoke -----------------------------------------------------
a(dist.includes('"AI mapping of leftover captions"]'), "6th processing step present");
a(dist.includes("try{await EN9aiRun(t,s,!1)}catch"), "processEntity awaits the AI pass inside its own try/catch");
a(dist.includes("te.groq.EN9auto===!1"), "auto toggle read (default ON when undefined)");
a(dist.includes("EN9unmatchedProfile:e.EN9unmatchedProfile||[]"), "processEntity snapshot keeps profile candidates");
a(dist.includes('await EN9aiRun(t,null,!0)'), "manual Resolve-with-Groq delegates to the shared pass");
a(dist.includes('Be.setGroq({EN9auto:n.target.checked})'), "Settings toggle wired");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL AI-MAPPING TESTS PASSED");
