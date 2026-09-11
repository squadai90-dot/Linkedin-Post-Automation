/* Statement structure: banners, structural subtotals, re-feeding.
 *
 * The shipped implementation lives in dist behind the EN9STRUCT sentinels.
 * This runs it and the src port over the same rows and demands identical
 * answers -- equivalence, not merely that the new code works.
 *
 * The fixture is the shape that produced the bugs: a page holding the tail of
 * a P&L and the head of a balance sheet, with the client's own subtotals
 * printed, a running page footer, and "Interest" appearing under two
 * different banners.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const SRC = load("src/prototype/wp/sections.ts");
const ENG = load("src/prototype/wp/engine.ts");

/* ---- the shipped implementation, lifted out of dist ---- */

const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const SHIPPED = (() => {
  const b = dist.indexOf("/*EN9STRUCT-BEGIN*/"), e = dist.indexOf("/*EN9STRUCT-END*/");
  assert.ok(b > 0 && e > b, "EN9STRUCT sentinels present in dist");
  let block = dist.slice(b + "/*EN9STRUCT-BEGIN*/".length, e);
  // The region also carries the tie-out and Schedule E helpers, which close
  // over app internals this test has no business constructing. Only the
  // section/structure half is under test; cut the rest off at its sentinel.
  const tieEnd = block.indexOf("/*EN9TIE-END*/");
  assert.ok(tieEnd > 0, "EN9TIE-END marks where the structure helpers begin");
  block = block.slice(tieEnd + "/*EN9TIE-END*/".length);
  const sandbox = {};
  new Function("exports", "is", block +
    ";exports.indentOf=EN9indentOf;exports.amtOf=EN9amtOf;exports.kidsSum=EN9kidsSum;" +
    "exports.same=EN9same;exports.structRows=EN9structRows;exports.dropFurniture=EN9dropFurniture;" +
    "exports.bsSide=EN9bsSide;exports.sectionOk=EN9sectionOk;exports.sectionRoute=EN9sectionRoute;" +
    "exports.tagSections=EN9tagSections;exports.SECTB=EN9SECTB;")(sandbox, ENG.BS_LINES);
  return sandbox;
})();

/** [label, amount|null, x0] -> a pipeline row. */
const R = (label, amt, x0, page = 1) => ({
  row: { label, values: amt === null ? [] : [amt], page },
  docId: "d1", docName: "Accounts.pdf", feed: "is", kind: "pdf", x0,
});

/* 26 since the bank-accounts and cost-of-sales groups were added: a
   QuickBooks sub-account is named after the bank or the supplier, so only its
   heading says what it is. */
t("the two banner lexicons are the same 26 patterns", () => {
  const BANNERS = load("src/prototype/wp/sectionBanners.ts").SECTION_BANNERS;
  assert.strictEqual(BANNERS.length, 26);
  assert.strictEqual(SHIPPED.SECTB.length, BANNERS.length);
  for (let i = 0; i < BANNERS.length; i++) {
    assert.strictEqual(String(BANNERS[i][0]), String(SHIPPED.SECTB[i][0]), "pattern " + i);
    assert.strictEqual(BANNERS[i][1], SHIPPED.SECTB[i][1], "section " + i);
  }
});

/* ---- banners ---- */

t("a banner tags every row beneath it, and stops at the next banner", () => {
  const rows = [
    R("Operating expenses", null, 40),
    R("Interest", 1200, 60),
    R("Current assets", null, 40),
    R("Interest", 800, 60),
  ];
  const tagged = SRC.tagSections(rows);
  assert.deepStrictEqual(tagged.map((m) => m.section), ["costs", "costs", "assets", "assets"]);
  assert.deepStrictEqual(tagged.map((m) => m.section), SHIPPED.tagSections(rows).map((m) => m.section));
});

t("rows above the first banner carry no section -- absence of evidence", () => {
  const rows = [R("Sales", 500000, 40), R("Operating expenses", null, 40), R("Rent", 12000, 60)];
  assert.deepStrictEqual(SRC.tagSections(rows).map((m) => m.section), [null, "costs", "costs"]);
});

