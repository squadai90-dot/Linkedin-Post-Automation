/* Worksheet selection for multi-tab client workbooks.
 *
 * A client "financial statements" workbook is a cover sheet, an index, a lead
 * schedule, the trial balance, the P&L, the balance sheet, a notes tab and
 * three tabs of queries. Reading every tab into one flat grid puts the notes
 * and the query log in competition with the statements for the same captions.
 *
 * Two things are being pinned here: the ranking itself, and the rule that it
 * may narrow the input but never empty it — a workbook whose tabs are named in
 * a convention this lexicon does not know must still be read in full.
 */
const assert = require("assert");
const path = require("path");
const esbuild = require("esbuild");
const JSZip = require("jszip");
// engine.ts reads the page-global JSZip that dist loads from a <script> tag.
globalThis.JSZip = JSZip;

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

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const T = (name, fn) => fn().then(() => { console.log("ok:", name); pass++; },
                                  (e) => { console.log("FAILED:", name, "-", e.message); fail++; });

t("a real client workbook keeps the statements and drops the admin tabs", () => {
  const r = ENG.rankSheets(["Cover", "Index", "Lead", "Trial Balance", "Profit and Loss", "Balance Sheet", "Notes", "Queries"]);
  assert.deepStrictEqual(r.read, ["Trial Balance", "Profit and Loss", "Balance Sheet"]);
  assert.deepStrictEqual(r.skip, ["Cover", "Index", "Lead", "Notes", "Queries"]);
});

t("the statement lexicon is the multilingual one, not an English-only list", () => {
  for (const n of ["Balans", "Winst- en verliesrekening", "Bilan", "Estado de resultados", "Balanço", "Conto economico", "Proefbalans"]) {
    assert.deepStrictEqual(ENG.rankSheets([n, "Cover"]).read, [n], n);
  }
});

t("P&L written the short way is still a statement tab", () => {
  assert.deepStrictEqual(ENG.rankSheets(["Cover", "P&L", "BS"]).read, ["P&L"]);
  assert.deepStrictEqual(ENG.rankSheets(["Cover", "P & L"]).read, ["P & L"]);
});

t("no statement tab: everything that is not administration is read", () => {
  const r = ENG.rankSheets(["Cover", "Notes", "FY24 figures", "Detail"]);
  assert.deepStrictEqual(r.read, ["FY24 figures", "Detail"]);
  assert.deepStrictEqual(r.skip, ["Cover", "Notes"]);
});

t("a workbook whose every tab looks administrative is read in full, not skipped", () => {
  const names = ["Cover", "Contents", "Notes"];
  const r = ENG.rankSheets(names);
  assert.deepStrictEqual(r.read, names);
  assert.deepStrictEqual(r.skip, []);
});

t("a single-tab workbook is never narrowed away", () => {
  assert.deepStrictEqual(ENG.rankSheets(["Sheet1"]).read, ["Sheet1"]);
});

/* ---- the reader end to end: a real .xlsx, tabs out of rId order ---- */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function sheetXml(rows) {
  const body = rows.map((cells, i) =>
    `<row r="${i + 1}">${cells.map((c, j) =>
      `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${esc(String(c))}</t></is></c>`).join("")}</row>`).join("");
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** @param tabs [name, rows][] — deliberately mapped to sheetN.xml in REVERSE,
    so any code that assumes "the Nth <sheet> is sheetN.xml" reads the wrong tab. */
async function workbook(tabs, { rels = true } = {}) {
  const zip = new JSZip();
  const n = tabs.length;
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("xl/workbook.xml",
    `<workbook><sheets>${tabs.map(([name], i) =>
      `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${n - i}"/>`).join("")}</sheets></workbook>`);
  if (rels) {
    zip.file("xl/_rels/workbook.xml.rels",
      `<Relationships>${tabs.map((_, i) =>
        `<Relationship Id="rId${n - i}" Target="worksheets/sheet${n - i}.xml"/>`).join("")}</Relationships>`);
  }
  tabs.forEach(([, rows], i) => zip.file(`xl/worksheets/sheet${n - i}.xml`, sheetXml(rows)));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new File([buf], "client-accounts.xlsx");
}

const TABS = [
  ["Cover", [["Prepared by"], ["Smith & Co"]]],
  ["Profit and Loss", [["Sales", "2290116"], ["Purchases", "228705"]]],
  ["Queries", [["Q1", "chase the bank letter"]]],
];

(async () => {
  await T("the statement tab is read and the admin tabs are named, not silently dropped", async () => {
    const doc = await ENG.readDocument(await workbook(TABS));
    assert.deepStrictEqual(doc.sheetsUsed, ["Profit and Loss"]);
    assert.deepStrictEqual(doc.sheetsSkipped, ["Cover", "Queries"]);
    const flat = doc.grid.flat().join("|");
    assert.ok(flat.includes("Sales"), "read the P&L: " + flat);
    assert.ok(!flat.includes("Prepared by"), "cover sheet leaked in: " + flat);
    assert.ok(!flat.includes("chase the bank letter"), "query log leaked in: " + flat);
  });

  await T("tabs are resolved through the relationship table, not by position", async () => {
    // sheet1.xml here holds Queries and sheet3.xml holds Cover; a positional
    // reader would report the wrong tab names as read.
    const doc = await ENG.readDocument(await workbook(TABS));
    assert.ok(!doc.grid.flat().join("|").includes("chase the bank letter"));
  });

  await T("a pinned worksheet list overrides the ranking", async () => {
    const doc = await ENG.readDocument(await workbook(TABS), { sheets: ["Cover"] });
    assert.deepStrictEqual(doc.sheetsUsed, ["Cover"]);
    assert.ok(doc.grid.flat().join("|").includes("Prepared by"));
  });

  await T("a stale pin that matches no tab falls back to reading everything", async () => {
    const doc = await ENG.readDocument(await workbook(TABS), { sheets: ["Balance Sheet"] });
    assert.strictEqual(doc.sheetsUsed, undefined);
    assert.ok(doc.grid.flat().join("|").includes("Sales"));
  });

  await T("without a resolvable relationship table nothing is narrowed", async () => {
    const doc = await ENG.readDocument(await workbook(TABS, { rels: false }));
    assert.strictEqual(doc.sheetsUsed, undefined, "must not guess the tab→part mapping");
    const flat = doc.grid.flat().join("|");
    assert.ok(flat.includes("Sales") && flat.includes("Prepared by"), "everything should be read: " + flat);
  });

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
