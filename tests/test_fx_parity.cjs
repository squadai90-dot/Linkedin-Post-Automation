/* Exchange-rate dates and series.
 *
 * A date bug in a rate lookup is invisible: the workbook fills in, the USD
 * columns compute, and the figure is simply the wrong one. So every rule here
 * is checked against the implementation shipping in dist (EN9FX sentinels) as
 * well as the src port, over the same fixed series.
 *
 * The two that matter most:
 *   - a rate must be published ON OR BEFORE the measurement date; a later one
 *     is never a substitute, at any distance;
 *   - an unparseable date must REFUSE, not fall through to "latest", which
 *     stamps today's rate as the year-end rate with nothing on screen to say
 *     it happened.
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
const SRC = load("src/prototype/wp/fxDates.ts");

/* ---- the shipped implementation ---- */

const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const SHIPPED = (() => {
  const b = dist.indexOf("/*EN9FX-BEGIN*/"), e = dist.indexOf("/*EN9FX-END*/");
  assert.ok(b > 0 && e > b, "EN9FX sentinels present in dist");
  const block = dist.slice(b + "/*EN9FX-BEGIN*/".length, e);
  const sandbox = {};
  // The network helpers close over app internals; only the pure half is under
  // test, so the fetch is stubbed to something that is never called.
  new Function("exports", "Oc", "Pc", block +
    ";exports.toIso=EN9toIso;exports.requireIso=EN9reqIso;exports.yearBefore=EN9yearBefore;" +
    "exports.nearestPoint=EN9nearestPoint;exports.windowStart=EN9windowStart;exports.dayNum=EN9dayNum;" +
    "exports.providerTag=EN9provTag;exports.fxTag=EN9fxTag;exports.asOfLabel=EN9asOfLabel;" +
    "exports.manualMeta=EN9fxManualMeta;")(
    sandbox, () => { throw new Error("network not available in tests"); }, () => {});
  return sandbox;
})();

/* ---- date parsing ---- */

const DATES = [
  ["2024-12-31", "2024-12-31"],
  ["2024/12/31", "2024-12-31"],
  ["12/31/2024", "2024-12-31"],
  ["31/12/2024", "2024-12-31"],     // only readable day-first
  ["3/4/2024", "2024-03-04"],       // ambiguous: follows the form's US convention
  ["1/2/24", "2024-01-02"],
  ["2024-13-01", null],
  ["2024-12-32", null],
  ["not a date", null],
  ["", null],
];

t("the date forms a preparer actually types all parse", () => {
  for (const [input, want] of DATES) assert.strictEqual(SRC.toIsoLoose(input), want, JSON.stringify(input));
});

t("date parsing matches the shipped implementation", () => {
  for (const [input] of DATES) assert.strictEqual(SRC.toIsoLoose(input), SHIPPED.toIso(input), JSON.stringify(input));
});

t("an unparseable date REFUSES rather than looking up a dateless rate", () => {
  assert.throws(() => SRC.requireIso("31st of Dec", "current-year end date"), /Unparseable current-year end date/);
  assert.throws(() => SRC.requireIso("31st of Dec"), /Refusing to look up a dateless "latest" rate/);
  assert.throws(() => SHIPPED.requireIso("31st of Dec"), /Refusing to look up a dateless "latest" rate/);
});

t("an EMPTY date is absent, not wrong — it returns null and throws nothing", () => {
  assert.strictEqual(SRC.requireIso(""), null);
  assert.strictEqual(SRC.requireIso(null), null);
  assert.strictEqual(SRC.requireIso(undefined), null);
  assert.strictEqual(SHIPPED.requireIso(""), null);
});

/* ---- the leap day ---- */

t("the year before 29 February is 1 March, not an invalid date", () => {
  // The period ending 2024-02-29 starts on 2023-03-01: subtracting a year
  // lands on 2023-02-29, which JS rolls forward to 2023-03-01 unless the
  // month is checked. Getting this wrong yields a period a day out at both
  // ends -- and a silently wrong average rate.
  assert.strictEqual(SRC.yearBefore("2024-02-29"), "2023-03-01");
  assert.strictEqual(SRC.yearBefore("2024-02-29"), SHIPPED.yearBefore("2024-02-29"));
});

