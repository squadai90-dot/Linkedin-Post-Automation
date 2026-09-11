/* Regression: "Translate free (2)" but "Nothing left to translate".
 *
 * Reproduces the reported state: French captions that were successfully BOUND
 * to template lines. Bound captions live in `contributions` (all of them), but
 * `sourceLabels` keeps only ONE label per target — last write wins. The old
 * work list read sourceLabels + unmatched only, so a bound caption that lost
 * the last-write-wins race was visible on screen, counted on the button, and
 * unreachable by the translator.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const esbuild = require("esbuild");

// Compile the real module — no hand-rolled TS stripping, so the test exercises
// exactly the code that ships.
function loadCaptions() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src/prototype/wp/captions.ts")],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const C = loadCaptions();

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/* The reported entity: two French captions bound to Sch C lines, each sharing
   its target with a later English caption that overwrote sourceLabels. */
const ent = {
  contributions: {
    "IS:7":  [{ label: "Chiffre d'affaires net" }, { label: "Turnover" }],
    "IS:29": [{ label: "Intérêts et charges assimilées" }, { label: "Interest payable" }],
    "IS:33": [{ label: "Autres charges" }],
  },
  sourceLabels: {                       // one per target — last write wins
    "IS:7":  { label: "Turnover" },
    "IS:29": { label: "Interest payable" },
    "IS:33": { label: "Autres charges" },
  },
  unmatched: [],
  translations: { "Autres charges": "PLEASE SELECT TWO DISTINCT LANGUAGES" },
};

t("the old work list could not see the two bound French captions", () => {
  const oldList = [
    ...Object.values(ent.sourceLabels).map((s) => s.label),
    ...ent.unmatched.map((u) => u.label),
  ].filter((l) => !ent.translations[l]);
  assert.ok(!oldList.includes("Chiffre d'affaires net"), "should have been invisible");
  assert.ok(!oldList.includes("Intérêts et charges assimilées"), "should have been invisible");
});

t("the shared collector sees every caption the screen can show", () => {
  const all = C.collectCaptionLabels(ent);
  for (const l of ["Chiffre d'affaires net", "Turnover", "Intérêts et charges assimilées",
                   "Interest payable", "Autres charges"]) {
    assert.ok(all.includes(l), `missing ${l}`);
  }
});

t("the new work list now queues the two stuck captions", () => {
  const all = C.collectCaptionLabels(ent);
  const poisoned = new Set(C.poisonedTranslationKeys(ent.translations));
  const work = all.filter((l) => !ent.translations[l] || poisoned.has(l));
  assert.ok(work.includes("Chiffre d'affaires net"));
  assert.ok(work.includes("Intérêts et charges assimilées"));
});

t("the stored error string is recognised and re-queued", () => {
  const poisoned = C.poisonedTranslationKeys(ent.translations);
  assert.deepStrictEqual(poisoned, ["Autres charges"]);
});

t("service error strings are never accepted as translations", () => {
  for (const bad of [
    "PLEASE SELECT TWO DISTINCT LANGUAGES",
    "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS",
    "QUOTA EXCEEDED",
    "INVALID LANGUAGE PAIR SPECIFIED",
    "",
  ]) assert.ok(C.isServiceErrorText(bad), `should reject: ${bad}`);
});

t("real translations are not mistaken for errors", () => {
  for (const good of ["Net turnover", "Interest and similar charges", "Other operating costs",
                      "VAT", "Cash at bank and in hand"]) {
    assert.ok(!C.isServiceErrorText(good), `should accept: ${good}`);
  }
});

t("French captions are sent as fr, never as en|en", () => {
  assert.strictEqual(C.translateSourceCode("Intérêts et charges assimilées"), "fr");
  assert.strictEqual(C.translateSourceCode("Chiffre d'affaires net"), "fr");
  assert.strictEqual(C.detectLanguage("Intérêts et charges assimilées"), "French");
  // English captions ask the service to auto-detect rather than claiming en|en
  assert.strictEqual(C.translateSourceCode("Interest payable"), "auto");
});

t("other languages still route correctly", () => {
  assert.strictEqual(C.translateSourceCode("Omzet en overlopende posten"), "nl");
  assert.strictEqual(C.translateSourceCode("Ingresos de clientes"), "es");
  assert.strictEqual(C.translateSourceCode("Умсатз"), "ru");
});

t("INVARIANT: work list is a superset of every displayable caption", () => {
  // Whatever the evidence table can render must be reachable by the translator.
  const displayable = new Set();
  for (const list of Object.values(ent.contributions)) for (const c of list) displayable.add(c.label);
  for (const s of Object.values(ent.sourceLabels)) displayable.add(s.label);
  for (const u of ent.unmatched) displayable.add(u.label);
  const all = new Set(C.collectCaptionLabels(ent));
  for (const l of displayable) assert.ok(all.has(l), `unreachable: ${l}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
