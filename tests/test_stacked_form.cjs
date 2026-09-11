/* Boxed tax forms — a caption and its amount are NOT on the same line.
 *
 * A Chilean SII Form 22 (and every form built the same way) prints a numbered
 * box: the box CODE at the far left, the CAPTION on the line above, the AMOUNT
 * right-aligned inside the box. The row reader needs a label and a number on
 * one row, so it read 0 lines from the entire filing — the entity came out
 * empty with nothing to explain why.
 *
 * The geometry below is the real form's layout and the real form's wording.
 * The amounts are invented: the shape is what is under test, and a client's
 * filed figures do not belong in a repository.
 *
 * Every rule here exists because a looser one booked something wrong:
 *   - "nearest number to the caption" booked the box CODE as the amount
 *     (Total del Activo = 122).
 *   - "money-shaped anywhere to the right" booked a NEIGHBOURING box's code
 *     and paired an email address with a figure.
 *   - the sentence tail "...deberá declarar por Internet)" looked like a
 *     caption and mapped, on the word "Internet", to telephone expense.
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

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/** [text, x0, x1] -> cell */
const C = (text, x0, x1) => ({ text, x0, x1 });
const R = (y, ...cells) => ({ page: 1, y, cells });

const DOC = { pageCount: 1, rows: [
  // Two boxes, cleanly separated: code, amount, code, amount.
  R(551, C("Región", 53, 72), C("Capital Efectivo", 330, 372)),
  R(549, C("53", 31, 39), C("5", 290, 293), C("102", 306, 318), C("777.777.777", 532, 570)),
  R(521, C("Total del Activo", 53, 94), C("Total del Pasivo", 330, 373)),
  R(519, C("122", 29, 41), C("111.111.111", 260, 293), C("123", 306, 318), C("222.222.222", 537, 570)),
  // The right box's code runs together with the left box's amount.
  R(311, C("Ingresos del giro percibidos", 53, 126),
         C("Existencias, insumos y servicios del negocio, pagados", 330, 474)),
  R(309, C("1400", 27, 43), C("333.333.333 1409", 260, 320), C("444.444.444", 537, 570)),
  // A code runs together with caption text that wrapped down onto the value line.
  R(345, C("BASE IMPONIBLE IDPC de empresas acogidas al régimen de", 53, 219),
         C("IDPC de empresas acogidas al régimen de imputación parcial de", 330, 503)),
  R(339, C("1109 imputación parcial de créditos, según art. 14 letra A) LIR", 27, 203),
         C("555.555.555 1113 créditos, según art. 14 letra A) LIR", 260, 421),
         C("666.666.666", 540, 570)),
  // A wrapped sentence sitting where a caption would be.
  R(101, C("Rentas afectas a IGC o IA (RAI) del ejercicio", 53, 172),
         C("inicial (saldo positivo)", 330, 387)),
  R(99, C("1500", 27, 43), C("321.321.321", 263, 293), C("1502", 306, 318), C("654.654.654", 540, 570)),
  // A whole prose line on the value row, plus a date that must not read as money.
  R(491, C("Fecha Presentación", 330, 383)),
  R(489, C("305", 29, 41),
         C("resultado es negativo o cero, deberá declarar por Internet)", 53, 208),
         C("888.888", 266, 293), C("315", 306, 318), C("30/04/2025", 540, 570)),
]};

const pairs = ENG.stackedCaptionRows(DOC);
const got = new Map(pairs);

t("a boxed form yields caption/amount pairs at all (it read zero lines before)", () => {
  assert.ok(pairs.length >= 8, `only ${pairs.length} pairs`);
});

t("the box CODE printed left of the caption is never booked as the amount", () => {
  assert.strictEqual(got.get("Total del Activo"), "111.111.111");   // not "122"
  assert.strictEqual(got.get("Total del Pasivo"), "222.222.222");   // not "123"
});

t("a one-digit amount on the value column is kept (it is not a code)", () => {
  // "Región = 5" was lost when only separator-carrying figures counted as money.
  assert.strictEqual(got.get("Región"), "5");
  assert.strictEqual(got.get("Capital Efectivo"), "777.777.777");
});

t("a code glued onto the previous box's amount is split off, not booked", () => {
  assert.strictEqual(got.get("Ingresos del giro percibidos"), "333.333.333");
  // and splitting it re-opens the right-hand box, which was lost entirely.
  assert.strictEqual(got.get("Existencias, insumos y servicios del negocio, pagados"), "444.444.444");
});

t("a code glued in front of wrapped caption text still opens its box", () => {
  assert.strictEqual(got.get("BASE IMPONIBLE IDPC de empresas acogidas al régimen de"), "555.555.555");
  assert.strictEqual(got.get("IDPC de empresas acogidas al régimen de imputación parcial de"), "666.666.666");
});

t("a lower-case wrap fragment is not accepted as a box caption", () => {
  assert.strictEqual(got.get("Rentas afectas a IGC o IA (RAI) del ejercicio"), "321.321.321");
  assert.strictEqual(got.has("inicial (saldo positivo)"), false);
});

t("a date is not money and prose is not a caption", () => {
  assert.strictEqual(got.has("Fecha Presentación"), false);
  for (const [label, value] of pairs) {
    assert.ok(!/^\d{2}\/\d{2}\/\d{4}$/.test(value), `${label} booked a date`);
    assert.ok(!/deberá declarar/.test(label), "a sentence was taken as a caption");
  }
});

