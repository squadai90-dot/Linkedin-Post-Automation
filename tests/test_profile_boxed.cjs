/* Entity particulars read off a boxed tax form, and the currency that decides
 * every translated figure in the work paper.
 *
 * Measured against the client's own gold work papers for two Chilean CFCs.
 * Before these fixes the tool read, from their SII Form 22s:
 *   legal name = "02 Apellido Materno"        (the NEXT box's caption)
 *   activity   = "14 Código actividad económica"  (likewise)
 *   currency   = INR on one of them           (from "REX/INR/ Remanente…")
 *   country    = blank, on a filing headed REPUBLICA DE CHILE
 * and Schedule E asserted a nil-tax year on an entity that had paid
 * 95,791,979 CLP of tax, because no caption mapped to income tax expense.
 *
 * The geometry and wording below are the real form's; identifying values are
 * invented. A client's particulars do not belong in a repository.
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
const DP = load("src/prototype/wp/detectProfile.ts");
const FX = load("src/prototype/wp/fxRates.ts");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/* Page 1 of the form, as the reader hands it over: a row of numbered box
   captions, then the row of values beneath. */
const FORM = [
  ["03 ROL UNICO", "01 Apellido Paterno o razón social", "02 Apellido Materno", "05 Nombres"],
  ["11111111-1", "EJEMPLO SOCIEDAD LIMITADA"],
  ["06 Calle; N°; Of; Depto.", "09 Teléfono", "18 Comuna"],
  ["CALLE FALSA 123", "555000", "VALPARAISO"],
  ["13", "Actividad, profesión o giro del negocio", "14 Código actividad económica", "903 RUT del Representante"],
  ["ENSENANZA PREESCOLAR PRIVADA", "850021"],
  ["55 Correo Electrónico"],
  ["CLP"],
  ["REX/INR/ Remanente ejercicio siguiente (saldo positivo)", "1.237.254"],
  ["REX/INR/ Remanente ejercicio anterior (saldo positivo)", "1.237.254"],
];

const found = new Map(DP.detectProfile(FORM).profile.map((f) => [f.key, f.value]));

t("the caption of the NEXT box is not this box's value", () => {
  assert.notStrictEqual(found.get("legalName"), "02 Apellido Materno");
  assert.strictEqual(found.get("legalName"), "EJEMPLO SOCIEDAD LIMITADA");
});

t("the value is taken from the line below, in the caption's own column", () => {
  // The name sits under its caption; the RUT to its left must not win.
  assert.notStrictEqual(found.get("legalName"), "11111111-1");
});

t("a code printed in the caption's column does not beat the words beside it", () => {
  // "Actividad…" is indented left of its box; the activity CODE 850021 sits
  // in the caption's own column. A description is words, a code is not.
  assert.strictEqual(found.get("activity"), "ENSENANZA PREESCOLAR PRIVADA");
});

t("a value read across the row is still marked high confidence; one read below is not", () => {
  const fields = DP.detectProfile(FORM).profile;
  const name = fields.find((f) => f.key === "legalName");
  assert.strictEqual(name.confidence, "medium", "a value inferred from the row below is not certain");
});

t("an ordinary questionnaire is untouched — the value is still read across", () => {
  const sheet = [
    ["Legal Name of Entity", "ACME HOLDINGS BV"],
    ["Entity Address", "2 Oriente 248"],       // leading digit, but not a box caption
    ["Country of Incorporation", "Netherlands"],
    ["Functional currency", "EUR"],
  ];
  const p = new Map(DP.detectProfile(sheet).profile.map((f) => [f.key, f.value]));
  assert.strictEqual(p.get("legalName"), "ACME HOLDINGS BV");
  assert.strictEqual(p.get("addr1"), "2 Oriente 248");
  assert.strictEqual(p.get("countryInc"), "Netherlands");
  assert.strictEqual(p.get("currency"), "EUR");
});

