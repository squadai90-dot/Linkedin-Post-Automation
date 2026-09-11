/* END-TO-END PARITY: the same real document through both pipelines.
 *
 * Every other parity test in this suite compares one function against its
 * shipped counterpart. This one replays a real client report -- 2Hats
 * Consulting B.V.'s 2024 Yuki annual accounts, the same rows the acceptance
 * fixture uses -- through the WHOLE booking pipeline twice: once through the
 * shipped bundle in jsdom, once through the source modules. Then it demands
 * the same numbers.
 *
 * It is the check the whole port exists to pass. A helper that matches in
 * isolation can still be wired up differently, and the wiring is where a port
 * goes wrong: a veto applied before a fallback instead of after, a filter on
 * the wrong side of a loop. Only running the real thing catches that.
 *
 * The AI decisions are replayed from the recorded Provenance sheet rather than
 * called live, so the comparison is deterministic and needs no key.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const DIST = require("./fixtures/harness.cjs");
const SRC = require("./fixtures/harness_src.cjs");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const here = (...p) => path.join(__dirname, ...p);
const RAW = JSON.parse(fs.readFileSync(here("fixtures", "2hats_rows.json"), "utf8"));
const AI = JSON.parse(fs.readFileSync(here("fixtures", "2hats_ai_mappings.json"), "utf8"));

const feedOf = (r) => (r.page <= 3 ? "bs" : "is");
/* The banners Yuki actually prints, resolved by the harness rather than by the
   lexicon, so both pipelines are fed identical sections and the comparison is
   about the BOOKING, not about banner detection (which test_sections covers). */
const BANNERS = [
  [/^assets$/i, "assets"], [/^liabilities$/i, "liabilities"],
  [/^gross margin$/i, "income"], [/^operating costs$/i, "costs"],
  [/^depreciations$/i, "costs"], [/^financial result$/i, "costs"], [/^taxes$/i, "costs"],
];
const makeSectionOf = () => {
  let current = null;
  return (r) => {
    const text = (r.cells[0].text || "").trim();
    for (const [re, s] of BANNERS) if (re.test(text)) { current = s; break; }
    return current;
  };
};

