/* FIXTURE #3 — SHORI CORPORATION (Belize, USD), 2024, QuickBooks exports.

   Input : the real QuickBooks P&L and balance sheet for the books entity
           (Power Real Group, LLC), as the PDF reader emits them — captions,
           amounts and the x-indents, which is where this fixture earns its
           keep.
   Truth : the hand-prepared work paper for the same year, reconciled cell by
           cell on 2026-09-11.
   Method: replay through the SOURCE pipeline and compare.

   What this pins, all of which the tool got wrong before:
     - four numbered QuickBooks group totals ("Total 3000 Shopify Product
       Sales", "Total 4010 …", "Total 6790 …", "Total 7300 …") were booked as
       ordinary accounts on top of the members they total, because each one is
       printed at its PARENT's indent rather than one level in from the
       members, so the upward arithmetic scan stopped at the parent and left
       the parent's own balance out of the sum;
     - "3003 Shopify Sales Return" reached line 1b but kept the negative sign
       the statement printed, and line 1b is SUBTRACTED, so it added half a
       million dollars instead of removing it;
     - "NET OTHER INCOME", a report summary line, was booked as other income;
     - owner investments, owner draws and opening balance equity all landed in
       the other-current-liabilities pool;
     - "7600 Taxes and Licenses" landed in the other-deductions pool instead of
       Schedule C line 16;
     - "8150 Exchange gain or loss", printed under Other Expenses, was booked
       as a gain.
   Net income came out at +1,291,419.39 against a real figure of −197.98. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const near = (x, y, tol = 0.01) => typeof x === "number" && Math.abs(x - y) <= tol;

const RAW = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "shori_rows.json"), "utf8"));
const { SECTION_BANNERS } = SRC.BANNERS();
const rows = (raw, feed, docName) => {
  let current = null;
  const sectionOf = (r) => {
    const label = (r.cells[0].text || "").trim();
    for (const [re, s] of SECTION_BANNERS) if (re.test(label)) { current = s; break; }
    return current;
  };
  return SRC.toRows(raw, { feedOf: () => feed, sectionOf, docName });
};

const OPTS = { structure: true, section: true, collapsed: true, equity: true };
const P = SRC.book(rows(RAW.pl, "is", "ProfitAndLoss_2024.pdf"), OPTS);
const B = SRC.book(rows(RAW.bs, "bs", "BalanceSheet_2024.pdf"), OPTS);
const v = (R, k, f) => SRC.val(R.lines, k, f);
const pool = (R, id, f) => SRC.ENG.POOLS[id].rows.reduce((n, r) => n + (v(R, (id.split(":")[0]) + ":" + r, f) || 0), 0);

/* ---- the group totals, which is the whole point of this fixture ---- */

const skipped = Object.fromEntries(P.skipped.map((s) => [s.label, s.why]));

for (const [label, parent] of [
  ["Total 3000 Shopify Product Sales", "3000 Shopify Product Sales"],
  ["Total 4010 Product Purchases - Shopify", "4010 Product Purchases - Shopify"],
  ["Total 6790 Other Professional Fees", "6790 Other Professional Fees"],
  ["Total 7300 Advertising expense", "7300 Advertising expense"],
]) {
  t(`"${label}" is dropped as its group's total`, () => {
    assert.ok(skipped[label], `not skipped: ${label}`);
    assert.ok(
      skipped[label].includes(parent),
      `skipped for the wrong reason: ${skipped[label]}`,
    );
  });
}

t('"NET OTHER INCOME" is a report total, not an income account', () => {
  assert.ok(skipped["NET OTHER INCOME"], "NET OTHER INCOME was booked");
});

/* ---- Schedule C ---- */

t("1a gross receipts: 2,105,663.30", () => {
  assert.ok(near(v(P, "IS:7", "amount"), 2105663.30), String(v(P, "IS:7", "amount")));
});

