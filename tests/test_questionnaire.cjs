/* The client questionnaire and the salary schedule.
 *
 * Two documents the hand-prepared work paper used and the tool had never read:
 * the preparer's one-sheet client questionnaire (roles, wages received, the
 * other shareholders with relationship and citizenship) and a month-by-month
 * salary schedule for one related person. The questionnaire fixture is the
 * real Bright!Tax grid as the .xls reader emits it, names and addresses
 * anonymised; the salary schedule is the real document's paragraphs.
 *
 * What ties them to the work paper: the wages figure equals a P&L wage
 * caption to the cent, which is the evidence for a Schedule M "compensation
 * paid" entry — the hand-prepared paper had put it on "compensation received".
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
const Q = load("src/prototype/wp/questionnaire.ts");
const L = load("src/prototype/wp/relatedPartyLedger.ts");
const C = load("src/prototype/wp/classify.ts");

const GRID = JSON.parse(fs.readFileSync(path.join(root, "tests", "fixtures", "questionnaire_grid.json"), "utf8"));

/* ---- the questionnaire ---- */

t("the questionnaire is recognised by its own captions, before the ledger test", () => {
  assert.ok(Q.looksLikeQuestionnaire(GRID));
  assert.ok(!Q.looksLikeQuestionnaire([["Date", "Details", "Reference", "Currency", "Source", "USD"], ["1/2/24", "Invoice", "INV-1", "KYD", "100", "120"]]));
  const cls = C.classifyParsedDoc("f1", "questionnaire.xls", { kind: "xlsx", grid: GRID });
  assert.strictEqual(cls.kind, "client-questionnaire");
});

t("the entity particulars", () => {
  const q = Q.parseQuestionnaire(GRID, "questionnaire.xls");
  assert.strictEqual(q.taxpayerName, "Casey Owner");
  assert.strictEqual(q.corporationName, "Client Ltd.");
  assert.deepStrictEqual(q.address, ["1 Harbour Road", "George Town, Grand Cayman"]);
  assert.strictEqual(q.country, "Cayman Islands");
  assert.strictEqual(q.countryInc, "Cayman Islands");
  assert.strictEqual(q.activity, "Marine services");
  assert.strictEqual(q.currency, "KYD");
});

t("the filer's roles answer the director/officer question", () => {
  const q = Q.parseQuestionnaire(GRID, "questionnaire.xls");
  assert.strictEqual(q.roles, "All three roles");
  assert.strictEqual(q.isOfficer, true);
  const shareholderOnly = GRID.map((r) => r.map((c) => (c === "All three roles" ? "Shareholder only" : c)));
  assert.strictEqual(Q.parseQuestionnaire(shareholderOnly, "q.xls").isOfficer, false);
});

t("shares: the filer's own and the corporation's outstanding count, beginning and end", () => {
  const q = Q.parseQuestionnaire(GRID, "questionnaire.xls");
  assert.deepStrictEqual(q.filerShares, { boy: 100, eoy: 100 });
  assert.deepStrictEqual(q.sharesOutstanding, { boy: 0, eoy: 0 }, "the client left outstanding shares at 0 — read as printed, not corrected");
});

t("the other shareholder, with relationship and citizenship", () => {
  const q = Q.parseQuestionnaire(GRID, "questionnaire.xls");
  assert.strictEqual(q.additionalHolders.length, 1, "three blank slots on the form are not holders");
  const h = q.additionalHolders[0];
  assert.strictEqual(h.name, "Morgan Owner");
  assert.strictEqual(h.shares, 100);
  assert.strictEqual(h.relationship, "Father");
  assert.strictEqual(h.usCitizen, false);
  assert.deepStrictEqual(h.address, ["2 Harbour Road", "George Town, Grand Cayman"]);
});

t("wages and dividends the filer received, and their currency", () => {
  const q = Q.parseQuestionnaire(GRID, "questionnaire.xls");
  assert.strictEqual(q.wagesReceived, 72067.4);
  assert.strictEqual(q.dividendsReceived, 0);
  assert.strictEqual(q.wagesCurrency, "KYD");
  assert.strictEqual(q.bookkeeper, "No");
});

/* ---- the salary schedule ---- */

