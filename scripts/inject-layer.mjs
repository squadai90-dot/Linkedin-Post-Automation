#!/usr/bin/env node
/* Re-injects the EN9 enhancement layer (layer-src/) into dist/index.html.
   Run this AFTER every `npm run build:app`, because the build regenerates
   dist/index.html from src/ and removes the injected layer. */
import { readFileSync, writeFileSync } from "node:fs";

const dist = "dist/index.html";
let s = readFileSync(dist, "utf8");
const theme = readFileSync("layer-src/theme.css", "utf8");
const css = readFileSync("layer-src/enhance.css", "utf8");
const js = readFileSync("layer-src/enhance.js", "utf8");
if (js.includes("</script>") || (theme + css).includes("</style>"))
  throw new Error("layer sources must not contain closing tags");

/* Placement on a FRESH build (no existing block to replace) must reproduce the
   shipped cascade: app css -> en9-theme (in <head>) -> en9-css -> en9-js (end of
   <body>). Never insert both stylesheets at the first `</style>`: that anchor is
   the app's own css, so the second insert would land ABOVE the first and silently
   invert theme.css against enhance.css, which overlap on tables, sidebar, pills
   and buttons. */
const put = (id, tag, body, where) => {
  const re = new RegExp(`<${tag} id="${id}">[\\s\\S]*?</${tag}>`);
  const block = `<${tag} id="${id}">${body}</${tag}>`;
  if (re.test(s)) { s = s.replace(re, block); return; }
  if (where === "head") {
    // immediately after the app's stylesheet, still inside <head>
    const i = s.indexOf("</style>");
    if (i < 0) throw new Error("no app <style> to anchor en9-theme after");
    const at = i + "</style>".length;
    s = s.slice(0, at) + `\n${block}` + s.slice(at);
  } else {
    // LAST `</body>`, not the first: the vendored SheetJS bundle contains the
    // literal string "</body></html>", so indexOf would splice the layer into
    // the middle of a JavaScript string.
    const i = s.lastIndexOf("</body>");
    if (i < 0) throw new Error("no </body> to anchor " + id + " before");
    if (!/^<\/body>\s*<\/html>\s*$/.test(s.slice(i)))
      throw new Error("last </body> is not the document end — refusing to inject " + id);
    s = s.slice(0, i) + `${block}\n` + s.slice(i);
  }
};
put("en9-theme", "style", theme, "head");
put("en9-css", "style", css, "body");
put("en9-js", "script", js, "body");
writeFileSync(dist, s);
console.log("EN9 layer injected into", dist);
