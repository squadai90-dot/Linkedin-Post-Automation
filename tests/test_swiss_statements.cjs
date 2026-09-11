/* A Swiss client's accounts — Athletic Prime Sàrl, Geneva, CHF.
 *
 * The tool read ZERO lines from them. Four separate defects, each of which
 * alone was enough to empty the work paper:
 *
 *  1. The page classifier only looked at a statement's TITLE if the page also
 *     carried a company registration number or a "Page n of m" footer. Small
 *     practices print neither — these accounts carry the company name, its
 *     address and "BILAN AU 31 DECEMBRE 2024" — so the title was never read
 *     and every page classified as "unknown", feeding nothing.
 *  2. The column header "2024 CHF" was not recognised as a year. The header
 *     parser stripped a hard-coded list of ten currency codes; CHF was not
 *     among them, nor SEK, CLP, THB or a hundred others. With no year on the
 *     columns, every row had two unlabelled numbers and was refused as
 *     ambiguous.
 *  3. All three rate tables called the Swiss franc CHE — which is the WIR
 *     Euro, a different currency. The rates stored under it are genuine Swiss
 *     franc rates, so nothing was wrong with the numbers, only the label; but
 *     an entity whose functional currency reads CHF found no rate at all.
 *  4. Statement subtotals were booked as line items: "Operating profit",
 *     "Net financial income" and "Profit before tax" became three deductions,
 *     and "Total revenue" was added to the revenue line it totals, so revenue
 *     came out at exactly twice the figure on the page.
 *
 * Figures below are the client's, checked against the signed French original.
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const ENG = load("src/prototype/wp/engine.ts");
const CL = load("src/prototype/wp/classify.ts");
const FX = load("src/prototype/wp/fxRates.ts");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const C = (text, x0, x1) => ({ text, x0, x1 });
const R = (page, y, ...cells) => ({ page, y, cells });

/* The statement as the reader hands it over: a name-and-address block, a
   title, then label/amount rows. No registration number anywhere. */
const SWISS = { pageCount: 1, rows: [
  R(1, 579, C("ATHLETIC PRIME SARL", 68, 184)),
  R(1, 563, C("11A chemin des Bruchons", 68, 193)),
  R(1, 548, C("1255 Veyrier", 68, 129)),
  R(1, 514, C("BALANCE SHEET AS OF DECEMBER 31, 2024", 68, 329)),
  R(1, 462, C("ASSETS", 228, 261), C("2024 CHF", 322, 362), C("2023 CHF", 383, 423)),
  R(1, 418, C("Banks", 188, 212), C("0.00", 321, 339), C("72.45", 383, 405)),
  R(1, 329, C("Due from partner", 188, 255), C("26,027.29", 321, 361), C("35,305.59", 383, 424)),
  R(1, 285, C("Total current assets", 188, 266), C("26,027.29", 321, 361), C("35,378.04", 383, 423)),
  R(1, 241, C("Rent guarantee", 188, 248), C("0.00", 321, 339), C("0.00", 383, 401)),
  R(1, 174, C("Total assets", 188, 236), C("26,027.29", 321, 361), C("35,378.04", 383, 423)),
  R(1, 108, C("Bank", 188, 207), C("7.03", 321, 338), C("7.03", 383, 399)),
  R(1, 64, C("Accrued liabilities", 188, 258), C("1,300.00", 321, 355), C("1,300.00", 383, 417)),
]};

t("a statement with no registration number and no page footer is still a statement", () => {
  const kinds = CL.classifyPages(SWISS).map((p) => p.kind);
  assert.deepStrictEqual(kinds, ["fs-balance-sheet"], `got ${JSON.stringify(kinds)}`);
});

t("prose ABOUT a balance sheet is not one", () => {
  const chat = { pageCount: 1, rows: [
    R(1, 620, C("Here is the translation to English, which includes the balance sheet and income statement", 68, 518)),
    R(1, 600, C("Let me know if you need anything else.", 68, 300)),
  ]};
  assert.strictEqual(CL.classifyPages(chat)[0].kind, "unknown");
});

t("a title with no rows of figures beneath it is not a statement either", () => {
  const titleOnly = { pageCount: 1, rows: [
    R(1, 514, C("BALANCE SHEET AS OF DECEMBER 31, 2024", 68, 329)),
    R(1, 480, C("The directors present their report for the year.", 68, 300)),
  ]};
  assert.strictEqual(CL.classifyPages(titleOnly)[0].kind, "unknown");
});

t("French and German statement titles are recognised", () => {
  for (const [title, want] of [
    ["BILAN AU 31 DECEMBRE 2024", "fs-balance-sheet"],
    ["COMPTE DE PROFITS ET PERTES", "fs-pnl"],
    ["ERFOLGSRECHNUNG 2024", "fs-pnl"],
  ]) {
    const doc = { pageCount: 1, rows: [R(1, 514, C(title, 68, 329)), ...SWISS.rows.slice(4)] };
    assert.strictEqual(CL.classifyPages(doc)[0].kind, want, title);
  }
});

