/* Number formats the parser must read.
 *
 * Chile (and Spain, Germany, Brazil) group thousands with dots. The parser
 * only stripped dots when a comma was also present, so a dot-grouped figure
 * fell through to parseFloat, which stops at the second dot: the Cecilia
 * Gonzalez Acuna SpA balance sheet read 2.555.002.379 as 2.555 — a billion
 * times too small, silently.
 *
 * Figures below are the real ones from the client's SII Form 22 filings.
 */
const assert = require("assert");
const fs = require("fs");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/* numeric(), lifted from the shipped engine so the test tracks the real code. */
const src = fs.readFileSync(require.resolve("../src/prototype/wp/engine.ts"), "utf8");
const body = src.slice(src.indexOf("export function numeric("));
const fnText = body.slice(body.indexOf("{"), body.indexOf("\n}") + 2)
  .replace(/: unknown|: number \| null|: string/g, "");
const numeric = new Function("v", fnText.slice(1, -1).replace(/^\s*/, ""));

t("Chilean thousands: total assets", () => assert.strictEqual(numeric("2.555.002.379"), 2555002379));
t("Chilean thousands: total liabilities", () => assert.strictEqual(numeric("2.349.644.310"), 2349644310));
t("Chilean thousands: operating revenue", () => assert.strictEqual(numeric("1.973.582.648"), 1973582648));
t("Chilean thousands: salaries", () => assert.strictEqual(numeric("779.000.384"), 779000384));
t("Chilean thousands: Charlie Brawn total assets", () => assert.strictEqual(numeric("464.138.576"), 464138576));
t("Chilean thousands: negative", () => assert.strictEqual(numeric("-3.658.471"), -3658471));

/* Formats that already worked and must not regress. */
t("US thousands with comma", () => assert.strictEqual(numeric("2,555,002,379"), 2555002379));
t("US figure with trailing period", () => assert.strictEqual(numeric("43,240."), 43240));
t("European decimal comma", () => assert.strictEqual(numeric("1.449,37"), 1449.37));
t("plain decimal point", () => assert.strictEqual(numeric("1449.37"), 1449.37));
t("six-place decimal is NOT a thousands group", () => assert.strictEqual(numeric("0.241879"), 0.241879));
t("bracketed negative", () => assert.strictEqual(numeric("(1,274)"), -1274));
t("credit suffix", () => assert.strictEqual(numeric("1,234 CR"), -1234));
t("blank is null", () => assert.strictEqual(numeric(""), null));
t("text is null", () => assert.strictEqual(numeric("Total del Activo"), null));

/* A single dot stays ambiguous and keeps its existing reading — documented so
   a future change does not silently flip it. */
t("one dot is still read as a decimal point", () => assert.strictEqual(numeric("464.138"), 464.138));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