t("no caption is paired twice and no code survives as a value", () => {
  const labels = pairs.map(([l]) => l);
  assert.strictEqual(new Set(labels).size, labels.length, "duplicate caption");
  for (const [label, value] of pairs) {
    assert.ok(!/^(1[0-9]{3}|[0-9]{2,3})$/.test(value) || label === "Región",
      `${label} = ${value} looks like a box code`);
  }
});

/* ---------- what the pairs then map to ---------- */

const rowsOf = (ps) => ENG.extractRows(ps.map(([l, v]) => [l, v]));
const target = (label, value) => {
  const r = ENG.extractRows([[label, value]]);
  return r.length ? ENG.matchRule(r[0].label, ENG.DEFAULT_RULES) : "DROPPED";
};

t("an expense box named after the income it is deducted from is a DEDUCTION", () => {
  // Both real wordings. The only keyword either used to hit was "ingresos",
  // so a Chilean entity's catch-all expense was booked as revenue.
  assert.strictEqual(target("Otros gastos deducibles de los ingresos", "622.624"), "IS:OD");
  assert.strictEqual(target("Otros gastos deducidos de los ingresos brutos", "184.913.638"), "IS:OD");
});

t("the return's own totals are skipped, not booked alongside their components", () => {
  for (const c of ["Total del Activo", "Total del Pasivo", "Total de ingresos anuales", "Total de egresos anuales"]) {
    assert.strictEqual(target(c, "1.000.000"), "SKIP", c);
  }
});

t("depreciation is stated twice on the return and must not be counted twice", () => {
  assert.strictEqual(target("Depreciación financiera del ejercicio", "115.585.728"), "IS:30");
  assert.strictEqual(target("Depreciación tributaria del ejercicio", "115.585.728"), "SKIP");
});

t("the remaining Chilean income and expense boxes reach the right lines", () => {
  const want = [
    ["Ingresos del giro percibidos", "IS:7"],
    ["Otros ingresos percibidos o devengados", "IS:OI"],
    ["Costo directo de los bienes y servicios", "IS:11"],
    ["Existencias, insumos y servicios del negocio, pagados", "IS:11"],
    ["Remuneraciones pagadas", "IS:26"],
    ["Arriendos", "IS:27"],
    ["Intereses pagados o adeudados", "IS:29"],
    ["Honorarios pagados", "IS:OD"],
  ];
  const wrong = want.filter(([c, w]) => target(c, "1.000.000") !== w)
    .map(([c, w]) => `${c}: got ${target(c, "1.000.000")}, want ${w}`);
  assert.deepStrictEqual(wrong, [], wrong.join(" | "));
});

t("unmatched brackets mark a wrapped sentence and drop the row", () => {
  assert.strictEqual(target("resultado es negativo o cero, deberá declarar por Internet)", "888.888"), "DROPPED");
  assert.strictEqual(target("Capital aportado, histórico (incluye aumentos y disminuciones", "1.250.000"), "DROPPED");
});

t("an enumerator is not a bracket: 'a) Cash' still maps", () => {
  assert.strictEqual(target("a) Cash at bank", "1.000"), "BS:10");
  // The sign marker is a balanced pair, so it is not a wrap fragment.
  assert.strictEqual(target("(-) Depreciacion Acumulada", "1.000"), "BS:29");
});

/* ---------- the shipped bundle carries the same code ---------- */

const DIST = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");

t("dist carries the stacked reader and calls it on every PDF", () => {
  assert.ok(DIST.includes("/*EN9STACK-BEGIN*/"), "EN9STACK block missing");
  assert.ok(DIST.includes(".concat(EN9stackRows(c))"), "EN9stackRows is defined but never called");
  assert.ok(DIST.includes("/*EN9UNBAL-BEGIN*/") && DIST.includes("EN9unbal(e)?null:"),
    "the bracket guard is not wired into the row reader");
});

t("dist carries the same mapping rules as src", () => {
  for (const kw of ["de los ingresos", "gastos deducidos", "costo directo", "insumos y servicios",
                    "remuneracion", "arriendo", "otros ingresos", "total del activo",
                    "depreciaci\\u00F3n tributaria", "resultado financiero"]) {
    assert.ok(DIST.includes(`"${kw}"`), `dist is missing keyword ${kw}`);
  }
});

t("dist's stacked reader returns exactly what src's does", () => {
  // Extract the shipped function and run it on the same geometry.
  const numeric = (() => {
    const i = DIST.indexOf("function Ii(t){");
    let d = 0, k = DIST.indexOf("{", i);
    for (;; k++) { if (DIST[k] === "{") d++; else if (DIST[k] === "}") d--; if (!d) break; }
    return DIST.slice(i, k + 1);
  })();
  const cells = /var Oa=t=>\{[\s\S]*?\},\$w=t=>[\s\S]*?===null,/.exec(DIST)[0].replace(/,$/, ";");
  const stack = /\/\*EN9STACK-BEGIN\*\/[\s\S]*?\/\*EN9STACK-END\*\//.exec(DIST)[0];
  const shipped = new Function(`${numeric}\n${cells}\n${stack}\nreturn EN9stackRows;`)();
  assert.deepStrictEqual(shipped(DOC), pairs);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
