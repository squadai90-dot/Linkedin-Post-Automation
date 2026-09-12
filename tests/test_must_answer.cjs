/* A gate that fills a required cell must be ANSWERED, not waved through.
 *
 * Basic Information C35 — "is the filer a director or officer?" — already
 * raised a blocking item. It shipped blank on the SHORI 2024 work paper all
 * the same, because there are two ways past a block and neither writes
 * anything: acknowledging it (which stores a tombstone) and a policy that
 * downgrades or suppresses it. Both are now refused for this id.
 *
 * Also here: an unparseable date of formation. B17 carries a date number
 * format, so formedCell writes an Excel serial and Excel renders it as a date;
 * when the day/month order cannot be resolved the helper hands back the text
 * unchanged, and that text sits in a date-formatted cell. Right value, wrong
 * type, easy to miss — so it is now said out loud.
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
    define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' },
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const STORE = load("src/prototype/wp/store.ts");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

/* ---- the must-answer set ---- */

t("C35 is on the must-answer list in both trees", () => {
  assert.ok(STORE.MUST_ANSWER.has("officer-flag-unconfirmed"));
  assert.ok(dist.includes('var EN9MUSTANSWER=new Set(["officer-flag-unconfirmed"])'),
    "dist has no must-answer set");
});

t("dist refuses the acknowledgement and refuses the policy override", () => {
  assert.ok(dist.includes("/*EN9MUSTANSWER*/if(EN9MUSTANSWER.has(e))"),
    "dismissReviewItem does not check the set");
  assert.ok(dist.includes("EN9MUSTANSWER.has(A.id)?A:o_(A,te.policies)"),
    "policies are still applied to a must-answer item");
});

t("the Exception Center offers no way to acknowledge it", () => {
  assert.ok(dist.includes("this one cannot be acknowledged"),
    "dist does not say the gate must be answered");
});

/* ---- the gate itself ---- */

function gated() {
  const e = STORE.makeEntity("SHORI CORPORATION", "Jacob A Kelt");
  e.shareholders = [{ id: "s1", name: "Jacob A Kelt", classOfShares: "Common", boy: 100, eoy: 100 }];
  e.ownership = { ...e.ownership, isOfficer: "" };
  return e;
}

t("an unanswered officer flag blocks generation", () => {
  const b = STORE.blockingIssues(gated());
  assert.ok(b.some((x) => x.id === "officer-flag-unconfirmed"), JSON.stringify(b.map((x) => x.id)));
});

t("answering it clears the block", () => {
  const e = gated();
  e.ownership = { ...e.ownership, isOfficer: "Yes" };
  const b = STORE.blockingIssues(e);
  assert.ok(!b.some((x) => x.id === "officer-flag-unconfirmed"));
});

t("a stored dismissal does NOT clear it", () => {
  const e = gated();
  /* What acknowledging used to leave behind. The item is derived, so a
     tombstone must not be enough to stop it gating. */
  e.reviewItems = [{
    id: "officer-flag-unconfirmed", level: "block", category: "profile",
    message: "…", dismissed: true, dismissedNote: "acknowledged",
  }];
  const still = STORE.allReviewItems(e).find((x) => x.id === "officer-flag-unconfirmed");
  assert.ok(still, "the item vanished entirely");
  assert.ok(still.dismissed, "the tombstone is still honoured for display");
  /* …and the fix is that dismissReviewItem will not create one in the first
     place. The source pin below is what guards that. */
  const src = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
  assert.ok(src.includes("if (MUST_ANSWER.has(id)) {"),
    "dismissReviewItem does not refuse a must-answer id");
  assert.ok(src.includes("MUST_ANSWER.has(r.id) ? r : applyPolicy(r, state.policies)"),
    "policies are still applied to a must-answer item");
});

/* ---- the formation date ---- */

t("an unambiguous date becomes an Excel serial, which B17 formats as a date", () => {
  assert.strictEqual(STORE.formedCell("2020-05-15"), 43966);
  assert.strictEqual(STORE.formedCell("15/05/2020"), 43966);
  assert.strictEqual(STORE.formedCell("05/15/2020", "prior return · 5471 face"), 43966);
});

t("an ambiguous date stays text — and is now flagged", () => {
  assert.strictEqual(STORE.formedCell("05/06/2020"), "05/06/2020");
  const e = STORE.makeEntity("SHORI CORPORATION", "Jacob A Kelt");
  e.profile = { ...e.profile, formed: "05/06/2020" };
  const items = STORE.allReviewItems(e);
  const it = items.find((x) => x.id === "profile-formed-ambiguous");
  assert.ok(it, "no ambiguity item raised");
  assert.strictEqual(it.level, "warn");
  assert.ok(it.target.endsWith("!B17"), it.target);
  assert.ok(it.message.includes("YYYY-MM-DD"), it.message);
});

t("a date the helper CAN read raises nothing", () => {
  const e = STORE.makeEntity("SHORI CORPORATION", "Jacob A Kelt");
  e.profile = { ...e.profile, formed: "2020-05-15" };
  assert.ok(!STORE.allReviewItems(e).some((x) => x.id === "profile-formed-ambiguous"));
});

t("dist carries the same check", () => {
  assert.ok(dist.includes("/*EN9FORMEDAMB*/"), "no EN9FORMEDAMB region");
  assert.ok(dist.includes('"profile-formed-ambiguous"'), "the id is not registered as derived");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
