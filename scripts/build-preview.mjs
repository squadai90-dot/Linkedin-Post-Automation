/* Assemble the built app into one self-contained HTML file.
 *
 *   node scripts/build-preview.mjs            -> unison-content-os.html (local use)
 *   node scripts/build-preview.mjs --sandbox  -> preview.html (hosted preview)
 *
 * Everything ships inline because a hosted sandbox allows scripts only from a
 * short CDN allowlist. The two modes differ only in the note at the top, which
 * has to be true of the place the file is actually opened.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = process.argv.includes("--sandbox");
const outName = sandbox ? "preview.html" : "unison-content-os.html";

const css = fs.readFileSync(`${ROOT}/dist-artifact/app.css`, "utf8");
const js = fs.readFileSync(`${ROOT}/dist-artifact/app.js`, "utf8");

// A literal </script> anywhere in the bundle would close the tag early.
const safeJs = js.replace(/<\/script/gi, "<\\/script");

const FONTS = "https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

/* The hosted sandbox blocks outbound requests, so its note is always true.
   Run locally, the only caveat is opening straight off disk, so that note
   shows itself only on a file:// origin. */
const NOTE = sandbox
  ? `<aside class="ctx-note" id="ctxNote">
  <b>Live preview</b>
  <span>The whole workflow is clickable. This sandbox blocks outbound requests, so research and drafting return clearly labelled sample data, and publishing reports the block instead of sending. Run it locally to connect the AI and LinkedIn.</span>
  <button type="button" onclick="document.getElementById('ctxNote').hidden = true">Dismiss</button>
</aside>`
  : `<aside class="ctx-note" id="ctxNote" hidden>
  <b>Opened straight from disk</b>
  <span>Everything works except calls that need a web address: an AI key may be refused, because the browser sends no origin from a <code>file://</code> page. To use one, serve the folder instead — <code>npx serve .</code> — and open the address it prints.</span>
  <button type="button" onclick="document.getElementById('ctxNote').hidden = true">Dismiss</button>
</aside>
<script>
  /* Only true when the file was double-clicked rather than served. */
  if (location.protocol === "file:") document.getElementById("ctxNote").hidden = false;
</script>`;

const page = `<title>Unison Content OS</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'" />
<noscript><link rel="stylesheet" href="${FONTS}" /></noscript>

<style>
/* The app paints its own ground; body must match so overscroll and the
   host's theme never show through. */
body { background: #04060A; }
body:has(.unison[data-t="light"]) { background: #F1F4F9; }

/* Context note — sits in the flow above the app so it never covers a
   control, and scrolls away once read. */
.ctx-note {
  display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap;
  padding: 10px 26px; border-bottom: 1px solid rgba(124, 140, 255, .28);
  background: rgba(124, 140, 255, .10); color: #EEF2F8;
  font-family: 'Inter Tight', ui-sans-serif, system-ui, sans-serif;
  font-size: 12.5px; line-height: 1.5;
}
body:has(.unison[data-t="light"]) .ctx-note { background: #EAEDFB; color: #101728; border-bottom-color: #C9D0E4; }
.ctx-note b { font-weight: 600; letter-spacing: .01em; }
.ctx-note span { opacity: .82; min-width: 0; }
.ctx-note code { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 11.5px; padding: 1px 5px; border-radius: 4px; background: rgba(124, 140, 255, .18); }
.ctx-note button {
  flex: none; margin-left: auto; background: none; border: 1px solid currentColor;
  border-radius: 999px; padding: 2px 10px; cursor: pointer; color: inherit;
  opacity: .55; font: inherit; font-size: 11.5px;
}
.ctx-note button:hover { opacity: 1; }
.ctx-note[hidden] { display: none; }
@media (max-width: 700px) { .ctx-note { padding: 10px 16px; font-size: 12px; } }

${css}
</style>

${NOTE}

<div id="root"></div>

<script type="module">
${safeJs}
</script>
`;

/* Standalone use needs a real document; the hosted preview is wrapped in one. */
const html = sandbox
  ? page
  : `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#0B0E14" />
<meta name="description" content="Unison Content OS — research, draft, verify, approve and publish LinkedIn Company Page posts." />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Cpath d='M24 4A20 20 0 0 1 44 24' fill='none' stroke='%237C8CFF' stroke-width='6' stroke-linecap='round'/%3E%3Cpath d='M24 44A20 20 0 0 1 4 24' fill='none' stroke='%2339D3C7' stroke-width='6' stroke-linecap='round'/%3E%3Ccircle cx='24' cy='24' r='6' fill='%237C8CFF'/%3E%3C/svg%3E" />
<style>html,body{margin:0;padding:0;} img{max-width:100%;} [hidden]{display:none !important;}</style>
${page}
</head>
<body></body>
</html>
`;

fs.writeFileSync(path.join(ROOT, outName), html);
console.log(outName, (html.length / 1024 / 1024).toFixed(2), "MB");
