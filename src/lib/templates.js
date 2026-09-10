/* ============================================================
   POST IMAGE TEMPLATES

   The old renderer drew four fixed compositions from whatever the model
   returned, and the result was flat: same weight everywhere, no focal point,
   nothing you would stop scrolling for.

   These are named templates instead. Each declares the fields it uses, so the
   same three or four pieces of text can be auto-filled from the draft AND
   edited by hand without regenerating anything. A template that wants a
   photograph says so, and the photo carries its source and licence — which is
   both a legal requirement of the free libraries and the honest thing to show.
   ============================================================ */

import { BRAND, FONT, esc, wrapText, BRAND_TEXT } from "./brand.js";

const brandName = () => BRAND_TEXT.name || "";
const brandSite = () => BRAND_TEXT.site || BRAND_TEXT.name || "";

/* Every field a template can ask for, with the label the editor shows and
   where its default comes from in a generated brief. */
export const FIELDS = {
  kicker:   { label: "Eyebrow",   hint: "Two or three words above the headline", max: 28 },
  headline: { label: "Headline",  hint: "The one line someone reads while scrolling", max: 90 },
  stat:     { label: "Big number", hint: "A figure worth stopping for, e.g. 62%", max: 12 },
  statLabel:{ label: "What it measures", hint: "Reads under the number", max: 46 },
  support:  { label: "Supporting line", hint: "One sentence of context", max: 120 },
  footer:   { label: "Footer",    hint: "Usually your company or site", max: 40 },
  quote:    { label: "Quote",     hint: "In their words, without the quote marks", max: 160 },
  attrib:   { label: "Said by",   hint: "Name, and role if it helps", max: 48 },
  items:    { label: "Points",    hint: "One per line, three or four works best", multiline: true },
};

/* ---------- drawing helpers ---------- */

const W = 1200, H = 630;

const text = (x, y, str, { size = 40, weight = 400, fill = BRAND.ink, spacing = 0, anchor = "start", opacity = 1 } = {}) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-family="${FONT}" font-size="${size}" font-weight="${weight}"${spacing ? ` letter-spacing="${spacing}"` : ""}${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}${opacity !== 1 ? ` opacity="${opacity}"` : ""}>${esc(str)}</text>`;

/* Headlines have to fit. Rather than clipping or overflowing, step the size
   down until the longest line fits the column it was given. */
const fitLines = (str, { width, size, min = 30, chars }) => {
  let s = size;
  let lines = wrapText(str, chars);
  while (lines.length > 3 && s > min) { s -= 4; lines = wrapText(str, Math.round(chars * (size / s))); }
  return { lines: lines.slice(0, 4), size: s, width };
};

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>`;

/* A soft wash so a flat panel has some depth rather than reading as a slab. */
const washes = `<defs>
<linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.acc}" stop-opacity="0.30"/><stop offset="1" stop-color="${BRAND.acc2}" stop-opacity="0.06"/></linearGradient>
<linearGradient id="g2" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${BRAND.acc2}" stop-opacity="0.26"/><stop offset="1" stop-color="${BRAND.acc}" stop-opacity="0.04"/></linearGradient>
<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.58"/><stop offset="0.22" stop-color="#000" stop-opacity="0.22"/><stop offset="0.55" stop-color="#000" stop-opacity="0.62"/><stop offset="1" stop-color="#000" stop-opacity="0.90"/></linearGradient>
<linearGradient id="sideShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.88"/><stop offset="0.62" stop-color="#000" stop-opacity="0.30"/><stop offset="1" stop-color="#000" stop-opacity="0.10"/></linearGradient>
</defs>`;

const footerBar = (label) => label
  ? `<rect x="72" y="${H - 96}" width="42" height="3" fill="${BRAND.acc}"/>${text(72, H - 62, label, { size: 20, fill: BRAND.mute, spacing: 2 })}`
  : "";

/* ---------- the templates ---------- */

