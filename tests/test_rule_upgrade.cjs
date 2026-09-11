/* A saved project must receive rules added after it was saved.
 *
 * This suite exists because it did not. Six rule groups written on
 * 2026-09-11 — contra-revenue, the payment-processor costs, "Taxes and
 * Licenses", the cash captions, payroll, and the two equity groups — shipped
 * inside the bundle while RULE_CATALOGUE_VERSION stayed at 3 and none of them
 * were registered in RULES_ADDED_SINCE. upgradeRules returns the saved rules
 * untouched once savedVersion >= RULE_CATALOGUE_VERSION, so every browser
 * holding an earlier project kept the old catalogue for ever. The live SHORI
 * 2024 run booked owner investments as a current liability and "7600 Taxes and
 * Licenses" into the other-deductions pool although both rules were sitting,
 * unreachable, in the very bundle that produced the work paper.
 *
 * The baseline in fixtures/rules_v3.json is the catalogue as shipped at the
 * last release. When you cut a release, refresh it and bump the version. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");

function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' },
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const ENG = load("src/prototype/wp/engine.ts");
const STORE = load("src/prototype/wp/store.ts");
const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "rules_v3.json"), "utf8"));

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const clone = (rs) => rs.map((r) => ({ t: r.t, kw: [...r.kw] }));
const lower = (rs) => new Set(rs.flatMap((r) => r.kw.map((k) => k.toLowerCase())));

t("the catalogue version is ahead of the baseline it upgrades from", () => {
  assert.ok(
    STORE.RULE_CATALOGUE_VERSION > BASE.version,
    `RULE_CATALOGUE_VERSION is ${STORE.RULE_CATALOGUE_VERSION}, baseline is v${BASE.version}. ` +
    "Adding rules without bumping the version means no saved project ever sees them.",
  );
});

/* The check that would have caught the defect: take the catalogue as it
   actually shipped at the baseline, upgrade it, and require that every caption
   the new rules were written for now resolves the way a brand-new project
   resolves it. */
const upgraded = STORE.upgradeRules(clone(BASE.rules), BASE.version);

t("upgrading the baseline adds the groups written since", () => {
  assert.ok(upgraded.length > BASE.rules.length,
    `upgradeRules returned ${upgraded.length} groups from ${BASE.rules.length} — nothing was added`);
});

t("every keyword added since the baseline is reachable after an upgrade", () => {
  const before = lower(BASE.rules);
  const after = lower(upgraded);
  const missing = [];
  for (const g of ENG.DEFAULT_RULES) {
    for (const k of g.kw) {
      const kk = k.toLowerCase();
      if (!before.has(kk) && !after.has(kk)) missing.push(`${kk} -> ${g.t}`);
    }
  }
  assert.deepStrictEqual(missing, [],
    "these keywords ship in DEFAULT_RULES but no saved project can ever receive them; " +
    "register one keyword from each new group in RULES_ADDED_SINCE");
});

/* Behaviour, not just presence: the captions from the live client run. */
const CAPTIONS = [
  ["7600 Taxes and Licenses", "IS:32"],
  ["2910 Owner investments", "BS:60"],
  ["2960 Owner draws", "BS:61"],
  ["Opening balance equity", "BS:61"],
  ["3002 Shopify Discounts Given", "IS:8"],
  ["4500 Shopify Payment Fees", "IS:12"],
  ["4502 Paypal Fees", "IS:12"],
  ["4100 Freight and delivery - COS", "IS:12"],
  ["Payroll Expenses", "IS:OD"],
  ["Merchant Account", "BS:10"],
];

for (const [caption, target] of CAPTIONS) {
  t(`an upgraded saved project maps "${caption}" to ${target}`, () => {
    assert.strictEqual(ENG.matchRule(caption, upgraded), target);
    assert.strictEqual(ENG.matchRule(caption, ENG.DEFAULT_RULES), target,
      "the fresh catalogue disagrees with the expectation");
  });
}

t("a rule the preparer wrote is never displaced by the upgrade", () => {
  const mine = { t: "IS:33", kw: ["shopify payment fees"] };
  const saved = [mine, ...clone(BASE.rules)];
  const out = STORE.upgradeRules(saved, BASE.version);
  assert.strictEqual(out[0], mine, "the preparer's own rule must stay first");
  assert.strictEqual(ENG.matchRule("4500 Shopify Payment Fees", out), "IS:33",
    "the preparer's longer keyword must still win");
});

t("upgrading twice is a no-op", () => {
  const once = STORE.upgradeRules(clone(BASE.rules), BASE.version);
  const twice = STORE.upgradeRules(clone(once), STORE.RULE_CATALOGUE_VERSION);
  assert.strictEqual(twice.length, once.length);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
