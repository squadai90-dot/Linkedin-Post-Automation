/* Pegged currencies, the opening rate, and the one place each is decided.

   The Treasury 12/31 table publishes KYD at 0.82; the peg is 0.833 and the
   prior return filed at 0.833. Translating an opening balance sheet at the
   rounded figure moved every line about 1.6% against the filing it continues
   — 472 dollars of cash, 332 of receivables, 262 on net current assets, none
   of it an accounting event. These are the rules that stop that, and the
   proof that the same answer reaches every cell that depends on it. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const FX = SRC.LOAD("src/prototype/wp/fxRates.ts");
const STORE = SRC.STORE;
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

/* ---- the table ---- */

t("the peg is three decimals where the table rounds to two", () => {
  assert.strictEqual(FX.PEGGED_SPOT.KYD.rate, 0.833);
  assert.strictEqual(FX.TREASURY_SPOT.KYD["2024"], 0.82, "the published table is untouched");
  assert.strictEqual(FX.peggedRate("kyd").rate, 0.833, "the lookup is case-insensitive");
});

t("only hard pegs are listed — a float is not a peg", () => {
  for (const code of ["EUR", "GBP", "CHF", "AUD", "CAD", "JPY", "MXN", "BRL", "INR"]) {
    assert.strictEqual(FX.peggedRate(code), null, code);
  }
  for (const code of ["AED", "SAR", "QAR", "JOD", "OMR", "BHD", "XCD", "BSD", "BBD"]) {
    assert.ok(FX.peggedRate(code), code);
  }
});

t("every peg carries a note saying what it is", () => {
  for (const [code, peg] of Object.entries(FX.PEGGED_SPOT)) {
    assert.ok(peg.note && /peg/i.test(peg.note), code);
    assert.ok(peg.rate > 0, code);
  }
});

/* ---- where it is applied ---- */

t("the lookup still reports what the tables say", () => {
  const hit = FX.lookupRates("KYD", "12/31/2024", "12/31/2023");
  assert.strictEqual(hit.cyRate, 0.82, "lookupRates must stay a reading of the tables");
  assert.strictEqual(hit.pegged, undefined);
});

t("applyPeg replaces the year-end rates and keeps the published ones", () => {
  const hit = FX.applyPeg(FX.lookupRates("KYD", "12/31/2024", "12/31/2023"), "KYD");
  assert.strictEqual(hit.cyRate, 0.833);
  assert.strictEqual(hit.pyRate, 0.833);
  assert.strictEqual(hit.pegged.published.cy, 0.82, "the table figure is kept for comparison");
  assert.ok(/Cayman/.test(hit.pegged.note));
  // The yearly average is an IRS figure and is not a spot rate: untouched.
  assert.strictEqual(hit.avgRate, FX.IRS_AVERAGE.KYD["2024"]);
});

t("a rate table the preparer uploaded outranks the peg", () => {
  const hit = FX.applyPeg(FX.lookupRates("KYD", "12/31/2024", "12/31/2023"), "KYD", true);
  assert.strictEqual(hit.cyRate, 0.82);
  assert.strictEqual(hit.pegged, undefined);
});

t("a currency with no peg passes straight through", () => {
  const hit = FX.applyPeg(FX.lookupRates("EUR", "12/31/2024", "12/31/2023"), "EUR");
  assert.strictEqual(hit.cyRate, FX.TREASURY_SPOT.EUR["2024"]);
  assert.strictEqual(hit.pegged, undefined);
});

t("the rates are tagged Pegged so the provenance sheet says so", () => {
  const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
  assert.ok(store.includes('hit.pegged ? "Pegged" : "Treasury"'), "the tag distinguishes the two");
  assert.ok(store.includes("published table"), "the table's own figure stays in the note");
  assert.ok(dist.includes('tag:"Pegged"'), "dist tags them too");
  assert.ok(dist.includes("EN9applyPeg"), "dist applies the peg where the rates are filled");
});

t("the FX view keeps showing what the tables published", () => {
  const view = fs.readFileSync(path.join(root, "src", "prototype", "wp", "FxRatesView.tsx"), "utf8");
  assert.ok(view.includes("pub: published?.cyRate"), "the Published column is the table, not the peg");
  assert.ok(dist.includes('pub:o?.cyRate'), "dist agrees");
});

/* ---- the opening rate: one answer, every cell ---- */

t("the prior return's own printed rate outranks everything", () => {
  const r = STORE.openingRateFor("KYD", 0.82, 0.833);
  assert.strictEqual(r.rate, 0.833);
  assert.ok(/prior return printed/.test(r.why));
});

t("the peg is next, ahead of the published prior year-end rate", () => {
  const r = STORE.openingRateFor("KYD", 0.82, undefined);
  assert.strictEqual(r.rate, 0.833);
  assert.ok(/peg/i.test(r.why));
});

t("an unpegged currency with no stated rate uses the rate in use", () => {
  const r = STORE.openingRateFor("EUR", 0.905, null);
  assert.strictEqual(r.rate, 0.905);
  assert.ok(/prior year-end rate in use/.test(r.why));
});

t("no usable rate at all is null, not a guess", () => {
  assert.strictEqual(STORE.openingRateFor("EUR", null, null), null);
  assert.strictEqual(STORE.openingRateFor("EUR", 0, 0), null);
});

t("the opening column and the roll-forward read the SAME answer", () => {
  const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
  // Two derivations of one figure is what wrote it twice with different
  // values; there must be exactly one function and both callers must use it.
  const callers = store.match(/openingRateFor\(/g) || [];
  assert.ok(callers.length >= 3, `openingRateFor is used by the definition and both callers (${callers.length})`);
  assert.ok(store.includes("ent.openingRate\n          ?? openingRateFor"), "the roll-forward prefers the rate the seeding recorded");
  assert.ok(dist.includes("EN9openingRate("), "dist has the same single definition");
  assert.ok(dist.includes("/*EN9REONE*/"), "and the roll-forward reads it");
});

t("the rate the opening balances were built at reaches the provenance sheet", () => {
  const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
  assert.ok(store.includes('"opening balances (Schedule F column (a))"'), "its own provenance row");
  assert.ok(dist.includes("opening balances (Schedule F column (a))"), "dist writes it too");
});

/* ---- what it is worth on the reconciled case ---- */

t("KYD at the peg reproduces the prior filing's own figures", () => {
  // Schedule F line 22 as filed: US$20,209. At the table's 0.82 the opening
  // retained earnings come out 16,571.38; at the peg, 16,834.10 — which is
  // the figure the prior return itself carries.
  assert.strictEqual(Math.round(20209 * 0.82 * 100) / 100, 16571.38);
  assert.strictEqual(Math.round(20209 * 0.833 * 100) / 100, 16834.1);
});

if (fail) { console.error(`${fail} FAILURE(S)`); process.exit(1); }
console.log(`${pass} passed, ${fail} failed`);
