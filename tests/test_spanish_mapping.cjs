/* Non-English statements — Premium Care Plastic Surgery SAS (Colombia).
 *
 * Before: 1 of 25 captions matched a rule, and that one line's value was 0,
 * so the entity showed "0 lines" with no explanation. The rule set was
 * English with a few French terms and exactly ONE Spanish word.
 *
 * The single clearest miss: the payroll rule keyword is "personnel"; Spanish
 * is "personal". One letter apart, and 81,704,489 COP of payroll went
 * unmapped.
 */
const assert = require("assert");
const path = require("path");
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
const CAP = load("src/prototype/wp/captions.ts");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/** Longest-keyword-wins match, as the engine does it. */
function match(label) {
  const l = String(label).toLowerCase();
  let best = null, len = 0;
  for (const r of ENG.DEFAULT_RULES) {
    for (const k of r.kw) if (l.includes(k) && k.length > len) { len = k.length; best = r.t; }
  }
  return best;
}

/* Real captions and amounts from the two uploaded statements. */
const ROWS = [
  ["CAJA GENERAL", 0, "BS:10"],
  ["BANCOS NACIONALES", 18178, "BS:10"],
  ["CUENTAS DE AHORROS", 0, "BS:10"],
  ["DEUDORES", 82600026, "BS:11"],
  ["MAQUINARIA Y EQUIPO", 23844225, "BS:28"],
  ["EQUIPO DE OFICINA", 171982103, "BS:28"],
  ["EQUIPO DE COMPUTACION Y COMUNICACION", 34965942, "BS:28"],
  ["(-) Depr. Acumulada", 81142564, "BS:29"],
  ["ACREEDORES VARIOS", 173832374, "BS:46"],
  ["RET. Y APORTES DE NOMINA", 1319600, "IS:26"],
  ["CESANTIAS CONSOLIDADAS", 4603200, "IS:26"],
  ["VACACIONES CONSOLIDAS", 1951872, "IS:26"],
  ["CAPITAL SUSCRITO Y PAGADO", 100000000, "BS:59"],
  ["UTILIDADES O EXCEDENTES ACUMULADOS", 30010429, "BS:61"],
  ["GASTOS DEL PERSONAL", 81704489, "IS:26"],
  ["GASTOS LEGALES", 1708400, "IS:OD"],
  ["INGRESOS OPERACIONALES", 0, "IS:7"],
];

t("the payroll line that was one letter from matching now maps", () => {
  // "personnel" (rule) vs "personal" (Spanish) — 81.7m COP hung on this.
  assert.strictEqual(match("GASTOS DEL PERSONAL"), "IS:26");
});

t("every expected Spanish caption maps to the right template line", () => {
  const wrong = ROWS.filter(([c, , want]) => match(c) !== want)
    .map(([c, , want]) => `${c}: got ${match(c)}, want ${want}`);
  assert.deepStrictEqual(wrong, [], wrong.join(" | "));
});

t("coverage rose from 1 caption to nearly all of them", () => {
  const mapped = ROWS.filter(([c]) => { const m = match(c); return m && m !== "SKIP"; });
  assert.ok(mapped.length >= 16, `only ${mapped.length} of ${ROWS.length} mapped`);
});

t("the amounts that were being dropped are now carried", () => {
  const covered = ROWS.filter(([c]) => match(c)).reduce((n, [, v]) => n + v, 0);
  assert.ok(covered > 700_000_000, `only ${covered} COP covered`);
});

t("genuinely ambiguous single words are NOT force-matched", () => {
  // Both appear on the income AND the expense side of this same statement
  // ("TOTAL ING. NO OPERACIONALES" vs "TOTAL GTOS NO OPERACIONALES"), so a
  // bare keyword would be wrong half the time. Left for the section banner.
  assert.strictEqual(match("SERVICIOS"), null);
  assert.strictEqual(match("FINANCIEROS"), null);
});

t("Spanish additions do not hijack English captions", () => {
  assert.strictEqual(match("Cash at bank and in hand"), "BS:10");
  assert.strictEqual(match("Accounts payable"), "BS:46");
  assert.strictEqual(match("Trade receivables"), "BS:11");
  assert.strictEqual(match("Accumulated depreciation"), "BS:29");
  assert.strictEqual(match("Salaries and wages"), "IS:26");
  assert.strictEqual(match("Share capital"), "BS:59");
  assert.strictEqual(match("Retained earnings"), "BS:61");
});

t("subtotals are still skipped, so nothing double-counts", () => {
  for (const s of ["Total assets", "Total liabilities", "Net income", "Gross profit"]) {
    assert.strictEqual(match(s), "SKIP", s);
  }
});