t("a row that already carries a section is never re-tagged", () => {
  const rows = [R("Operating expenses", null, 40), { ...R("Rent", 12000, 60), section: "income" }];
  assert.strictEqual(SRC.tagSections(rows)[1].section, "income");
});

t('"Total current assets 412,500" is a data row, not a banner', () => {
  const BANNERS = load("src/prototype/wp/sectionBanners.ts");
  assert.ok(BANNERS.isBannerLabel("Current assets"));
  assert.ok(!BANNERS.isBannerLabel("Total current assets 412,500"));
  assert.ok(!BANNERS.isBannerLabel("Interest on current assets"));
});

t("the lexicon covers the languages the analysts actually sent", () => {
  const { isBannerLabel } = load("src/prototype/wp/sectionBanners.ts");
  for (const n of ["Eigen vermogen", "Capitaux propres", "Passif", "Activos", "Patrimonio neto",
                   "Vaste activa", "Winst en verliesrekening", "Provisions"]) {
    assert.ok(isBannerLabel(n), n);
  }
});

/* ---- the veto ---- */

t("a balance-sheet banner refuses an income line, and the reverse", () => {
  for (const [section, target, want] of [
    ["assets", "IS:7", false],
    ["assets", "BS:11", true],
    ["assets", "BS:46", false],          // payables are the other side
    ["liabilities", "BS:46", true],
    ["liabilities", "BS:11", false],
    ["costs", "IS:26", true],
    ["costs", "BS:46", false],
    ["income", "IS:7", true],
  ]) {
    assert.strictEqual(SRC.sectionOk(section, target), want, section + " -> " + target);
    assert.strictEqual(SRC.sectionOk(section, target), SHIPPED.sectionOk(section, target), section + " -> " + target);
  }
});

t("pool ids resolve to the side they belong to", () => {
  assert.strictEqual(SRC.sectionOk("assets", "BS:OCA"), true);
  assert.strictEqual(SRC.sectionOk("liabilities", "BS:OCA"), false);
  assert.strictEqual(SRC.sectionOk("liabilities", "BS:OCL"), true);
  assert.strictEqual(SRC.sectionOk("liabilities", "BS:OL"), true);
});

t("no banner, or no target, vetoes nothing", () => {
  assert.strictEqual(SRC.sectionOk(null, "IS:7"), true);
  assert.strictEqual(SRC.sectionOk("assets", null), true);
});

/* ---- the fallback route ---- */

t("the assets side has NO catch-all -- a guessed asset line is unfindable", () => {
  assert.strictEqual(SRC.sectionRoute("assets", "Something nobody has ever seen"), null);
  assert.strictEqual(SRC.sectionRoute("assets", "Trade debtors"), "BS:11");
  assert.strictEqual(SRC.sectionRoute("assets", "Accumulated depreciation"), "BS:29");
  assert.strictEqual(SRC.sectionRoute("assets", "Prepaid insurance"), "BS:OCA");
  // Branch order matters and is deliberate: "VAT receivable" IS a receivable,
  // so the receivable branch above claims it before the tax branch.
  assert.strictEqual(SRC.sectionRoute("assets", "VAT receivable"), "BS:11");
});

t("the other three sides do have one, because each has a real other line", () => {
  assert.strictEqual(SRC.sectionRoute("liabilities", "Something unseen"), "BS:OCL");
  assert.strictEqual(SRC.sectionRoute("income", "Something unseen"), "IS:7");
  assert.strictEqual(SRC.sectionRoute("costs", "Something unseen"), "IS:OD");
});

t("the fallback matches the shipped routing on every branch", () => {
  const labels = ["Trade debtors", "Accumulated depreciation", "VAT receivable", "Nothing familiar",
    "Share capital", "Retained earnings", "Deferred income", "Current account with parent",
    "Trade creditors", "Aandelenkapitaal", "Referral fee", "Sundry income", "Turnover",
    "Salaries", "WKR expense", "Depreciation", "Interest paid", "FX loss",
    "Vennootschapsbelasting", "Belasting", "Office costs"];
  for (const section of ["assets", "liabilities", "income", "costs"]) {
    for (const l of labels) {
      assert.strictEqual(SRC.sectionRoute(section, l), SHIPPED.sectionRoute(section, l), section + " / " + l);
    }
  }
});

