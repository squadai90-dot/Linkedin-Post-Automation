/* FIXTURE #1 — 2Hats Consulting B.V. 2024

   Input : the real Yuki "Financial report" rows (labels, amounts, x-indents)
   Truth : the reviewed workpaper prepared by a human
   Method: replay the rows through the SHIPPED mapping code and compare.

   This is the acceptance test. It does not assert that code was written; it
   asserts the numbers come out right. */
const fs = require("fs");
const path = require("path");
const H = require("./fixtures/harness.cjs");
const DIST = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
const dist_has = t => DIST.includes(t);

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "2hats_rows.json"), "utf8"));
/* The recorded AI decisions from the tool's own Provenance sheet. Captions the
   keyword rules don't match were mapped by the model; replaying those exact
   decisions isolates what the new rules change. */
const AI = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "2hats_ai_mappings.json"), "utf8"));

/* Yuki prints the balance sheet on pages 2-3 and the P&L on pages 4-5. */
const feedOf = r => (r.page <= 3 ? "bs" : "is");
/* Section = the banner the row was printed under. */
const SECTION_BANNERS = [
  [/^assets$/i, "assets"], [/^liabilities$/i, "liabilities"],
  [/^gross margin$/i, "income"], [/^operating costs$/i, "costs"],
  [/^depreciations$/i, "costs"], [/^financial result$/i, "costs"], [/^taxes$/i, "costs"],
];
let curSection = null;
const sectionOf = r => {
  const t = (r.cells[0].text || "").trim();
  for (const [re, s] of SECTION_BANNERS) if (re.test(t)) { curSection = s; break; }
  return curSection;
};

/* ---- truth, taken from the reviewed workpaper -------------------------- */
const EXPECT_BS = {
  "Cash": 28447.17,
  "Buildings and other depreciable assets": 1449.37,
  "Less accumulated depreciation": -1390.12,
  "Common stock": 4500.00,
  "Retained earnings": -1890.68,
};
const EXPECT_IS = {
  "Gross receipts": 174223.36,
  "Compensation not deducted elsewhere": 186640.63,
  "Depreciation not deducted elsewhere": 236.97,
  "Interest": -49.00,
  "FX gain/loss": -2701.45,
};
/* Totals, which is where a presentation split cannot hide. */
const TOTAL_ASSETS = 29641.42;
const TOTAL_LIABEQ = 29641.42;
const TOTAL_OTHER_DEDUCTIONS = 3252.17;   // advisors + office + bank costs
const TOTAL_OTHER_INCOME = 18503.33;      // referral fee

