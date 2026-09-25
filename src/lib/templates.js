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
  source:   { label: "Source",    hint: "Where the figure or rule came from — shown on the graphic", max: 40 },
  leftItems:  { label: "Left side",  hint: "One per line", multiline: true },
  rightItems: { label: "Right side", hint: "One per line", multiline: true },
  leftLabel:  { label: "Left heading",  hint: "Two or three words", max: 24 },
  rightLabel: { label: "Right heading", hint: "Two or three words", max: 24 },
  greeting: { label: "Greeting",  hint: "e.g. Happy Diwali", max: 40 },
  occasionId: { label: "Occasion", hint: "Which festival this is", max: 24 },
  when:     { label: "When",      hint: "Date and time, as you would say it", max: 48 },
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

/* ---------- occasion artwork ----------
   A Diwali post that shows a businesswoman at a laptop is the failure this
   exists to prevent. Each occasion gets its own drawn motif and its own
   palette, so the graphic reads as that festival before a word is read.
   Drawn as vector rather than generated, because a diffusion model cannot be
   relied on to place a diya or spell a greeting correctly, and a company page
   cannot afford a festival graphic that is subtly wrong. */

/* A row of oil lamps, flames lit. */
const diyas = (y) => [0, 1, 2, 3, 4].map((i) => {
  const x = 812 + (i - 2) * 86;
  return `<ellipse cx="${x}" cy="${y}" rx="34" ry="13" fill="#8A4B1E"/>
<path d="M${x - 34} ${y} a34 13 0 0 0 68 0z" fill="#5E3113"/>
<circle cx="${x}" cy="${y - 34}" r="26" fill="url(#glow)"/>
<path d="M${x} ${y - 52} c10 12 6 22 0 28 c-6 -6 -10 -16 0 -28z" fill="#FFD27A"/>`;
}).join("");

/* Concentric rangoli petals. */
const rangoli = (cx, cy) => {
  const petal = (r, n, fill, op) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return `<ellipse cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}" rx="${(r / 3.1).toFixed(1)}" ry="${(r / 6.2).toFixed(1)}" fill="${fill}" opacity="${op}" transform="rotate(${((a * 180) / Math.PI).toFixed(1)} ${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)})"/>`;
  }).join("");
  return `${petal(150, 12, "#F5A524", 0.5)}${petal(104, 10, "#E0457B", 0.55)}${petal(62, 8, "#FFD27A", 0.7)}<circle cx="${cx}" cy="${cy}" r="24" fill="#FFD27A" opacity="0.9"/>`;
};

const bursts = (pts, colours) => pts.map(([cx, cy, r], i) => {
  const c = colours[i % colours.length];
  return Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * Math.PI * 2;
    return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${c}" stroke-width="3" opacity="0.75" stroke-linecap="round"/>`;
  }).join("") + `<circle cx="${cx}" cy="${cy}" r="5" fill="${c}"/>`;
}).join("");

export const OCCASION_ART = {
  diwali: { deep: "#2A0E3D", mid: "#7A1F3D", warm: "#FFC24D",
    art: `${rangoli(950, 250)}${diyas(520)}${bursts([[1080, 120, 44], [760, 96, 30]], ["#FFD27A", "#F5A524"])}` },
  holi: { deep: "#2B1B4D", mid: "#7B2A6B", warm: "#FFD166",
    art: `${[["#E0457B", 940, 210, 120], ["#F2B705", 1080, 330, 96], ["#2E9E5B", 860, 400, 84], ["#3AA0E0", 1010, 480, 70]]
      .map(([c, cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" opacity="0.5"/>`).join("")}
${Array.from({ length: 60 }, (_, i) => { const cx = 700 + ((i * 137) % 480); const cy = 90 + ((i * 219) % 460); const c = ["#E0457B", "#F2B705", "#2E9E5B", "#3AA0E0", "#FFFFFF"][i % 5];
      return `<circle cx="${cx}" cy="${cy}" r="${2 + (i % 4)}" fill="${c}" opacity="0.8"/>`; }).join("")}` },
  eid: { deep: "#04241C", mid: "#0E6B52", warm: "#E8C766",
    /* A crescent is a disc with a second disc taken out of it. Done as a
       mask rather than by painting the bite in the background colour,
       because the background here is a gradient. */
    art: `<mask id="crescent"><rect x="820" y="90" width="340" height="340" fill="#fff"/><circle cx="1032" cy="228" r="108" fill="#000"/></mask>
