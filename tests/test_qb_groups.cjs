/* QuickBooks group structure: the subtotals, the bank-accounts group, the
   cost-of-sales group and the equity group.

   Every case here is a caption QuickBooks names after something other than
   what it is — the group's own name repeated with "Total" in front, a bank
   account called "Sales", a payment processor called "Shopify fees", an
   owner's draw — and every one of them was booked wrongly before: the
   subtotal counted its members twice, the bank accounts went unmapped and
   left Schedule F's asset side empty, the fees reached gross receipts, and
   equity was reported as a current liability.

   Both trees, because a rule that lives in only one of them is a rule the
   shipped app does not have. */
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");
const DIST = require("./fixtures/harness.cjs");

let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const SECT = SRC.SECT;
const ENG = SRC.ENG;
const RULES = ENG.DEFAULT_RULES;
let M = null;

/* ---- 1. "Total <group>" is the group's subtotal, not an account ---- */

t('"Total <banner>" is a subtotal in both trees', () => {
  for (const caption of [
    "Total Bank Accounts", "Total Current Liabilities", "Total Equity",
    "Total Assets", "Total Cost of Sales", "Total Expenses",
  ]) {
    assert.strictEqual(ENG.matchRule(caption, RULES), "SKIP", `src: ${caption}`);
    assert.strictEqual(M.Tv(caption, M.P1), "SKIP", `dist: ${caption}`);
  }
});

t("a real account that merely starts with a total word is still data", () => {
  // "Total Return Fund" is an investment, not a subtotal: no banner follows
  // the total word, so the rule does not fire and the keyword scan runs.
  assert.notStrictEqual(ENG.matchRule("Total Return Fund", RULES), "SKIP");
  assert.notStrictEqual(M.Tv("Total Return Fund", M.P1), "SKIP");
});

/* ---- 2. grid feeds, which have no indent to read ---- */

const gridRows = (pairs) => pairs.map(([label, v], i) => ({
  row: { label, values: v === null ? [] : [v], years: null, page: 1 },
  feed: "both", kind: "grid", docId: "g", docName: "export.xlsx", x0: 0, idx: i,
}));

const QB_GRID = [
  ["Payroll Expenses", 80352.54],
  ["Wage expenses", 72067.40],
  ["Total Payroll", 152419.94],
  ["Supplies", 14983.13],
];

t("a grid subtotal is found by name and arithmetic together", () => {
  const out = SECT.gridStructRows(gridRows(QB_GRID));
  // Nothing named "Payroll" precedes it, so the name test cannot fire; the
  // arithmetic one does — the two rows since the last total add up to it.
  assert.ok(out[2].skipReason, "the subtotal was not recognised: " + JSON.stringify(out.map((r) => r.skipReason)));
  assert.ok(!out[0].skipReason && !out[1].skipReason && !out[3].skipReason, "a component was dropped");
});

t("a grid subtotal that closes a named group is found by the name", () => {
  const out = SECT.gridStructRows(gridRows([
    ["Payroll Expenses", 100],
    ["Employer taxes", 25],
    ["Benefits", 75],
    ["Total Payroll Expenses", 200],
  ]));
  assert.ok(/listed under "Payroll Expenses"/.test(out[3].skipReason || ""), out[3].skipReason);
});

t("a total word with no arithmetic behind it stays data", () => {
  const out = SECT.gridStructRows(gridRows([["Supplies", 10], ["Total Supplies", 999]]));
  assert.ok(!out[1].skipReason, "a figure that totals nothing was dropped anyway");
});

t("the grid pass is the same code in both trees", () => {
  const rows = gridRows(QB_GRID);
  const a = SECT.gridStructRows(rows).map((r) => !!r.skipReason);
  const b = M.EN9gridStructRows(rows.map((r) => ({ ...r }))).map((r) => !!r.EN9skip);
  assert.deepStrictEqual(b, a);
});

t("the rows a subtotal was proven to add are marked", () => {
  const out = SECT.gridStructRows(gridRows(QB_GRID));
  assert.strictEqual(out[0].inTotal, true);
  assert.strictEqual(out[1].inTotal, true);
  assert.strictEqual(out[2].inTotal, undefined, "the subtotal itself is not inside itself");
});