let fails = 0, checks = 0;
const a = (cond, msg) => { checks++; if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const near = (x, y) => x !== null && y !== null && Math.abs(x - y) < 1.0;

(async () => {
  await H.boot();
  const M = H.M;
  const items = H.toRows(RAW, { feedOf, sectionOf, docName: "2Hats Yuki annual accounts 2024" });
  console.log(`\nreplayed ${items.length} rows from the real report\n`);

  /* build the oracle: caption -> line key, from the recorded decisions */
  const norm = t => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const oracleMap = new Map();
  for (const p of AI) {
    const m = /^Sch ([CF]) \u00b7 (.+?) \((amount|eoy|boy)\)$/.exec(p.target || "");
    if (!m) continue;
    const list = m[1] === "F" ? M.is : M.ts;
    const e = list.find(x => x.label.toLowerCase() === m[2].toLowerCase())
           || list.find(x => m[2].toLowerCase().startsWith(x.label.toLowerCase()));
    if (e) oracleMap.set(norm(p.caption), (m[1] === "F" ? "BS:" : "IS:") + e.row);
  }
  const oracle = lbl => oracleMap.get(norm(lbl));
  console.log(`oracle holds ${oracleMap.size} recorded AI decisions`);

  const OPTS = {
    oracle,
    structure: !!M.EN9structRows,
    dedupe: !!M.EN9dedupeRows,
    section: !!M.EN9sectionOk,
  };
  console.log("rules active:", JSON.stringify(OPTS), "\n");
  const R = H.book(items, OPTS);

  /* map template line label -> line key */
  /* EXACT label first, then a prefix. Prefix-only resolved "Interest" to
     "Interest income" (row 15) and scored the correctly booked row 29 as
     wrong, understating the tool's accuracy at 90%. */
  const pick = (list, lbl) => list.find(x => x.label.toLowerCase() === lbl.toLowerCase())
                           || list.find(x => x.label.toLowerCase().startsWith(lbl.toLowerCase()));
  const bsKey = lbl => { const e = pick(M.is, lbl); return e ? "BS:" + e.row : null; };
  const isKey = lbl => { const e = pick(M.ts, lbl); return e ? "IS:" + e.row : null; };

  console.log("--- BALANCE SHEET (end of year) ---");
  let bsOk = 0, bsTot = 0;
  for (const [lbl, want] of Object.entries(EXPECT_BS)) {
    const k = bsKey(lbl); const got = k ? H.val(R.lines, k, "eoy") : null;
    bsTot++;
    const good = want === null ? (got === null || Math.abs(got) < 1) : near(got, want);
    if (good) bsOk++;
    console.log(`  ${good ? "OK   " : "WRONG"} ${lbl.padEnd(40)} tool=${String(got).padStart(12)}  want=${String(want).padStart(12)}`);
  }

  console.log("--- INCOME STATEMENT ---");
  let isOk = 0, isTot = 0;
  for (const [lbl, want] of Object.entries(EXPECT_IS)) {
    const k = isKey(lbl); const got = k ? H.val(R.lines, k, "amount") : null;
    isTot++;
    const good = near(got, want);
    if (good) isOk++;
    console.log(`  ${good ? "OK   " : "WRONG"} ${lbl.padEnd(40)} tool=${String(got).padStart(12)}  want=${String(want).padStart(12)}`);
  }

  /* ---- balance check ---------------------------------------------------- */
  let assets = 0, liabeq = 0;
  for (const e of M.is) {
    const v = H.val(R.lines, "BS:" + e.row, "eoy");
    if (typeof v !== "number") continue;
    if (/assets/i.test(e.group)) assets += v; else liabeq += v;
  }
  console.log(`\n  assets=${assets.toFixed(2)}  liabilities+equity=${liabeq.toFixed(2)}  out by ${(assets - liabeq).toFixed(2)}`);

  const pct = Math.round(100 * (bsOk + isOk) / (bsTot + isTot));
  console.log(`\n  FINANCIAL LINE ACCURACY: ${bsOk + isOk}/${bsTot + isTot} = ${pct}%`);
  console.log(`  skipped as subtotals: ${R.skipped.length}   unmatched: ${R.unmatched.length}   section-blocked: ${R.blocked.length}`);

  const sumGroup = (pfx, rows) => rows.reduce((t, r) => t + (H.val(R.lines, pfx + r, pfx === "IS:" ? "amount" : "eoy") || 0), 0);
  const od = sumGroup("IS:", M.O1["IS:OD"].rows);
  const oi = sumGroup("IS:", M.O1["IS:OI"].rows);
  console.log(`  other deductions total ${od.toFixed(2)} (want ${TOTAL_OTHER_DEDUCTIONS})`);
  console.log(`  other income total     ${oi.toFixed(2)} (want ${TOTAL_OTHER_INCOME})`);

  a(near(H.val(R.lines, bsKey("Cash"), "eoy"), 28447.17), "Cash is the liquid-assets figure, not the sum of every level");
  a(near(H.val(R.lines, isKey("Gross receipts"), "amount"), 174223.36), "Gross receipts excludes the Net revenue subtotal");
  a(near(assets, TOTAL_ASSETS), `total assets = ${TOTAL_ASSETS} (got ${assets.toFixed(2)})`);
  a(near(liabeq, TOTAL_LIABEQ), `total liabilities and equity = ${TOTAL_LIABEQ} (got ${liabeq.toFixed(2)})`);
  a(Math.abs(assets - liabeq) < 1.0, `balance sheet balances (out by ${(assets - liabeq).toFixed(2)})`);
  a(near(od, TOTAL_OTHER_DEDUCTIONS), "other deductions total matches");
  a(near(oi, TOTAL_OTHER_INCOME), "other income total matches");
  a(R.unmatched.length === 0, `no caption left unmatched (${R.unmatched.length})`);
  a(pct >= 85, `financial line accuracy >= 85% (got ${pct}%)`);

  /* ---- step 4: the E&P chain -------------------------------------------
     Income Statement J56 -> Sch-H I10 -> I26 -> Schedule J F23 is entirely
     formula-driven in the template, so the only thing the tool must supply is
     the tax. Prove the writer fires for a taxpaying entity and stands down for
     a nil-tax one, and that the two sides are tied out. */
  const taxEnt = { profile: { legalName: "ACME GMBH", countryInc: "GERMANY", cyEnd: "12/31/2024" },
                   lines: { "IS:54": { amount: -12500 } } };
  const w = []; 
  a(M.EN9schETax(taxEnt, x => w.push(x), 0.924, { referenceIds: ["R1"] }) === true,
    "step 4: a real income tax is written to Schedule E");
  a((w.find(x => x.ref === "O16") || {}).value === 12500,
    "step 4: the P&L keeps the tax negative, Schedule E receives the magnitude");
  a(M.EN9schETax({ profile: {}, lines: {} }, () => {}, 0.924, {}) === false,
    "step 4: a nil-tax entity leaves the nil-tax documentation row to run");
  a(M.EN9tieTax({ "IS:54": { amount: -12500 } }, 9000).length === 1,
    "step 4: a Schedule C / Schedule E tax mismatch is flagged");
  a(M.EN9tieTax({ "IS:54": { amount: -12500 } }, 12500).length === 0,
    "step 4: agreeing figures raise nothing");
  a(M.EN9sectionRoute("costs", "Income tax expense") === "IS:54",
    "step 4: an income-tax caption lands on Schedule C line 21a");

  /* ---- rules 5 and 7 ---------------------------------------------------- */
  a(dist_has("EN9PLACEHOLDERS"), "rule 5: the template placeholder list is present");
  const us = M.EN9parseUsShareholders([
    { page: 21, cells: ["Part I  U.S. Shareholders of Foreign Corporation"] },
    { page: 21, cells: ["WILLIAM M PHILLIPPE", "COMMON", "4,500.000", "4,500.000", "100"] },
  ]);
  a(us.length === 1 && us[0].boy === 4500 && us[0].eoy === 4500,
    "rule 7: Schedule B Part I is parsed (was: template demo data shipped instead)");
  const variants = ["Common Stock", "Class A Common", "Ordinary Shares", "COMMON"].map(c =>
    M.EN9parseUsShareholders([
      { page: 21, cells: ["Part I  U.S. Shareholders of Foreign Corporation"] },
      { page: 21, cells: ["ACME HOLDINGS LLC", c, "1,000", "1,000"] }]).length);
  a(variants.every(v => v === 1),
    `rule 7: every real-world class wording parses (${variants.join(",")}) — all four were dropped before`);

  /* ---- rule 4 ----------------------------------------------------------- */
  a(M.EN9tieOut({ "BS:10": { eoy: 114923.68 }, "BS:46": { eoy: 67114.13 } })
     .some(x => x.level === "block"), "rule 4: an unbalanced Schedule F blocks generation");
  a(M.EN9tieOut(R.lines).length === 0, "rule 4: the corrected sheet raises nothing");

  console.log(`\n${fails ? fails + " FAILURE(S)" : "FIXTURE #1 PASSED"}  (${checks} checks)`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("UNCAUGHT:", e); process.exit(1); });
