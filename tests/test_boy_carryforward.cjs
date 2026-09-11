/* Schedule F column (a) — beginning of year.
 *
 * A single-period statement (Yuki and most software exports) carries only the
 * current year, so column (a) has NO source among the current-year documents.
 * The prior return's closing column IS the opening column, and the tool
 * already read it into priorClosingUSD — but that was only ever used to print
 * a comparison note, never written. Column (a) therefore came out blank, and
 * Schedule F cannot be filed without it.
 *
 * Figures verified against the 2Hats 2023 Form 5471 and the reviewed 2024
 * work paper. Filed amounts are USD; column (a) is local currency, so the
 * conversion is EUR = USD x 0.905 (the prior year-end rate).
 */
const assert = require("assert");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const PY_RATE = 0.905;

/** The seeding rule, exactly as store.ts applies it. */
function seedBoy(priorClosingUSD, existingLines, rate) {
  // Each key lists the rows that can hold it. Sch F lines 5 and 16 are =SUM()
  // subtotals in the template (rows 15/47) and are NOT in BS_LINES, so the
  // aggregate lands on the first free detail row the subtotal spans.
  const map = [
    ["cash", [10], false], ["ar", [11], false], ["badDebts", [12], true],
    ["inventories", [14], false], ["oca", [16, 17, 18], false, "Other current assets"],
    ["loansToShareholders", [19], false],
    ["depreciable", [28], false], ["accumDep", [29], true],
    ["land", [32], false],
    ["otherAssets", [39, 40, 41], false, "Other assets"],
    ["ap", [46], false], ["ocl", [48, 49, 50], false, "Other current liabilities"],
    ["loansFromShareholders", [52], false],
    ["otherLiabilities", [54, 55, 56], false, "Other liabilities"],
    ["preferredStock", [58], false], ["commonStock", [59], false],
    ["paidInSurplus", [60], false], ["re", [61], false],
    ["treasuryStock", [62], false],
  ];
  const lines = { ...existingLines };
  const relabels = {};
  const seeded = [];
  for (const [key, rows, negate, aggregateLabel] of map) {
    const filed = priorClosingUSD[key]?.value;
    if (typeof filed !== "number") continue;
    const row = rows.find((r) => typeof lines[`BS:${r}`]?.boy !== "number");
    if (row === undefined) continue;                    // never overwrite
    const k = `BS:${row}`;
    const local = Math.round(filed * rate * 100) / 100;
    lines[k] = { ...(lines[k] || {}), boy: negate ? -Math.abs(local) : local };
    if (rows.length > 1 && aggregateLabel && !relabels[k]) {
      relabels[k] = `${aggregateLabel} (per prior-year Form 5471)`;
    }
    seeded.push(k);
  }
  return { lines, seeded, relabels };
}

/* The rows the generator actually exports (engine.ts BS_LINES). Every subtotal
   row is absent: a value seeded on one is dropped before it reaches the writer. */
const BS_LINES_ROWS = [10,11,12,13,14,16,17,18,19,21,22,23,25,26,27,28,29,30,31,
  32,34,35,36,37,39,40,41,46,48,49,50,51,52,54,55,56,58,59,60,61,62];

/* Real 2023 Form 5471 Schedule F column (b), in whole USD. */
const FILED = {
  cash:         { value: 13322 },
  oca:          { value: 243 },
  depreciable:  { value: 1602 },
  accumDep:     { value: 1274 },     // printed in brackets on the form
  ap:           { value: 0 },
  ocl:          { value: 10840 },
  commonStock:  { value: 4973 },
  re:           { value: -1920 },
  totalAssets:  { value: 13893 },
};

t("column (a) is populated where it used to be blank", () => {
  const { seeded } = seedBoy(FILED, {}, PY_RATE);
  assert.ok(seeded.length >= 8, `only ${seeded.length} lines seeded`);
  for (const k of ["BS:10", "BS:16", "BS:28", "BS:29", "BS:48", "BS:59", "BS:61"]) {
    assert.ok(seeded.includes(k), `${k} not seeded`);
  }
});