/* ---- structural subtotals ---- */

t("a heading whose value is the sum of the rows beneath it is a summary", () => {
  const rows = [
    R("Operating expenses", 33000, 40),
    R("Rent", 12000, 60),
    R("Salaries", 20000, 60),
    R("Insurance", 1000, 60),
  ];
  const out = SRC.structRows(rows);
  assert.ok(out[0].skipReason, "the heading should be skipped");
  assert.match(out[0].skipReason, /summary of the 3 row\(s\)/);
  assert.ok(out.slice(1).every((m) => !m.skipReason), "its components must survive");
});

t("a trailing total of the rows above it is skipped", () => {
  const rows = [
    R("Cost of goods", null, 40),
    R("Purchases", 200000, 60),
    R("Freight", 28705, 60),
    R("Total cost of goods", 228705, 60),
  ];
  const out = SRC.structRows(rows);
  assert.ok(!out[3].skipReason, "at the same indent as its siblings it is not a total of them");
});

t("a total indented level with its siblings needs the total word at the outermost indent", () => {
  const rows = [
    R("Purchases", 200000, 60),
    R("Freight", 28705, 60),
    R("Total", 228705, 40),
  ];
  const out = SRC.structRows(rows);
  assert.match(out[2].skipReason, /total of the 2 row\(s\) above it/);
});

t("a grand total at the outermost indent is skipped on its word alone", () => {
  const rows = [R("Sales", 500000, 40), R("Other income", 12000, 40), R("Grand total", 999999, 40)];
  const out = SRC.structRows(rows);
  assert.strictEqual(out[2].skipReason, "a total at the outermost indent of the report");
  assert.ok(!out[0].skipReason && !out[1].skipReason);
});

t("a genuine line item whose caption starts with a total word is NOT dropped", () => {
  // "Total return on investments" is a real caption; it is at the outermost
  // indent, so only the arithmetic keeps it -- which is why the third test
  // requires the total WORD as well as the indent.
  const rows = [R("Rent", 12000, 60), R("Totalisator levy", 4000, 60)];
  assert.ok(SRC.structRows(rows).every((m) => !m.skipReason));
});

t("only the immediate children count, not grandchildren", () => {
  const rows = [
    R("Operating expenses", 33000, 40),
    R("Premises", 13000, 60),
    R("Rent", 12000, 80),
    R("Rates", 1000, 80),
    R("Salaries", 20000, 60),
  ];
  const out = SRC.structRows(rows);
  assert.match(out[0].skipReason, /summary of the 2 row\(s\)/, "13,000 + 20,000, not the leaves too");
  assert.match(out[1].skipReason, /summary of the 2 row\(s\)/);
});

t("the tolerance accepts a subtotal printed rounded, and rejects a real difference", () => {
  assert.ok(SRC.same(33000.01, 33000));
  assert.ok(SRC.same(2290116.5, 2290116));         // one part per million of 2.3m
  assert.ok(!SRC.same(33010, 33000));
  for (const [a, b] of [[33000.01, 33000], [2290116.5, 2290116], [33010, 33000], [0.02, 0], [0.03, 0]]) {
    assert.strictEqual(SRC.same(a, b), SHIPPED.same(a, b), a + " ~ " + b);
  }
});

t("structRows matches the shipped implementation on the whole fixture", () => {
  const rows = [
    R("Operating expenses", 33000, 40),
    R("Rent", 12000, 60),
    R("Salaries", 20000, 60),
    R("Insurance", 1000, 60),
    R("Grand total", 33000, 40),
    R("Page 1 of 9", null, 40, 1),
    R("Page 2 of 9", null, 40, 2),
  ];
  const mine = SRC.structRows(rows).map((m) => [m.row.label, m.skipReason || null]);
  const theirs = SHIPPED.structRows(rows).map((m) => [m.row.label, m.EN9skip || null]);
  assert.deepStrictEqual(mine, theirs);
});