/* ---------- the currency label on the rate tables ---------- */

t("the Swiss franc is CHF; CHE is a different currency entirely", () => {
  for (const table of ["FX_META", "IRS_AVERAGE", "TREASURY_SPOT"]) {
    assert.ok(FX[table]["CHF"], `${table} has no CHF`);
    assert.ok(!FX[table]["CHE"], `${table} still labels it CHE`);
  }
  assert.strictEqual(FX.FX_META["CHF"].country, "Switzerland");
});

t("the stored Swiss rates reproduce the prior year's filed US dollar figures", () => {
  // The client's 2023 accounts show CHF 35,378.04 of assets; the 2023 Form
  // 5471 filed US$42,217. That is the year-end rate doing its job.
  const rate = FX.TREASURY_SPOT["CHF"]["2023"];
  assert.strictEqual(Math.round(35378.04 / rate), 42217, `rate ${rate} does not reproduce the filing`);
});

/* ---------- subtotals ---------- */

const target = (label) => {
  const r = ENG.extractRows([[label, "1.00"]]);
  return r.length ? ENG.matchRule(r[0].label, ENG.DEFAULT_RULES) : "DROPPED";
};

t("a statement's own subtotals are never booked as line items", () => {
  for (const c of ["Total revenue", "Operating profit", "Profit before tax", "Net financial income",
                   "Total foreign capital", "Total fixed assets", "Total expenses", "Total assets"]) {
    assert.strictEqual(target(c), "SKIP", `${c} was booked`);
  }
});

t("the components those subtotals total still map", () => {
  const want = [
    ["Service revenue", "IS:7"], ["Interest income", "IS:15"], ["Rent", "IS:27"],
    ["Accounting fees", "IS:OD"], ["Insurance", "IS:OD"], ["Travel expenses", "IS:OD"],
    ["Advertising expenses", "IS:OD"], ["Bank charges", "IS:OD"],
    ["Cash", "BS:10"], ["Share capital", "BS:59"], ["Retained earnings", "BS:61"],
  ];
  const wrong = want.filter(([c, w]) => target(c) !== w).map(([c, w]) => `${c}: got ${target(c)}, want ${w}`);
  assert.deepStrictEqual(wrong, [], wrong.join(" | "));
});

t("the French names of those subtotals are refused too", () => {
  for (const c of ["Total des produits", "Total des charges", "Total du passif",
                   "Total des capitaux propres"]) {
    assert.strictEqual(target(c), "SKIP", c);
  }
});

/* ---------- the shipped bundle ---------- */

const DIST = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");

t("dist carries all four fixes, wired in", () => {
  assert.ok(DIST.includes("/*EN9SHAPE-BEGIN*/"), "shape-based classification missing");
  assert.ok(DIST.includes("||EN9looksStmt(t,e)){"), "shape rule defined but never consulted");
  assert.ok(DIST.includes("/*EN9CCYTOK-BEGIN*/") && DIST.includes(".replace(/\\b[A-Za-z]{3}\\b/g,EN9ccyTok)"),
    "the year header still strips a fixed currency list");
  assert.ok(DIST.includes("/*EN9SECT2-BEGIN*/"), "equity section banners missing");
  assert.ok(DIST.includes('CHF:{country:"Switzerland"'), "dist still labels the franc CHE");
  assert.ok(!/CHE:\{/.test(DIST), "a CHE entry survives in dist");
  assert.ok(DIST.includes('"operating profit"') && DIST.includes('"total revenue"'),
    "the subtotal keywords are missing from dist");
});

t("the shipped year-header parser reads any currency, not a list of ten", () => {
  const cut = (from) => {
    const i = DIST.indexOf(from);
    let d = 0, k = DIST.indexOf("{", i);
    for (;; k++) { if (DIST[k] === "{") d++; else if (DIST[k] === "}") d--; if (!d) break; }
    return DIST.slice(i, k + 1);
  };
  const start = DIST.indexOf("/*EN9CCYTOK-BEGIN*/");
  const seg = DIST.slice(start, DIST.indexOf("EN9_RSV=", start)).replace(/,\s*$/, "") + ";";
  const HY = new Function(
    `${cut("var Pa={AFN:")};${cut("function Ii(t){")};${/var Oa=t=>\{[\s\S]*?\}/.exec(DIST)[0]};${seg}return EN9_HY;`,
  )();
  for (const code of ["CHF", "USD", "SEK", "CLP", "THB", "ZAR"]) {
    assert.strictEqual(HY(`2024 ${code}`), 2024, `"2024 ${code}" not read as a year`);
  }
  // Still refuses text that merely contains a year.
  assert.strictEqual(HY("Total 2024"), null);
  assert.strictEqual(HY("2024 Notes"), null);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
