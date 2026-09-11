/* Loads the shipped dist/index.html in jsdom and replays real document rows
   through the REAL mapping functions. No copy of the logic lives here. */
require("fake-indexeddb/auto");
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");

let M = null;

async function boot() {
  if (M) return M;
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, "..", "..", "dist", "index.html"), "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "http://localhost/", virtualConsole: vc,
  });
  dom.window.fetch = () => Promise.reject(new Error("offline"));
  await new Promise(r => setTimeout(r, 2000));
  M = dom.window.__EN9MAP;
  if (!M) throw new Error("__EN9MAP not exposed — is the fixture hook present?");
  return M;
}

/* Build {label,values,years} rows from the raw PDF rows, the way q1() does for
   a single-amount-column report: first text cell = label, numerics = values. */
function toRows(raw, meta) {
  const out = [];
  for (const r of raw) {
    /* section banners carry no amount, so they must be seen before the
       value filter drops them */
    const section = meta.sectionOf(r);
    let label = null, li = -1;
    const vals = [];
    r.cells.forEach((c, i) => {
      const n = M.Oa(c.text);
      if (n !== null) vals.push({ v: n, idx: i });
      else if (label === null && c.text.trim().length > 2) { label = c.text.trim(); li = i; }
    });
    if (!label) continue;
    const v = vals.filter(x => x.idx > li);
    if (!v.length) continue;
    out.push({
      row: { label, values: v.map(x => x.v), years: null, page: r.page },
      feed: meta.feedOf(r), kind: "pdf", section,
      x0: r.cells[0].x0, docId: "yuki", docName: meta.docName,
    });
  }
  return out;
}

function newSlots() {
  const S = {};
  for (const k of Object.keys(M.O1)) S[k] = { byLabel: new Map(), free: M.O1[k].rows.slice(), overflow: [] };
  return S;
}

/* Mirrors processing stage 3's booking loop. */
const ENT = { docClasses: {} };
function book(items, opts = {}) {
  const rules = M.P1.map(r => ({ t: r.t, kw: [...r.kw] }));
  const S = newSlots();
  const lines = {}, contrib = {}, relabels = {};
  const unmatched = [], skipped = [], blocked = [];
  let feed = items;
  if (opts.section && M.EN9tagSections) feed = M.EN9tagSections(feed);
  if (opts.structure && M.EN9structRows) feed = M.EN9structRows(feed);
  if (opts.dedupe && M.EN9dedupeRows) feed = M.EN9dedupeRows(feed);
  if (opts.collapsed && M.EN9collapsedSections) feed = M.EN9collapsedSections(feed);

  for (const it of feed) {
    if (it.EN9skip) { skipped.push({ label: it.row.label, why: it.EN9skip }); continue; }
    const norm = M.Yv(it.row);
    if (!norm) { unmatched.push({ label: it.row.label, why: "prose filter" }); continue; }
    let target = M.Tv(norm.label, rules);
    /* SKIP is decided before any fallback or veto, exactly as the real
       booking loop does — a subtotal under a liabilities banner is still a
       subtotal, not something to re-route. */
    if (target === "SKIP") {
      const equity = opts.equity && M.EN9equityOverride ? M.EN9equityOverride(norm.label, it.feed, it.section) : null;
      if (!equity) { skipped.push({ label: norm.label, why: "SKIP rule" }); continue; }
      target = equity;
    }
    /* order: keyword rule -> section routing (documentary) -> model guess */
    if (!target && opts.section && M.EN9sectionRoute) target = M.EN9sectionRoute(it.section, norm.label) || null;
    if (!target && opts.collapsed && it.EN9collapsed && M.EN9collapsedRoute) target = M.EN9collapsedRoute(norm.label, it.EN9collapsed) || null;
    if (!target && opts.oracle) target = opts.oracle(norm.label, it.row.page) || null;
    if (opts.section && M.EN9sectionOk && target && !M.EN9sectionOk(it.section, target)) {
      blocked.push({ label: norm.label, target, section: it.section });
      target = M.EN9sectionRoute ? (M.EN9sectionRoute(it.section, norm.label) || null) : null;
    }
    if (target && it.feed === "is" && !target.startsWith("IS")) target = null;
    if (target && it.feed === "bs" && !target.startsWith("BS")) target = null;
    if (!target) { unmatched.push({ label: norm.label, why: "no rule" }); continue; }
    const alloc = M.c_(S, target, norm.label);
    if (alloc.relabel) relabels[alloc.target] = alloc.relabel;
    /* real signature: bF(entity, lines, contributions, relabels, target, row, via) */
    const rowIn = { ...norm, docId: it.docId, docName: it.docName, page: it.row.page };
    /* Contra-revenue on line 1b carries the sign reversed when the statement
       added it to its own income total — see EN9contraFlip. */
    if (M.EN9contraFlip && M.EN9contraFlip(alloc.target, it.EN9inTotal)) rowIn.values = rowIn.values.map((v) => -v);
    const okBooked = M.bF(ENT, lines, contrib, relabels, alloc.target, rowIn, "fixture");
    if (!okBooked) unmatched.push({ label: norm.label, why: "bF refused (years/target)" });
  }
  return { lines, relabels, unmatched, skipped, blocked };
}

const val = (lines, key, field) => {
  const L = lines[key];
  if (!L) return null;
  return field === "amount" ? (L.amount ?? null) : (L[field] ?? null);
};

module.exports = { boot, toRows, book, val, get M() { return M; } };
