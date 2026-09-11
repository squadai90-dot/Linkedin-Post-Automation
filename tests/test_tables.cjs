/* Item A: the filter popup must not move the page, must not be clipped, and
   must behave identically whether React rendered it or the layer injected it.
   The geometry block is evaluated out of dist/index.html. */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const layer = fs.readFileSync(path.join(root, "layer-src", "enhance.js"), "utf8");
const css = fs.readFileSync(path.join(root, "layer-src", "enhance.css"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const m = dist.match(/\/\*EN9POP-BEGIN\*\/([\s\S]*?)\/\*EN9POP-END\*\//);
a(!!m, "EN9POP sentinel block present in dist");
if (!m) { process.exit(1); }
const window = { innerWidth: 1200, innerHeight: 800 };
eval(m[1]);

const VP = { w: 1200, h: 800 };
const rect = (top, left, w = 120, h = 24) => ({ top, left, bottom: top + h, right: left + w });

/* ---- A1: the page must not move ---------------------------------------- */
a(!/autoFocus:!0/.test(dist), "A1 ROOT CAUSE: no autoFocus survives anywhere in the app bundle");
a(dist.includes("ref:EN9focusNoScroll"), "A1 the popup's search input is focused through the helper instead");
a(/function EN9focusNoScroll\(t\)\{if\(!t\)return;try\{t\.focus\(\{preventScroll:!0\}\)/.test(dist),
  "A1 the helper focuses with preventScroll");
a(/catch\(e\)\{try\{t\.focus\(\)/.test(dist), "A1 it still focuses on browsers without the option");
a(layer.includes("window.EN9focusNoScroll(box)"), "A1 the layer's popup uses the same helper");
a(layer.includes("preventScroll:true"), "A1 the layer has its own preventScroll fallback");
a(!/ins\[i\]\.focus\(\);\s*ins\[i\]\.select\(\)/.test(layer), "A1 the '/' shortcut no longer plain-focuses either");

/* ---- A5: clamping, flipping, never clipped ------------------------------ */
let p = EN9popPlace(rect(100, 400), { w: 288, h: 300 }, VP);
a(p.top === 128 && p.left === 400 && !p.flip, "plenty of room: the popup sits under its trigger");

p = EN9popPlace(rect(100, 1150), { w: 288, h: 300 }, VP);
a(p.left + p.width <= VP.w - 8, `clamped at the right edge (left ${p.left} + w ${p.width} <= 1192)`);
p = EN9popPlace(rect(100, -50), { w: 288, h: 300 }, VP);
a(p.left === 8, "clamped at the left edge");

// near the bottom it flips above the trigger rather than running off-screen
p = EN9popPlace(rect(740, 400), { w: 288, h: 300 }, VP);
a(p.flip === true, "A5 near the viewport bottom the popup flips above the trigger");
a(p.top + p.maxHeight <= 740 + 4, "A5 the flipped popup sits above its trigger, not over it");
a(p.top >= 8, "A5 the flipped popup stays on screen");

p = EN9popPlace(rect(60, 400), { w: 288, h: 300 }, VP);
a(p.flip === false, "A5 near the top it opens downward");
[rect(0, 0), rect(799, 1199), rect(400, 600), rect(790, 10)].forEach((r, i) => {
  const q = EN9popPlace(r, { w: 288, h: 300 }, VP);
  a(q.top >= 8 && q.left >= 8 && q.top + q.maxHeight <= VP.h && q.left + q.width <= VP.w,
    `A5 popup stays fully inside the viewport from anchor ${i}`);
});

// a narrow phone viewport must not produce a popup wider than the screen
p = EN9popPlace(rect(300, 10), { w: 288, h: 300 }, { w: 360, h: 640 });
a(p.width <= 360 - 16, `A5 the popup narrows to fit a 360px screen (${p.width}px)`);
a(p.maxHeight >= 120, "A5 it never collapses to nothing");
p = EN9popPlace(null, { w: 288, h: 300 }, VP);
a(p.top >= 8 && p.left >= 8, "A5 a missing anchor still yields a sane position rather than NaN");

/* ---- A5: repositioning ------------------------------------------------- */
a(dist.includes('window.addEventListener("scroll",EN9r,!0),window.addEventListener("resize",EN9r)'),
  "A5 React popups reposition on scroll and resize");
a(dist.includes('window.removeEventListener("scroll",EN9r,!0)'), "A5 and unbind when closed");
a(dist.includes("EN9b.current?EN9b.current.getBoundingClientRect()"),
  "A5 placement reads the trigger's LIVE rect, not a snapshot from when it opened");
a(layer.includes('addEventListener("scroll", popPosition, true)') && layer.includes('addEventListener("resize", popPosition)'),
  "A5 the layer's popup repositions the same way");
a(/follow it \*\/\s*\n\s*popPosition\(\);/.test(layer), "A5 an open popup is re-placed after every rebuild");

/* ---- A2/A6: no filter row, popup on <body> ------------------------------ */
a(!layer.includes('el("tr","en9-cfrow")'), "A2 REGRESSION: the layer no longer builds a separate filter row");
a(!css.includes("tr.en9-cfrow th{"), "A2 the filter-row styles are gone");
a(layer.includes('var old = head.querySelector("tr.en9-cfrow"); if(old) old.remove()'),
  "A2 any filter row left over from a previous build is removed");
a(layer.includes("document.body.appendChild(POP)"), "A6 the popup is appended to <body>");
a(!layer.includes("th.appendChild(POP)"), "A6 it is never appended to the header cell");
a(layer.includes('var POP = null, POPFOR = null'), "A6 there is a single shared popup, not one per column");

/* ---- A3/A4: coverage and skipping -------------------------------------- */
a(layer.includes('document.querySelectorAll(".view-stack table, .wp-table table")'),
  "A3 the layer walks every table, not just the two kinds it used to know");
a(/EN9SKIPCOL = \/\^\(remove\|restore\|use\|open\|delete\|actions\?\|edit/.test(layer),
  "A4 action-only columns are named and skipped");
a(layer.includes('if(!name) return false;'), "A4 unlabelled columns are skipped");
a(layer.includes("return sampled === 0 ? true : withText > 0;"),
  "A4 a column whose cells hold only buttons is not offered a filter");

/* ---- the Status cell: chip, not dropdown options ------------------------ */
a(layer.includes('c.querySelectorAll("[data-en9],select,option,button")'),
  "the cell reader drops the select so the Status filter reads the chip label");
a(layer.includes('var sel = td.querySelector("select"); if(sel && sel.selectedIndex>=0'),
  "a cell that is ONLY a select still contributes its chosen option");

/* ---- A7: the table key --------------------------------------------------*/
a(!layer.includes('Array.prototype.indexOf.call(document.querySelectorAll("table"),tb)'),
  "A7 REGRESSION: the document-wide table index is gone from the key");
a(layer.includes('junk = c.querySelectorAll("[data-en9]")'),
  "A7 nodes this layer injects are stripped before the key is derived");
a(layer.includes("names.join(\"|\").slice(0,90)"), "A7 the key is derived from the header's own text");

/* ---- A5: responsive CSS ------------------------------------------------ */
a(!css.includes(".wp-table thead{display:none}"), "A5 REGRESSION: headers are no longer hidden on small screens");
a(!css.includes("tr.en9-cfrow{display:none}"), "A5 REGRESSION: filters are no longer hidden on small screens");
a(css.includes(".wp-table thead{display:table-header-group}"), "A5 headers stay in the header group when narrow");
a(css.includes(".wp-table table{min-width:680px}"), "A5 columns scroll rather than being squeezed");
a(css.includes("main,.view-stack{overflow-x:hidden}"), "A5 no page-level horizontal scroll");
a(css.includes(".wp-table thead th{position:sticky;top:0;z-index:5}"), "A5 headers remain usable while scrolling");
a(css.includes(".en9-fpop{max-width:calc(100vw - 16px)}"), "A5 the popup cannot exceed a narrow screen");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL TABLE-UI TESTS PASSED");
