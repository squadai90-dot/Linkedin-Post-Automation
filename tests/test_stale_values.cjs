/* Stale cached results in formula cells.
 *
 * A formula cell stores the formula AND its last computed result. The tool
 * writes formulas but cannot evaluate them, so untouched formulas keep the
 * template's cached value — usually 0 or #DIV/0!.
 *
 * fullCalcOnLoad makes Excel recompute on open, but nothing else does: the
 * in-app preview, a print/PDF export, an OS preview pane, or an automated
 * reconciliation all read the dead cache. That is exactly how a client
 * reconciliation scored correct totals as zeros and reported "FX rates not
 * linked / totals hardcoded to 0" for a workbook whose formulas were intact
 * and whose recalculated totals were correct to the cent.
 *
 * Deleting the cached value keeps the formula and makes those readers show an
 * EMPTY cell — "not computed yet" rather than a confident wrong number.
 */
const assert = require("assert");
const path = require("path");
const esbuild = require("esbuild");

function load() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src/prototype/wp/xlsxPatch.ts")],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const { stripStaleFormulaValues: strip } = load();

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

t("a stale 0 is removed but the formula survives", () => {
  const out = strip(`<c r="L5" s="3"><f>'Basic Information'!C59</f><v>0</v></c>`);
  assert.ok(out.includes(`<f>'Basic Information'!C59</f>`), "formula lost");
  assert.ok(!/<v>/.test(out), "cached value kept");
});

t("a cached #DIV/0! and its error type are removed", () => {
  const out = strip(`<c r="H14" s="9" t="e"><f>F14/H6</f><v>#DIV/0!</v></c>`);
  assert.ok(out.includes("<f>F14/H6</f>"), "formula lost");
  assert.ok(!/<v>/.test(out), "cached error kept");
  assert.ok(!/t="e"/.test(out), 'stale t="e" kept — Excel would flag the cell');
});

t("real data cells are NEVER touched", () => {
  for (const cell of [
    `<c r="F19" s="2"><v>-2701.45</v></c>`,          // a booked amount
    `<c r="B19" s="1" t="s"><v>42</v></c>`,          // a shared string
    `<c r="C59" s="4"><v>0.924</v></c>`,             // the FX rate the tool wrote
    `<c r="H19" s="0"><v>4500</v></c>`,              // share count
  ]) assert.strictEqual(strip(cell), cell, `mutated a data cell: ${cell}`);
});

t("shared-formula children keep their reference", () => {
  const out = strip(`<c r="L11" s="3"><f t="shared" si="4"/><v>0</v></c>`);
  assert.ok(out.includes(`<f t="shared" si="4"/>`), "shared reference lost");
  assert.ok(!/<v>/.test(out), "cached value kept");
});

t("inline strings and empty cells are left alone", () => {
  for (const cell of [`<c r="A1" t="inlineStr"><is><t>Total</t></is></c>`, `<c r="A2" s="1"/>`]) {
    assert.strictEqual(strip(cell), cell);
  }
});

t("a whole row is handled cell by cell", () => {
  const row = `<row r="5">`
    + `<c r="A5" t="s"><v>7</v></c>`                       // label — keep
    + `<c r="F5"><v>174223.36</v></c>`                     // amount — keep
    + `<c r="L5"><f>F5/$L$3</f><v>0</v></c>`               // formula — strip value
    + `<c r="M5" t="e"><f>F5/0</f><v>#DIV/0!</v></c>`      // formula — strip value+type
    + `</row>`;
  const out = strip(row);
  assert.ok(out.includes(`<c r="A5" t="s"><v>7</v></c>`), "label damaged");
  assert.ok(out.includes(`<c r="F5"><v>174223.36</v></c>`), "amount damaged");
  assert.ok(out.includes(`<f>F5/$L$3</f>`) && out.includes(`<f>F5/0</f>`), "formulas lost");
  assert.strictEqual((out.match(/<v>/g) || []).length, 2, "wrong number of values kept");
});

t("the reported symptom cannot recur: no formula cell keeps a 0 or an error", () => {
  // The three cells the client reconciliation called "hardcoded 0".
  const sheet =
    `<c r="L5"><f>'Basic Information'!C59</f><v>0</v></c>` +
    `<c r="G6"><f>'Basic Information'!C61</f><v>0</v></c>` +
    `<c r="H6"><f>'Basic Information'!C60</f><v>0</v></c>`;
  const out = strip(sheet);
  assert.strictEqual((out.match(/<v>/g) || []).length, 0, "a stale rate survived");
  assert.strictEqual((out.match(/<f>/g) || []).length, 3, "a rate formula was lost");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
