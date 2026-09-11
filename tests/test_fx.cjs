/* FX chain tests (CHANGE 3): nearest-date OFX lookups, fiscal window computation,
   manual-entry attribution, and source tags. Evals the /*EN9FX-BEGIN*​/ block
   straight out of dist/index.html so it pins the shipped code. */
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const m = dist.match(/\/\*EN9FX-BEGIN\*\/([\s\S]*?)\/\*EN9FX-END\*\//);
a(!!m, "EN9FX sentinel block present in dist");
if (!m) { process.exit(1); }

// Oc stub the eval'd block closes over (swappable per test)
var OcCalls = [];
var OcImpl = async () => { throw new Error("Oc not stubbed"); };
async function Oc(url) { OcCalls.push(url); return OcImpl(url); }
void Oc;

eval(m[1]);

const day = (y, mo, d) => Date.UTC(y, mo - 1, d, 12, 0, 0); // midday avoids TZ edges
const pts = (...days) => days.map(([y, mo, d, r]) => ({ t: day(y, mo, d), r }));

(async () => {
  // --- 1. EN9nearestPoint --------------------------------------------------
  const series = pts([2024, 6, 18, 1.51], [2024, 6, 21, 1.52], [2024, 6, 23, 1.53], [2024, 6, 25, 1.54]);
  let n = EN9nearestPoint(series, "2024-06-21");
  a(n && n.rate === 1.52 && n.date === "2024-06-21" && n.diffDays === 0, "nearest: exact hit");
  n = EN9nearestPoint(series, "2024-06-22");
  a(n && n.date === "2024-06-21", "nearest: no rate on the date -> the last one published BEFORE it (Jun 21)");
  n = EN9nearestPoint(series, "2024-06-24");
  a(n && n.date === "2024-06-23", "nearest: Jun 24 takes Jun 23, never the later Jun 25");
  // THE RULE: the last published rate ON OR BEFORE the measurement date. A rate
  // published afterwards did not exist when the transaction happened.
  n = EN9nearestPoint(pts([2025, 7, 28, 1.10], [2025, 8, 1, 1.20]), "2025-07-31");
  a(n && n.date === "2025-07-28" && n.rate === 1.10,
    "RULE: 31 Jul with 28 Jul and 1 Aug in the series returns 28 Jul, not 1 Aug");
  a(EN9nearestPoint(pts([2024, 6, 25, 1.54]), "2024-06-22") === null,
    "nearest: a forward-only series is refused outright (was: reached 3 days forward)");
  a(EN9nearestPoint(pts([2025, 8, 1, 1.2]), "2025-07-31") === null,
    "nearest: one day forward is still refused");
  // Widened to 10 days: Christmas, Golden Week and Eid closures all exceed 7.
  n = EN9nearestPoint(pts([2024, 12, 24, 1.5]), "2025-01-02");
  a(n && n.date === "2024-12-24" && n.diffDays === 9, "nearest: 9-day Christmas gap accepted (backward)");
  a(EN9nearestPoint(pts([2024, 12, 22, 1.5]), "2025-01-02") === null, "nearest: >10 days back refused");
  a(EN9nearestPoint(pts([2024, 6, 1, 1.5]), "2024-06-22") === null, "nearest: >10 days away refused");
  a(EN9nearestPoint([], "2024-06-22") === null, "nearest: empty series refused");
  a(EN9nearestPoint(series, "junk") === null, "nearest: malformed date refused");
  a(EN9windowStart("2025-07-31", 10) === "2025-07-21", "windowStart: names the oldest date the search reaches");

  // --- 2. EN9ofxAllTime + EN9ofxOnDate (cache, errors, no inversion) -------
  OcCalls = [];
  OcImpl = async () => ({ HistoricalPoints: series.map(p => ({ PointInTime: p.t, InterbankRate: p.r })) });
  let r = await EN9ofxOnDate("aud", "2024-06-22");
  a(r.ok && r.value.rate === 1.52, "ofxOnDate: returns the divide rate unchanged (no inversion)");
  a(r.value.asOf === "2024-06-21" && r.value.requested === "2024-06-22", "ofxOnDate: resolved date differs from requested and both are reported");
  await EN9ofxOnDate("AUD", "2024-06-23");
  a(OcCalls.length === 1, "ofxOnDate: second lookup for the same currency hits the session cache (one download)");
  r = await EN9ofxOnDate("AUD", "2023-01-01");
  a(!r.ok && /on or before 2023-01-01/.test(r.error) && /searched back to 2022-12-22/.test(r.error),
    "ofxOnDate: failure names the requested date AND the oldest date checked");
  a(!r.ok && /after the measurement date cannot be used/.test(r.error),
    "ofxOnDate: failure states why a later rate was not substituted");
  OcImpl = async () => ({ ErrorCode: 17, Message: "Currency RON not supported" });
  r = await EN9ofxOnDate("RON", "2024-06-22");
  a(!r.ok && /RON not supported/.test(r.error), "ofxOnDate: provider error is passed through");
  let before = OcCalls.length;
  OcImpl = async () => ({ HistoricalPoints: [{ PointInTime: day(2024, 6, 22), InterbankRate: 4.5 }] });
  r = await EN9ofxOnDate("RON", "2024-06-22");
  a(r.ok && r.value.rate === 4.5 && OcCalls.length === before + 1, "ofxOnDate: a failed series is evicted so the next call retries");

  // --- 3. EN9yearBefore / EN9toIso -----------------------------------------
  a(EN9yearBefore("2024-12-31") === "2024-01-01", "yearBefore: calendar year window");
  a(EN9yearBefore("2024-02-29") === "2023-03-01", "yearBefore: Feb-29 clamps without throwing (old code raised RangeError)");
  a(EN9yearBefore("2025-06-30") === "2024-07-01", "yearBefore: fiscal-year window");
  a(EN9yearBefore("garbage") === null, "yearBefore: junk refused");
  a(EN9toIso("06/22/2024") === "2024-06-22", "toIso: M/D/YYYY");
  a(EN9toIso("6-22-24") === "2024-06-22", "toIso: dashed short form");
  a(EN9toIso("22/06/2024") === "2024-06-22", "toIso: day/month swap when first field > 12");
  a(EN9toIso("11/30/2023") === "2023-11-30", "toIso: cross-year dates no longer nulled (old m8 required a matching year)");
  a(EN9toIso("13/13/2024") === null, "toIso: impossible date refused");
  a(EN9toIso("2025-07-31") === "2025-07-31", "toIso: ISO YYYY-MM-DD accepted (was null -> dateless lookup)");
  a(EN9toIso("2025/07/31") === "2025-07-31", "toIso: ISO YYYY/MM/DD accepted");
  a(EN9toIso("2025-13-01") === null, "toIso: impossible ISO month refused");

  // --- 3b. EN9reqIso: a supplied-but-unparseable date must BLOCK ------------
  a(EN9reqIso("") === null && EN9reqIso(null) === null, "reqIso: genuinely absent date returns null");
  a(EN9reqIso("2025-07-31") === "2025-07-31", "reqIso: ISO passes through");
  let threw = null;
  try { EN9reqIso("31 July 2025", "measurement date"); } catch (e) { threw = e.message; }
  a(threw && /Unparseable measurement date/.test(threw), "reqIso: unparseable date throws instead of returning null");
  a(threw && /Refusing to look up a dateless "latest" rate/.test(threw),
    "reqIso: the exception says why — no silent fall-through to today's rate");

  // --- 4. Manual meta, tags, labels ----------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  // B4: asOf is the MEASUREMENT date. Stamping today made a rate typed in March
  // for a 31 December year-end look as though it was sourced in March.
  let meta = EN9fxManualMeta({}, "cyRate", "1.5", "2025-12-31");
  a(meta.cyRate && meta.cyRate.source === "Manual entry" && meta.cyRate.tag === "Manual",
    "manualMeta: typing a rate stamps Manual entry");
  a(meta.cyRate.asOf === "2025-12-31", "manualMeta: asOf is the measurement date, not today");
  a(meta.cyRate.asOf !== today || today === "2025-12-31", "manualMeta REGRESSION: asOf is no longer today's date");
  a(meta.cyRate.enteredOn === today, "manualMeta: the entry date is recorded separately");
  a(meta.cyRate.measured === true, "manualMeta: the entry is marked as carrying a real measurement date");
  let noDate = EN9fxManualMeta({}, "avgRate", "1.5", null);
  a(noDate.avgRate.asOf === "" && noDate.avgRate.enteredOn === today && noDate.avgRate.measured === false,
    "manualMeta: with no measurement date, asOf stays empty rather than claiming today");
  meta = EN9fxManualMeta({ cyRate: { source: "x", asOf: "y" } }, "cyRate", "", "2025-12-31");
  a(!("cyRate" in meta), "manualMeta: clearing the input deletes the stale meta");
  a(EN9fxMeasureDate({ profile: { cyEnd: "12/31/2025", pyEnd: "12/31/2024" } }, "cyRate") === "2025-12-31",
    "measureDate: cyRate takes the current-year end");
  a(EN9fxMeasureDate({ profile: { cyEnd: "12/31/2025", pyEnd: "12/31/2024" } }, "pyRate") === "2024-12-31",
    "measureDate: pyRate takes the prior-year end");
  a(EN9fxMeasureDate({ profile: { cyEnd: "12/31/2025" } }, "avgRate") === null,
    "measureDate: an average rate has no single measurement date");
  a(EN9fxMeasureDate({ profile: { cyEnd: "not a date" } }, "cyRate") === null,
    "measureDate: an unparseable period end yields no date rather than throwing");
  a(EN9fxTag({ tag: "OFX" }) === "OFX", "fxTag: explicit tag wins");
  a(EN9fxTag({ source: "Built-in IRS yearly average + US Treasury 12/31 tables · IRS yearly average" }) === "IRS",
    "fxTag: legacy IRS prose sniffed");
  a(EN9fxTag({ source: "Built-in tables · Treasury 12/31 spot" }) === "Treasury", "fxTag: legacy Treasury prose sniffed");
  a(EN9fxTag({ source: "frankfurter (live fallback)" }) === "ECB", "fxTag: frankfurter prose sniffed as ECB");
  a(EN9fxTag({ source: "Manual entry" }) === "Manual", "fxTag: manual prose sniffed");
  a(EN9fxTag(undefined) === "", "fxTag: missing meta yields empty (badge hidden)");
  a(EN9asOfLabel("2024-06-21", "2024-06-22") === "2024-06-21 (requested 2024-06-22)", "asOfLabel: substitution surfaced");
  a(EN9asOfLabel("2024-06-21", "2024-06-21") === "2024-06-21", "asOfLabel: exact date stays plain");

  // --- 5. dist wiring smoke -------------------------------------------------
  a(dist.includes('a=i?await EN9ofxOnDate(t,i):await qJ(t)'), "tC routes dated OFX requests to the nearest-date lookup");
  a(dist.includes('EN9fiscal=Wc(i.profile.cyEnd)'), "fiscal guard lifted in autoFillRates");
  a(dist.includes('fxMeta:EN9fxManualMeta(n.fxMeta,i,s,EN9fxMeasureDate(n,i))'),
    "setField passes the entity's period end as the measurement date");
  a(!dist.includes('asOf:new Date().toISOString().slice(0,10),tag:"Manual"'),
    "B4 REGRESSION: the today-stamp is gone from manual FX meta");
  a(dist.includes('"average for the period"'), "B4 an average rate says so instead of showing a blank date");
  a(!dist.includes('u&&!d?["frankfurter"]:te.fxOrder'), "historical spot fallback no longer frankfurter-only");
  a(!dist.includes("let u=EN9toIso(h.end)||void 0"),
    "spot-rate caller no longer degrades an unparseable date to a dateless lookup");
  a(dist.includes('catch(EN9pe){We("Exchange rate lookup refused"'),
    "spot-rate caller logs the refusal instead of swallowing it");
  a(dist.includes('EN9nearestPoint(s,e,10)'), "ofxOnDate asks for the widened 10-day backward window");
  a(dist.includes('try{m=EN9reqIso(Q,"dividend payment date")}'), "dividend date goes through the blocking parser");
  a(dist.includes('level:EN9dErr?"block"'), "an unparseable dividend date raises a blocking review item");
  a(!/EN9nearestPoint\(t,e,i=7\)/.test(dist), "the 7-day symmetric default is gone from the bundle");

  if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
  console.log("ALL FX TESTS PASSED");
})().catch(e => { console.error("UNCAUGHT:", e); process.exit(1); });
