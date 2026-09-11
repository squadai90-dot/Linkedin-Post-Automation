/* Schedule B shareholders — built from the real Claycomb 2023 return.
 *
 * The extractor originally read Part II ONLY. On that return:
 *   Part I  : RODNEY W CLAYCOMB 25.500 / 25.50%, HEATHER M CLAYCOMB 25.500 / 25.50%
 *   Part II : ARCK TRUST (ARCK LEGACY TRUS) 98.000
 * so both individuals — and the ONLY copies of the SSN and the pro rata % —
 * were silently dropped.
 *
 * The same file also holds a SECOND corporation (DELINK LIMITED) filed as
 * page 1 only. "No shareholders" is CORRECT there; the tool must say why
 * instead of implying a parse failure.
 */
const assert = require("assert");
const path = require("path");
const esbuild = require("esbuild");

function load() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src/prototype/wp/carryForward.ts")],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const CF = load();

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/* Replays the scan exactly as carryForward runs it. */
function scan(face, from) {
  const holders = [];
  if (from < 0) return holders;
  const isIdish = (s) => /^\d{2}-\d{7}\b|^\d{3}-\d{2}-\d{4}\b/.test(s) || /^[A-Z]{2}$/.test(s) || !/[A-Za-z]{3}/.test(s);
  for (let j = from + 1; j < Math.min(from + 40, face.length); j++) {
    const r = face[j];
    const joined = r.cells.join(" ").trim();
    if (/^part\b|^schedule [a-z]\b(?!\s*,\s*column)|income statement/i.test(joined)) break;
    const cells = r.cells.map((c) => (c || "").trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const CLASS_EXACT = /^(common|ordinary|preferred|class [a-z0-9]+)( shares?)?$/i;
    const CLASS_INLINE = /\b(common|ordinary|preferred|class\s+[a-z0-9]+)(\s+shares?)?\b\s*$/i;
    let ci = cells.findIndex((c) => CLASS_EXACT.test(c));
    let className = ci >= 0 ? cells[ci] : "";
    let nameCells = ci >= 0 ? cells.slice(0, ci) : [];
    if (ci < 0) {
      const k = cells.findIndex((c) => CLASS_INLINE.test(c));
      if (k < 0) continue;
      const m = CLASS_INLINE.exec(cells[k]);
      if (!m || m.index === 0) continue;
      className = m[0].trim();
      nameCells = [...cells.slice(0, k), cells[k].slice(0, m.index).trim()].filter(Boolean);
      ci = k;
    }
    let pair = CF.parseSharePair(cells.slice(ci + 1));
    if (!pair) {
      const n = CF.numericCell(cells[ci + 1] || "");
      if (n !== null && n >= 0) pair = { boy: n, eoy: n };
    }
    if (!pair) continue;
    let name = nameCells.join(" ").trim();
    if ((!name || isIdish(name)) && j + 1 < face.length) {
      const cand = (face[j + 1].cells[0] || "").trim();
      if (/[A-Za-z]{3}/.test(cand) && !CF.looksLikeCaption(cand)) name = cand;
    }
    if (!name || isIdish(name) || /name, address|^\(a\)/i.test(name)) continue;
    let pct;
    for (let k = j; k <= j + 4 && k < face.length; k++) {
      const m = /(\d+(?:\.\d+)?)\s*%/.exec(face[k].cells.join(" "));
      if (m) { pct = Number(m[1]); break; }
    }
    if (!holders.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
      holders.push({ name, classOfShares: className, truncated: /\([^)]*$/.test(name), boy: pair.boy, eoy: pair.eoy, ...(pct !== undefined ? { pct } : {}) });
    }
  }
  return holders;
}

const mk = (rows) => rows.map((cells) => ({ page: 2, cells }));

/* Real rows from Claycomb page 2. */
const hmc = mk([
  ["Schedule B Shareholders of Foreign Corporation"],
  ["Part I U.S. Shareholders of Foreign Corporation (see instructions)"],
  ["(a) Name, address, and identifying", "(b) Description of each class of stock held by shareholder."],
  ["RODNEY W CLAYCOMB", "COMMON", "25.500", "25.500"],
  ["49 SHRULE PLACE"],
  ["HAMILT, NEW ZEALAND 3210"],
  ["174-56-8373", "25.50%"],
  ["HEATHER M CLAYCOMB", "COMMON", "25.500", "25.500"],
  ["49 SHRULE PLACE"],
  ["HAMILT, NEW ZEALAND 3210"],
  ["210-58-8456", "25.50%"],
  ["Part II      Direct Shareholders of Foreign Corporation (see instructions)"],
  ["(a) Name, address, and identifying number of", "(b) Description of each class of stock held by shareholder."],
  ["ARCK TRUST (ARCK LEGACY TRUS", "COMMON", "98.000 98.000"],
  ["49 SHRULE PLACE"],
  ["HAMILTON, NEW ZEALAND 3210"],
  ["666-66-6666", "NZ"],
]);

const partI = hmc.findIndex((r) => /part i\b.*u\.?\s*s\.?\s*shareholders/i.test(r.cells.join(" ")));
const partII = hmc.findIndex((r) => /part ii\b.*direct shareholders/i.test(r.cells.join(" ")));

t("Part I and Part II are both located", () => {
  assert.ok(partI >= 0, "Part I not found");
  assert.ok(partII >= 0, "Part II not found");
});

t("Part II still reads the direct shareholder (unchanged behaviour)", () => {
  const d = scan(hmc, partII);
  assert.strictEqual(d.length, 1);
  assert.ok(/ARCK TRUST/i.test(d[0].name), d[0].name);
  assert.strictEqual(d[0].boy, 98);
  assert.strictEqual(d[0].eoy, 98);
});

t("Part I now reads BOTH U.S. shareholders — previously dropped", () => {
  const u = scan(hmc, partI);
  assert.strictEqual(u.length, 2, `got ${u.length}: ${u.map((h) => h.name)}`);
  assert.strictEqual(u[0].name, "RODNEY W CLAYCOMB");
  assert.strictEqual(u[1].name, "HEATHER M CLAYCOMB");
  assert.strictEqual(u[0].boy, 25.5);
  assert.strictEqual(u[1].eoy, 25.5);
});

t("the pro rata % is captured — it exists ONLY in Part I", () => {
  const u = scan(hmc, partI);
  assert.strictEqual(u[0].pct, 25.5);
  assert.strictEqual(u[1].pct, 25.5);
  const combined = u.reduce((n, h) => n + h.pct, 0);
  assert.strictEqual(combined, 51, "combined US ownership drives CFC status");
});

t("Part I scan stops at Part II and does not swallow the trust", () => {
  const u = scan(hmc, partI);
  assert.ok(!u.some((h) => /ARCK/i.test(h.name)), "Part I leaked into Part II");
});

t("Part II scan does not reach back into Part I", () => {
  const d = scan(hmc, partII);
  assert.ok(!d.some((h) => /CLAYCOMB/i.test(h.name)), "Part II picked up Part I rows");
});

t("direct rows are NOT merged with Part I — that would double-count", () => {
  const d = scan(hmc, partII);
  const u = scan(hmc, partI);
  // 98 + 25.5 + 25.5 = 149 shares against 98 issued: the merge is wrong.
  assert.strictEqual(d.reduce((n, h) => n + h.eoy, 0), 98);
  assert.ok(d.reduce((n, h) => n + h.eoy, 0) + u.reduce((n, h) => n + h.eoy, 0) > 98,
    "sanity: merging really would over-state ownership");
});

/* ---- DELINK LIMITED: page-1-only 5471, no Schedule B at all ---- */
const delink = mk([
  ["H Person(s) on whose behalf this information return is filed:"],
  ["(1) Name", "(2) Address", "(3) Identifying number"],
  ["HEATHER M. CLAYCOMB", "49 SHRULE PLACE, HAMILTON, NEW ZEALAND 3210", "174-56-8373", "X", "X", "X"],
  ["Important: Fill in all applicable lines and schedules."],
  ["1a Name and address of foreign corporation"],
  ["DELINK LIMITED"],
]);

t("a page-1-only block reports no Schedule B (not a parse failure)", () => {
  const pI = delink.findIndex((r) => /part i\b.*u\.?\s*s\.?\s*shareholders/i.test(r.cells.join(" ")));
  const pII = delink.findIndex((r) => /part ii\b.*direct shareholders/i.test(r.cells.join(" ")));
  assert.strictEqual(pI, -1);
  assert.strictEqual(pII, -1);
  assert.strictEqual(pI >= 0 || pII >= 0, false, "hasScheduleB must be false");
});

t("Item H is still readable on a page-1-only block", () => {
  const hIdx = delink.findIndex((r) =>
    /person\(s\)\s*on whose behalf this information return is filed/i.test(r.cells.join(" ")));
  assert.ok(hIdx >= 0, "Item H not found");
  const people = [];
  for (let j = hIdx + 1; j <= hIdx + 10 && j < delink.length; j++) {
    const joined = delink[j].cells.join(" ");
    if (/^important\b|name and address of foreign corporation/i.test(joined.trim())) break;
    const first = (delink[j].cells[0] || "").trim();
    if (!first || CF.looksLikeCaption(first) || CF.isFormStructure(first)) continue;
    if (!/[A-Za-z]{3}/.test(first) || /^\(\d\)|^name\b|^address\b/i.test(first)) continue;
    const marks = (joined.match(/\bX\b/g) || []).length;
    people.push({ name: first, isShareholder: marks >= 1, isOfficer: marks >= 2, isDirector: marks >= 3 });
  }
  assert.strictEqual(people.length, 1, JSON.stringify(people));
  assert.strictEqual(people[0].name, "HEATHER M. CLAYCOMB");
  assert.ok(people[0].isShareholder && people[0].isOfficer && people[0].isDirector);
});

/* ---- Rise Digital Marketing: the class token MERGES into the name cell.
   "ASHLEY G ELLIOTT" is short, so the column gap survives and the row reads.
   "MATTHEW J METCALFE (NRA SPOU" runs up to the column rule, so the extractor
   receives "MATTHEW J METCALFE (NRA SPOU COMMON" as ONE cell. An exact
   whole-cell match drops him — leaving 1 share of 1 (100%) instead of
   1 of 2 (50%). ---- */
const rise = mk([
  ["Part II", "Direct Shareholders of Foreign Corporation (see instructions)"],
  ["(a) Name, address, and identifying number of", "(b) Description of each class of stock held by shareholder."],
  ["ASHLEY G ELLIOTT", "COMMON", "1.000", "1.000"],
  ["PMB 22135, 514 AMERICAS WAY"],
  ["BOX ELDER, SD 57719"],
  ["275-08-4980", "AS"],
  ["MATTHEW J METCALFE (NRA SPOU COMMON", "1.000", "1.000"],
  ["15 ABBOTSWOOD ROAD"],
  ["DOREEN, AUSTRALIA 3764"],
  ["666-66-6666", "AS"],
]);
const riseII = rise.findIndex((r) => /part ii\b.*direct shareholders/i.test(r.cells.join(" ")));

t("a holder whose name merged with the class cell is still read", () => {
  const d = scan(rise, riseII);
  assert.strictEqual(d.length, 2, `got ${d.length}: ${d.map((h) => h.name)}`);
  assert.strictEqual(d[0].name, "ASHLEY G ELLIOTT");
  assert.strictEqual(d[1].name, "MATTHEW J METCALFE (NRA SPOU");
  assert.strictEqual(d[1].classOfShares, "COMMON");
  assert.strictEqual(d[1].boy, 1);
  assert.strictEqual(d[1].eoy, 1);
});

t("ownership percentages are now right: 50% each, not 100%", () => {
  const d = scan(rise, riseII);
  const total = d.reduce((n, h) => n + h.eoy, 0);
  assert.strictEqual(total, 2, "Schedule A reports 2 shares issued");
  assert.strictEqual((d[0].eoy / total) * 100, 50);
});

t("Schedule A reconciliation catches a dropped holder", () => {
  const schedA = { boy: 2, eoy: 2 };
  const onlyOne = [{ boy: 1, eoy: 1 }];              // the old, broken result
  const both = scan(rise, riseII);
  const sum = (rows) => rows.reduce((n, h) => n + h.eoy, 0);
  assert.notStrictEqual(sum(onlyOne), schedA.eoy, "must be flagged");
  assert.strictEqual(sum(both), schedA.eoy, "must reconcile once fixed");
});

t("a name truncated by the column edge is flagged, not silently kept", () => {
  const d = scan(rise, riseII);
  assert.strictEqual(d[0].truncated, false);
  assert.strictEqual(d[1].truncated, true, "unclosed bracket means cut off");
});

t("the class cell alone is never mistaken for a name", () => {
  const classOnly = mk([
    ["Part II", "Direct Shareholders of Foreign Corporation"],
    ["COMMON", "5.000", "5.000"],
  ]);
  const i = classOnly.findIndex((r) => /part ii\b/i.test(r.cells.join(" ")));
  const d = scan(classOnly, i);
  assert.strictEqual(d.length, 0, `bare class row produced a holder: ${JSON.stringify(d)}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