t("a postal code is still a valid address line (the letter rule is below-row only)", () => {
  const sheet = [["Legal Name of Entity", "ACME"], ["Postal code", "94105"]];
  const p = new Map(DP.detectProfile(sheet).profile.map((f) => [f.key, f.value]));
  assert.strictEqual(p.get("addr3"), "94105");
});

/* ---------- currency ---------- */

t("a currency code standing alone beats the same letters buried in a caption", () => {
  // CLP appears once, as its own cell. INR appears twice, inside a caption.
  const c = DP.sniffCurrency(FORM);
  assert.strictEqual(c.value, "CLP", `picked ${c && c.value} from "${c && c.sourceLabel}"`);
});

t("a bracketed code counts as standing alone", () => {
  const rows = [["Amounts in", "(GBP)"], ["MUR consultancy note text here", "1"], ["MUR again in prose", "2"]];
  assert.strictEqual(DP.sniffCurrency(rows).value, "GBP");
});

t("with nothing standing alone, frequency still decides", () => {
  const rows = [["fees paid in SEK on account", "1"], ["more SEK detail", "2"], ["one NOK mention", "3"]];
  assert.strictEqual(DP.sniffCurrency(rows).value, "SEK");
});

t("USD is never the answer — it is the reporting currency", () => {
  const rows = [["USD"], ["USD"], ["THB"]];
  assert.strictEqual(DP.sniffCurrency(rows).value, "THB");
});

/* ---------- country from currency (fix lives in the store; data checked here) ---------- */

t("the rate tables name Chile for CLP, so the country need not be on the form", () => {
  assert.strictEqual(FX.FX_META["CLP"].country, "Chile");
});

t("a shared currency names no single country and must be skipped", () => {
  const guard = /\b(zone|union|area)\b/i;
  assert.ok(guard.test(FX.FX_META["EUR"].country), `EUR maps to "${FX.FX_META["EUR"].country}"`);
  assert.ok(!guard.test(FX.FX_META["CLP"].country));
  assert.ok(!guard.test(FX.FX_META["GBP"].country));
});

const STORE = fs.readFileSync(path.join(__dirname, "..", "src", "prototype", "wp", "store.ts"), "utf8");

