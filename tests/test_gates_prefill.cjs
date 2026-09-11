/* The two questions asked before generation, and the fields that stopped
   being left blank.

   The name gate exists because a prior return that spells the corporation
   differently from the statements was being discarded in silence, taking the
   opening balances, the filer categories, the shareholders and the opening
   E&P with it. The officer gate exists because a blank Item H answer was
   being discovered on the filed form. Schedule Q had never been written at
   all, and the country code it wants is the IRS's own list, not ISO. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const SRC = require("./fixtures/harness_src.cjs");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const STORE = SRC.STORE;
const ENG = SRC.ENG;
const CC = SRC.LOAD("src/prototype/wp/countryCodes.ts");
const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
const views = fs.readFileSync(path.join(root, "src", "prototype", "wp", "CoreViews.tsx"), "utf8");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

const entity = (over) => ({
  ...STORE.makeEntity("Client Ltd.", "Stakeholder"),
  ...over,
});
const ids = (ent) => STORE.validateEntity(ent).map((r) => r.id);
const item = (ent, id) => STORE.validateEntity(ent).find((r) => r.id === id);

/* ---- the legal-name gate ---- */

t("a name disagreement blocks generation and names both spellings", () => {
  const ent = entity({
    nameMismatch: { statementName: "Client Ltd.", priorName: "CLIENT LIMITED", source: "2023_return.pdf" },
  });
  const gate = item(ent, "cf-name-unconfirmed");
  assert.ok(gate, "no gate raised: " + ids(ent).join(", "));
  assert.strictEqual(gate.level, "block");
  assert.ok(gate.message.includes("Client Ltd.") && gate.message.includes("CLIENT LIMITED"), gate.message);
  assert.ok(/opening balances|carried forward/.test(gate.message), "it must say what is at stake");
  assert.strictEqual(gate.target, `${ENG.SHEET.basic}!B11`);
});

t("no disagreement, no gate", () => {
  assert.ok(!ids(entity({})).includes("cf-name-unconfirmed"));
});

t("confirming clears the block and records the answer", () => {
  assert.ok(store.includes("confirmLegalName(entityId: string, name: string, sameEntity: boolean)"));
  assert.ok(store.includes("nameMismatch: null,"), "the block is cleared");
  assert.ok(store.includes("nameDecision: { priorName, sameEntity }"), "the answer is remembered");
  assert.ok(store.includes("legalName: chosen"), "the corrected name is the legal name everywhere");
  assert.ok(dist.includes("confirmLegalName(t,e,i)"), "dist has the action too");
});

t('"same entity" adopts the whole carry-forward on the next run', () => {
  assert.ok(store.includes("decided.sameEntity && entitySimilarity(decided.priorName, best.cfcName) >= 0.8"),
    "the decision is matched to the candidate it was made about");
  assert.ok(store.includes("accepted as the same entity as"), "and the log says so");
  assert.ok(dist.includes("/*EN9NAMEGATE-BEGIN*/") && dist.includes("/*EN9NAMEGATE-END*/"));
});

t('"different entity" keeps the existing refusal', () => {
  assert.ok(store.includes("its carry-forward figures were NOT used."),
    "the warning that names the rejected file survives");
});