t("ordinary year ends are the day after the same date a year earlier", () => {
  for (const [end, want] of [["2024-12-31", "2024-01-01"], ["2024-06-30", "2023-07-01"], ["2025-03-31", "2024-04-01"]]) {
    assert.strictEqual(SRC.yearBefore(end), want, end);
    assert.strictEqual(SRC.yearBefore(end), SHIPPED.yearBefore(end), end);
  }
});

t("an unparseable date yields null rather than an Invalid Date string", () => {
  assert.strictEqual(SRC.yearBefore("nonsense"), null);
});

/* ---- nearest published rate ---- */

const day = (iso) => Date.parse(iso + "T00:00:00Z");
/** A market that closes over Christmas: last quote 2024-12-24, next 2025-01-02. */
const SERIES = [
  { t: day("2024-12-20"), r: 1.4711 },
  { t: day("2024-12-23"), r: 1.4725 },
  { t: day("2024-12-24"), r: 1.4730 },
  { t: day("2025-01-02"), r: 1.4802 },
];

t("the rate on the date itself is used when the market was open", () => {
  const hit = SRC.nearestPoint(SERIES, "2024-12-24");
  assert.strictEqual(hit.rate, 1.4730);
  assert.strictEqual(hit.diffDays, 0);
});

t("a closed market falls BACK to the last published rate, never forward", () => {
  // 31 December: the 2 January rate is two days away and the 24 December rate
  // is seven -- but 2 January did not exist yet on the balance-sheet date.
  const hit = SRC.nearestPoint(SERIES, "2024-12-31");
  assert.strictEqual(hit.rate, 1.4730, "took a rate published after the measurement date");
  assert.strictEqual(hit.date, "2024-12-24");
  assert.strictEqual(hit.diffDays, 7);
});

t("a later rate is refused even when nothing earlier exists at all", () => {
  assert.strictEqual(SRC.nearestPoint(SERIES, "2024-12-01"), null);
});

t("the ten-day window: nine days back is accepted, eleven is refused", () => {
  const one = [{ t: day("2024-12-20"), r: 1.47 }];
  assert.ok(SRC.nearestPoint(one, "2024-12-29"), "9 days back should be accepted");
  assert.strictEqual(SRC.nearestPoint(one, "2024-12-30").diffDays, 10, "10 days is the boundary and is accepted");
  assert.strictEqual(SRC.nearestPoint(one, "2024-12-31"), null, "11 days back must be refused");
});

t("nearestPoint matches the shipped implementation on every case", () => {
  for (const iso of ["2024-12-20", "2024-12-24", "2024-12-25", "2024-12-31", "2025-01-02", "2025-01-20", "2024-01-01"]) {
    assert.deepStrictEqual(SRC.nearestPoint(SERIES, iso), SHIPPED.nearestPoint(SERIES, iso), iso);
  }
  assert.strictEqual(SRC.nearestPoint([], "2024-12-31"), SHIPPED.nearestPoint([], "2024-12-31"));
});

t("a failed lookup can name how far back it searched", () => {
  assert.strictEqual(SRC.windowStart("2024-12-31", 10), "2024-12-21");
  assert.strictEqual(SRC.windowStart("2024-12-31", 10), SHIPPED.windowStart("2024-12-31", 10));
});

/* ---- provenance labels ---- */

t("a rate carries where it came from", () => {
  for (const p of ["ofx", "frankfurter", "tables", "somethingelse", undefined]) {
    assert.strictEqual(SRC.providerTag(p), SHIPPED.providerTag(p), String(p));
  }
  assert.strictEqual(SRC.providerTag("ofx"), "OFX");
  assert.strictEqual(SRC.providerTag("frankfurter"), "ECB");
});

t("an older rate with no tag is read back out of its source text", () => {
  const cases = [
    [{ tag: "Manual" }, "Manual"],
    [{ source: "Manual entry" }, "Manual"],
    [{ source: "OFX daily average (fallback)" }, "OFX"],
    [{ source: "IRS 2024 · IRS yearly average" }, "IRS"],
    [{ source: "IRS 2024 · Treasury 12/31 spot" }, "Treasury"],
    [{ source: "frankfurter (live fallback)" }, "ECB"],
    [{ source: "something else" }, "Live"],
    [{ source: "" }, ""],
    [null, ""],
  ];
  for (const [meta, want] of cases) {
    assert.strictEqual(SRC.fxTag(meta), want, JSON.stringify(meta));
    assert.strictEqual(SRC.fxTag(meta), SHIPPED.fxTag(meta), JSON.stringify(meta));
  }
});

