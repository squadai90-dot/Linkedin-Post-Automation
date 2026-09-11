/* The same replay as fixtures/harness.cjs, driven through the SOURCE modules
   instead of the shipped bundle.
 *
 * Deliberately a near-copy: the point is that the two harnesses differ ONLY in
 * which implementation they call, so a difference in the results is a
 * difference in the code and not in how the code was driven. Keep the two
 * files in step -- if the shipped harness's booking loop changes, this one
 * changes with it. */
const path = require("path");
const esbuild = require("esbuild");

function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "..", entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' },
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const ENG = load("src/prototype/wp/engine.ts");
const STORE = load("src/prototype/wp/store.ts");
const SECT = load("src/prototype/wp/sections.ts");

/** Same shape as the shipped harness's toRows, using src's numericCell. */
function toRows(raw, meta) {
  const out = [];
  for (const r of raw) {
    const section = meta.sectionOf(r);
    let label = null, li = -1;
    const vals = [];
    r.cells.forEach((c, i) => {
      const n = ENG.numericCell(c.text);
      if (n !== null) vals.push({ v: n, idx: i });
      else if (label === null && c.text.trim().length > 2) { label = c.text.trim(); li = i; }
    });
    if (!label) continue;
    const v = vals.filter((x) => x.idx > li);
    if (!v.length) continue;
    out.push({
      row: { label, values: v.map((x) => x.v), years: null, page: r.page },
      feed: meta.feedOf(r), kind: "pdf", section,
      x0: r.cells[0].x0, docId: "yuki", docName: meta.docName,
    });
  }
  return out;
}

function newSlots() {
  const S = {};
  for (const k of Object.keys(ENG.POOLS)) S[k] = { byLabel: new Map(), free: ENG.POOLS[k].rows.slice(), overflow: [] };
  return S;
}

const ENT = { docClasses: {} };

function book(items, opts = {}) {
  const rules = ENG.DEFAULT_RULES.map((r) => ({ t: r.t, kw: [...r.kw] }));
  const S = newSlots();
  const lines = {}, contrib = {}, relabels = {};
  const unmatched = [], skipped = [], blocked = [];
  let feed = items;
  if (opts.section) feed = SECT.tagSections(feed);
  if (opts.structure) feed = SECT.structRows(feed);
  if (opts.collapsed) feed = SECT.collapsedSections(feed);

  for (const it of feed) {
    if (it.skipReason) { skipped.push({ label: it.row.label, why: it.skipReason }); continue; }
    const norm = ENG.applyRowHygiene(it.row);
    if (!norm) { unmatched.push({ label: it.row.label, why: "prose filter" }); continue; }
    let target = ENG.matchRule(norm.label, rules);
    /* SKIP is decided before any fallback or veto, exactly as the real
       booking loop does — a subtotal under a liabilities banner is still a
       subtotal, not something to re-route. */
    if (target === "SKIP") {
      const equity = opts.equity ? SECT.equityOverride(norm.label, it.feed, it.section) : null;
      if (!equity) { skipped.push({ label: norm.label, why: "SKIP rule" }); continue; }
      target = equity;
    }
    if (!target && opts.section) target = SECT.sectionRoute(it.section, norm.label) || null;
    if (!target && opts.collapsed && it.collapsed) target = SECT.collapsedRoute(norm.label, it.collapsed) || null;
    if (!target && opts.oracle) target = opts.oracle(norm.label, it.row.page) || null;
    if (opts.section && target && !SECT.sectionOk(it.section, target)) {
      blocked.push({ label: norm.label, target, section: it.section });
      target = SECT.sectionRoute(it.section, norm.label) || null;
    }
    if (target && it.feed === "is" && !target.startsWith("IS")) target = null;
    if (target && it.feed === "bs" && !target.startsWith("BS")) target = null;
    if (!target) { unmatched.push({ label: norm.label, why: "no rule" }); continue; }
    const alloc = STORE.resolvePool(S, target, norm.label);
    if (alloc.relabel) relabels[alloc.target] = alloc.relabel;
    const rowIn = { ...norm, docId: it.docId, docName: it.docName, page: it.row.page };
    /* Contra-revenue on line 1b carries the sign reversed when the statement
       added it to its own income total — see SECT.contraRevenueFlip. */
    if (SECT.contraRevenueFlip(alloc.target, it.inTotal)) rowIn.values = rowIn.values.map((v) => -v);
    const okBooked = STORE.manualApply(ENT, lines, contrib, relabels, alloc.target, rowIn, "fixture");
    if (!okBooked) unmatched.push({ label: norm.label, why: "bF refused (years/target)" });
  }
  return { lines, relabels, unmatched, skipped, blocked };
}

const val = (lines, key, field) => {
  const L = lines[key];
  if (!L) return null;
  return field === "amount" ? (L.amount ?? null) : (L[field] ?? null);
};

const BANNERS = () => load("src/prototype/wp/sectionBanners.ts");

module.exports = { toRows, book, val, ENG, STORE, SECT, BANNERS };