/* ---- 3. the bank-accounts group ---- */

t('"Bank Accounts" is a section of its own, and its members are cash', () => {
  assert.ok(SECT.isBannerLabel("Bank Accounts"));
  for (const caption of ["Sales", "Property", "Merchant Account", "Checking", "Savings", "Undeposited Funds"]) {
    assert.strictEqual(SECT.sectionRoute("cash", caption), "BS:10", `src: ${caption}`);
    assert.strictEqual(M.EN9sectionRoute("cash", caption), "BS:10", `dist: ${caption}`);
  }
});

t('a bank sub-account called "Sales" cannot take the income line', () => {
  // The keyword scan says IS:7. The heading says cash, and the heading wins.
  assert.strictEqual(ENG.matchRule("Sales", RULES), "IS:7");
  assert.strictEqual(SECT.sectionOk("cash", "IS:7"), false);
  assert.strictEqual(M.EN9sectionOk("cash", "IS:7"), false);
  assert.strictEqual(SECT.sectionOk("cash", "BS:10"), true);
});

t('"Sales" on an actual income statement is still gross receipts', () => {
  assert.strictEqual(SECT.sectionOk("income", "IS:7"), true);
  assert.strictEqual(SECT.sectionRoute("income", "Sales"), "IS:7");
});

t("merchant accounts and undeposited funds reach cash without a heading", () => {
  for (const caption of ["Merchant Account", "Undeposited Funds", "Petty cash"]) {
    assert.strictEqual(ENG.matchRule(caption, RULES), "BS:10", `src: ${caption}`);
    assert.strictEqual(M.Tv(caption, M.P1), "BS:10", `dist: ${caption}`);
  }
});

/* ---- 4. cost of sales never reaches income ---- */

t("the carriage and payment-processor captions are line 2", () => {
  for (const caption of [
    "Freight", "Freight and delivery", "Shipping and delivery expense",
    "Shopify fees", "PayPal fees", "Payment processing fees", "Merchant fees",
  ]) {
    assert.strictEqual(ENG.matchRule(caption, RULES), "IS:12", `src: ${caption}`);
    assert.strictEqual(M.Tv(caption, M.P1), "IS:12", `dist: ${caption}`);
  }
});

t("a caption under cost of sales can never take an income line", () => {
  assert.ok(SECT.isBannerLabel("Cost of Sales"));
  for (const target of ["IS:7", "IS:14", "IS:15", "IS:16", "IS:17", "IS:22", "IS:OI"]) {
    assert.strictEqual(SECT.sectionOk("cogs", target), false, `src: ${target}`);
    assert.strictEqual(M.EN9sectionOk("cogs", target), false, `dist: ${target}`);
  }
  // The cost lines themselves, contra-revenue and the deductions still pass.
  for (const target of ["IS:10", "IS:11", "IS:12", "IS:8", "IS:26", "IS:OD"]) {
    assert.strictEqual(SECT.sectionOk("cogs", target), true, `src: ${target}`);
    assert.strictEqual(M.EN9sectionOk("cogs", target), true, `dist: ${target}`);
  }
  // And it is still an income-statement section: no balance-sheet line.
  assert.strictEqual(SECT.sectionOk("cogs", "BS:10"), false);
});

t("an unrecognised caption under cost of sales lands on a cost line", () => {
  const cases = [["Contract labour", "IS:10"], ["Raw materials", "IS:11"], ["Something unseen", "IS:12"]];
  for (const [caption, target] of cases) {
    assert.strictEqual(SECT.sectionRoute("cogs", caption), target, `src: ${caption}`);
    assert.strictEqual(M.EN9sectionRoute("cogs", caption), target, `dist: ${caption}`);
  }
});

/* ---- 5. equity is equity, not a current liability ---- */

t("owner contributions are paid-in surplus, draws are retained earnings", () => {
  const cases = [
    ["Owner Investments", "BS:60"], ["Opening Balance Equity", "BS:60"],
    ["Member Capital", "BS:60"], ["Capital contribution", "BS:60"],
    ["Owner Draws", "BS:61"], ["Owners Draw", "BS:61"],
    ["Shareholder distributions", "BS:61"], ["Partner distributions", "BS:61"],
  ];
  for (const [caption, target] of cases) {
    assert.strictEqual(ENG.matchRule(caption, RULES), target, `src: ${caption}`);
    assert.strictEqual(M.Tv(caption, M.P1), target, `dist: ${caption}`);
  }
});