/* The statement prints the return negative and adds it inside its own income
   total. Line 1b is subtracted by the template, so it carries the magnitude:
   523,743.76 + the 16,954.85 discount. */
t("1b returns and allowances: 540,698.61, positive", () => {
  assert.ok(near(v(P, "IS:8", "amount"), 540698.61), String(v(P, "IS:8", "amount")));
});

t("line 2 cost of goods sold: 1,246,051.06", () => {
  const cogs = ["IS:10", "IS:11", "IS:12"].reduce((n, k) => n + (v(P, k, "amount") || 0), 0);
  assert.ok(near(cogs, 1246051.06), String(cogs));
});

t("line 2 other costs: freight and the two payment processors, 126,800.63", () => {
  assert.ok(near(v(P, "IS:12", "amount"), 126800.63), String(v(P, "IS:12", "amount")));
});

t("line 9 other income: 50,710.69, the account alone", () => {
  assert.ok(near(pool(P, "IS:OI", "amount"), 50710.69), String(pool(P, "IS:OI", "amount")));
});

t("line 11 compensation: 82,000.00", () => {
  assert.ok(near(v(P, "IS:26", "amount"), 82000), String(v(P, "IS:26", "amount")));
});

t("line 16 taxes: 387.00, off the other-deductions pool", () => {
  assert.ok(near(v(P, "IS:32", "amount"), 387), String(v(P, "IS:32", "amount")));
});

/* The hand-prepared paper shows 287,425.16; it rounds Office Supplies 787.98
   to 788. The tool keeps the cents, so it is the manual that is 0.02 out. */
t("line 17 other deductions: 287,425.14", () => {
  assert.ok(near(pool(P, "IS:OD", "amount"), 287425.14), String(pool(P, "IS:OD", "amount")));
});

t("the exchange loss is a loss: −10.16", () => {
  const fx = (v(P, "IS:19", "amount") || 0) + (v(P, "IS:20", "amount") || 0);
  assert.ok(near(fx, -10.16), String(fx));
});

t("nothing on the P&L is left unmatched", () => {
  assert.deepStrictEqual(P.unmatched.map((u) => u.label), []);
});

t("net income is the statement's own −197.98", () => {
  const cogs = ["IS:10", "IS:11", "IS:12"].reduce((n, k) => n + (v(P, k, "amount") || 0), 0);
  const gross = (v(P, "IS:7", "amount") || 0) - (v(P, "IS:8", "amount") || 0) - cogs;
  const income = gross + pool(P, "IS:OI", "amount")
    + (v(P, "IS:19", "amount") || 0) + (v(P, "IS:20", "amount") || 0);
  const deductions = (v(P, "IS:26", "amount") || 0) + (v(P, "IS:32", "amount") || 0)
    + pool(P, "IS:OD", "amount");
  assert.ok(near(income - deductions, -197.98), String(income - deductions));
});

/* ---- Schedule F ---- */

t("cash: all 24 bank sub-accounts, 72,882.56", () => {
  assert.ok(near(v(B, "BS:10", "eoy"), 72882.56), String(v(B, "BS:10", "eoy")));
});

t("accounts payable: 61,139.37", () => {
  assert.ok(near(v(B, "BS:46", "eoy"), 61139.37), String(v(B, "BS:46", "eoy")));
});

t("owner investments reach paid-in surplus: 8,573.40", () => {
  assert.ok(near(v(B, "BS:60", "eoy"), 8573.40), String(v(B, "BS:60", "eoy")));
});

/* 2990 Retained Earnings 243,156.64, owner draws −104,008.71, opening balance
   equity −144,975.47 and the year's −197.98. The manual keeps net income on
   its own row and shows −5,827.54 above it; the total equity is the same. */
t("draws and opening balance equity land in retained earnings: −6,025.52", () => {
  assert.ok(near(v(B, "BS:61", "eoy"), -6025.52), String(v(B, "BS:61", "eoy")));
});

