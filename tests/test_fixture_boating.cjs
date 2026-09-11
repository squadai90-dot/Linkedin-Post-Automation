/* FIXTURE #2 — Boating Made Easy Ltd (Cayman, KYD), 2024, QuickBooks exports.

   Input : the real QuickBooks P&L and balance-sheet rows as the PDF reader
           emits them (captions, amounts, indents, the page footer), with the
           entity name anonymised.
   Truth : the hand-prepared work paper for the same year, reconciled cell by
           cell on 2026-09-10.
   Method: replay through the SOURCE pipeline and compare.

   What this pins, each of which the tool got wrong before:
     - "Net earnings" (the closing line) was booked as an other DEDUCTION;
     - the footer "Accrual Basis Wednesday, June 11, 2025 09:58 PM GMTZ 1/1"
       was booked as a deduction worth 11 (the page count read as a number);
     - "Total for Current Liabilities 0" was booked as a liability;
     - the balance sheet's only asset line, "Current Assets $24,292.34", was
       left unmatched because it is named like a section heading;
     - the equity line "Net Income 12,875.74" was SKIPped as a P&L subtotal.
   Net income came out at −11 and the balance sheet did not balance. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const near = (x, y, tol = 0.01) => typeof x === "number" && Math.abs(x - y) <= tol;

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "boating_rows.json"), "utf8"));
const rows = (raw, feed, docName) => {
  let current = null;
  const sectionOf = (r) => {
    const label = (r.cells[0].text || "").trim();
    const B = SRC.SECT;
    // the same lexicon the pipeline uses; harness-side only for the feed tag
    const { SECTION_BANNERS } = require("./fixtures/harness_src.cjs").BANNERS();
    for (const [re, s] of SECTION_BANNERS) if (re.test(label)) { current = s; break; }
    return current;
  };
  return SRC.toRows(raw, { feedOf: () => feed, sectionOf, docName });
};

const pl = rows(RAW.pl, "is", "ProfitandLoss_2024.pdf");
const bs = rows(RAW.bs, "bs", "BalanceSheet_2024.pdf");
const OPTS = { structure: true, section: true, collapsed: true, equity: true };
const P = SRC.book(pl, OPTS);
const B = SRC.book(bs, OPTS);
const v = (R, k, f) => SRC.val(R.lines, k, f);
const sum = (R, keys, f) => keys.reduce((n, k) => n + (v(R, k, f) || 0), 0);
const OD = Object.keys(SRC.ENG.POOLS).length ? SRC.ENG.POOLS["IS:OD"].rows.map((r) => "IS:" + r) : [];

/* ---- income statement ---- */

/* Gross receipts is the six remaining income captions: "Discounts given" is
   contra-revenue and now sits on line 1b. The statement ADDS it to its own
   income total, so line 1b carries it negated and line 1a + line 1b still
   comes to the QuickBooks total of 350,585.97 — see contraRevenueFlip. */
t("gross receipts: the six QuickBooks income captions, to the cent", () => {
  assert.ok(near(v(P, "IS:7", "amount"), 350280.05), String(v(P, "IS:7", "amount")));
});

t('"Discounts given" is on line 1b, signed so gross income does not move', () => {
  assert.ok(near(v(P, "IS:8", "amount"), -305.92), String(v(P, "IS:8", "amount")));
  assert.ok(near(v(P, "IS:7", "amount") - v(P, "IS:8", "amount"), 350585.97), "line 1a less line 1b is the statement's own income total");
});

/* Line 11 is for the wage and salary captions themselves. "Payroll Expenses"
   is a QuickBooks parent group covering employer taxes and benefits too, and
   belongs in other deductions on line 17. */
t("compensation: the wage caption alone", () => {
  assert.ok(near(v(P, "IS:26", "amount"), 72067.40), String(v(P, "IS:26", "amount")));
});

/* "Shipping and delivery expense" is a cost of sales and moved to line 2. */
t("cost of sales: carriage is line 2, not an other deduction", () => {
  assert.ok(near(v(P, "IS:12", "amount"), 11481.77), String(v(P, "IS:12", "amount")));
});

t("other deductions: the real captions and nothing else", () => {
  assert.ok(near(sum(P, OD, "amount"), 254161.06), String(sum(P, OD, "amount")));
});

t('"Net earnings" is the closing line, not a deduction', () => {
  assert.ok(P.skipped.some((s) => /^net earnings$/i.test(s.label)), JSON.stringify(P.skipped));
  const booked = Object.values(P.lines).some((l) => near(l.amount, 12875.74));
  assert.ok(!booked, "12,875.74 was booked somewhere");
});

