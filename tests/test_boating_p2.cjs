/* Boating reconciliation, priority 2: the silent inconsistencies.
 *
 * Found by reconciling the tool's work paper against the hand-prepared one:
 *   - Schedule J carried the template's default "FB - Foreign Branch" while
 *     the prior return said GEN on every schedule;
 *   - "10% corporate shareholder" answered Yes because the FILER owned 10%,
 *     though both holders are individuals;
 *   - the filer's Item H boxes (officer/director) were parsed and never used;
 *   - the face said the filer owned 100% while Schedule B gave 50%, and both
 *     work papers carried it silently into the 8992 pro-rata share;
 *   - retained earnings did not roll forward from the prior filing to the
 *     books, and the 5,417 residual was visible only on a hand-built tab.
 * Also two template defects: row number "l" and the FB default.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");
const JSZip = require("jszip");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const T = (name, fn) => fn().then(() => { console.log("ok:", name); pass++; }, (e) => { console.log("FAILED:", name, "-", e.message); fail++; });

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
const ENG = load("src/prototype/wp/engine.ts");
const CF = load("src/prototype/wp/carryForward.ts");

/* ---- the prior return's own statements: category code and rate ---- */

/** A parsed PDF with one page of each schedule, as rows of cells. */
function priorReturn() {
  const page = (n, lines) => lines.map((cells, i) => ({ page: n, y: 800 - i * 12, cells: cells.map((text, k) => ({ text, x0: 20 + k * 200, x1: 20 + k * 200 + 150 })) }));
  const rows = [
    ...page(1, [["Form 5471 Information Return of U.S. Persons With Respect to Certain Foreign Corporations"]]),
    ...page(2, [["SCHEDULE J (Form 5471) Accumulated Earnings & Profits (E&P) of Controlled Foreign Corporation"],
                ["a Separate Category (Enter code - see instructions.)", "|", "GEN"],
                ["14 Balance at beginning of next year (combine lines 7 through 13)", "16,834."]]),
    ...page(3, [["SCHEDULE H Current Earnings and Profits"],
                ["1 Current year net income or (loss) per foreign books of account", "1", "-12,295."],
                ["e Enter exchange rate used for line 5d", "|", ".833000000"]]),
    ...page(4, [["SCHEDULE M Transactions Between Controlled Foreign Corporation and Shareholders or Other Related Persons"],
                ["Enter the relevant functional currency and the exchange rate used throughout this schedule", "|", "CAYMAN ISLANDS, DO", ".833000000"]]),
  ];
  const cls = {
    kind: "prior-year-us-return", pages: [
      { page: 1, kind: "us-5471-face", score: 1 }, { page: 2, kind: "us-5471-schJ", score: 1 },
      { page: 3, kind: "us-5471-schH", score: 1 }, { page: 4, kind: "us-5471-schM", score: 1 },
    ], notes: [], statementYear: 2023,
  };
  return { cls, parsed: { kind: "pdf", grid: rows.map((r) => r.cells.map((c) => c.text)), pdf: { pageCount: 4, rows } } };
}

t("the separate-category code is read from Schedule J as filed", () => {
  const { cls, parsed } = priorReturn();
  const cf = CF.extractCarryForward(cls, parsed);
  assert.strictEqual(cf.separateCategory, "GEN");
});

t("the rate the prior filing states is read from Schedule H, unrounded", () => {
  const { cls, parsed } = priorReturn();
  const cf = CF.extractCarryForward(cls, parsed);
  assert.ok(cf.priorRate, "no rate read");
  assert.strictEqual(cf.priorRate.value, 0.833);
  assert.strictEqual(cf.priorRate.page, 3, "Schedule H first, Schedule M as fallback");
});

t("with no Schedule H the Schedule M header supplies the rate", () => {
  const { cls, parsed } = priorReturn();
  cls.pages = cls.pages.filter((p) => p.kind !== "us-5471-schH");
  const cf = CF.extractCarryForward(cls, parsed);
  assert.strictEqual(cf.priorRate && cf.priorRate.value, 0.833);
  assert.strictEqual(cf.priorRate.page, 4);
});

t("a return that states no category or rate yields neither — nothing guessed", () => {
  const { cls, parsed } = priorReturn();
  cls.pages = cls.pages.filter((p) => p.kind === "us-5471-face");
  const cf = CF.extractCarryForward(cls, parsed);
  assert.strictEqual(cf.separateCategory, undefined);
  assert.strictEqual(cf.priorRate, undefined);
});

/* ---- who is a corporation ---- */

