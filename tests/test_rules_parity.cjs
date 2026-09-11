/* The mapping catalogue in src must BE the shipped catalogue.
 *
 * Six rule groups and two SKIP keywords were added directly to the built file
 * over months of client work and never made it back into src, so the readable
 * source silently mapped six kinds of caption differently from the app the
 * preparers actually use. This compiles src's DEFAULT_RULES, extracts the
 * array out of dist, and demands they be identical -- not merely compatible.
 *
 * It also pins the behaviour the newest groups exist for: the periodic-
 * inventory pair, where "Opening stock" and "Closing stock" both map to
 * Schedule C line 2 and the closing figure must be SUBTRACTED.
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
const ENG = load("src/prototype/wp/engine.ts");
const SRC = ENG.DEFAULT_RULES;

const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const SHIPPED = (() => {
  const i = dist.indexOf('kw:["cost of sales"');
  assert.ok(i > 0, "the shipped catalogue starts with the SKIP group");
  const start = dist.lastIndexOf("[", i);
  let depth = 0, j = start;
  for (; j < dist.length; j++) {
    const c = dist[j];
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  return new Function("return " + dist.slice(start, j + 1))();
})();

t("src and dist carry the same number of rule groups and keywords", () => {
  const kws = (R) => R.reduce((n, g) => n + g.kw.length, 0);
  assert.strictEqual(SRC.length, SHIPPED.length, `groups: src ${SRC.length} vs dist ${SHIPPED.length}`);
  assert.strictEqual(kws(SRC), kws(SHIPPED), `keywords: src ${kws(SRC)} vs dist ${kws(SHIPPED)}`);
});

t("every group is identical, in the same order", () => {
  assert.deepStrictEqual(SRC, SHIPPED);
});

t("the six groups the review named are present", () => {
  const find = (kw) => SRC.find((g) => g.kw.includes(kw));
  assert.strictEqual(find("werkkostenregeling").t, "IS:26");
  assert.strictEqual(find("kleinmateriaal").t, "IS:OD");
  assert.strictEqual(find("issued & paid up capital").t, "BS:59");
  assert.strictEqual(find("opening stock").t, "IS:12");
  assert.strictEqual(find("closing stock").t, "IS:12");
  assert.strictEqual(find("stock on hand").t, "BS:14");
});

t("Xero and MYOB subtotal wordings are skipped, not booked", () => {
  const skip = SRC.find((g) => g.t === "SKIP");
  assert.ok(skip.kw.includes("total for income"));
  assert.ok(skip.kw.includes("total for expenses"));
});

t('"stock on hand" is a balance, not a cost of sales', () => {
  // The "stock" fragment must not drag the balance-sheet caption into the P&L.
  assert.strictEqual(ENG.matchRule("Stock on hand", SRC), "BS:14");
  assert.strictEqual(ENG.matchRule("Opening stock", SRC), "IS:12");
  assert.strictEqual(ENG.matchRule("Closing stock", SRC), "IS:12");
});

t("the longest matching keyword still wins after the additions", () => {
  assert.strictEqual(ENG.matchRule("Cost of Sales", SRC), "SKIP");
  assert.strictEqual(ENG.matchRule("Total for Income", SRC), "SKIP");
});

/* ---- the closing-stock sign flip, in both trees ---- */

const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");

t("a positive closing-stock contribution is subtracted, not added", () => {
  // Applied as -2x: once to undo the addition the booking loop made, once to
  // subtract it. Reproduced here from the source's own expression.
  const lines = { "IS:12": { amount: 100000 } };          // opening 40,000 + closing 60,000
  const contributions = [{ label: "Closing stock", value: 60000 }];
  for (const c of contributions) {
    if (!/^closing\s/i.test(c.label || "") || c.value <= 0) continue;
    const cur = lines["IS:12"];
    lines["IS:12"] = { amount: (cur && typeof cur.amount === "number" ? cur.amount : 0) - 2 * c.value };
    c.value = -c.value;
  }
  assert.strictEqual(lines["IS:12"].amount, -20000, "opening 40,000 less closing 60,000");
  assert.strictEqual(contributions[0].value, -60000, "the provenance trail must show what was booked");
});

t("the flip is in src and in the shipped app", () => {
  assert.ok(/\/\^closing\\s\/i\.test\(c\.label \|\| ""\)/.test(store), "src has no closing-stock flip");
  assert.ok(dist.includes('/^closing\\s/i.test(EN9cs.label||"")&&EN9cs.value>0'), "dist has no closing-stock flip");
});

t("only a POSITIVE closing figure is flipped -- flipping twice would restore the bug", () => {
  assert.ok(store.includes("c.value <= 0) continue"), "src does not guard on the sign");
  assert.ok(dist.includes("EN9cs.value>0"), "dist does not guard on the sign");
});

t("a negative amount on a deduction line is reported, in both trees", () => {
  assert.ok(store.includes("id: `neg-deduction-${target}-${norm(c.label)}`"), "src raises no negative-deduction warning");
  assert.ok(dist.includes("id:`neg-deduction-${EN9tk}-"), "dist raises it without a stable id");
});

/* ---- a saved project must receive rules added since it was saved ---- */

const STORE = load("src/prototype/wp/store.ts");

t("a project saved before the additions receives them on restore", () => {
  const old = SRC.filter((g) => !["wkr expense", "small material", "issued & paid up capital",
                                  "opening stock", "closing stock", "stock on hand"].some((k) => g.kw.includes(k)));
  const upgraded = STORE.upgradeRules(old.map((g) => ({ t: g.t, kw: [...g.kw] })), 1);
  assert.strictEqual(upgraded.length, old.length + 6);
  assert.ok(upgraded.some((g) => g.kw.includes("werkkostenregeling")));
});

t("a project already on the current version is left alone", () => {
  const cur = SRC.map((g) => ({ t: g.t, kw: [...g.kw] }));
  assert.strictEqual(STORE.upgradeRules(cur, STORE.RULE_CATALOGUE_VERSION), cur, "returned a new array unnecessarily");
});

t("a v2 project receives the v3 SKIP keywords inside its existing SKIP group", () => {
  // v3 added keywords to a group every saved catalogue already has, so they
  // are merged into it rather than appended as a new group.
  const v2 = SRC.map((g) => ({ t: g.t, kw: g.kw.filter((k) => !/^net (earnings|profit for the period|loss)/.test(k)) }));
  const upgraded = STORE.upgradeRules(v2, 2);
  assert.strictEqual(upgraded.length, v2.length, "no new group expected");
  const skip = upgraded.find((g) => g.t === "SKIP");
  for (const k of ["net earnings", "net earnings for the year", "net profit for the period", "net loss for the year", "net loss"]) {
    assert.ok(skip.kw.includes(k), k);
  }
  assert.strictEqual(STORE.upgradeRules(upgraded, 3), upgraded, "already current — untouched");
});

t("the preparer's own edits survive the upgrade", () => {
  const mine = [{ t: "IS:7", kw: ["omzet uit dienstverlening"] }];
  const upgraded = STORE.upgradeRules(mine, 1);
  assert.deepStrictEqual(upgraded[0], mine[0], "the preparer's rule must stay first -- ties go to it");
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