<circle cx="1000" cy="250" r="130" fill="#E8C766" opacity="0.94" mask="url(#crescent)"/>
${[[1120, 300], [880, 170], [1060, 430]].map(([cx, cy]) => `<path d="M${cx} ${cy - 16} l5 11 l12 2 l-9 9 l3 12 l-11 -6 l-11 6 l3 -12 l-9 -9 l12 -2z" fill="#E8C766" opacity="0.85"/>`).join("")}
${[820, 930, 1040].map((x, i) => `<path d="M${x} ${470 + i % 2 * 16} l26 0 l-4 54 l-18 0z" fill="#E8C766" opacity="0.5"/><circle cx="${x + 13}" cy="${500 + i % 2 * 16}" r="9" fill="url(#glow)"/>`).join("")}` },
  christmas: { deep: "#07301F", mid: "#0F5132", warm: "#F2E8CF",
    art: `${[[980, 470, 150], [1120, 470, 96]].map(([cx, by, w]) => `<path d="M${cx} ${by - w * 2.1} L${cx - w * 0.55} ${by - w * 1.1} L${cx - w * 0.3} ${by - w * 1.1} L${cx - w * 0.8} ${by - w * 0.35} L${cx - w * 0.45} ${by - w * 0.35} L${cx - w} ${by} L${cx + w} ${by} L${cx + w * 0.45} ${by - w * 0.35} L${cx + w * 0.8} ${by - w * 0.35} L${cx + w * 0.3} ${by - w * 1.1} L${cx + w * 0.55} ${by - w * 1.1} Z" fill="#14603C"/>`).join("")}
<path d="M980 150 l9 20 l22 3 l-16 16 l4 22 l-19 -11 l-19 11 l4 -22 l-16 -16 l22 -3z" fill="#F2C94C"/>
${Array.from({ length: 34 }, (_, i) => { const cx = 700 + ((i * 151) % 480); const cy = 80 + ((i * 97) % 420); return `<circle cx="${cx}" cy="${cy}" r="${2 + (i % 3)}" fill="#F2E8CF" opacity="0.7"/>`; }).join("")}` },
  newyear: { deep: "#0B1740", mid: "#1B2A5B", warm: "#E8C766",
    art: `${bursts([[960, 200, 90], [1110, 350, 62], [840, 330, 48]], ["#E8C766", "#7C8CFF", "#F2E8CF"])}
<path d="M700 520 L1200 520" stroke="#E8C766" stroke-width="2" opacity="0.4"/>` },
  thanksgiving: { deep: "#40200B", mid: "#8C4B1F", warm: "#F0C987",
    art: `${[[950, 250, 0], [1070, 330, 40], [870, 380, -30], [1010, 440, 15]].map(([cx, cy, rot]) =>
      `<path d="M${cx} ${cy} c42 -34 82 -12 74 30 c-6 34 -52 46 -74 22 c-22 24 -68 12 -74 -22 c-8 -42 32 -64 74 -30z" fill="#D98324" opacity="0.8" transform="rotate(${rot} ${cx} ${cy})"/>`).join("")}
${[820, 900, 980].map((x) => `<path d="M${x} 540 l0 -70 M${x} 500 l14 -14 M${x} 512 l-14 -14" stroke="#F0C987" stroke-width="3" opacity="0.7" fill="none"/>`).join("")}` },
  easter: { deep: "#1B3A5C", mid: "#4E7FA8", warm: "#F7E7CE",
    art: `${[[960, 330], [1070, 300], [880, 380]].map(([cx, cy], i) => `<ellipse cx="${cx}" cy="${cy}" rx="${46 - i * 6}" ry="${60 - i * 8}" fill="#F7E7CE" opacity="0.85"/><path d="M${cx - 40} ${cy} q40 -18 80 0" stroke="#E4A6B8" stroke-width="5" fill="none" opacity="0.9"/>`).join("")}
<path d="M760 520 q40 -80 90 -70 q-30 30 -20 70z" fill="#7FB069" opacity="0.8"/>` },
  australiaday: { deep: "#08214E", mid: "#123A7A", warm: "#FFFFFF",
    art: `${[[980, 200, 13], [1060, 300, 10], [930, 330, 9], [1010, 400, 11], [1100, 430, 7]].map(([cx, cy, r]) =>
      `<path d="M${cx} ${cy - r * 2} l${r * 0.6} ${r * 1.3} l${r * 1.4} 0 l-${r * 1.1} ${r} l${r * 0.45} ${r * 1.4} l-${r * 1.35} -${r * 0.85} l-${r * 1.35} ${r * 0.85} l${r * 0.45} -${r * 1.4} l-${r * 1.1} -${r} l${r * 1.4} 0z" fill="#FFFFFF" opacity="0.92"/>`).join("")}