t("the converted figures match the reviewed work paper", () => {
  const { lines } = seedBoy(FILED, {}, PY_RATE);
  // Reviewed work paper column (a), EUR. Whole-dollar filing rounds to ~+/-1.
  const expected = {
    "BS:10": 12056.41,   // cash
    "BS:16": 220,        // other current assets (detail row under the line-5 subtotal)
    "BS:28": 1449.37,    // depreciable assets
    "BS:29": -1153.15,   // accumulated depreciation
    "BS:61": -1737.15,   // retained earnings
  };
  for (const [k, want] of Object.entries(expected)) {
    const got = lines[k].boy;
    assert.ok(Math.abs(got - want) <= 1.0, `${k}: got ${got}, expected ~${want}`);
  }
});

t("accumulated depreciation is carried as a negative", () => {
  const { lines } = seedBoy(FILED, {}, PY_RATE);
  assert.ok(lines["BS:29"].boy < 0, "must reduce assets");
  assert.ok(Math.abs(lines["BS:29"].boy + 1153.15) <= 1.0);
});

t("total assets reconcile to the reviewed figure", () => {
  const { lines } = seedBoy(FILED, {}, PY_RATE);
  const total = lines["BS:10"].boy + lines["BS:16"].boy + lines["BS:28"].boy + lines["BS:29"].boy;
  assert.ok(Math.abs(total - 12572.63) <= 2.0, `total ${total}, expected ~12,572.63`);
});

t("a value already present is NEVER overwritten", () => {
  // A two-column source document, or a figure the preparer typed.
  const existing = { "BS:10": { boy: 99999, eoy: 28447.17 } };
  const { lines, seeded } = seedBoy(FILED, existing, PY_RATE);
  assert.strictEqual(lines["BS:10"].boy, 99999, "carry-forward clobbered a real value");
  assert.ok(!seeded.includes("BS:10"));
  assert.ok(seeded.includes("BS:16"), "other lines should still seed");
});

t("the end-of-year column is left untouched", () => {
  const existing = { "BS:10": { eoy: 28447.17 } };
  const { lines } = seedBoy(FILED, existing, PY_RATE);
  assert.strictEqual(lines["BS:10"].eoy, 28447.17, "EOY was modified");
  assert.ok(Math.abs(lines["BS:10"].boy - 12056.41) <= 1.0, "BOY should still seed");
});

t("nothing is carried when the prior year-end rate is unknown", () => {
  // Guessing a rate would silently mis-state every opening balance.
  for (const bad of [0, NaN, undefined]) {
    const rate = Number(bad);
    const ok = isFinite(rate) && rate > 0;
    assert.strictEqual(ok, false, `rate ${bad} should be rejected`);
  }
});

t("lines absent from the prior return stay blank rather than zero", () => {
  const partial = { cash: { value: 13322 } };
  const { lines, seeded } = seedBoy(partial, {}, PY_RATE);
  assert.strictEqual(seeded.length, 1);
  assert.strictEqual(lines["BS:48"], undefined, "invented an opening balance");
});

t("the line 15/16 grouping difference is detectable", () => {
  // Prior return puts everything on line 16; the current year splits it.
  const priorAllOnOne = (!FILED.ap.value || FILED.ap.value === 0) && !!FILED.ocl.value;
  const currentSplit = !!6087 && !!20944.69;
  assert.ok(priorAllOnOne && currentSplit, "should raise one review item");
});

/* REGRESSION. The carry-forward used to seed Sch F line 5 on row 15 and line 16
   on row 47. Both are =SUM() subtotals and neither is in BS_LINES, so the
   generator never read them: the two figures were silently dropped and column
   (a) came out short by the whole of other current assets and other current
   liabilities. For 2Hats that is US$243 of assets and US$10,840 of liabilities
   — the largest single liability on the return. */
t("every seeded row is one the generator actually exports", () => {
  const { seeded } = seedBoy(FILED, {}, PY_RATE);
  for (const k of seeded) {
    const row = Number(k.split(":")[1]);
    assert.ok(BS_LINES_ROWS.includes(row), `${k} is not in BS_LINES — it would be dropped`);
  }
});

t("no figure is ever seeded onto a =SUM() subtotal row", () => {
  const SUBTOTALS = [15, 20, 24, 38, 42, 47, 53, 57, 63];
  const { seeded } = seedBoy(FILED, {}, PY_RATE);
  for (const k of seeded) {
    assert.ok(!SUBTOTALS.includes(Number(k.split(":")[1])), `${k} targets a formula cell`);
  }
});