const SALARY = [
  ["Sam Owner – 2024 Salary"],
  ["January 2024         – KYD $2,500.00"], ["February 2024       – KYD $5,430.00"], ["March 2024            – KYD $5,753.80"],
  ["April 2024               – KYD $7,816.00"], ["May 2024                – KYD $2,000.00"], ["June 2024               – KYD $2,997.60"],
  ["July 2024                 – KYD $4,600.00"], ["August 2024          – KYD $6,000.00"], ["September 2024 – KYD $5,920.00"],
  ["October 2024       – KYD $1,300.00"], ["November 2024  – KYD $3,100.00"], ["December 2024 – KYD $4,650.00"],
  ["Year end bonus – KYD $20,000.00"],
  ["Total:    KYD $72,067.40"],
];

t("a salary schedule is recognised and read line by line", () => {
  assert.ok(L.looksLikeSalarySchedule(SALARY));
  const s = L.summarizeSalary(SALARY, "salary.docx");
  assert.strictEqual(s.person, "Sam Owner");
  assert.strictEqual(s.currency, "KYD");
  assert.strictEqual(s.lines.length, 13, "twelve months and a bonus");
  assert.strictEqual(s.lines[0].label, "January 2024");
  assert.strictEqual(s.lines[0].amount, 2500);
  assert.strictEqual(s.lines[12].label, "Year end bonus");
  assert.strictEqual(s.statedTotal, 72067.4);
  assert.strictEqual(s.sumOfLines, 72067.4);
  assert.deepStrictEqual(s.warnings, []);
});

t("a schedule whose lines do not add to its total says so, and keeps the stated total", () => {
  const off = SALARY.map((r) => (r[0].startsWith("Total") ? ["Total: KYD $70,000.00"] : r));
  const s = L.summarizeSalary(off, "salary.docx");
  assert.strictEqual(s.statedTotal, 70000);
  assert.strictEqual(s.sumOfLines, 72067.4);
  assert.ok(s.warnings.some((w) => /lines sum to 72067.4 but the schedule states 70000/.test(w)));
});

t("the salary schedule is classified as one, not as a trial balance", () => {
  const cls = C.classifyParsedDoc("f2", "salary.docx", { kind: "docx", grid: SALARY });
  assert.strictEqual(cls.kind, "related-party-salary");
  const tb = C.classifyParsedDoc("f3", "tb.xlsx", { kind: "xlsx", grid: [["Account", "Debit", "Credit"], ["Sales", "", "1000"], ["Rent", "200", ""]] });
  assert.strictEqual(tb.kind, "trial-balance", "an ordinary grid is still a trial balance");
});

t("both kinds feed only what they should", () => {
  const q = C.classifyParsedDoc("f1", "questionnaire.xls", { kind: "xlsx", grid: GRID });
  assert.deepStrictEqual([...C.feedsForPage(q, "unknown")], ["profile"]);
  const s = C.classifyParsedDoc("f2", "salary.docx", { kind: "docx", grid: SALARY });
  assert.deepStrictEqual([...C.feedsForPage(s, "unknown")], ["schM-ledger"]);
});

/* ---- what the store does with them ---- */

const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");

/* Line 6, the row the preparer's own work paper uses. Read strictly the
   caption is the other direction, so the write carries a note saying so
   rather than quietly moving the figure to line 19. */
t("the wages figure that equals a booked P&L caption goes to Schedule M line 6", () => {
  assert.ok(store.includes('labelKey: { col: "B", contains: "compensation received for technical" }'), "wrong Schedule M line");
  assert.ok(store.includes('reviewId: `schm-compensation-${col}`'));
  assert.ok(store.includes("Math.abs(c.value - fact.amount) <= 0.01"), "the tie is exact, to the cent");
  assert.ok(store.includes("the figure belongs on line 19"), "the caption reading must be called out");
  assert.ok(store.includes('const col = isFiler ? "E" : "K";'), "a schedule naming someone else gets its own column");
  assert.ok(store.includes("facts.length && avgRate && relatedParty"), "no related party, no Schedule M transaction");
});

t("a stated wage with no matching caption is a warning, not a write", () => {
  assert.ok(store.includes("schm-compensation-unmatched-"));
  assert.ok(store.includes("Schedule M was NOT pre-filled"));
});

t("the questionnaire fills blank particulars and re-cases an uppercase name", () => {
  assert.ok(store.includes("entity name re-cased from the questionnaire"));
  assert.ok(store.includes('propose(ownership, "isOfficer", questionnaire.isOfficer ? "Yes" : "No"'));
});

t("the questionnaire seeds shareholders only when nothing else has", () => {
  assert.ok(store.includes("if (cur && !(cur.shareholders || []).length) {"));
  assert.ok(store.includes('id: "q-holders"'));
  assert.ok(store.includes("Citizenship decides whether their holdings count toward CFC status"));
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