(async () => {
  await DIST.boot();
  const M = DIST.M;

  /* The recorded AI decisions, keyed by caption. Both sides get the same
     oracle, so the model is not a variable in this comparison. */
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const oracleMap = new Map();
  for (const p of AI) {
    const m = /^Sch ([CF]) · (.+?) \((amount|eoy|boy)\)$/.exec(p.target || "");
    if (!m) continue;
    const list = m[1] === "F" ? M.is : M.ts;
    const e = list.find((x) => x.label.toLowerCase() === m[2].toLowerCase())
           || list.find((x) => m[2].toLowerCase().startsWith(x.label.toLowerCase()));
    if (e) oracleMap.set(norm(p.caption), (m[1] === "F" ? "BS:" : "IS:") + e.row);
  }
  const oracle = (label) => oracleMap.get(norm(label));

  const meta = (sectionOf) => ({ feedOf, sectionOf, docName: "2Hats Yuki annual accounts 2024" });
  const distItems = DIST.toRows(RAW, meta(makeSectionOf()));
  const srcItems = SRC.toRows(RAW, meta(makeSectionOf()));

  t("both readers extract the same rows from the real report", () => {
    assert.ok(distItems.length > 50, `only ${distItems.length} rows replayed — the fixture did not load`);
    assert.strictEqual(srcItems.length, distItems.length, "different row counts");
    assert.deepStrictEqual(
      srcItems.map((i) => [i.row.label, i.row.values, i.feed, i.section, i.x0]),
      distItems.map((i) => [i.row.label, i.row.values, i.feed, i.section, i.x0]),
    );
  });

  const OPTS = { oracle, structure: true, section: true };
  const D = DIST.book(distItems, OPTS);
  const S = SRC.book(srcItems, OPTS);

  /* Serialised, not deep-equalled: the shipped side's objects come from the
     jsdom realm, and deepStrictEqual compares prototype identity, so two
     structurally identical objects from different realms never match. */
  const sortLines = (lines) => Object.keys(lines).sort()
    .map((k) => `${k} = ${JSON.stringify(lines[k], Object.keys(lines[k]).sort())}`);

  t("every booked line comes out with the same value, to the cent", () => {
    const d = sortLines(D.lines), s = sortLines(S.lines);
    assert.ok(d.length > 15, `only ${d.length} lines booked — the replay did nothing`);
    assert.deepStrictEqual(s, d);
  });

  t("the same rows are dropped as structure, for the same stated reason", () => {
    const key = (x) => `${x.label} :: ${x.why}`;
    assert.deepStrictEqual(S.skipped.map(key).sort(), D.skipped.map(key).sort());
  });

  t("the same rows are left unmatched, for the same stated reason", () => {
    const key = (x) => `${x.label} :: ${x.why}`;
    assert.deepStrictEqual(S.unmatched.map(key).sort(), D.unmatched.map(key).sort());
  });

  t("the section veto blocks the same proposals on both sides", () => {
    const key = (x) => `${x.label} -> ${x.target} (${x.section})`;
    assert.deepStrictEqual(S.blocked.map(key).sort(), D.blocked.map(key).sort());
  });

  t("pooled 'other' lines are relabelled identically", () => {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(S.relabels)), JSON.parse(JSON.stringify(D.relabels)));
  });

  /* The figures a reviewer would actually check, restated here so a failure
     names the number rather than a diff of the whole object. */
  /* EXACT label first, then a prefix: prefix-only resolves "Interest" to
     "Interest income" and scores a correctly booked line as missing. */
  const pick = (list, l) => list.find((x) => x.label.toLowerCase() === l.toLowerCase())
                         || list.find((x) => x.label.toLowerCase().startsWith(l.toLowerCase()));
  const bsKey = (l) => { const e = pick(M.is, l); return e ? "BS:" + e.row : null; };
  const isKey = (l) => { const e = pick(M.ts, l); return e ? "IS:" + e.row : null; };

  t("the reviewed work paper's balance-sheet figures still come out of src", () => {
    for (const [label, want] of Object.entries({
      "Cash": 28447.17,
      "Buildings and other depreciable assets": 1449.37,
      "Less accumulated depreciation": -1390.12,
      "Common stock": 4500.00,
      "Retained earnings": -1890.68,
    })) {
      const got = SRC.val(S.lines, bsKey(label), "eoy");
      assert.ok(got !== null && Math.abs(got - want) < 1.0, `${label}: expected ${want}, got ${got}`);
    }
  });

  t("the reviewed work paper's income-statement figures still come out of src", () => {
    for (const [label, want] of Object.entries({
      "Gross receipts": 174223.36,
      "Compensation not deducted elsewhere": 186640.63,
      "Depreciation not deducted elsewhere": 236.97,
      "Interest": -49.00,
      "FX gain/loss": -2701.45,
    })) {
      const got = SRC.val(S.lines, isKey(label), "amount");
      assert.ok(got !== null && Math.abs(got - want) < 1.0, `${label}: expected ${want}, got ${got}`);
    }
  });

  t("Schedule F balances in the source pipeline, as it does in the shipped one", () => {
    // A presentation split can hide in a single line; it cannot hide in the
    // totals. 29,641.42 both sides, from the reviewed work paper.
    let assets = 0, liabEq = 0;
    for (const spec of M.is) {
      const v = SRC.val(S.lines, "BS:" + spec.row, "eoy");
      if (typeof v !== "number") continue;
      if (/assets/i.test(spec.group)) assets += v; else liabEq += v;
    }
    assert.ok(Math.abs(assets - 29641.42) < 1.0, `assets ${assets}`);
    assert.ok(Math.abs(liabEq - 29641.42) < 1.0, `liabilities + equity ${liabEq}`);
    assert.ok(Math.abs(assets - liabEq) < 0.01, `out by ${assets - liabEq}`);
  });

  console.log(`\n${Object.keys(S.lines).length} lines booked · ${S.skipped.length} structural rows dropped · ${S.unmatched.length} unmatched`);
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
