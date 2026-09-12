/* Schedule M line 6 when nobody sent a questionnaire.
 *
 * The SHORI 2024 work paper shipped Schedule M blank. The books said the
 * corporation paid 82,000 of wages, the filer owned 100% of it, and there was
 * no second shareholder — but the pre-fill only ever read a client
 * questionnaire or a salary schedule, so with neither document supplied the
 * block did nothing at all, not even a warning.
 *
 * The inference is deliberately narrow. A minority filer, or a corporation
 * with more than one shareholder, still gets nothing: the counterparty would
 * be a guess rather than an inference, and Schedule M is a schedule of
 * transactions with named people.
 */
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
const ENG = load("src/prototype/wp/engine.ts");

const FACTS = {
  caseYears: { cy: 2024, py: 2023 }, equity: null,
  ato: { dividendDate: null, dividends: [] },
  cf: null, cfSource: "", ledger: null, questionnaire: null, salary: null,
};

/** One entity, one booked wage, dials for everything the inference reads. */
function entity({ wage = 82000, pct = "100", shareholders = [], avgRate = "1" } = {}) {
  const e = STORE.makeEntity("Power Real Group", "Jacob A Kelt");
  e.fx = { ...e.fx, avgRate };
  e.profile = { ...e.profile, currency: "USD", legalName: "SHORI CORPORATION" };
  e.ownership = { ...e.ownership, ownStart: pct, ownEnd: pct };
  e.shareholders = shareholders;
  if (wage !== null) {
    e.contributions = {
      "IS:26": [{
        docId: "d1", docName: "ProfitAndLoss_2024.pdf", page: 1,
        label: "5000 Wages Expense", value: wage, field: "amount", via: "rule",
      }],
    };
  }
  return e;
}

async function run(ent, extra = {}) {
  const items = [];
  const out = await STORE.materializeCaseWrites(ent, {
    ...FACTS, ...extra, rv: (i) => items.push(i),
  });
  const schM = out.list.filter((w) => w.sheet === ENG.SHEET.schM);
  return { writes: out.list, schM, items, e15: schM.find((w) => w.ref === "E15") };
}

const main = async () => {

await (async () => {
  const { e15, items } = await run(entity());
  t("a booked wage with a 100% owner reaches Schedule M line 6", () => {
    assert.ok(e15, "E15 was not written");
    assert.strictEqual(e15.value, 82000);
    assert.strictEqual(e15.reviewId, "schm-compensation-inferred-E");
    assert.deepStrictEqual(e15.labelKey, { col: "B", contains: "compensation received for technical" });
  });
  t("the write says it was inferred, and from what", () => {
    const it = items.find((i) => i.id === "schm-compensation-inferred-E");
    assert.ok(it, "no review item");
    assert.strictEqual(it.level, "info");
    assert.ok(it.message.includes("INFERRED"), it.message);
    assert.ok(it.message.includes("5000 Wages Expense"), it.message);
    assert.ok(it.message.includes("100%"), it.message);
    assert.ok(/no questionnaire/i.test(it.message), it.message);
  });
})();

await (async () => {
  const { e15 } = await run(entity({ shareholders: [{ id: "a", name: "A" }, { id: "b", name: "B" }] }));
  t("two shareholders: no inference, the counterparty would be a guess", () => {
    assert.ok(!e15, "E15 was written for a two-shareholder corporation");
  });
})();

await (async () => {
  const { e15 } = await run(entity({ pct: "25" }));
  t("a minority filer: no inference", () => {
    assert.ok(!e15, "E15 was written for a 25% filer");
  });
})();

await (async () => {
  const { e15 } = await run(entity({ wage: null }));
  t("no wage booked: nothing to infer from", () => {
    assert.ok(!e15);
  });
})();

await (async () => {
  const { e15 } = await run(entity({ avgRate: "" }));
  t("no average rate: the figure cannot be translated, so nothing is written", () => {
    assert.ok(!e15);
  });
})();

/* A questionnaire is evidence; the books are an inference. Evidence wins, and
   the inferred path must not add a second figure on top of it. */
await (async () => {
  const q = {
    fileName: "questionnaire.xls", taxpayerName: "Jacob A Kelt",
    wagesReceived: 82000, roles: "All three roles",
  };
  const { schM, e15, items } = await run(entity(), { questionnaire: q });
  t("a questionnaire still wins the E column", () => {
    assert.ok(e15);
    assert.strictEqual(e15.reviewId, "schm-compensation-E");
    assert.ok(!items.some((i) => i.id === "schm-compensation-inferred-E"),
      "the inferred item was raised alongside the questionnaire");
  });
  t("and only one figure lands on line 6", () => {
    assert.strictEqual(schM.filter((w) => w.ref === "E15").length, 1);
  });
})();

/* The translation still applies: a functional currency that is not USD is
   divided by the year-average rate, as every other Schedule M write is. */
await (async () => {
  const { e15 } = await run(entity({ wage: 90000, avgRate: "0.9" }));
  t("the figure is translated at the year-average rate", () => {
    assert.strictEqual(e15.value, 100000);
  });
})();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
};

main();
