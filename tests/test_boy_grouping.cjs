/* cf-boy-grouping — the opening-liabilities grouping warning.
 *
 * When the prior return reported nothing on Schedule F line 15 and put the
 * whole payable on line 16, but the current year splits payables across both
 * lines, the two columns show the same money on different lines. That is not
 * an error — the preparer decides — so it is a warning, not a block.
 *
 * The check lived only in src/. This runs the block that was patched into the
 * shipped app (EN9BOYGRP sentinels) against the cases that matter, and
 * pins its message text against the source's, so the two cannot drift.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const src = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");

const B = "/*EN9BOYGRP-BEGIN*/", E = "/*EN9BOYGRP-END*/";
const i = dist.indexOf(B), j = dist.indexOf(E);
assert.ok(i > 0 && j > i, "EN9BOYGRP sentinels present in dist");
const block = dist.slice(i + B.length, j);

// The shipped identifiers this block closes over: cf, ent, rv, numeric, SHEET, source.
const run = new Function("a", "t", "o", "Ii", "Ce", "A", block);
const numeric = (s) => { const n = Number(String(s).replace(/,/g, "")); return s === "" || !isFinite(n) ? null : n; };
const SHEET = { bs: "Balance Sheet" };

/** @param prior {ap,ocl} filed USD  @param cur {ap,ocl} current-year local */
const raise = (prior, cur) => {
  const items = [];
  run(
    { priorClosingUSD: { ap: prior.ap === undefined ? undefined : { value: prior.ap },
                         ocl: prior.ocl === undefined ? undefined : { value: prior.ocl } } },
    { lines: { "BS:46": { eoy: cur.ap ?? "" }, "BS:47": { eoy: cur.ocl ?? "" } } },
    (it) => items.push(it), numeric, SHEET, "2023 Form 5471.pdf",
  );
  return items;
};

t("prior grouped on line 16 + current split across 15/16 raises the warning", () => {
  const [it] = raise({ ap: 0, ocl: 412_500 }, { ap: 90_000, ocl: 322_500 });
  assert.ok(it, "expected an item");
  assert.strictEqual(it.id, "cf-boy-grouping");
  assert.strictEqual(it.level, "warn");
  assert.strictEqual(it.category, "carry-forward");
  assert.strictEqual(it.target, "Balance Sheet!D46");
  assert.strictEqual(it.source, "2023 Form 5471.pdf");
  assert.ok(it.message.includes("412,500"), "quotes the filed line-16 amount: " + it.message);
});

t("an absent prior line 15 (undefined, not 0) counts as grouped", () => {
  assert.strictEqual(raise({ ocl: 412_500 }, { ap: 90_000, ocl: 322_500 }).length, 1);
});

t("prior year that already split the payable raises nothing", () => {
  assert.strictEqual(raise({ ap: 100_000, ocl: 312_500 }, { ap: 90_000, ocl: 322_500 }).length, 0);
});

t("current year on one line only raises nothing", () => {
  assert.strictEqual(raise({ ap: 0, ocl: 412_500 }, { ocl: 412_500 }).length, 0);
  assert.strictEqual(raise({ ap: 0, ocl: 412_500 }, { ap: 412_500 }).length, 0);
});

t("nothing filed on line 16 raises nothing (no grouping to report)", () => {
  assert.strictEqual(raise({ ap: 0 }, { ap: 90_000, ocl: 322_500 }).length, 0);
});

t("dist and src carry the same message text", () => {
  const strip = (s) => s.replace(/\$\{[^}]*\}/g, "${}").replace(/\s+/g, " ").trim();
  const pick = (hay) => {
    const k = hay.indexOf("Beginning-of-year liabilities");
    assert.ok(k > 0, "message not found");
    return hay.slice(k, hay.indexOf("`", k));
  };
  assert.strictEqual(strip(pick(block)), strip(pick(src)));
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
