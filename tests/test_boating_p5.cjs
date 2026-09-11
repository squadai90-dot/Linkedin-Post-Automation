/* Boating Made Easy — the reconciliation's remaining items.
 *
 * K  the caption on the return's attached statement ("SUB-CONTRACTOR") is
 *    carried onto the beginning-of-year line it supports;
 * L  the entity's name takes the statements' own casing over the return's
 *    capitals, and the date of formation reaches B17 as a date;
 * M  a prior return that filed Schedule R as "NONE / date / 0 / 0" leads to
 *    the same row this year when no distribution was found;
 * N  the Provenance sheet says how each line was chosen and lists every
 *    blocking exception the preparer acknowledged;
 * I  an exchange rate written to a schedule keeps its precision (0.833, not
 *    0.83).
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
    define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' },
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const STORE = load("src/prototype/wp/store.ts");
const CF = load("src/prototype/wp/carryForward.ts");
const ENG = load("src/prototype/wp/engine.ts");
const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

/* ---- a prior return: Schedule F, Schedule R and the statement pages ---- */

const page = (n, lines) => lines.map((cells, i) => ({ page: n, y: 800 - i * 12, cells: cells.map((text, k) => ({ text, x0: 20 + k * 200, x1: 20 + k * 200 + 150 })) }));
function priorReturn({ schR = "none", stmtTotal = "-43,426." } = {}) {
  const rows = [
    ...page(1, [["Form 5471 Information Return of U.S. Persons With Respect to Certain Foreign Corporations"]]),
    ...page(2, [["SCHEDULE F Balance Sheet"],
                ["Assets", "(a) Beginning of annual accounting period", "(b) End of annual accounting period"],
                ["1 Cash", "-21,215.", "36,323."],
                ["5 Other current assets (attach statement)", "", "-43,426."],
                ["16 Total assets", "35,000.", "20,209."]]),
    ...page(3, [["SCHEDULE R (Form 5471) Distributions From a Foreign Corporation"],
                ["(a) Description of distribution", "(b) Date of distribution", "(c) Amount of distribution in foreign corporation's functional currency", "(d) Amount of E&P distribution"],
                ...(schR === "none" ? [["1", "NONE", "12/31/2023", "0.", "0."]] : [["1", "CASH DIVIDEND", "06/30/2023", "5,000.", "5,000."]]),
                ["2"]]),
    ...page(4, [["FORM 5471", "OTHER DEDUCTIONS", "STATEMENT 9"],
                ["DESCRIPTION", "FUNCTIONAL CURRENCY", "EXCHANGE RATE", "U.S. DOLLARS"],
                ["BANK CHARGES", "197.", ".833000", "236."],
                ["TOTAL TO 5471, PAGE 3, SCH C, LINE 17", "368,044.", "441,829."],
                ["FORM 5471", "OTHER CURRENT ASSETS", "STATEMENT 10"],
                ["BEG. OF ANNUAL", "END OF ANNUAL"],
                ["DESCRIPTION", "ACCOUNTING PERIOD", "ACCOUNTING PERIOD"],
                ["SUB-CONTRACTOR", stmtTotal],
                ["TOTAL TO 5471, PAGE 4, SCH F, LINE 5", stmtTotal]]),
  ];
  const cls = {
    kind: "prior-year-us-return", pages: [
      { page: 1, kind: "us-5471-face", score: 1 }, { page: 2, kind: "us-5471-schF", score: 1 },
      { page: 3, kind: "us-5471-schR", score: 1 }, { page: 4, kind: "us-statements", score: 1 },
    ], notes: [], statementYear: 2023,
  };
  return { cls, parsed: { kind: "pdf", grid: rows.map((r) => r.cells.map((c) => c.text)), pdf: { pageCount: 4, rows } } };
}

t("K · the attached statement's caption is read and tied to Schedule F line 5 by its total", () => {
  const { cls, parsed } = priorReturn();
  const cf = CF.extractCarryForward(cls, parsed);
  assert.strictEqual(cf.priorClosingUSD.oca.value, -43426, "the schedule line itself");
  assert.deepStrictEqual(cf.statementCaptions.oca, { label: "SUB-CONTRACTOR", page: 4, statement: "Statement 10" });
});

t("K · a statement whose total does not match the line is not trusted", () => {
  const { cls, parsed } = priorReturn({ stmtTotal: "-9,999." });
  const cf = CF.extractCarryForward(cls, parsed);
  assert.strictEqual(cf.statementCaptions, undefined);
});