t("the gate is a derived item, so its dismissal cannot outlive its cause", () => {
  assert.ok(/DERIVED_IDS[\s\S]{0,400}"cf-name-unconfirmed"/.test(store));
  assert.ok(/new Set\(\[[^\]]*"cf-name-unconfirmed"/.test(dist), "dist too");
});

t("the exception centre offers both answers, not a free-text guess", () => {
  assert.ok(views.includes('b.id === "cf-name-unconfirmed"'));
  assert.ok(views.includes("Same entity — use the prior return"));
  assert.ok(views.includes("Different entity"));
  assert.ok(dist.includes("Same entity \\u2014 use the prior return") || dist.includes("Same entity — use the prior return"));
});

/* ---- the director/officer gate ---- */

t("a blank Item H answer blocks generation once a shareholder is known", () => {
  const ent = entity({ shareholders: [{ id: "s1", name: "Casey Owner" }] });
  const gate = item(ent, "officer-flag-unconfirmed");
  assert.ok(gate, "no gate raised: " + ids(ent).join(", "));
  assert.strictEqual(gate.level, "block");
  assert.strictEqual(gate.target, `${ENG.SHEET.basic}!C35`);
});

t("an answered flag raises nothing", () => {
  for (const answer of ["Yes", "No"]) {
    const ent = entity({ shareholders: [{ id: "s1", name: "Casey Owner" }], ownership: { isOfficer: answer } });
    assert.ok(!ids(ent).includes("officer-flag-unconfirmed"), answer);
  }
});

t("an entity with no shareholders yet is not nagged", () => {
  assert.ok(!ids(entity({})).includes("officer-flag-unconfirmed"));
});

t("the exception centre answers it with Yes and No", () => {
  assert.ok(views.includes('b.id === "officer-flag-unconfirmed"'));
  assert.ok(views.includes('actions.setField(b.entityId, "ownership", "isOfficer", "Yes")'));
  assert.ok(dist.includes('"ownership","isOfficer","Yes"'), "dist too");
  assert.ok(/new Set\(\[[^\]]*"officer-flag-unconfirmed"/.test(dist));
});

/* ---- the IRS country codes ---- */

t("the codes are the IRS list, not ISO 3166", () => {
  assert.strictEqual(CC.irsCountryCode("Cayman Islands"), "CJ");   // ISO says KY
  assert.strictEqual(CC.irsCountryCode("Switzerland"), "SZ");      // ISO says CH
  assert.strictEqual(CC.irsCountryCode("United Kingdom"), "UK");   // ISO says GB
  assert.strictEqual(CC.irsCountryCode("Ireland"), "EI");          // ISO says IE
  assert.strictEqual(CC.irsCountryCode("Germany"), "GM");          // ISO says DE
});

t("the spellings clients actually type resolve", () => {
  const cases = [
    ["the Cayman Islands", "CJ"], ["CAYMAN ISLANDS", "CJ"], ["Cayman Islands.", "CJ"],
    ["UK", "UK"], ["Great Britain", "UK"], ["England", "UK"],
    ["Holland", "NL"], ["The Netherlands", "NL"], ["UAE", "AE"], ["BVI", "VI"],
    ["Republic of Ireland", "EI"], ["USA", "US"],
  ];
  for (const [name, code] of cases) assert.strictEqual(CC.irsCountryCode(name), code, name);
});

t("an unknown country is null, never a guess from a prefix", () => {
  assert.strictEqual(CC.irsCountryCode("Freedonia"), null);
  assert.strictEqual(CC.irsCountryCode(""), null);
  assert.strictEqual(CC.irsCountryCode(null), null);
  // Niger and Nigeria are different countries with different codes.
  assert.strictEqual(CC.irsCountryCode("Niger"), "NG");
  assert.strictEqual(CC.irsCountryCode("Nigeria"), "NI");
});

t("every currency the rate tables cover has a country on the list", () => {
  const FX = SRC.LOAD("src/prototype/wp/fxRates.ts");
  const missing = [];
  for (const [code, meta] of Object.entries(FX.FX_META)) {
    // The euro zone is not a country and has no IRS code of its own.
    if (code === "EUR") continue;
    if (!CC.irsCountryCode(meta.country)) missing.push(`${code} (${meta.country})`);
  }
  assert.deepStrictEqual(missing, [], "no IRS code for: " + missing.join(", "));
});

t("the table is the same in both trees", () => {
  const m = /var EN9CCTBL=(\{[\s\S]*?\});/.exec(dist);
  assert.ok(m, "the dist table is findable");
  const shipped = JSON.parse(m[1]);
  assert.deepStrictEqual(shipped, CC.IRS_COUNTRY_CODES);
});

/* ---- the Basic Information answers Schedule Q now depends on ---- */

t("country of incorporation is answered from three sources, in order", () => {
  assert.ok(store.includes('propose(profile, "countryInc", cf.countryInc || ""'), "the prior return's 5471 face");
  assert.ok(store.includes('propose(profile, "countryInc", questionnaire.countryInc, qs)'), "the client questionnaire");
  assert.ok(store.includes('propose(profile, "countryInc", country, `functional currency'), "the functional currency, last");
  assert.strictEqual(ENG.PROFILE_FIELDS.find((f) => f.key === "countryInc").cell, "B19");
});

t("the country reaches B19 in the workbook writes", () => {
  const w = STORE.buildWrites(entity({
    profile: { countryInc: "Cayman Islands", entityShort: "Client" },
  }));
  assert.strictEqual(w[ENG.SHEET.basic].B19, "Cayman Islands");
});

t("the director/officer answer reaches C35", () => {
  assert.strictEqual(ENG.OWNERSHIP_FIELDS.find((f) => f.key === "isOfficer").cell, "C35");
  const w = STORE.buildWrites(entity({ ownership: { isOfficer: "Yes" }, profile: { entityShort: "Client" } }));
  assert.strictEqual(w[ENG.SHEET.basic].C35, "Yes");
});

/* ---- Schedule Q, which had never been written ---- */

t("Schedule Q is a sheet the engine knows about", () => {
  assert.strictEqual(ENG.SHEET.schQ, "Schedule Q");
  assert.ok(dist.includes('schQ:"Schedule Q"'), "dist too");
});

t("the separate-category code reaches Schedule Q with the other three tabs", () => {
  assert.ok(store.includes('w({ sheet: SHEET.schQ, ref: "C10", value: code'));
  assert.ok(store.includes("Schedule J C10, Schedule P B10, Sch-H C8 and Schedule Q C10"),
    "and the fallback message names all four");
  assert.ok(dist.includes("/*EN9SCHQCAT*/"));
});

t("tested-income unit 1 comes from Basic Information, or not at all", () => {
  assert.ok(store.includes('w({ sheet: SHEET.schQ, ref: "C57", value: unitName'), "the unit name");
  assert.ok(store.includes('w({ sheet: SHEET.schQ, ref: "F57", value: code'), "the country code");
  assert.ok(store.includes("irsCountryCode(ent.profile.countryInc)"));
  assert.ok(store.includes('id: "schq-country-unknown"'), "an unknown country says so rather than guessing");
  assert.ok(store.includes("the tool fills the first row only"), "more than one tested unit is the preparer's");
  assert.ok(dist.includes("/*EN9SCHQ-BEGIN*/") && dist.includes("/*EN9SCHQ-END*/"));
});

t("Schedule Q cells reach the workbook writes", () => {
  const ent = entity({
    profile: { legalName: "Client Ltd.", countryInc: "Cayman Islands", entityShort: "Client" },
    extraWrites: [
      { sheet: ENG.SHEET.schQ, ref: "C10", value: "GEN - General", source: "test" },
      { sheet: ENG.SHEET.schQ, ref: "C57", value: "Client Ltd.", source: "test" },
      { sheet: ENG.SHEET.schQ, ref: "F57", value: "CJ", source: "test" },
    ],
  });
  const w = STORE.buildWrites(ent);
  assert.strictEqual(w[ENG.SHEET.schQ].C10, "GEN - General");
  assert.strictEqual(w[ENG.SHEET.schQ].C57, "Client Ltd.");
  assert.strictEqual(w[ENG.SHEET.schQ].F57, "CJ");
});

if (fail) { console.error(`${fail} FAILURE(S)`); process.exit(1); }
console.log(`${pass} passed, ${fail} failed`);