t("no equity is left in the current-liability pool", () => {
  assert.ok(near(pool(B, "BS:OCL", "eoy"), 9195.31), String(pool(B, "BS:OCL", "eoy")));
});

t("Schedule F balances at 72,882.56", () => {
  const le = (v(B, "BS:46", "eoy") || 0) + pool(B, "BS:OCL", "eoy")
    + (v(B, "BS:60", "eoy") || 0) + (v(B, "BS:61", "eoy") || 0);
  assert.ok(near(le, 72882.56), String(le));
  assert.ok(near(v(B, "BS:10", "eoy"), le), "assets do not equal liabilities and capital");
});

t("nothing on the balance sheet is left unmatched", () => {
  assert.deepStrictEqual(B.unmatched.map((u) => u.label), []);
});

/* ---- the same replay through the SHIPPED bundle ----
   The fixes live in two trees and only the shipped one reaches a preparer, so
   the numbers above are worth nothing until dist produces them too. */
(async () => {
  const DIST = require("./fixtures/harness.cjs");
  const M = await DIST.boot();
  /* The two banner lexicons are asserted identical by test_sections, so
     tagging with the src copy keeps this leg about the booking, not the
     lexicon. */
  let cur = null;
  const sectionOf = (r) => {
    const label = (r.cells[0].text || "").trim();
    for (const [re, s] of SECTION_BANNERS) if (re.test(label)) { cur = s; break; }
    return cur;
  };
  const drows = (raw, feed, docName) => {
    cur = null;
    return DIST.toRows(raw, { feedOf: () => feed, sectionOf, docName });
  };
  const DP = DIST.book(drows(RAW.pl, "is", "ProfitAndLoss_2024.pdf"), OPTS);
  const DB = DIST.book(drows(RAW.bs, "bs", "BalanceSheet_2024.pdf"), OPTS);
  const dv = (R, k, f) => DIST.val(R.lines, k, f);
  const dpool = (R, id, f) =>
    M.O1[id].rows.reduce((n, r) => n + (dv(R, id.split(":")[0] + ":" + r, f) || 0), 0);

  for (const [name, got, want] of [
    ["1a gross receipts", dv(DP, "IS:7", "amount"), 2105663.30],
    ["1b returns", dv(DP, "IS:8", "amount"), 540698.61],
    ["line 2 cost of goods sold", ["IS:10", "IS:11", "IS:12"].reduce((n, k) => n + (dv(DP, k, "amount") || 0), 0), 1246051.06],
    ["line 9 other income", dpool(DP, "IS:OI", "amount"), 50710.69],
    ["line 16 taxes", dv(DP, "IS:32", "amount"), 387],
    ["line 17 other deductions", dpool(DP, "IS:OD", "amount"), 287425.14],
    ["the exchange loss", (dv(DP, "IS:19", "amount") || 0) + (dv(DP, "IS:20", "amount") || 0), -10.16],
    ["cash", dv(DB, "BS:10", "eoy"), 72882.56],
    ["paid-in surplus", dv(DB, "BS:60", "eoy"), 8573.40],
    ["retained earnings", dv(DB, "BS:61", "eoy"), -6025.52],
    ["the current-liability pool", dpool(DB, "BS:OCL", "eoy"), 9195.31],
  ]) {
    t(`shipped bundle: ${name}`, () => assert.ok(near(got, want), String(got)));
  }

  t("shipped bundle: the four group totals are dropped", () => {
    const sk = Object.fromEntries(DP.skipped.map((x) => [x.label, x.why]));
    for (const label of [
      "Total 3000 Shopify Product Sales", "Total 4010 Product Purchases - Shopify",
      "Total 6790 Other Professional Fees", "Total 7300 Advertising expense",
      "NET OTHER INCOME",
    ]) assert.ok(sk[label], `not skipped: ${label}`);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
