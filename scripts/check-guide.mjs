/* Drift-guard: docs/user-guide.md must agree with the shipped app on the facts
   that have historically gone stale (tab count, local PDF parsing, FX window,
   Groq models, generation blockers). Facts are extracted FROM dist/index.html
   where possible so the guide can only pass while it matches the app. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
const guide = fs.readFileSync(path.join(root, "docs", "user-guide.md"), "utf8");

let fails = 0;
const a = (c, m) => { if (!c) { console.error("GUIDE DRIFT:", m); fails++; } else console.log("ok:", m); };

// 1. tab count — measured from the nav array in dist
const navAt = dist.indexOf('AC=[{id:"overview"');
const tabs = navAt >= 0
  ? [...dist.slice(navAt, navAt + 2500).matchAll(/\{id:"[a-z-]+",label:"([^"]+)"/g)].map(m => m[1])
  : [];
a(tabs.length >= 14, `nav array found in dist (${tabs.length} tabs)`);
a(guide.includes(`**${tabs.length} tabs**`), `guide states the measured tab count (${tabs.length})`);
for (const t of ["Exception center", "Mapping & adjustments", "Settings"])
  a(guide.includes(t), `guide names the "${t}" tab`);

// 2. PDFs parsed locally (the old docx claimed the opposite)
a(/parsed locally, in the browser/i.test(guide), "guide says PDFs are parsed locally");
a(!/PDFs are not parsed/i.test(guide), "guide does not repeat the old 'PDFs are not parsed' claim");

// 3. FX window — dist copy is the source of truth
a(dist.includes("10-day search"), "dist carries the 10-day FX copy");
a(guide.includes("on or before the requested\ndate (10-day search)") || /on or before[\s\S]{0,80}10-day search/.test(guide),
  "guide states the on-or-before / 10-day FX rule");
a(!/within 7 days|nearest.{0,20}7.day/i.test(guide), "guide does not carry the stale 7-day wording");

// 4. Groq models — every model id present in dist must appear in the guide
const models = [...new Set(dist.match(/openai\/gpt-oss-\d+b/g) || [])];
a(models.length >= 1, `model ids found in dist (${models.join(", ")})`);
for (const m of models) a(guide.includes(m), `guide names model ${m}`);
a(!/llama|mixtral/i.test(guide), "guide does not name decommissioned models");

// 5. generation blockers: FX + balance, and the balance block is dismissible
a(/does not balance/.test(dist), "dist blocks on unbalanced sheets");
a(/does not balance/.test(guide), "guide documents the balance blocker");
a(/dismissed with a note/i.test(guide), "guide documents that the balance block is dismissible");
a(!/only rates block generation/i.test(guide), "guide does not claim rates are the only blocker");

// 6. duplicate-upload refusal (shipped in dist)
a(dist.includes("byte-identical"), "dist refuses byte-identical re-uploads");
a(/byte-identical/i.test(guide), "guide documents the duplicate-upload refusal");

if (fails) { console.error(`${fails} DRIFT FAILURE(S) — update docs/user-guide.md`); process.exit(1); }
console.log("USER GUIDE IN SYNC WITH APP");