t("the as-of label shows both dates when the market was shut on the one asked for", () => {
  assert.strictEqual(SRC.asOfLabel("2024-12-24", "2024-12-31"), "2024-12-24 (requested 2024-12-31)");
  assert.strictEqual(SRC.asOfLabel("2024-12-31", "2024-12-31"), "2024-12-31");
  assert.strictEqual(SRC.asOfLabel("", ""), "latest");
});

/* ---- what the store does with all of it ---- */

const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
const providers = fs.readFileSync(path.join(root, "src", "prototype", "wp", "providers.ts"), "utf8");

t("a Manual rate is never overwritten by an unforced refresh", () => {
  assert.ok(store.includes('if (!force && fxTag(fxMeta[k]) === "Manual") return;'), "put() clobbers manual rates");
  assert.ok(store.includes('fxTag(fresh.fxMeta?.[m.k]) === "Manual"'), "the live fallback clobbers manual rates");
});

t("a fiscal year strips previously auto-filled rates but keeps the typed ones", () => {
  assert.ok(store.includes('!["avgRate", "cyRate", "pyRate"].includes(k) || fxTag(ent.fxMeta?.[k]) === "Manual"'));
});

t("a fiscal year continues to OFX instead of stopping", () => {
  assert.ok(store.includes('logEvent(\n        "Calendar-year tables skipped"'), "no fiscal log line");
  const fx = store.slice(store.indexOf("autoFillRates(entityId: string"));
  assert.ok(!/if \(fiscal\) \{[\s\S]{0,400}?return;/.test(fx.slice(0, 2000)), "still bails out on a fiscal year");
});

t("only the latest-only provider is dropped for a historical date", () => {
  // src used to hard-code frankfurter here, silently ignoring the preparer's
  // provider order. The rule is narrower: drop what CANNOT answer a date.
  assert.ok(store.includes('state.fxOrder.filter((p) => p !== "erapi")'));
  assert.ok(!store.includes('["frankfurter"] : state.fxOrder'), "frankfurter is still hard-coded");
});

t("the average period is leap-day safe", () => {
  assert.ok(store.includes("const startIso = endIso ? yearBefore(endIso) : null;"));
});

t("OFX unchecked in Settings is reported as a setting, not a failure", () => {
  assert.ok(store.includes("OFX provider is unchecked in Settings"));
});

t("the average call is counted against the provider's usage", () => {
  assert.ok(/recordProvider\("ofx", 1, !!r\.ok/.test(store));
});

t("a manual rate records the date it measures and the date it was typed", () => {
  assert.ok(store.includes("enteredOn: new Date().toISOString().slice(0, 10)"));
  assert.ok(store.includes("measured: !!measuredOn"));
  assert.ok(store.includes("fxMeta: fxManualMeta(ent.fxMeta, key, value, fxMeasureDate(ent, key)),"));
});

t("currency and period edits are debounced, not fired per keystroke", () => {
  assert.ok(store.includes("clearTimeout(fxDebounce[entityId]);"));
  assert.ok(/setTimeout\(\(\) => actions\.autoFillRates\(entityId, false\), 700\)/.test(store));
});

t("the fiscal review item says which of the three situations this is", () => {
  assert.ok(store.includes("could not fill every rate — enter the missing rate(s) manually"));
  assert.ok(store.includes("rates were derived from OFX daily data over the actual fiscal period"));
  assert.ok(store.includes("entered manually or from live quotes — confirm they reflect the"));
});

t("the OFX series is fetched once per currency per session", () => {
  assert.ok(providers.includes("const ofxSeries = new Map<string, Promise<RatePoint[]>>();"));
  assert.ok(providers.includes("ofxSeries.delete(key); throw err;"), "a rejection must not be cached");
  // All three lookups must go through the cache, or it saves nothing.
  assert.ok((providers.match(/ofxAllTime\(/g) || []).length >= 4, "not every OFX lookup uses the cache");
});

t("a dated lookup asks OFX for that date, not for the latest point", () => {
  assert.ok(providers.includes('if (id === "ofx") r = date ? await fxOfxOnDate(code, date) : await fxOfx(code);'));
  assert.ok(providers.includes("nearestPoint(series, iso, 10)"));
});

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