t("a 10% corporate shareholder is about the holder's legal form", () => {
  for (const n of ["Acme Holdings Ltd", "BLUE WATER INC.", "Nordsee GmbH", "Zuid B.V.", "Ocean Pty Ltd", "Harbour Trust", "Cayman Marine Co"]) {
    assert.ok(STORE.isCorporateName(n), n);
  }
  for (const n of ["WILBUR J THOMPSON", "Wilbur M. Thompson", "Tanya E Thompson", "Jan de Vries"]) {
    assert.ok(!STORE.isCorporateName(n), n + " is a person");
  }
});

/* ---- net income the way the template computes it ---- */

t("bookNetIncome mirrors the Income Statement tab", () => {
  // The Boating figures: gross receipts, compensation, fifteen other deductions.
  const lines = { "IS:7": { amount: 350585.97 }, "IS:26": { amount: 152419.94 } };
  const od = [665.65, 49457.93, 225, 800, 9779.29, 5820, 48.04, 35305.17, 553.61, 4352.1, 14611.69, 11481.77, 14983.13, 34103.35, 3103.56];
  od.forEach((v, i) => { lines["IS:" + (34 + i)] = { amount: v }; });
  assert.strictEqual(STORE.bookNetIncome(lines), 12875.74);
  assert.strictEqual(STORE.bookNetIncome({}), null, "nothing booked is null, not zero");
  // Returns (1b) and COGS reduce; a negative tax line (21a) reduces.
  assert.strictEqual(STORE.bookNetIncome({ "IS:7": { amount: 1000 }, "IS:8": { amount: 100 }, "IS:11": { amount: 300 }, "IS:54": { amount: -50 } }), 550);
});

/* ---- the rate warning, line by line, exactly as the owner reconciled it ---- */

t("the opening column at the table rate vs the prior filing's rate, per line", () => {
  // The prior return's Schedule F column (b), as filed in USD.
  const filed = { cash: { value: 36323 }, ar: { value: 25511 }, inventories: { value: 1801 }, oca: { value: -43426 } };
  const fx = STORE.rateEffectLines(filed, 0.82, 0.833);
  const by = Object.fromEntries(fx.lines.map((l) => [l.label, l]));
  assert.deepStrictEqual([by.cash.atPrior, by.cash.atTable, by.cash.diff], [30257, 29785, -472]);
  assert.deepStrictEqual([by["trade notes and accounts receivable"].atPrior, by["trade notes and accounts receivable"].atTable, by["trade notes and accounts receivable"].diff], [21251, 20919, -332]);
  assert.deepStrictEqual([by.inventories.atPrior, by.inventories.atTable, by.inventories.diff], [1500, 1477, -23]);
  assert.deepStrictEqual([by["other current assets"].atPrior, by["other current assets"].atTable, by["other current assets"].diff], [-36174, -35609, 565]);
  assert.deepStrictEqual([fx.net.atPrior, fx.net.atTable, fx.net.diff], [16834, 16572, -262]);
});

t("liabilities count against net current assets; absent lines are absent", () => {
  const fx = STORE.rateEffectLines({ cash: { value: 1000 }, ap: { value: 400 } }, 0.5, 1);
  assert.deepStrictEqual(fx.lines.map((l) => l.label), ["cash", "accounts payable"]);
  assert.deepStrictEqual(fx.net, { atTable: 300, atPrior: 600, diff: -300 });
});

t("the table rate stands; the warning suggests the prior filing's rate, in both trees", () => {
  const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
  assert.ok(store.includes('id: "fx-prior-rate"'));
  assert.ok(store.includes("target: `${SHEET.basic}!C61`, source: cfSource, suggestedValue: stated"));
  assert.ok(store.includes("/ cf.priorRate.value > 0.005"), "half a percent is the threshold");
  const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  assert.ok(dist.includes('id:"fx-prior-rate"'), "dist lacks the warning");
  assert.ok(dist.includes("n.separateCategory=m[1]") && dist.includes("n.priorRate={value:v,page:rows[k].page"), "dist parser lacks the category/rate read");
  assert.ok(dist.includes('ref:"C10",value:EN9cc') && dist.includes('ref:"B10",value:EN9cc'), "dist does not write the category code");
});

/* ---- the roll-forward, as the exception will state it ---- */

t("the Boating residual is the 5,417 the hand-built tab plugged", () => {
  // prior filing US$20,209 at the filing's own 0.833 = 16,834.10; books close
  // at 24,292.34 with net income 12,875.74 and no distributions.
  const priorFc = Math.round(20209 * 0.833 * 100) / 100;
  const booksOpening = Math.round((24292.34 - 12875.74 + 0) * 100) / 100;
  assert.strictEqual(priorFc, 16834.1);
  assert.strictEqual(booksOpening, 11416.6);
  assert.strictEqual(Math.round((booksOpening - priorFc) * 100) / 100, -5417.5);
});

const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");

t("the residual is reported and suggested, never written", () => {
  assert.ok(store.includes('id: "re-rollforward"'));
  assert.ok(store.includes("Nothing has been plugged"));
  assert.ok(store.includes("target: `${SHEET.re}!F24`, source: cfSource, suggestedValue: residual"));
  assert.ok(!/ref: "F24", value/.test(store), "F24 must never be written by the tool");
});