export const TEMPLATES = [
  {
    id: "statement",
    label: "Statement",
    note: "One line, set large. Best when the sentence is the whole idea.",
    fields: ["kicker", "headline", "support", "footer"],
    render: (f) => {
      const { lines, size } = fitLines(f.headline, { width: 1000, size: 76, chars: 26 });
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<circle cx="1090" cy="90" r="320" fill="url(#g1)"/>
<circle cx="150" cy="600" r="260" fill="url(#g2)"/>
${f.kicker ? text(72, 118, String(f.kicker).toUpperCase(), { size: 20, fill: BRAND.acc2, spacing: 5, weight: 600 }) : ""}
${lines.map((l, i) => text(72, 250 + i * (size + 12), l, { size, weight: 700 })).join("")}
${f.support ? text(72, 250 + lines.length * (size + 12) + 34, wrapText(f.support, 62)[0] || "", { size: 24, fill: BRAND.mute }) : ""}
${footerBar(f.footer)}`);
    },
  },
  {
    id: "figure",
    label: "Big number",
    note: "A single figure carrying the post. Strongest for survey or benchmark numbers.",
    fields: ["kicker", "headline", "stat", "statLabel", "footer"],
    render: (f) => svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<rect x="640" y="0" width="560" height="${H}" fill="url(#g1)"/>
<circle cx="920" cy="315" r="196" fill="none" stroke="${BRAND.acc}" stroke-width="2" opacity="0.5"/>
<circle cx="920" cy="315" r="252" fill="none" stroke="${BRAND.acc2}" stroke-width="1.5" opacity="0.28"/>
${text(920, 366, f.stat || "—", { size: String(f.stat || "").length > 4 ? 128 : 168, weight: 700, anchor: "middle" })}
${wrapText(f.statLabel || "", 30).slice(0, 2).map((l, i) => text(920, 420 + i * 28, l, { size: 21, fill: BRAND.mute, anchor: "middle" })).join("")}
${f.kicker ? text(72, 118, String(f.kicker).toUpperCase(), { size: 20, fill: BRAND.acc2, spacing: 5, weight: 600 }) : ""}
${wrapText(f.headline || f.support || "", 22).slice(0, 4).map((l, i) => text(72, 246 + i * 54, l, { size: 44, weight: 600 })).join("")}
${footerBar(f.footer)}`),
  },
  {
    id: "list",
    label: "Numbered points",
    note: "Three or four points, numbered. Good for a checklist or a short framework.",
    fields: ["kicker", "headline", "items", "footer"],
    render: (f) => {
      const items = String(f.items || "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 4);
      /* Four points need tighter setting than three, and each may run to two
         lines — a point cut off mid-sentence reads as a bug. */
      const size = items.length > 3 ? 24 : 27;
      const step = items.length > 3 ? 82 : 92;
      const top = items.length > 3 ? 252 : 268;
      const wrapped = items.map((it) => wrapText(it, items.length > 3 ? 56 : 50).slice(0, 2));
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="10" height="${H}" fill="${BRAND.acc}"/>
<circle cx="1140" cy="70" r="260" fill="url(#g2)"/>
${f.kicker ? text(72, 112, String(f.kicker).toUpperCase(), { size: 19, fill: BRAND.acc2, spacing: 5, weight: 600 }) : ""}
${wrapText(f.headline || "", 34).slice(0, 2).map((l, i) => text(72, 178 + i * 46, l, { size: 40, weight: 700 })).join("")}
${wrapped.map((ls, i) => `
<circle cx="94" cy="${top + i * step}" r="20" fill="none" stroke="${BRAND.acc}" stroke-width="2"/>
${text(94, top + i * step + 8, String(i + 1), { size: 20, weight: 700, fill: BRAND.acc, anchor: "middle" })}
${ls.map((l, j) => text(140, top + i * step + 9 + j * (size + 6), l, { size, fill: BRAND.ink })).join("")}`).join("")}
${footerBar(f.footer)}`);
    },
  },
  {
    id: "quote",
    label: "Quote",
    note: "A client or team line, attributed. Use real words, not a paraphrase.",
    fields: ["quote", "attrib", "footer"],
    render: (f) => {
      const { lines, size } = fitLines(f.quote || "", { width: 940, size: 52, min: 32, chars: 34 });
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="${W}" height="${H}" fill="url(#g2)" opacity="0.5"/>
${(() => {
        const block = lines.length * (size + 14) + (f.attrib ? 54 : 0);
        const start = Math.max(190, Math.round((H - block) / 2) + size);
        return `${text(72, start - 34, "“", { size: 200, fill: BRAND.acc, opacity: 0.35, weight: 700 })}
${lines.map((l, i) => text(172, start + i * (size + 14), l, { size, weight: 500 })).join("")}
${f.attrib ? text(172, start + lines.length * (size + 14) + 26, `— ${f.attrib}`, { size: 24, fill: BRAND.acc2 }) : ""}`;
      })()}
${footerBar(f.footer)}`);
    },
  },
  {
    id: "photo",
    label: "Photo + headline",
    note: "Your headline over a real photograph. The source and licence are shown with it.",
    fields: ["kicker", "headline", "footer"],
    photo: true,
    render: (f, photo) => {
      const { lines, size } = fitLines(f.headline, { width: 1040, size: 62, min: 34, chars: 30 });
      const img = photo?.dataUrl || photo?.url;
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
${img ? `<image href="${esc(img)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>` : `<rect width="${W}" height="${H}" fill="url(#g1)"/>`}
<rect width="${W}" height="${H}" fill="url(#shade)"/>
${f.kicker ? text(72, 108, String(f.kicker).toUpperCase(), { size: 20, fill: BRAND.ink, spacing: 5, weight: 700 }) : ""}
${lines.map((l, i) => text(72, H - 168 - (lines.length - 1 - i) * (size + 10), l, { size, weight: 700 })).join("")}
${f.footer ? text(72, H - 108, f.footer, { size: 20, fill: BRAND.ink, opacity: 0.75, spacing: 2 }) : ""}
${photo?.credit ? text(72, H - 44, photo.credit, { size: 15, fill: BRAND.ink, opacity: 0.55 }) : ""}`);
    },
  },
  {
    id: "split",
    label: "Photo beside text",
    note: "Photograph on one side, headline on the other. Calmer than text over an image.",
    fields: ["kicker", "headline", "support", "footer"],
    photo: true,
    render: (f, photo) => {
      const { lines, size } = fitLines(f.headline, { width: 560, size: 50, min: 30, chars: 20 });
      const img = photo?.dataUrl || photo?.url;
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
${img ? `<image href="${esc(img)}" x="600" y="0" width="600" height="${H}" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="600" y="0" width="600" height="${H}" fill="url(#g1)"/>`}
<rect x="600" y="0" width="600" height="${H}" fill="url(#sideShade)" opacity="0.45"/>
${f.kicker ? text(72, 116, String(f.kicker).toUpperCase(), { size: 19, fill: BRAND.acc2, spacing: 5, weight: 600 }) : ""}
${lines.map((l, i) => text(72, 232 + i * (size + 12), l, { size, weight: 700 })).join("")}
${f.support ? wrapText(f.support, 34).slice(0, 2).map((l, i) => text(72, 232 + lines.length * (size + 12) + 30 + i * 30, l, { size: 22, fill: BRAND.mute })).join("") : ""}
${footerBar(f.footer)}
${photo?.credit ? text(1128, H - 28, photo.credit, { size: 14, fill: BRAND.ink, opacity: 0.6, anchor: "end" }) : ""}`);
    },
  },
];

