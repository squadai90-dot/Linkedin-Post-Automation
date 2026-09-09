/* Assemble the built app into one self-contained page for the hosted preview.
   The artifact sandbox allows scripts only from a short CDN allowlist and
   blocks outbound fetch, so everything ships inline and the note below is
   honest about what cannot be exercised here. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(`${ROOT}/dist-artifact/app.css`, "utf8");
const js = fs.readFileSync(`${ROOT}/dist-artifact/app.js`, "utf8");

// A literal </script> anywhere in the bundle would close the tag early.
const safeJs = js.replace(/<\/script/gi, "<\\/script");

const FONTS = "https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

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

/* Preview note — sits in the flow above the app so it never covers a
   control, and scrolls away once read. */
.preview-note {
  display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap;
  padding: 10px 26px; border-bottom: 1px solid rgba(124, 140, 255, .28);
  background: rgba(124, 140, 255, .10); color: #EEF2F8;
  font-family: 'Inter Tight', ui-sans-serif, system-ui, sans-serif;
  font-size: 12.5px; line-height: 1.5;
}
body:has(.unison[data-t="light"]) .preview-note { background: #EAEDFB; color: #101728; border-bottom-color: #C9D0E4; }
.preview-note b { font-weight: 600; letter-spacing: .01em; }
.preview-note span { opacity: .78; min-width: 0; }
.preview-note button {
  flex: none; margin-left: auto; background: none; border: 1px solid currentColor;
  border-radius: 999px; padding: 2px 10px; cursor: pointer; color: inherit;
  opacity: .55; font: inherit; font-size: 11.5px;
}
.preview-note button:hover { opacity: 1; }
.preview-note[hidden] { display: none; }
@media (max-width: 700px) { .preview-note { padding: 10px 16px; font-size: 12px; } }

${css}
</style>

<aside class="preview-note" id="previewNote">
  <b>Live preview</b>
  <span>The whole workflow is clickable. This sandbox blocks outbound requests, so research and drafting return clearly labelled sample data, and publishing reports the block instead of sending. Run it locally to connect the AI and LinkedIn.</span>
  <button type="button" onclick="document.getElementById('previewNote').hidden = true">Dismiss</button>
</aside>

<div id="root"></div>

<script type="module">
${safeJs}
</script>
`;

fs.writeFileSync(`${ROOT}/preview.html`, page);
console.log("preview.html", (page.length / 1024 / 1024).toFixed(2), "MB");