t("a translated caption matches when the raw one cannot", () => {
  // The mapping fallback: raw label first, then the stored translation.
  const raw = "SERVICIOS PUBLICOS";
  assert.strictEqual(match(raw), null, "raw Spanish should not match");
  assert.strictEqual(match("Utilities"), "IS:OD", "translation should match");
});

t("the statements are detected as Spanish for the diagnostic", () => {
  const spanish = ROWS.filter(([c]) => CAP.detectLanguage(c) !== "English");
  assert.ok(spanish.length >= 1, "no caption detected as non-English");
});

/* ---- The gate BEFORE mapping: page classification. ----
   Even with Spanish keywords in the rules, these statements produced 0 lines
   because their PAGES never reached the mapper. Two English-only gates:
     1. the FS "band" needed an Anglo company identifier (ABN/ACN/company
        number/Companies House). Colombia prints "NIT No. 900,574,408-0".
     2. the titles are "BALANCE GENERAL" and "ESTADO DE RESULTADO", not
        "Balance Sheet" / "Income Statement".
   Both failed, the page classified as "unknown", and nothing was extracted —
   which is why the entity showed 0 lines with 0 unmatched captions too. */
const CLS = load("src/prototype/wp/classify.ts");

const mkDoc = (lines) => {
  const rows = lines.map((l) => ({
    page: 1,
    cells: l.split("|").map((c) => ({ text: c.trim(), x0: 0 })).filter((c) => c.text),
  }));
  return { rows, pageCount: 1, pages: [{ page: 1 }] };
};

t("a Colombian balance sheet is recognised as a balance sheet", () => {
  const doc = mkDoc([
    "PREMIUM CARE PLASTIC SURGERY SAS",
    "NIT No. 900,574,408-0",
    "BALANCE GENERAL",
    "A DICIEMBRE 31 DE 2024",
    "A C T I V O S",
    "CAJA GENERAL | 0",
    "BANCOS NACIONALES | 18,178",
  ]);
  assert.strictEqual(CLS.classifyPages(doc)[0].kind, "fs-balance-sheet");
});

t("a Colombian income statement is recognised as a P&L", () => {
  const doc = mkDoc([
    "PREMIUM CARE PLASTIC SURGERY SAS",
    "NIT No. 900,574,408-0",
    "ESTADO DE RESULTADO",
    "A DICIEMBRE 31 DE 2024",
    "INGRESOS OPERACIONALES",
    "GASTOS DEL PERSONAL | 81,704,489",
  ]);
  assert.strictEqual(CLS.classifyPages(doc)[0].kind, "fs-pnl");
});

t("other non-English statement titles are recognised too", () => {
  const cases = [
    ["BALANCE GENERAL", "NIT No. 900.123-4", "fs-balance-sheet"],
    ["ESTADO DE SITUACION FINANCIERA", "RUC 20123456789", "fs-balance-sheet"],
    ["BALANCO PATRIMONIAL", "CNPJ 12.345.678/0001-95", "fs-balance-sheet"],
    ["BILAN", "SIREN 123456789", "fs-balance-sheet"],
    ["ESTADO DE RESULTADOS", "RFC ABC123456XYZ", "fs-pnl"],
    ["COMPTE DE RESULTAT", "SIRET 12345678900011", "fs-pnl"],
  ];
  for (const [title, id, want] of cases) {
    const got = CLS.classifyPages(mkDoc(["ACME LTDA", id, title, "A DICIEMBRE 31 DE 2024", "CAJA | 100"]))[0].kind;
    assert.strictEqual(got, want, `${title} -> ${got}`);
  }
});

t("English statements still classify exactly as before", () => {
  const uk = mkDoc([
    "ACME TRADING LIMITED", "Company number 01234567", "Balance Sheet",
    "as at 31 December 2024", "Cash at bank | 1,000",
  ]);
  assert.strictEqual(CLS.classifyPages(uk)[0].kind, "fs-balance-sheet");
  const pl = mkDoc([
    "ACME TRADING LIMITED", "Company number 01234567", "Profit and Loss Account",
    "for the year ended 31 December 2024", "Turnover | 5,000",
  ]);
  assert.strictEqual(CLS.classifyPages(pl)[0].kind, "fs-pnl");
});

t("an unrelated page is still not mistaken for a statement", () => {
  const junk = mkDoc(["SOME COVER LETTER", "Dear Sir or Madam", "Please find enclosed"]);
  assert.strictEqual(CLS.classifyPages(junk)[0].kind, "unknown");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