/* ---- furniture ---- */

t("a value-less caption repeating across pages is furniture and is removed", () => {
  const rows = [
    R("Smith & Co Chartered Accountants", null, 40, 1),
    R("Smith & Co Chartered Accountants", null, 40, 2),
    R("Rent", 12000, 60, 1),
  ];
  const out = SRC.dropFurniture(rows);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].row.label, "Rent");
});

t("digits are normalised, so a numbered footer is one repeating caption", () => {
  const rows = [R("Page 1 of 9", null, 40, 1), R("Page 2 of 9", null, 40, 2)];
  assert.strictEqual(SRC.dropFurniture(rows).length, 0);
});

t("a caption appearing once is not furniture, however value-less", () => {
  const rows = [R("Current assets", null, 40, 1), R("Cash", 55574, 60, 1)];
  assert.strictEqual(SRC.dropFurniture(rows).length, 2);
});

/* ---- re-feeding ---- */

t("a balance-sheet banner on a P&L page moves its rows to the other pipeline", () => {
  const isRows = SRC.tagSections([
    R("Operating expenses", null, 40),
    R("Rent", 12000, 60),
    R("Current assets", null, 40),
    R("Cash at bank", 55574, 60),
  ]);
  const out = SRC.refeedBySection(isRows, []);
  assert.strictEqual(out.moved, 2, "the banner and the row beneath it");
  assert.deepStrictEqual(out.is.map((m) => m.row.label), ["Operating expenses", "Rent"]);
  assert.deepStrictEqual(out.bs.map((m) => m.row.label), ["Current assets", "Cash at bank"]);
  assert.ok(out.bs.every((m) => m.feed === "bs"), "the moved rows must carry the new feed");
});

t("nothing to move leaves both arrays untouched, by identity", () => {
  const isRows = SRC.tagSections([R("Operating expenses", null, 40), R("Rent", 12000, 60)]);
  const out = SRC.refeedBySection(isRows, []);
  assert.strictEqual(out.moved, 0);
  assert.strictEqual(out.is, isRows);
});

/* ---- the pipeline actually calls all of it ---- */

const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
const engine = fs.readFileSync(path.join(root, "src", "prototype", "wp", "engine.ts"), "utf8");

t("banners survive row hygiene and are emitted by the positioned reader", () => {
  assert.ok(engine.includes("label.length <= 40 && isBannerLabel(label)"), "hygiene drops banners");
  assert.ok(engine.includes("if (!opts?.raw && label.length <= 40 && isBannerLabel(label))"),
    "the reader does not emit banners, or emits them on raw pages");
});

t("every positioned row carries its indent", () => {
  assert.ok(/const candidate: ExtractedRow = \{ label, values: kept\.map\(\(x\) => x\.v\), years, page: row\.page, x0 \}/.test(engine));
});

t("step 2 tags, re-feeds and detects structure, and logs both counts", () => {
  assert.ok(store.includes("re-routed between the P&L and balance-sheet pipelines by their statement section banners"));
  assert.ok(store.includes("structural subtotal/total row(s) dropped before mapping"));
  assert.ok(/pdfIs = structRows\(pdfIs\)/.test(store) && /pdfBs = structRows\(pdfBs\)/.test(store));
});

t("step 3 skips structure, applies the veto AFTER a target is chosen, then the fallback", () => {
  const loop = store.slice(store.indexOf("for (const m of mapRows) {"));
  assert.ok(loop.includes("if (m.skipReason || m.row.isBanner) continue;"), "structure is booked");
  const veto = loop.indexOf("if (target && m.section && !sectionOk(m.section, target)) target = null;");
  const fallback = loop.search(/if \(!target && m\.section\) \{\s*target = sectionRoute\(m\.section, m\.row\.label\)/);
  assert.ok(veto > 0 && fallback > veto, "the fallback must run after the veto, not before");
});

t("the section travels onto the unmatched row", () => {
  assert.ok(store.includes("docId: m.docId, docName: m.docName, section: m.section,"));
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