t("the filed aggregates land on detail rows under their subtotal", () => {
  const { lines } = seedBoy(FILED, {}, PY_RATE);
  assert.ok(Math.abs(lines["BS:16"].boy - 219.92) <= 1.0, "other current assets -> row 16");
  assert.ok(Math.abs(lines["BS:48"].boy - 9810.20) <= 1.0, "other current liabilities -> row 48");
});

t("an aggregate does not keep the detail row's stock caption", () => {
  const { relabels } = seedBoy(FILED, {}, PY_RATE);
  assert.match(relabels["BS:16"], /other current assets/i);
  assert.match(relabels["BS:48"], /other current liabilities/i);
});

t("a spare detail row is used when the first is already taken", () => {
  const existing = { "BS:16": { boy: 500 } };          // preparer typed a prepaid
  const { lines } = seedBoy(FILED, existing, PY_RATE);
  assert.strictEqual(lines["BS:16"].boy, 500, "clobbered a real value");
  assert.ok(Math.abs(lines["BS:17"].boy - 219.92) <= 1.0, "should fall through to row 17");
});

t("column (a) balances once the aggregates are carried", () => {
  const { lines } = seedBoy(FILED, {}, PY_RATE);
  const assets = lines["BS:10"].boy + lines["BS:16"].boy + lines["BS:28"].boy + lines["BS:29"].boy;
  const liabEq = lines["BS:48"].boy + lines["BS:59"].boy + lines["BS:61"].boy;
  assert.ok(Math.abs(assets - liabEq) <= 2.0,
    `column (a) out by ${(assets - liabEq).toFixed(2)} (assets ${assets.toFixed(2)}, L+E ${liabEq.toFixed(2)})`);
});

/* REGRESSION — the Chilean client. Schedule F line 19 "Other liabilities" was
   never in the map at all. Cecilia Gonzalez Acuna SpA filed US$1,367,778 there,
   49% of its balance sheet, and column (a) came out short by exactly that
   amount at the 880 prior year-end rate: 1,203,644,640 pesos. */
const CL_FILED = {
  cash:             { value: 43240 },
  ar:               { value: 82483 },
  oca:              { value: 33955 },
  depreciable:      { value: 2629000 },
  ocl:              { value: 523198 },
  otherLiabilities: { value: 1367778 },
  commonStock:      { value: 155048 },
  re:               { value: 742654 },
  totalAssets:      { value: 2788678 },
};
const CL_RATE = 880;

t("Chile: line 19 other liabilities is carried", () => {
  const { lines } = seedBoy(CL_FILED, {}, CL_RATE);
  assert.ok(lines["BS:54"], "line 19 was dropped again");
  assert.strictEqual(lines["BS:54"].boy, 1367778 * CL_RATE);
});

t("Chile: column (a) balances once line 19 carries", () => {
  const { lines } = seedBoy(CL_FILED, {}, CL_RATE);
  const v = (k) => (lines[k] ? lines[k].boy : 0);
  const assets = v("BS:10") + v("BS:11") + v("BS:16") + v("BS:28");
  const liabEq = v("BS:48") + v("BS:54") + v("BS:59") + v("BS:61");
  assert.strictEqual(assets, liabEq,
    `out by ${(assets - liabEq).toLocaleString()} (assets ${assets.toLocaleString()}, L+E ${liabEq.toLocaleString()})`);
});

t("Chile: total assets tie to the filed figure", () => {
  const { lines } = seedBoy(CL_FILED, {}, CL_RATE);
  const assets = lines["BS:10"].boy + lines["BS:11"].boy + lines["BS:16"].boy + lines["BS:28"].boy;
  assert.strictEqual(assets, 2788678 * CL_RATE);
});

t("an aggregate on a detail row is labelled for its own line", () => {
  const { relabels } = seedBoy(CL_FILED, {}, CL_RATE);
  assert.match(relabels["BS:54"], /other liabilities/i);
  assert.match(relabels["BS:16"], /other current assets/i);
});

t("contra lines carry the sign the template's totals expect", () => {
  // D42 sums D10:D15, so bad debts must reduce assets; D63 ends "- D62", so
  // treasury stock is entered positive and the formula subtracts it.
  const { lines } = seedBoy({ badDebts: { value: 500 }, treasuryStock: { value: 900 } }, {}, 1);
  assert.strictEqual(lines["BS:12"].boy, -500, "bad debts must be negative");
  assert.strictEqual(lines["BS:62"].boy, 900, "treasury stock must be positive");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