<path d="M700 540 q120 -40 250 -10 q130 30 250 -14" stroke="#7FD4D0" stroke-width="4" fill="none" opacity="0.6"/>` },
  independenceday: { deep: "#08214E", mid: "#0A3161", warm: "#FFFFFF",
    art: `${bursts([[980, 220, 86], [1110, 350, 58]], ["#FFFFFF", "#D94F5C"])}
${[0, 1, 2, 3].map((i) => `<rect x="740" y="${450 + i * 26}" width="440" height="12" fill="${i % 2 ? "#D94F5C" : "#FFFFFF"}" opacity="0.55"/>`).join("")}` },
  internationalwomensday: { deep: "#3A0B57", mid: "#6A1B9A", warm: "#FFC7E0",
    art: `${[[900, 300], [1000, 260], [1100, 320]].map(([cx, cy], i) => `<circle cx="${cx}" cy="${cy}" r="${34 - i * 3}" fill="#FFC7E0" opacity="0.85"/><path d="M${cx - 44} ${cy + 96} q44 -56 88 0z" fill="#FFC7E0" opacity="0.6"/>`).join("")}
<path d="M760 520 L900 452 L1020 486 L1160 396" stroke="#FFD166" stroke-width="5" fill="none" opacity="0.9"/>` },
  default: { deep: "#0A0F1A", mid: "#1B2A5B", warm: "#7C8CFF",
    art: `${bursts([[1000, 260, 76], [1120, 400, 48]], ["#7C8CFF", "#39D3C7"])}` },
};

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
    fields: ["kicker", "headline", "stat", "statLabel", "source", "footer"],
    render: (f) => svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<rect x="640" y="0" width="560" height="${H}" fill="url(#g1)"/>
<circle cx="920" cy="315" r="196" fill="none" stroke="${BRAND.acc}" stroke-width="2" opacity="0.5"/>
<circle cx="920" cy="315" r="252" fill="none" stroke="${BRAND.acc2}" stroke-width="1.5" opacity="0.28"/>
${text(920, 366, f.stat || "—", { size: String(f.stat || "").length > 4 ? 128 : 168, weight: 700, anchor: "middle" })}
${wrapText(f.statLabel || "", 30).slice(0, 2).map((l, i) => text(920, 420 + i * 28, l, { size: 21, fill: BRAND.mute, anchor: "middle" })).join("")}
${f.kicker ? text(72, 118, String(f.kicker).toUpperCase(), { size: 20, fill: BRAND.acc2, spacing: 5, weight: 600 }) : ""}
${wrapText(f.headline || f.support || "", 22).slice(0, 4).map((l, i) => text(72, 246 + i * 54, l, { size: 44, weight: 600 })).join("")}
${f.source ? text(920, 476, `Source: ${String(f.source).slice(0, 40)}`, { size: 17, fill: BRAND.acc2, anchor: "middle" }) : ""}
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

  /* ---- formats added for accounting content ----
     Built to published B2B infographic guidance rather than to taste: one
     idea per graphic, type large enough to read on a phone without zooming,
     a single high-contrast pairing, real whitespace, and the source named on
     the graphic whenever it carries a figure or a rule. */
  {
    id: "factcard",
    label: "Fact card",
    note: "A rule, threshold or date — stated plainly, with the authority named on the graphic.",
    fields: ["kicker", "headline", "support", "source", "footer"],
    render: (f) => {
      const { lines, size } = fitLines(f.headline, { width: 900, size: 62, min: 36, chars: 26 });
      /* The source pill is pinned to the bottom because that is where a
         reader looks for attribution. The supporting line therefore gets
         whatever room is left above it and no more — a long headline loses a
         line of support rather than running through the pill. */
      const pillTop = H - 112;
      const supportTop = 232 + lines.length * (size + 12) + 30;
      const room = Math.max(0, Math.floor((pillTop - 26 - supportTop) / 34) + 1);
      /* A sentence cut off halfway reads as a bug, and the post carries the
         same words anyway — so it is shown whole or not at all. */
      const wanted = f.support ? wrapText(f.support, 56) : [];
      const support = wanted.length && wanted.length <= Math.min(2, room) ? wanted : [];
      const sourceLabel = `Source: ${String(f.source || "").slice(0, 40)}`;
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="14" height="${H}" fill="${BRAND.acc2}"/>
<circle cx="1120" cy="110" r="280" fill="url(#g1)"/>
${f.kicker ? text(72, 116, String(f.kicker).toUpperCase(), { size: 20, fill: BRAND.acc2, spacing: 5, weight: 700 }) : ""}
${lines.map((l, i) => text(72, 232 + i * (size + 12), l, { size, weight: 700 })).join("")}
${support.map((l, i) => text(72, supportTop + i * 34, l, { size: 25, fill: BRAND.mute })).join("")}
${f.source
  ? `<rect x="72" y="${pillTop}" width="${Math.min(560, 30 + sourceLabel.length * 10)}" height="42" rx="21" fill="${BRAND.panel}" stroke="${BRAND.rule}"/>${text(96, pillTop + 28, sourceLabel, { size: 18, fill: BRAND.acc2 })}`
  : footerBar(f.footer)}`);
    },
  },
  {
    id: "steps",
    label: "Process steps",
    note: "An ordered sequence. Numbered, because the order is the point.",
    fields: ["kicker", "headline", "items", "footer"],
    render: (f) => {
      const items = String(f.items || "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 4);
      const n = Math.max(items.length, 1);
      const colW = Math.floor((W - 144 - (n - 1) * 24) / n);
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<circle cx="60" cy="600" r="240" fill="url(#g2)"/>
${f.kicker ? text(72, 110, String(f.kicker).toUpperCase(), { size: 19, fill: BRAND.acc2, spacing: 5, weight: 600 }) : ""}
${wrapText(f.headline || "", 38).slice(0, 2).map((l, i) => text(72, 176 + i * 44, l, { size: 38, weight: 700 })).join("")}
${items.map((it, i) => {
        const x = 72 + i * (colW + 24);
        return `<rect x="${x}" y="290" width="${colW}" height="200" rx="16" fill="${BRAND.panel}" stroke="${BRAND.rule}"/>
<circle cx="${x + 34}" cy="334" r="20" fill="${BRAND.acc}"/>
${text(x + 34, 342, String(i + 1), { size: 21, weight: 700, fill: BRAND.bg, anchor: "middle" })}
${wrapText(it, Math.floor(colW / 11)).slice(0, 4).map((l, j) => text(x + 22, 392 + j * 26, l, { size: 20, fill: BRAND.ink })).join("")}
${i < items.length - 1 ? `<path d="M${x + colW + 4} 390 l12 0 m-5 -5 l5 5 l-5 5" stroke="${BRAND.acc2}" stroke-width="2" fill="none"/>` : ""}`;
      }).join("")}
${footerBar(f.footer)}`);
    },
  },
  {
    id: "compare",
    label: "Side by side",
    note: "Two things held against each other. The contrast is the message.",
    fields: ["kicker", "headline", "leftLabel", "leftItems", "rightLabel", "rightItems", "footer"],
    render: (f) => {
      const col = (raw) => String(raw || "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 4);
      const L = col(f.leftItems), R = col(f.rightItems);
      const side = (x, label, list, accent) => `
<rect x="${x}" y="262" width="504" height="248" rx="16" fill="${BRAND.panel}" stroke="${accent}" stroke-opacity="0.45"/>
${text(x + 28, 306, String(label || "").toUpperCase(), { size: 19, fill: accent, spacing: 4, weight: 700 })}
${list.map((it, i) => wrapText(it, 40).slice(0, 2).map((l, j) => text(x + 28, 352 + i * 44 + j * 24, (j === 0 ? "— " : "   ") + l, { size: 21, fill: BRAND.ink })).join("")).join("")}`;
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
${f.kicker ? text(72, 110, String(f.kicker).toUpperCase(), { size: 19, fill: BRAND.acc2, spacing: 5, weight: 600 }) : ""}
${wrapText(f.headline || "", 40).slice(0, 2).map((l, i) => text(72, 176 + i * 42, l, { size: 36, weight: 700 })).join("")}
${side(72, f.leftLabel || "Now", L, BRAND.mute)}
${side(624, f.rightLabel || "Instead", R, BRAND.acc)}
${footerBar(f.footer)}`);
    },
  },
  {
    id: "roles",
    label: "Open roles",
    note: "Roles and places, scannable, so the right person recognises themselves.",
    fields: ["kicker", "headline", "items", "support", "footer"],
    render: (f) => {
      const items = String(f.items || "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 4);
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="${W}" height="8" fill="${BRAND.acc}"/>
<circle cx="1210" cy="610" r="210" fill="url(#g1)"/>
${text(72, 112, String(f.kicker || "We are hiring").toUpperCase(), { size: 21, fill: BRAND.acc2, spacing: 5, weight: 700 })}
${wrapText(f.headline || "", 32).slice(0, 2).map((l, i) => text(72, 182 + i * 48, l, { size: 42, weight: 700 })).join("")}
${items.map((it, i) => `
<rect x="72" y="${268 + i * 68}" width="880" height="54" rx="12" fill="${BRAND.panel}" stroke="${BRAND.rule}"/>
<rect x="72" y="${268 + i * 68}" width="5" height="54" rx="2" fill="${BRAND.acc}"/>
${text(104, 302 + i * 68, wrapText(it, 60)[0] || "", { size: 23, fill: BRAND.ink, weight: 500 })}`).join("")}
${f.support ? text(72, H - 62, f.support, { size: 21, fill: BRAND.acc2 }) : footerBar(f.footer)}`);
    },
  },
  {
    id: "event",
    label: "Event card",
    note: "What it is, when it is, and how to get in.",
    fields: ["kicker", "headline", "when", "support", "footer"],
    render: (f) => {
      const { lines, size } = fitLines(f.headline, { width: 900, size: 58, min: 34, chars: 28 });
      /* When it happens belongs with what it is, not stranded at the bottom
         of the card. */
      const whenTop = Math.min(H - 190, 224 + lines.length * (size + 10) + 14);
      return svg(`${washes}
<rect width="${W}" height="${H}" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="${W}" height="${H}" fill="url(#g2)" opacity="0.4"/>
${text(72, 114, String(f.kicker || "Event").toUpperCase(), { size: 20, fill: BRAND.acc2, spacing: 5, weight: 700 })}
${lines.map((l, i) => text(72, 224 + i * (size + 10), l, { size, weight: 700 })).join("")}
${f.when ? `<rect x="72" y="${whenTop}" width="${Math.min(700, 44 + String(f.when).length * 14)}" height="58" rx="14" fill="${BRAND.acc}"/>${text(100, whenTop + 38, String(f.when).slice(0, 48), { size: 24, weight: 700, fill: BRAND.bg })}` : ""}
${f.support ? text(72, whenTop + (f.when ? 106 : 46), wrapText(f.support, 62)[0] || "", { size: 22, fill: BRAND.mute }) : ""}
${footerBar(f.footer)}`);
    },
  },
  {
    id: "occasion",
    label: "Occasion",
    note: "A festival graphic that reads as that festival — its symbols and its colours, drawn rather than photographed.",
    fields: ["greeting", "headline", "support", "footer", "occasionId"],
    render: (f) => {
      const o = OCCASION_ART[f.occasionId] || OCCASION_ART.default;
      const { lines, size } = fitLines(f.headline || "", { width: 760, size: 40, min: 26, chars: 34 });
      return svg(`<defs>
<linearGradient id="occ" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${o.deep}"/><stop offset="1" stop-color="${o.mid}"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${o.warm}" stop-opacity="0.85"/><stop offset="1" stop-color="${o.warm}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#occ)"/>
${o.art}
${text(72, 150, String(f.greeting || "").toUpperCase(), { size: 26, fill: o.warm, spacing: 6, weight: 700 })}
${lines.map((l, i) => text(72, 236 + i * (size + 10), l, { size, weight: 700, fill: "#FFFFFF" })).join("")}
${f.support ? wrapText(f.support, 50).slice(0, 2).map((l, i) => text(72, 236 + lines.length * (size + 10) + 34 + i * 30, l, { size: 22, fill: "#FFFFFF", opacity: 0.82 })).join("") : ""}
${f.footer ? `<rect x="72" y="${H - 96}" width="42" height="3" fill="${o.warm}"/>${text(72, H - 62, f.footer, { size: 20, fill: "#FFFFFF", opacity: 0.8, spacing: 2 })}` : ""}`);
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

/* Every template defines its gradients and masks with the same handful of
   ids. One SVG on its own is fine; two on the same page are not — the
   browser resolves url(#occ) to whichever definition it saw first, so a
   Christmas card silently takes Diwali's palette. That is not hypothetical:
   it happened the first time two occasion graphics were rendered side by
   side. So each render gets its own namespace. */
let renderSeq = 0;
export function namespaceIds(svgText) {
  const uid = `t${(++renderSeq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return String(svgText)
    .replace(/\bid="([A-Za-z][\w-]*)"/g, (_m, id) => `id="${uid}-${id}"`)
    .replace(/url\(#([A-Za-z][\w-]*)\)/g, (_m, id) => `url(#${uid}-${id})`);
}

export function renderTemplate(templateId, fields, photo) {
  const t = TEMPLATE_BY_ID[templateId] || TEMPLATES[0];
  return namespaceIds(t.render(fields || {}, photo));
}