t("K · the seeded opening line carries the statement's caption, title-cased", () => {
  assert.strictEqual(STORE.titleCaseCaption("SUB-CONTRACTOR"), "Sub-Contractor");
  assert.strictEqual(STORE.titleCaseCaption("Prepaid expenses"), "Prepaid expenses", "mixed case is the author's choice");
  assert.ok(store.includes("relabels[k] = `${titleCaseCaption(stmt.label)} (per prior-year Form 5471, ${stmt.statement})`"));
  assert.ok(store.includes("else if (aggregateLabel) relabels[k] = `${aggregateLabel} (per prior-year Form 5471)`"), "the generic caption remains the fallback");
});

t("M · Schedule R filed as NONE is read; a real distribution is not mistaken for it", () => {
  assert.deepStrictEqual(CF.extractCarryForward(priorReturn().cls, priorReturn().parsed).schRNone, { page: 3, date: "12/31/2023" });
  const paid = priorReturn({ schR: "paid" });
  assert.strictEqual(CF.extractCarryForward(paid.cls, paid.parsed).schRNone, undefined);
});

t("M · with no distribution this year the same row is written, dated this year end", () => {
  assert.ok(store.includes("if (!divAmount && cf?.schRNone && !ent.dividends.length) {"));
  assert.ok(store.includes('w({ sheet: SHEET.schR, ref: "B10", value: "NONE", source: src, reviewId: "sch-r-none" });'));
  assert.ok(store.includes('w({ sheet: SHEET.schR, ref: "G10", value: 0, source: src });'));
  assert.ok(store.includes('id: "sch-r-none", level: "info"'));
});

/* ---- L ---- */

t("L · the date of formation becomes a real date with a four-digit year", () => {
  assert.strictEqual(STORE.formedCell("09/05/08", "2023 return · 5471 face"), 39696, "5 September 2008 — the face prints month/day/year");
  assert.strictEqual(STORE.formedCell("2008-09-05"), 39696);
  assert.strictEqual(STORE.formedCell("25/09/2008", "questionnaire"), 39716, "a day above 12 settles the order");
  assert.strictEqual(STORE.formedCell("05/09/08", "questionnaire"), "05/09/08", "ambiguous from a source of unknown convention — left as printed");
  assert.strictEqual(STORE.formedCell("31/02/2008", "questionnaire"), "31/02/2008", "not a date");
});

t("L · B17 receives the serial, other profile cells the text", () => {
  const ent = STORE.makeEntity("Boating Made Easy Ltd.", "Tanya");
  ent.profile.formed = "09/05/08";
  ent.profile.legalName = "Boating Made Easy Ltd.";
  ent.detected.formed = { key: "formed", value: "09/05/08", sourceLabel: "2023 return · 5471 face", confidence: "high" };
  const w = STORE.buildWrites(ent);
  assert.strictEqual(w[ENG.SHEET.basic].B17, 39696);
  assert.strictEqual(w[ENG.SHEET.basic].B11, "Boating Made Easy Ltd.");
});

t("L · the statements' header re-cases the return's capitals", () => {
  assert.ok(store.includes("entity name re-cased from the statements' header"));
  assert.ok(store.includes("entitySimilarity(profile.legalName, stmtName) >= 0.8"), "only when clearly the same company");
  assert.ok(store.includes("if (stmtName && !isUpper(stmtName) && profile.legalName && isUpper(profile.legalName)"), "and only when the statements themselves are not in capitals");
});

/* ---- I ---- */

t("I · an exchange rate keeps its precision on the way to the cell; amounts still round to 2 dp", () => {
  const ent = STORE.makeEntity("Boating Made Easy Ltd.", "Tanya");
  ent.extraWrites = [
    { sheet: ENG.SHEET.schE, ref: "Q16", value: 0.833, dp: 6, source: "average rate" },
    { sheet: ENG.SHEET.schE, ref: "O16", value: 1234.5678, source: "tax" },
    { sheet: ENG.SHEET.dividends, ref: "D3", value: 1.2005, dp: 4, source: "rate" },
  ];
  const w = STORE.buildWrites(ent);
  assert.strictEqual(w[ENG.SHEET.schE].Q16, 0.833);
  assert.strictEqual(w[ENG.SHEET.schE].O16, 1234.57);
  assert.strictEqual(w[ENG.SHEET.dividends].D3, 1.2005);
  assert.strictEqual((store.match(/ref: "Q16", value: avgRate, dp: 6/g) || []).length, 2, "both Schedule E rows");
  assert.ok(store.includes('ref: "D3", value: usdPerUnit, dp: 4'));
});

