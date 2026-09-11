/* Year-detection hardening tests (CHANGE 2).
   Pins the EN9 header/ruler detectors and the q1 ruler-inheritance path.
   Also enforces that the snapshot sources (this suite's and vf_test_src.js)
   are still byte-identical to dist/index.html — hand-patches must be mirrored. */
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
const src = require("./detect_test_src.cjs");

let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- 0. snapshot sync guards ---------------------------------------------
src.distChunks.forEach((c, i) => a(dist.includes(c), `snapshot chunk ${i} is byte-identical to dist`));
fs.readFileSync(path.join(__dirname, "vf_test_src.js"), "utf8").split("\n").map(l => l.trim()).filter(Boolean)
  .forEach((l, i) => a(dist.includes(l), `vf_test_src.js line ${i + 1} is byte-identical to dist (vF untouched)`));
a(dist.includes("EN9-boy-gap-"), "boy-gap review item present in dist");
a(dist.includes("inheritRulerFrom:EN9_INH("), "ruler inheritance wired at the call sites");

// --- eval the shipped code ------------------------------------------------
eval(src.local + src.distChunks.join(";"));

// --- 1. EN9_HY accept/refuse table ---------------------------------------
const HY_OK = [["2024", 2024], ["31 Dec 2024", 2024], ["31.12.2024", 2024], ["December 31, 2024", 2024],
  ["Year ended 30 June 2024", 2024], ["As at 30/06/2024", 2024], ["FY2024", 2024], ["FY24", 2024],
  ["2024 $", 2024], ["$'000 2024", 2024]];
const HY_NO = ["(2024)", "2024.00", "2,024", "2 024", "1,982,024", "Total 2024", "Restated 2023",
  "Notes 2024", "20240630", "2023-2024", "FY99", "", "profit in 2024 rose strongly versus last year"];
for (const [inp, exp] of HY_OK) a(EN9_HY(inp) === exp, `EN9_HY accepts "${inp}" -> ${exp}`);
for (const inp of HY_NO) a(EN9_HY(inp) === null, `EN9_HY refuses "${inp}"`);

// --- 2. oJ (grid header detector) ----------------------------------------
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const sparse = (obj) => { const r = []; for (const k in obj) r[k] = obj[k]; return r; };
a(eq(oJ([["Account", "31 Dec 2024", "31 Dec 2023"]]), sparse({ 1: 2024, 2: 2023 })), "oJ: date-style headers");
a(eq(oJ([["As at 31 Dec 2024"], ["Account", "2024", "2023"]]), sparse({ 1: 2024, 2: 2023 })),
  "oJ: spanning title row does not mask the real header below (>=2 rule)");
a(eq(oJ([["Account", "FY24", "FY23"]]), sparse({ 1: 2024, 2: 2023 })), "oJ: FY-style headers");
a(eq(oJ([["Account", "Current year", "Prior year"]]), sparse({ 1: -1, 2: -2 })), "oJ: word labels emit sentinels");
a(oJ([["Account", "Current year"]]) === null, "oJ: single word synonym refused (both required)");
a(eq(oJ([["", "2024", "2023"]]), sparse({ 1: 2024, 2: 2023 })), "oJ: legacy bare-year row unchanged");
a(eq(oJ([["x", "2024"]]), sparse({ 1: 2024 })), "oJ: legacy single bare year unchanged");
a(oJ([["Adjustment", "(2024)"]]) === null, "oJ: negative-marker cell cannot mint a header");
a(oJ([["Sales", "1500", "2024"]]) === null, "oJ: numeric neighbour cell blocks the row (legacy guard)");

// --- 3. e8 (PDF ruler detector) + EN9_RSV --------------------------------
const row = (page, y, cells) => ({ page, y, cells });
const cell = (text, x0, x1) => ({ text, x0, x1 });
let r1 = e8({ rows: [row(1, 700, [cell("31 Dec 2024", 300, 360), cell("31 Dec 2023", 420, 480)])] });
a(r1.length === 1 && eq(r1[0].cols.map(c => c.year), [2024, 2023]), "e8: two date-style cells make a ruler");
a(r1[0].cols[0].x0 === 300 && r1[0].cols[1].x1 === 480, "e8: ruler keeps the cells' x-ranges");
a(e8({ rows: [row(1, 700, [cell("Year ended 30 June 2024", 100, 500)])] }).length === 0,
  "e8: single extended cell (title line) makes NO ruler (>=2 rule)");
a(e8({ rows: [row(1, 700, [cell("Adjustment", 10, 80), cell("(2024)", 400, 460)])] }).length === 0,
  "e8: data row with bracketed number makes no ruler");
a(e8({ rows: [row(1, 700, [cell("2024", 300, 340), cell("2023", 420, 460)])] }).length === 1,
  "e8: legacy bare-year ruler unchanged");
let rw = e8({ rows: [row(1, 700, [cell("Current Year", 300, 380), cell("Prior Year", 420, 500)])] });
a(rw.length === 1 && eq(rw[0].cols.map(c => c.year), [-1, -2]), "e8: word ruler emits sentinels");
a(eq(EN9_RSV(rw, { cy: 2024, py: 2023 })[0].cols.map(c => c.year), [2024, 2023]),
  "EN9_RSV resolves sentinels from the case-year context");
a(EN9_RSV(rw, { cy: null, py: null }).length === 0, "EN9_RSV drops word rulers with no case year (no guessing)");
a(eq(EN9_RSV(rw, { cy: 2024, py: null })[0].cols.map(c => c.year), [2024, 2023]),
  "EN9_RSV falls back to cy-1 when py missing");

// --- 4. EN9_INH + q1 inheritance end-to-end ------------------------------
const ruler5 = e8({ rows: [row(5, 750, [cell("2024", 300, 350), cell("2023", 420, 470)])] });
a(eq([...EN9_INH(ruler5, new Set([5, 6, 7, 8, 9])).entries()], [[6, 5], [7, 5], [8, 5]]),
  "EN9_INH maps pages 6-8 to page 5, excludes page 9 (gap > 3)");
const doc = {
  rows: [
    row(5, 750, [cell("2024", 300, 350), cell("2023", 420, 470)]),
    row(5, 700, [cell("Cash", 10, 80), cell("11,783", 290, 340), cell("9,500", 415, 465)]),
    row(6, 700, [cell("Receivables", 10, 100), cell("5,000", 291, 341), cell("4,000", 416, 466)]),
  ],
};
const rulers = e8(doc);
const rows56 = q1(doc, rulers, { pages: new Set([5, 6]), raw: !0, inheritRulerFrom: EN9_INH(rulers, new Set([5, 6])) });
const p6 = rows56.find(r => r.page === 6);
a(p6 && eq(p6.years, [2024, 2023]), "q1: ruler-less page 6 inherits page-5 ruler (years tagged)");
const p5 = rows56.find(r => r.page === 5 && r.label === "Cash");
a(p5 && eq(p5.years, [2024, 2023]), "q1: page-5 row still tagged by its own ruler");
const rows59 = q1(doc, rulers, { pages: new Set([5, 9]), raw: !0, inheritRulerFrom: EN9_INH(rulers, new Set([5, 9])) });
a(rows59.every(r => r.page !== 9), "q1: page 9 (gap 4) gets no inherited ruler and yields no tagged rows here");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL YEAR-DETECTION TESTS PASSED");
