/* Item C: money rounds to 2dp, and the two QuickBooks subtotal captions that
   were falling into unmapped residue are skipped. Evals the /*EN9ROUND-BEGIN*​/
   block out of dist/index.html so it pins the shipped code. */
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const m = dist.match(/\/\*EN9ROUND-BEGIN\*\/([\s\S]*?)\/\*EN9ROUND-END\*\//);
a(!!m, "EN9ROUND sentinel block present in dist");
if (!m) { process.exit(1); }
eval(m[1]);

/* --- C1: the exact number from the report ------------------------------- */
// the reported symptom, reproduced then fixed
let raw = 0;
[0.1, 0.2].forEach(v => raw += v);
a(raw !== 0.3, "REGRESSION baseline: plain + produces float drift (0.1+0.2 !== 0.3)");
a(EN9r2add(0.1, 0.2) === 0.3, "EN9r2add gives the money answer");

// the exact shape of the reported figure: a set of contributions whose plain
// sum surfaces as 170100.63999999998
const parts = [102145.31, 67955.32, 0.0099999999];
let plain = 0; parts.forEach(v => { plain += v; });
a(plain !== 170100.64, `REGRESSION baseline: the raw sum drifts (${plain})`);
a(String(plain).length > 12, `and it surfaces with a long tail: ${plain}`);
let acc = 0;
parts.forEach(v => { acc = EN9r2add(acc, v); });
a(acc === 170100.64, `accumulated total is clean money: ${acc}`);
a(String(acc).length <= 9, `and no longer carries a float tail: ${acc}`);

/* --- C1: rounding behaviour --------------------------------------------- */
a(EN9r2(1.005) === 1.01, "half-cent rounds up rather than down through binary error");
a(EN9r2(2.675) === 2.68, "the classic 2.675 case rounds correctly");
a(EN9r2(-1.005) === -1.01, "negatives round away from zero symmetrically");
a(EN9r2(-170100.639999) === -170100.64, "a negative total rounds like its positive twin");
a(EN9r2(1234.5) === 1234.5 && EN9r2(0) === 0, "already-clean values are unchanged");
a(EN9r2(1e12 + 0.004) === 1e12, "large values stay exact");

// non-numbers pass straight through: labels and blanks must not become NaN
a(EN9r2("Gross receipts") === "Gross receipts", "a text cell is returned untouched");
a(EN9r2("") === "", "an empty cell stays empty, not 0");
a(EN9r2(null) === null && EN9r2(undefined) === undefined, "null/undefined pass through");
a(Number.isNaN(EN9r2(NaN)), "NaN is not silently turned into a number");
a(EN9r2(Infinity) === Infinity, "Infinity is not mangled");

// the accumulator treats a missing running total as zero, not NaN
a(EN9r2add(undefined, 5.005) === 5.01, "a first contribution starts from zero");
a(EN9r2add(null, 2.5) === 2.5, "a null running total is treated as zero");
a(EN9r2add(10, undefined) === 10, "a missing contribution leaves the total alone");
a(EN9r2add(NaN, 3) === 3, "a NaN running total does not poison the line");

/* --- C1: wiring ---------------------------------------------------------- */
a(dist.includes("e[n]={amount:EN9r2add(h.amount,g)}"), "Schedule C amounts accumulate rounded");
a(dist.includes("eoy:EN9r2add(h.eoy,g)") && dist.includes("boy:EN9r2add(h.boy,g)"),
  "Schedule F opening and closing balances accumulate rounded");
a(!dist.includes('(typeof h.amount=="number"?h.amount:0)+g'),
  "REGRESSION: the raw float accumulation is gone");
a(dist.includes("(i[`F${a.row}`]=EN9r2(A.amount))"), "Schedule C is rounded again at workbook write");
a(dist.includes("(s[`D${a.row}`]=EN9r2(A.boy))") && dist.includes("(s[`F${a.row}`]=EN9r2(A.eoy))"),
  "Schedule F is rounded again at workbook write");
a(dist.includes('EN9v=typeof a.value=="number"?(a.dp?EN9roundDp(a.value,a.dp):EN9r2(a.value)):typeof a.value=="string"?EN9sanitize(a.value):a.value'),
  "every other numeric cell written to the workbook is rounded (to 2 dp, or to the precision a rate declares), and strings are sanitised");

/* --- C2: the SKIP list --------------------------------------------------- */
// The SKIP list keeps growing (v3 added the QuickBooks/Xero closing lines);
// the bound is a safety net against a runaway match, not a size limit.
const skip = dist.match(/P1=\[\{kw:\[([\s\S]{0,3000}?)\],t:"SKIP"\}/);
a(!!skip, "the SKIP rule is findable in the bundle");
const kws = skip ? skip[1].toLowerCase() : "";
a(kws.includes('"total for income"'), "C2: QuickBooks 'Total for Income' is skipped");
a(kws.includes('"total for expenses"'), "C2: QuickBooks 'Total for Expenses' is skipped");
a(kws.includes('"total income"') && kws.includes('"total expenses"'), "the original phrasings are still skipped");

// A caption reaching the SKIP rule is matched by substring, so confirm the new
// entries cannot be swallowed by an existing one.
a(!"total for income".includes("total income"), "'Total for Income' does NOT contain 'total income'");
a(!"total for expenses".includes("total expenses"), "'Total for Expenses' does NOT contain 'total expenses'");
const rule = kws.split('","');
["total for income", "total for expenses"].forEach(k =>
  a(rule.some(r => r.replace(/"/g, "") === k), `'${k}' is its own entry, not a near-miss`));

/* --- C: the deliberate non-changes -------------------------------------- */
// These are tax-treatment decisions awaiting the preparer and must NOT have
// been quietly given a mapping. The check reads the catalogue itself rather
// than the text of the bundle, so a keyword cannot pass by sitting anywhere
// but last in its group.
const RULES = (() => {
  const m = /P1=(\[\{kw:\["cost of sales"[\s\S]*?\}\])(?=,|;|\))/.exec(dist);
  a(!!m, "the rule catalogue is findable in the bundle");
  return m ? new Function(`return ${m[1]}`)() : [];
})();
const mapped = (cap) => RULES.some((r) => r.kw.some((k) => k.toLowerCase().startsWith(cap)));
["parts sold", "disbursements", "billable expense income", "uncategori"].forEach((cap) => {
  a(!mapped(cap), `'${cap}' still has no keyword mapping — left for the preparer`);
});
/* "Discounts given" DOES have one now: it is contra-revenue, and leaving it
   unmapped is what let the income banner's catch-all book it to gross
   receipts, adding the discount to income instead of taking it off. */
a(RULES.some((r) => r.t === "IS:8" && r.kw.includes("discounts given")),
  "'discounts given' reduces income on line 1b");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL SCHEDULE-C TESTS PASSED");