/* ---- N ---- */

t("N · a section-heading placement is recorded as such, not as a keyword rule", () => {
  assert.ok(store.includes('via: "rule" | "section" | "groq" | "manual"'));
  assert.ok(/target = sectionRoute\(m\.section, m\.row\.label\) \|\| null;\n\s+if \(target\) via = "section";/.test(store));
  assert.ok(/target = collapsedRoute\(m\.row\.label, m\.collapsed\);\n\s+if \(target\) \{\n\s+via = "section";/.test(store));
  assert.ok(/target = ov\.to;\n\s+via = "manual";/.test(store), "a standing override is the preparer's decision");
  assert.ok(store.includes("year: r.year, via,"));
});

t("N · the Provenance sheet labels each kind honestly and leaves Confidence blank for non-AI rows", () => {
  assert.ok(store.includes('rule: "Keyword rule", section: "Section heading", groq: "AI mapping", manual: "Manual assignment"'));
  assert.ok(store.includes('c.via === "groq" ? (flaggedLow ? "LOW — verify" : "model-reported ok") : ""'));
  assert.ok(!store.includes('"booked by the AI model; remap on Mapping & adjustments if wrong"'), "the old one-size note is gone");
});

t("N · acknowledged blocking exceptions are listed on the sheet, with the preparer's note", () => {
  assert.ok(store.includes('const acknowledged = allReviewItems(ent).filter((r) => r.level === "block" && r.dismissed);'));
  assert.ok(store.includes("ACKNOWLEDGED BLOCKING EXCEPTIONS — generation proceeded despite these"));
  assert.ok(store.includes('preparer\'s note: "${r.dismissedNote}"'));
});

/* ---- the shipped app carries the same behaviour ---- */

t("dist · statement captions, Schedule R NONE, formation date, rate precision, provenance", () => {
  for (const pin of [
    "/*EN9CFSTMT*/", "/*EN9CFSCHR*/", "(per prior-year Form 5471, ", "/*EN9SCHRNONE*/", 'value:"NONE"',
    "EN9formedCell(", "EN9roundDp(", 'ref:"Q16",value:g,dp:6', 'ref:"D3",value:p,dp:4',
    'EN9via="section"', 'EN9via="manual"', "via:EN9via", "Keyword rule", "Section heading",
    "ACKNOWLEDGED BLOCKING EXCEPTIONS", "entity name re-cased from the statements' header",
  ]) assert.ok(dist.includes(pin), `dist lacks ${pin}`);
  assert.ok(!dist.includes('"booked by the AI model; remap on Mapping & adjustments if wrong"'));
});

/* The shipped reader, driven with the same rows through the fixture hook. */
(async () => {
  const H = require("./fixtures/harness.cjs");
  await H.boot();
  const M = H.M;
  t("dist · the attached statement's caption and Schedule R NONE are read by the shipped reader", () => {
    const { cls, parsed } = priorReturn();
    // Objects cross the jsdom realm boundary — compare by value, not prototype.
    const cf = JSON.parse(JSON.stringify(M.EN9carryForward(cls, parsed)));
    assert.deepStrictEqual(cf.statementCaptions.oca, { label: "SUB-CONTRACTOR", page: 4, statement: "Statement 10" });
    assert.deepStrictEqual(cf.schRNone, { page: 3, date: "12/31/2023" });
    const off = priorReturn({ stmtTotal: "-9,999.", schR: "paid" });
    const cf2 = M.EN9carryForward(off.cls, off.parsed);
    assert.strictEqual(cf2.statementCaptions, undefined);
    assert.strictEqual(cf2.schRNone, undefined);
  });
  t("dist · formation date and title-casing match src", () => {
    assert.strictEqual(M.EN9formedCell("09/05/08", "2023 return · 5471 face"), 39696);
    assert.strictEqual(M.EN9formedCell("05/09/08", "questionnaire"), "05/09/08");
    assert.strictEqual(M.EN9formedCell("25/09/2008", "q"), 39716);
    assert.strictEqual(M.EN9titleCase("SUB-CONTRACTOR"), "Sub-Contractor");
  });
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
