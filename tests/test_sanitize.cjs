/* Text and number hygiene.
 *
 * A PDF producer writes "office" with the ffi LIGATURE, a non-breaking space
 * between a figure and its currency, curly quotes in a caption, an en dash
 * where a hyphen belongs. Each is a different code point from the ASCII the
 * keyword lexicon is written in, so the caption does not match and the row
 * lands in the unmatched list -- while the two strings look identical on
 * screen. That is the whole reason the lexicon can stay plain ASCII.
 *
 * And rounding: -1.005 and 1.005 must round in the SAME direction, which they
 * do not if the EPSILON bias is applied to the signed value.
 *
 * Both are checked against the shipped implementation, extracted from dist by
 * its sentinels, so the two cannot drift.
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
const SRC = load("src/prototype/wp/hygiene.ts");

/** The shipped implementation, evaluated out of dist. */
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
function region(tag) {
  const b = dist.indexOf("/*" + tag + "-BEGIN*/"), e = dist.indexOf("/*" + tag + "-END*/");
  assert.ok(b > 0 && e > b, tag + " sentinels present");
  return dist.slice(b + tag.length + 10, e);
}
const SHIPPED = (() => {
  const sandbox = {};
  new Function("exports", region("EN9SANI") + region("EN9ROUND") +
    ";exports.sanitize=EN9sanitize;exports.r2=EN9r2;exports.r2add=EN9r2add;")(sandbox);
  return sandbox;
})();

const LIG = "ﬀﬁﬂﬃﬄﬅﬆ";
const CASES = [
  ["oﬃce expenses", "office expenses"],
  ["staﬀ", "staff"],
  ["1 234", "1 234"],
  ["‘Other’ income", "'Other' income"],
  ["“Sundry”", '"Sundry"'],
  ["profit – loss", "profit - loss"],
  ["profit — loss", "profit - loss"],
  ["−5", "-5"],
  [LIG, "fffiflffifflstst"],
  ["clean caption", "clean caption"],
];

t("typographic look-alikes fold to the ASCII the lexicon is written in", () => {
  for (const [input, want] of CASES) assert.strictEqual(SRC.sanitize(input), want, JSON.stringify(input));
});

t("control characters go, but tab, newline and carriage return stay", () => {
  assert.strictEqual(SRC.sanitize("abcd"), "abcd");
  assert.strictEqual(SRC.sanitize("a\tb\nc\rd"), "a\tb\nc\rd");
});

t("null and undefined pass through -- their absence is meaningful", () => {
  assert.strictEqual(SRC.sanitize(null), null);
  assert.strictEqual(SRC.sanitize(undefined), undefined);
});

t("sanitize matches the shipped implementation", () => {
  for (const [input] of CASES) assert.strictEqual(SRC.sanitize(input), SHIPPED.sanitize(input), JSON.stringify(input));
  assert.strictEqual(SRC.sanitize("ab\tc"), SHIPPED.sanitize("ab\tc"));
  assert.strictEqual(SRC.sanitize(null), SHIPPED.sanitize(null));
});

t("rounding is sign-symmetric: 1.005 and -1.005 go the same way", () => {
  assert.strictEqual(SRC.r2(1.005), 1.01);
  assert.strictEqual(SRC.r2(-1.005), -1.01);
  assert.strictEqual(SRC.r2(0.1 + 0.2), 0.3);
  assert.strictEqual(SRC.r2(2290116), 2290116);
});

t("r2 passes non-numbers and non-finite values through", () => {
  for (const v of ["1.005", null, undefined, NaN, Infinity, -Infinity]) {
    const got = SRC.r2(v);
    if (typeof v === "number" && isNaN(v)) assert.ok(isNaN(got));
    else assert.strictEqual(got, v, String(v));
  }
});

t("r2add treats an absent operand as zero and rounds once", () => {
  assert.strictEqual(SRC.r2add(undefined, 1.005), 1.01);
  assert.strictEqual(SRC.r2add(0.1, 0.2), 0.3);
  assert.strictEqual(SRC.r2add(null, null), 0);
  assert.strictEqual(SRC.r2add("nonsense", 5), 5);
});

t("a column of twenty contributions carries no float error into the cell", () => {
  let viaAdd, plain = 0;
  for (let i = 0; i < 20; i++) { viaAdd = SRC.r2add(viaAdd, 0.1); plain += 0.1; }
  assert.strictEqual(viaAdd, 2);
  assert.notStrictEqual(plain, 2);   // this is the bug being fixed
});

t("r2 and r2add match the shipped implementation", () => {
  for (const v of [1.005, -1.005, 0.1 + 0.2, 2290116, -0.0049, 1e12 + 0.005]) {
    assert.strictEqual(SRC.r2(v), SHIPPED.r2(v), String(v));
  }
  for (const [a, b] of [[undefined, 1.005], [0.1, 0.2], [null, null], [-3.335, 1.11], [5, undefined]]) {
    assert.strictEqual(SRC.r2add(a, b), SHIPPED.r2add(a, b), a + "+" + b);
  }
});

/* The call sites are the point: a helper nobody calls fixes nothing. */
const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
const engine = fs.readFileSync(path.join(root, "src", "prototype", "wp", "engine.ts"), "utf8");
const pdfText = fs.readFileSync(path.join(root, "src", "prototype", "wp", "pdfText.ts"), "utf8");

t("applyRowHygiene sanitizes the caption before anything reads it", () => {
  const body = engine.slice(engine.indexOf("function applyRowHygiene"));
  assert.ok(/label = sanitize\(String\(label \|\| ""\)\);/.test(body.slice(0, 400)), "not the first thing it does");
});

t("the PDF cell cleaner sanitizes", () => {
  assert.ok(pdfText.includes("return sanitize(s)"), "cleanCellText does not sanitize");
});

t("manualApply accumulates through r2add on all three fields", () => {
  assert.strictEqual((store.match(/r2add\(cur\.(amount|eoy|boy), booked\)/g) || []).length, 3);
});

t("buildWrites rounds numbers and sanitizes strings on the way to the cell", () => {
  assert.ok(store.includes(
    'typeof w.value === "number" ? (w.dp ? roundDp(w.value, w.dp) : r2(w.value)) : typeof w.value === "string" ? sanitize(w.value) : w.value'),
    "buildWrites does not clean the value");
});

t("the bulk booking loop still accumulates with plain + , as the shipped app does", () => {
  // Deliberate: rounding there would diverge from dist for no benefit -- the
  // contributions are already whole-unit figures read off a statement.
  const loop = store.slice(store.indexOf("const booked = taxBookValue(resolved.target"));
  assert.ok(/typeof cur\.amount === "number" \? cur\.amount : 0\) \+ booked/.test(loop.slice(0, 2500)),
    "the step-3 loop was changed; dist still uses plain +");
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