t("the store proposes the country from the currency, guarded, and never overwrites", () => {
  assert.ok(/if \(profile\.currency && !profile\.countryInc\)/.test(STORE), "not guarded on a blank field");
  assert.ok(/\\b\(zone\|union\|area\)\\b/.test(STORE) || /\(zone\|union\|area\)/.test(STORE), "shared currencies not excluded");
  assert.ok(/propose\(profile, "countryInc", country/.test(STORE), "the proposal is not made");
});

/* ---------- Schedule E: a placeholder is not a finding ---------- */

t("'booked at zero' and 'never found' are carried as different facts", () => {
  assert.ok(/const taxFound = taxCur !== null;/.test(STORE), "the distinction is not computed");
  assert.ok(/level: taxFound \? "info" : "warn"/.test(STORE), "a missing tax figure is not raised as a warning");
  assert.ok(/ZERO PLACEHOLDER, not a finding/.test(STORE), "the placeholder wording is missing");
  // The old text asserted a fact the tool had not established.
  const nilBranch = STORE.slice(STORE.indexOf("id: \"sch-e-nil\""), STORE.indexOf("id: \"sch-e-nil\"") + 1600);
  assert.ok(/taxFound[\s\S]*the statements book no income tax/.test(nilBranch),
    "the nil assertion is no longer conditional on having found a figure");
});

/* ---------- the shipped bundle carries the same code ---------- */

const DIST = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");

t("dist carries all four fixes, wired in", () => {
  for (const [marker, why] of [
    ["/*EN9CCY-BEGIN*/", "currency ranking"],
    ["/*EN9BOX-BEGIN*/", "boxed-row helpers"],
    ["/*EN9BOXV-BEGIN*/", "boxed value resolution"],
    ["/*EN9CTRY-BEGIN*/", "country from currency"],
    ["/*EN9NILF-BEGIN*/", "Schedule E tax-found flag"],
  ]) assert.ok(DIST.includes(marker), `${why} missing from dist`);
  assert.ok(DIST.includes("EN9valueBelow(EN9bl,a,"), "the boxed fallback is defined but never called");
  assert.ok(DIST.includes("EN9nilFound?\"info\":\"warn\""), "the Schedule E level is not conditional");
  assert.ok(DIST.includes("ZERO PLACEHOLDER, not a finding"), "the placeholder wording is missing from dist");
});

/* Extract the shipped detectProfile and sniffCurrency and RUN them. The
   region spans from the yes/no cleaners to the end of the currency sniffer;
   its only free names are the rate metadata and the ISO list built from it. */
function shipped() {
  const cut = (from, to) => {
    const i = DIST.indexOf(from);
    let d = 0, k = DIST.indexOf("{", DIST.indexOf(to, i));
    for (;; k++) { if (DIST[k] === "{") d++; else if (DIST[k] === "}") d--; if (!d) break; }
    return DIST.slice(i, k + 1);
  };
  const meta = cut("var Pa={AFN:", "var Pa={AFN:");
  const region = DIST.slice(DIST.indexOf("var jJ="), DIST.indexOf(cut("/*EN9CCY-BEGIN*/", "function pF(t)")) + cut("/*EN9CCY-BEGIN*/", "function pF(t)").length);
  return new Function(`${meta};\nvar el=Object.keys(Pa).sort();\n${region}\nreturn {QF, pF};`)();
}

t("the shipped detectProfile reads a boxed form the same way src does", () => {
  const { QF } = shipped();
  const want = DP.detectProfile(FORM).profile.map((f) => [f.key, f.value, f.confidence]);
  const got = QF(FORM).profile.map((f) => [f.key, f.value, f.confidence]);
  assert.deepStrictEqual(got, want);
  assert.deepStrictEqual(got, [
    ["legalName", "EJEMPLO SOCIEDAD LIMITADA", "medium"],
    ["activity", "ENSENANZA PREESCOLAR PRIVADA", "medium"],
  ]);
});

t("the shipped detectProfile leaves an ordinary questionnaire alone", () => {
  const { QF } = shipped();
  const sheet = [
    ["Legal Name of Entity", "ACME HOLDINGS BV"],
    ["Entity Address", "2 Oriente 248"],
    ["Country of Incorporation", "Netherlands"],
    ["Functional currency", "EUR"],
    ["Postal code", "94105"],
  ];
  const got = QF(sheet).profile.map((f) => [f.key, f.value, f.confidence]);
  assert.deepStrictEqual(got, DP.detectProfile(sheet).profile.map((f) => [f.key, f.value, f.confidence]));
  // Every one read straight across the row, as before these fixes.
  assert.ok(got.every((g) => g[2] === "high"), JSON.stringify(got));
});

t("the shipped currency sniffer picks CLP over the buried INR, as src does", () => {
  const { pF } = shipped();
  assert.strictEqual(pF(FORM).value, "CLP");
  assert.deepStrictEqual(pF(FORM), DP.sniffCurrency(FORM));
});

t("dist's boxed-row helpers behave exactly like src's", () => {
  const body = /\/\*EN9BOX-BEGIN\*\/[\s\S]*?\/\*EN9BOX-END\*\//.exec(DIST)[0];
  const h = new Function(`${body}\nreturn {EN9boxedRow, EN9valueBelow, EN9BOXCAP};`)();
  assert.strictEqual(h.EN9boxedRow(FORM[0]), true, "a row of numbered captions is a boxed row");
  assert.strictEqual(h.EN9boxedRow(["Entity Address", "1 Main Street"]), false,
    "a caption and its value is not a boxed row");
  assert.strictEqual(h.EN9BOXCAP.test("02 Apellido Materno"), true);
  assert.strictEqual(h.EN9BOXCAP.test("2 Oriente 248"), false, "an address is not a box caption");
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