t("none of them can reach the other-current-liability pool", () => {
  for (const caption of ["Owner Investments", "Owner Draws", "Opening Balance Equity", "Member Capital"]) {
    const target = ENG.matchRule(caption, RULES);
    assert.notStrictEqual(target, "BS:OCL", caption);
    assert.ok(SECT.sectionOk("liabilities", target), `${caption} must still sit on the liabilities side`);
  }
});

t("a genuine unnamed liability still falls to the other-current pool", () => {
  assert.strictEqual(SECT.sectionRoute("liabilities", "Something unseen"), "BS:OCL");
  assert.strictEqual(M.EN9sectionRoute("liabilities", "Something unseen"), "BS:OCL");
});

/* ---- 6. the two deduction moves ---- */

t("taxes and licenses reach line 16, income tax still reaches 21a", () => {
  for (const caption of ["Taxes and Licenses", "Licenses and permits", "Business license"]) {
    assert.strictEqual(ENG.matchRule(caption, RULES), "IS:32", `src: ${caption}`);
    assert.strictEqual(M.Tv(caption, M.P1), "IS:32", `dist: ${caption}`);
  }
  assert.strictEqual(ENG.matchRule("Income tax expense", RULES), "IS:54");
});

t("payroll is line 17; wages and salaries keep line 11", () => {
  for (const caption of ["Payroll Expenses", "Payroll costs"]) {
    assert.strictEqual(ENG.matchRule(caption, RULES), "IS:OD", `src: ${caption}`);
    assert.strictEqual(M.Tv(caption, M.P1), "IS:OD", `dist: ${caption}`);
  }
  for (const caption of ["Wages", "Salaries", "Staff costs"]) {
    assert.strictEqual(ENG.matchRule(caption, RULES), "IS:26", `src: ${caption}`);
    assert.strictEqual(M.Tv(caption, M.P1), "IS:26", `dist: ${caption}`);
  }
  // The banner fallback agrees with the catalogue on both counts.
  assert.strictEqual(SECT.sectionRoute("costs", "Wage expenses"), "IS:26");
  assert.strictEqual(SECT.sectionRoute("costs", "Payroll Expenses"), "IS:OD");
  assert.strictEqual(M.EN9sectionRoute("costs", "Payroll Expenses"), "IS:OD");
});

/* ---- 7. contra-revenue and its sign ---- */

t("discounts, returns and allowances are line 1b", () => {
  for (const caption of [
    "Discounts given", "Sales discounts", "Sales returns",
    "Returns and allowances", "Customer refunds",
  ]) {
    assert.strictEqual(ENG.matchRule(caption, RULES), "IS:8", `src: ${caption}`);
    assert.strictEqual(M.Tv(caption, M.P1), "IS:8", `dist: ${caption}`);
  }
});

t("the sign is reversed only where the statement added the caption itself", () => {
  // Inside a proven income total: the statement adds it, so line 1b — which
  // is subtracted — carries it negated and gross income does not move.
  assert.strictEqual(SECT.contraRevenueFlip("IS:8", true), true);
  assert.strictEqual(M.EN9contraFlip("IS:8", true), true);
  // The "Gross sales / Less returns / Net sales" layout: the total does NOT
  // add the returns line, so the printed figure is already right way round.
  assert.strictEqual(SECT.contraRevenueFlip("IS:8", false), false);
  assert.strictEqual(M.EN9contraFlip("IS:8", false), false);
  // Nothing else is ever flipped.
  assert.strictEqual(SECT.contraRevenueFlip("IS:7", true), false);
  assert.strictEqual(M.EN9contraFlip("IS:7", true), false);
});

(async () => {
  M = await DIST.boot();
  for (const [name, fn] of tests) {
    try { fn(); console.log("ok:", name); pass++; }
    catch (e) { console.log("FAILED:", name, "-", e.message); fail++; }
  }
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  process.exit(0);
})();