export const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
export const templatesNeedingPhoto = () => TEMPLATES.filter((t) => t.photo).map((t) => t.id);

/* ---------- auto-fill ----------
   The brief the media engine already produces, mapped onto whichever fields
   the chosen template actually uses. Anything the brief does not cover is
   left empty rather than padded with filler. */
export function autoFill(templateId, brief = {}, draft = {}) {
  const t = TEMPLATE_BY_ID[templateId] || TEMPLATES[0];
  const headline = brief.headline || draft.hook || brief.subject || "";
  const body = [draft.hook, draft.body].filter(Boolean).join(" ");
  /* A number in the post is the strongest thing a "big number" template can
     show, so find one rather than asking the model for it again. */
  const found = String(body).match(/\b\d{1,3}(?:[.,]\d+)?\s?%|\b\d+x\b|\b\d{1,3}(?:,\d{3})+\b/);

  const all = {
    kicker: brief.kicker || brandName() || "",
    headline,
    stat: brief.stat || (found ? found[0].trim() : ""),
    statLabel: brief.statLabel || (found ? wrapText(headline, 40)[0] || "" : ""),
    support: brief.support || wrapText(draft.body || brief.subject || "", 60)[0] || "",
    footer: brief.footer || brandSite(),
    quote: brief.quote || draft.hook || "",
    attrib: brief.attrib || brandName() || "",
    items: (Array.isArray(brief.items) ? brief.items : String(draft.body || "").split(/\n+|(?<=\.)\s+/))
      .map((x) => String(x).trim()).filter(Boolean).slice(0, 4).join("\n"),
  };
  return Object.fromEntries(t.fields.map((k) => [k, all[k] ?? ""]));
}

export function renderTemplate(templateId, fields, photo) {
  const t = TEMPLATE_BY_ID[templateId] || TEMPLATES[0];
  return t.render(fields || {}, photo);
}