t("the page footer is furniture: dropped before mapping, never worth 11", () => {
  // Two independent guards. The page count "1/1" is no longer a number, so the
  // footer never becomes a row at all …
  assert.strictEqual(SRC.ENG.numericCell("1/1"), null);
  assert.strictEqual(SRC.ENG.numericCell("09:58"), null);
  const everywhere = [...P.skipped, ...P.unmatched, ...B.skipped, ...B.unmatched].map((x) => x.label);
  assert.ok(!everywhere.some((l) => /accrual basis/i.test(l)), "the footer reached the pipeline: " + everywhere.join(" | "));
  assert.ok(![...Object.values(P.lines), ...Object.values(B.lines)].some((l) => l.amount === 11 || l.eoy === 11), "the page count was booked");
  // … and even if it did carry a figure, row hygiene refuses it.
  const footer = RAW.pl[RAW.pl.length - 1].cells[0].text;
  assert.strictEqual(SRC.ENG.applyRowHygiene({ label: footer, values: [11], years: null, page: 1 }), null, footer);
});

/* The invariant behind every routing change above: however the captions are
   spread across lines 1a, 1b, 2, 11 and 17, the bottom line is still the one
   the client's own statement reports. Uses the engine's formula, not a
   simplification of it, so a caption moved to a line the simplification
   ignored cannot pass unnoticed. */
t("net income is the QuickBooks figure", () => {
  assert.ok(near(SRC.STORE.bookNetIncome(P.lines), 12875.74), String(SRC.STORE.bookNetIncome(P.lines)));
});

/* ---- balance sheet ---- */

t('"Current Assets" carrying the whole figure is booked to other current assets', () => {
  assert.ok(near(v(B, "BS:OCA", "eoy") ?? v(B, "BS:16", "eoy"), 24292.34), JSON.stringify(B.lines));
});

t("retained earnings = QuickBooks retained earnings + the equity net-income line", () => {
  assert.ok(near(v(B, "BS:61", "eoy"), 24292.34), String(v(B, "BS:61", "eoy")));
});

t('"Total for Current Liabilities 0" and the footer are not liabilities', () => {
  for (const k of ["BS:48", "BS:49", "BS:50", "BS:OCL"]) assert.strictEqual(v(B, k, "eoy"), null, k + " was written");
  assert.ok(B.skipped.some((s) => /^total for current liabilities$/i.test(s.label)), JSON.stringify(B.skipped));
});

t("the section totals are recognised as totals", () => {
  for (const l of ["Total for Assets", "Total for Shareholder's Equity", "Total for Liabilities and Shareholder's Equity"]) {
    assert.ok(B.skipped.some((s) => s.label === l), l + " not skipped: " + JSON.stringify(B.skipped));
  }
});

t("Schedule F balances at the end of the year", () => {
  let assets = 0, liabEq = 0;
  for (const spec of SRC.ENG.BS_LINES) {
    const x = v(B, "BS:" + spec.row, "eoy");
    if (typeof x !== "number") continue;
    if (/assets/i.test(spec.group)) assets += x; else liabEq += x;
  }
  assert.ok(near(assets, 24292.34) && near(liabEq, 24292.34), `assets ${assets} vs liabilities+equity ${liabEq}`);
});

t("nothing on either statement is left unmatched except furniture", () => {
  const real = [...P.unmatched, ...B.unmatched].filter((u) => u.why !== "prose filter");
  assert.deepStrictEqual(real, [], JSON.stringify(real));
});

/* ---- and the shipped app gives the same answers ---- */

const DIST = require("./fixtures/harness.cjs");
(async () => {
  await DIST.boot();
  const distRows = (raw, feed, docName) => {
    let current = null;
    const { SECTION_BANNERS } = SRC.BANNERS();
    const sectionOf = (r) => {
      const label = (r.cells[0].text || "").trim();
      for (const [re, sec] of SECTION_BANNERS) if (re.test(label)) { current = sec; break; }
      return current;
    };
    return DIST.toRows(raw, { feedOf: () => feed, sectionOf, docName });
  };
  const DP = DIST.book(distRows(RAW.pl, "is", "ProfitandLoss_2024.pdf"), OPTS);
  const DB = DIST.book(distRows(RAW.bs, "bs", "BalanceSheet_2024.pdf"), OPTS);
  const flat = (R) => Object.keys(R.lines).sort().map((k) => k + "=" + JSON.stringify(R.lines[k], Object.keys(R.lines[k]).sort()));

  t("the shipped app books the same P&L lines as source", () => {
    assert.deepStrictEqual(flat(DP), flat(P));
  });
  t("the shipped app books the same balance-sheet lines as source", () => {
    assert.deepStrictEqual(flat(DB), flat(B));
  });
  t("the shipped app skips and leaves unmatched the same rows", () => {
    const key = (x) => x.label + " :: " + x.why;
    assert.deepStrictEqual([...DP.skipped, ...DB.skipped].map(key).sort(), [...P.skipped, ...B.skipped].map(key).sort());
    assert.deepStrictEqual([...DP.unmatched, ...DB.unmatched].map(key).sort(), [...P.unmatched, ...B.unmatched].map(key).sort());
  });

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
