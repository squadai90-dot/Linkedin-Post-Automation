/* Pins scripts/inject-layer.mjs against two landmines that shipped silently:

   1. Both <style> blocks used to fall to s.replace("</style>", …), which always
      matches the app's OWN stylesheet close — so the second insert landed ABOVE
      the first and inverted theme.css against enhance.css (they overlap on
      tables, sidebar, pills and buttons).
   2. Both body inserts used indexOf("</body>"), and the vendored SheetJS bundle
      contains the literal string "</body></html>", so the layer was spliced into
      the middle of a JavaScript string literal.

   Neither shows up when re-injecting into the committed dist (every block is
   replaced in place), only on a FRESH build — which is exactly when it matters.
   So this test strips the three blocks out of dist to simulate a fresh build,
   runs the real injector, and checks the result. */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
let pass = 0, fail = 0;
const a = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } else { console.log("ok:", m); pass++; } };

const shipped = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

// A fresh build is dist minus the three injected blocks.
let fresh = shipped;
for (const [tag, id] of [["style", "en9-theme"], ["style", "en9-css"], ["script", "en9-js"]]) {
  fresh = fresh.replace(new RegExp(`<${tag} id="${id}">[\\s\\S]*?</${tag}>\\n?`), "");
}
a(!/id="en9-(theme|css|js)"/.test(fresh), "fixture really has no EN9 blocks left");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "en9-inject-"));
fs.mkdirSync(path.join(tmp, "dist"));
fs.writeFileSync(path.join(tmp, "dist", "index.html"), fresh);
fs.symlinkSync(path.join(root, "layer-src"), path.join(tmp, "layer-src"));
execFileSync(process.execPath, [path.join(root, "scripts", "inject-layer.mjs")], { cwd: tmp, stdio: "pipe" });
const out = fs.readFileSync(path.join(tmp, "dist", "index.html"), "utf8");
fs.rmSync(tmp, { recursive: true, force: true });

const at = (needle) => out.indexOf(needle);
const theme = at('<style id="en9-theme">');
const css = at('<style id="en9-css">');
const js = at('<script id="en9-js">');
const head = at("</head>");

a(theme > 0 && css > 0 && js > 0, "all three blocks injected on a fresh build");
a(theme < head, "en9-theme lands inside <head>");
a(theme < css, "cascade order preserved: theme.css before enhance.css");
a(css < js, "en9-css precedes en9-js, as the shipped file has it");
a(js < out.lastIndexOf("</body>"), "en9-js sits before the document's own </body>");

// The SheetJS string literal must be untouched — this is landmine 2.
a(out.includes('var Wb="</body></html>"'), "the SheetJS \"</body></html>\" literal is not spliced into");

// The strongest statement available: a fresh build carried through the injector
// is the shipped file (newline placement aside).
a(out.replace(/\n/g, "") === shipped.replace(/\n/g, ""),
  "a fresh-build injection reproduces the shipped file exactly");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