t("Schedule F's opening RE is checked against Schedule J's", () => {
  assert.ok(store.includes('id: "re-opening-mismatch"'));
});

t("the face percentage is checked against Schedule B", () => {
  assert.ok(store.includes('id: "cf-ownership-mismatch"'));
  assert.ok(store.includes("Form 8992 pro-rata share"));
});

t("the category code reaches every tab that asks, with an honest fallback", () => {
  for (const ref of ['sheet: SHEET.schJ, ref: "C10"', 'sheet: SHEET.schP, ref: "B10"', 'sheet: SHEET.schH, ref: "C8"']) assert.ok(store.includes(ref), ref);
  assert.ok(store.includes('id: "cf-category-code"'));
});

t("the flags: officer from Item H, transition No after 2018, corporate from the holders", () => {
  assert.ok(store.includes('propose(ownership, "isOfficer", mine.isOfficer || mine.isDirector ? "Yes" : "No"'));
  assert.ok(store.includes('propose(ownership, "transition", "No"'));
  assert.ok(store.includes('propose(ownership, "tenPct", "No", `${cfSource} · Schedule B holders are individuals`)'));
  assert.ok(!store.includes('cf.pctVoting >= 10) {\n              propose(ownership, "tenPct", "Yes"'), "the old filer-percentage rule is still there");
});

/* ---- the template, in the file and as embedded in the shipped bundle ---- */

(async () => {
  const file = fs.readFileSync(path.join(root, "assets", "master-template.xlsx"));
  const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  const a = dist.indexOf('<script id="wp-template" type="application/octet-stream">') + '<script id="wp-template" type="application/octet-stream">'.length;
  const embedded = Buffer.from(dist.slice(a, dist.indexOf("</script>", a)).trim(), "base64");

  await T("the shipped bundle embeds the same template as assets/", async () => {
    assert.ok(embedded.equals(file), "dist carries a different template from assets/master-template.xlsx");
  });

  const zip = await JSZip.loadAsync(file);
  const wb = await zip.file("xl/workbook.xml").async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const part = async (name) => {
    const m = new RegExp('<sheet name="' + name + '"[^>]*r:id="([^"]+)"').exec(wb);
    const tg = new RegExp('Id="' + m[1] + '"[^>]*Target="([^"]+)"').exec(rels);
    return zip.file("xl/" + tg[1]).async("string");
  };
  const ss = (await zip.file("xl/sharedStrings.xml").async("string")).match(/<si>[\s\S]*?<\/si>/g).map((x) => x.replace(/<[^>]+>/g, ""));
  const cellText = (xml, ref) => {
    const m = new RegExp('<c r="' + ref + '"[^>]*?(?:/>|>([\\s\\S]*?)</c>)').exec(xml);
    if (!m || !m[1]) return null;
    const inl = /<t[^>]*>([\s\S]*?)<\/t>/.exec(m[1]); if (inl) return inl[1];
    const v = /<v>([\s\S]*?)<\/v>/.exec(m[1]); if (!v) return null;
    return / t="s"/.test(m[0]) ? ss[Number(v[1])] : v[1];
  };

  await T('Shareholding Details row 7 is numbered "7", not "l"', async () => {
    assert.strictEqual(cellText(await part("Shareholding Details"), "A25"), "7");
  });
  await T("Schedule J defaults to GEN, the common case", async () => {
    assert.strictEqual(cellText(await part("Schedule J"), "C10"), "GEN - General");
  });
  await T("the Retained Earnings tab exists, sits after the Balance Sheet, and ties to Schedule F", async () => {
    const order = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    assert.ok(order.indexOf("Retained Earnings") === order.indexOf("Balance Sheet") + 1, order.join(" | "));
    const xml = await part("Retained Earnings");
    assert.ok(xml.includes("<f>'Balance Sheet'!F61</f>"), "F28 must read Schedule F line 22");
    assert.ok(xml.includes("<f>'Income Statement'!F56</f>"), "F13 must read net income");
    assert.ok(xml.includes("<f>ROUND(F27-F28,2)</f>"), "F29 must show the difference");
    assert.ok(xml.includes("<f>Dividends!C12</f>"), "F20 must read the dividends");
  });
  await T("only the entry cells on the tab are writable", async () => {
    const guard = ENG.FORMULA_REFS["Retained Earnings"];
    for (const ok of ["F10", "F16", "F17", "F21", "F24", "F25"]) assert.strictEqual(guard(ok), false, ok + " should be writable");
    for (const no of ["F13", "F27", "F28", "F29", "H10", "H27", "J6"]) assert.strictEqual(guard(no), true, no + " is a formula");
  });

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
