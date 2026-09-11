/* Guards the committed dist/index.html against structural loss: all script/style
   blocks present at plausible sizes, EN9 sentinel pairs balanced. A rebuild from
   the stale src/ (which drops every EN9 fix) turns this suite red. SheetJS is not
   at risk — build.mjs has emitted the vendored copy since 1df6707. */
const fs = require("fs");
const path = require("path");
const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (c, m) => { if (!c) { console.error("FAIL:", m); fails++; } else console.log("ok:", m); };

// the app is delivered as a fixed set of embedded blocks
a(dist.includes('<script id="wp-template"'), "master template block present");
a(/JSZip/.test(dist), "JSZip present");
a(/xlsx\.js \(C\) 2013-present\s+SheetJS/.test(dist) || dist.includes("SheetJS"), "SheetJS present (build.mjs inlines vendor/xlsx.full.min.js)");
a(dist.includes('<style id="en9-theme">') && dist.includes('<style id="en9-css">') && dist.includes('<script id="en9-js">'),
  "EN9 layer blocks injected");
// Measured 2026-09-09: a bare src rebuild is ~2.89MB, ~2.98MB once the EN9 layer
// is injected. The ~0.12MB above that is the dist-only patch weight, so this
// threshold really does catch "someone rebuilt from src".
a(dist.length > 3_000_000, `bundle size plausible (${(dist.length / 1e6).toFixed(2)}MB — a src rebuild + layer is ~2.98MB)`);

// sentinel pairs
for (const s of ["EN9AIMODE", "EN9FX", "EN9GROQ", "EN9POP", "EN9PRUNE", "EN9ROUND", "EN9SANI", "EN9SCHE", "EN9STRUCT", "EN9TASKS", "EN9TIE", "EN9AI-PURE"]) {
  const b = dist.includes(`/*${s}-BEGIN*/`) || dist.includes(`/*${s}-START*/`);
  const e = dist.includes(`/*${s}-END*/`);
  a(b && e, `sentinel pair ${s} balanced`);
}
// the guard itself must stay in the builder
const build = fs.readFileSync(path.join(__dirname, "..", "scripts", "build.mjs"), "utf8");
a(build.includes("FORCE_REBUILD"), "build.mjs refuses to overwrite a fixed dist without FORCE_REBUILD=1");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL DIST-INTEGRITY TESTS PASSED");
