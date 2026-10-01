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

/* Petal rings with chosen colours, for the flower-based festivals. */
const petals = (cx, cy, rings) => rings.map(([r, n, fill, op]) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  const x = (cx + Math.cos(a) * r).toFixed(1), y = (cy + Math.sin(a) * r).toFixed(1);
  return `<ellipse cx="${x}" cy="${y}" rx="${(r / 3.1).toFixed(1)}" ry="${(r / 6.2).toFixed(1)}" fill="${fill}" opacity="${op}" transform="rotate(${((a * 180) / Math.PI).toFixed(1)} ${x} ${y})"/>`;
}).join("")).join("");

/* A ring of dots, for garba circles and alpana borders. */
const dotRing = (cx, cy, r, n, colours, size = 8) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return `<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}" r="${size}" fill="${colours[i % colours.length]}"/>`;
}).join("");

/* A string of festive bulbs hanging across the top of the art. */
const bulbs = (x1, x2, y, sag, colours) => {
  const n = 11;
  const pts = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [x1 + (x2 - x1) * t, y + sag * 4 * t * (1 - t)];
  });
  return `<path d="M${x1} ${y} Q${(x1 + x2) / 2} ${y + sag * 2} ${x2} ${y}" stroke="#F2E8CF" stroke-width="1.5" fill="none" opacity="0.5"/>
${pts.map(([x, yy], i) => `<circle cx="${x.toFixed(1)}" cy="${(yy + 9).toFixed(1)}" r="14" fill="url(#glow)" opacity="0.6"/><circle cx="${x.toFixed(1)}" cy="${(yy + 9).toFixed(1)}" r="6" fill="${colours[i % colours.length]}"/>`).join("")}`;
};

/* A marigold toran: strands of flowers and leaves hung from a line. */
const toran = (x1, x2, y, flowers = ["#F5A524", "#FFC24D"]) => {
  const strands = [];
  for (let x = x1 + 16, i = 0; x < x2; x += 40, i += 1) {
    const len = i % 2 ? 3 : 4;
    strands.push(Array.from({ length: len }, (_, k) => `<circle cx="${x}" cy="${y + 16 + k * 17}" r="8.5" fill="${flowers[(i + k) % flowers.length]}"/>`).join(""));
    strands.push(`<ellipse cx="${x + 20}" cy="${y + 14}" rx="11" ry="5" fill="#2E7D32" transform="rotate(70 ${x + 20} ${y + 14})"/>`);
  }
  return `<path d="M${x1} ${y} L${x2} ${y}" stroke="#2E7D32" stroke-width="3"/>${strands.join("")}`;
};

/* A diya, on its own. */
const diya = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="34" ry="13" fill="#8A4B1E"/><path d="M-34 0 a34 13 0 0 0 68 0z" fill="#5E3113"/><circle cx="0" cy="-34" r="26" fill="url(#glow)"/><path d="M0 -52 c10 12 6 22 0 28 c-6 -6 -10 -16 0 -28z" fill="#FFD27A"/></g>`;

/* A paper kite with its spars, a tail of bows, and a string trailing away. */
const kite = (cx, cy, s, fill, rot) => `<g transform="rotate(${rot} ${cx} ${cy})">
<path d="M${cx} ${cy - s} L${cx + s * 0.78} ${cy} L${cx} ${cy + s * 1.15} L${cx - s * 0.78} ${cy} Z" fill="${fill}"/>
<path d="M${cx} ${cy - s} L${cx} ${cy + s * 1.15} M${cx - s * 0.78} ${cy} Q${cx} ${cy - s * 0.35} ${cx + s * 0.78} ${cy}" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="0.7"/>
<path d="M${cx} ${cy + s * 1.15} q${-s * 0.2} ${s * 0.5} ${s * 0.05} ${s * 0.95}" stroke="#FFFFFF" stroke-width="1.5" fill="none" opacity="0.7"/>
<path d="M${cx - 7} ${cy + s * 1.62} l7 4 l7 -4 l-7 -4z M${cx - 2} ${cy + s * 1.95} l6 4 l6 -4 l-6 -4z" fill="${fill}"/></g>`;

const wheel = (cx, cy, r, colour) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colour}" stroke-width="${(r / 11).toFixed(1)}"/>
${Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${colour}" stroke-width="2"/>`; }).join("")}
<circle cx="${cx}" cy="${cy}" r="${(r / 6).toFixed(1)}" fill="${colour}"/>`;

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
  /* ---- Indian festivals added with the intent work. Symbols only — no
     deities are drawn, because a company page should not risk a depiction
     that is subtly wrong. ---- */
  navratri: { deep: "#2E0A3A", mid: "#8E1C5C", warm: "#F2B705",
    art: `${bulbs(712, 1180, 64, 26, ["#F2B705", "#E0457B", "#2E9E5B", "#3AA0E0", "#FF7A1A"])}
<circle cx="960" cy="300" r="150" fill="url(#glow)" opacity="0.45"/>
<circle cx="960" cy="300" r="148" fill="none" stroke="#F2B705" stroke-width="2" opacity="0.55"/>
${dotRing(960, 300, 148, 18, ["#F2B705", "#E0457B", "#2E9E5B", "#FF7A1A", "#3AA0E0", "#FFFFFF"], 9)}
${petals(960, 300, [[100, 12, "#E0457B", 0.7], [62, 9, "#F2B705", 0.8], [30, 6, "#FF7A1A", 0.9]])}
<circle cx="960" cy="300" r="14" fill="#FFFFFF" opacity="0.9"/>
${[[-1, "#F2B705"], [1, "#FF7A1A"]].map(([d, c]) => `<g transform="rotate(${d * 34} 960 520)"><rect x="954" y="420" width="12" height="200" rx="6" fill="${c}"/>${[450, 520, 590].map((y, k) => `<rect x="952" y="${y}" width="16" height="9" rx="3" fill="${["#E0457B", "#2E9E5B", "#3AA0E0"][k]}"/>`).join("")}</g>`).join("")}` },
  dussehra: { deep: "#2A0A0E", mid: "#7E1A14", warm: "#F5A524",
    art: `${toran(704, 1184, 58)}
<circle cx="960" cy="330" r="190" fill="url(#glow)" opacity="0.55"/>
<path d="M900 196 Q1064 330 900 464" stroke="#FFC24D" stroke-width="9" fill="none" stroke-linecap="round"/>
<path d="M900 196 L900 464" stroke="#F2E8CF" stroke-width="2" opacity="0.85"/>
<path d="M846 330 L1088 330" stroke="#FFC24D" stroke-width="5" stroke-linecap="round"/>
<path d="M1088 330 l-22 -12 l4 12 l-4 12z" fill="#FFC24D"/>
<path d="M846 330 l-16 -12 M846 330 l-16 12 M862 330 l-16 -12 M862 330 l-16 12" stroke="#F2E8CF" stroke-width="3" opacity="0.85"/>
${[[790, 520], [1130, 520]].map(([x, y]) => diya(x, y, 0.8)).join("")}` },
  uttarayan: { deep: "#0B3C6E", mid: "#2F8FD6", warm: "#FFE08A",
    art: `<circle cx="1110" cy="120" r="46" fill="#FFE08A" opacity="0.9"/><circle cx="1110" cy="120" r="90" fill="url(#glow)" opacity="0.6"/>
${[[960, 210, 70, "#E0457B", -12], [1090, 330, 50, "#F2B705", 10], [840, 330, 44, "#2E9E5B", -20], [1010, 450, 36, "#FF7A1A", 6]].map(([cx, cy, sz, c, r]) =>
      `<path d="M${cx} ${cy + sz * 1.15} q-30 ${140 - sz} -${150 - sz} ${330 - cy * 0.4}" stroke="#FFFFFF" stroke-width="1.2" fill="none" opacity="0.4"/>${kite(cx, cy, sz, c, r)}`).join("")}` },
  ganeshchaturthi: { deep: "#3E1205", mid: "#A33A16", warm: "#FFD27A",
    art: `${toran(704, 1184, 58, ["#F28C28", "#FFC24D"])}
<circle cx="960" cy="380" r="170" fill="url(#glow)" opacity="0.5"/>
<ellipse cx="960" cy="470" rx="150" ry="22" fill="#C9A227"/><ellipse cx="960" cy="464" rx="138" ry="16" fill="#E5C35A"/>
${[[890, 432], [960, 418], [1030, 432]].map(([x, y]) => `<path d="M${x} ${y - 48} C${x + 34} ${y - 14} ${x + 36} ${y + 22} ${x} ${y + 26} C${x - 36} ${y + 22} ${x - 34} ${y - 14} ${x} ${y - 48} Z" fill="#F7E7CE"/><path d="M${x} ${y - 46} L${x} ${y + 24} M${x - 14} ${y - 26} Q${x - 18} ${y} ${x - 16} ${y + 22} M${x + 14} ${y - 26} Q${x + 18} ${y} ${x + 16} ${y + 22}" stroke="#D9C2A0" stroke-width="2" fill="none"/>`).join("")}
${diya(1120, 520, 0.8)}${diya(800, 520, 0.8)}` },
  rakshabandhan: { deep: "#3E0A26", mid: "#9C2257", warm: "#F2B705",
    art: `<path d="M704 330 C800 290 860 370 960 330 S1120 290 1184 330" stroke="#C7332B" stroke-width="7" fill="none"/>
<path d="M704 336 C800 296 860 376 960 336 S1120 296 1184 336" stroke="#F2B705" stroke-width="3" fill="none"/>
<circle cx="960" cy="332" r="150" fill="url(#glow)" opacity="0.45"/>
${petals(960, 332, [[96, 14, "#F2B705", 0.85], [62, 10, "#E0457B", 0.9], [32, 8, "#FFFFFF", 0.85]])}
<circle cx="960" cy="332" r="16" fill="#C7332B"/>
${[780, 840, 1080, 1140].map((x) => `<circle cx="${x}" cy="${x < 960 ? 318 : 318}" r="7" fill="#F2B705"/>`).join("")}` },
  janmashtami: { deep: "#0A1A42", mid: "#1F4E9E", warm: "#F2B705",
    art: `<circle cx="980" cy="300" r="180" fill="url(#glow)" opacity="0.35"/>
<path d="M1040 540 C1010 420 990 300 1010 170" stroke="#2E9E5B" stroke-width="4" fill="none"/>
${Array.from({ length: 16 }, (_, i) => { const t = i / 16; const y = 520 - t * 300; const x = 1036 - t * 30; return `<path d="M${x} ${y} q-60 -30 -96 -18 M${x} ${y} q60 -30 96 -18" stroke="#2E9E5B" stroke-width="1.6" fill="none" opacity="0.75"/>`; }).join("")}
<ellipse cx="1010" cy="190" rx="62" ry="80" fill="#2E9E5B"/><ellipse cx="1010" cy="200" rx="40" ry="54" fill="#1BA3A0"/><ellipse cx="1010" cy="206" rx="24" ry="32" fill="#F2B705"/><ellipse cx="1010" cy="210" rx="13" ry="18" fill="#1F3A8A"/>
<g transform="rotate(-24 900 430)"><rect x="740" y="420" width="330" height="22" rx="11" fill="#B07A2A"/>${[800, 850, 900, 950, 1000].map((x) => `<circle cx="${x}" cy="431" r="5" fill="#5E3113"/>`).join("")}<rect x="1010" y="418" width="14" height="26" fill="#F2B705"/></g>` },
  onam: { deep: "#0C3A1C", mid: "#2E7D32", warm: "#F2B705",
    art: `${petals(990, 320, [[140, 22, "#F2B705", 0.8], [110, 18, "#E0612B", 0.85], [82, 16, "#FFFFFF", 0.85], [54, 12, "#C7332B", 0.85], [28, 8, "#F2B705", 0.95]])}
<circle cx="990" cy="320" r="14" fill="#E0612B"/>` },
  pongal: { deep: "#4A1A08", mid: "#B0451A", warm: "#F2B705",
    art: `<circle cx="1100" cy="130" r="44" fill="#F2B705"/>${Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; return `<line x1="${(1100 + Math.cos(a) * 58).toFixed(1)}" y1="${(130 + Math.sin(a) * 58).toFixed(1)}" x2="${(1100 + Math.cos(a) * 82).toFixed(1)}" y2="${(130 + Math.sin(a) * 82).toFixed(1)}" stroke="#F2B705" stroke-width="4" stroke-linecap="round"/>`; }).join("")}
${[[810, -8], [1110, 8]].map(([x, r]) => `<g transform="rotate(${r} ${x} 560)">${[0, 1, 2, 3, 4].map((k) => `<rect x="${x - 7}" y="${300 + k * 52}" width="14" height="48" rx="4" fill="#4E8A2E"/>`).join("")}<path d="M${x} 300 q-40 -40 -70 -36 M${x} 300 q40 -50 64 -60" stroke="#6BB04A" stroke-width="5" fill="none"/></g>`).join("")}
<path d="M880 330 Q960 280 1040 330 Q1004 352 960 350 Q916 352 880 330z" fill="#FFF8E7"/>
<path d="M884 340 C860 420 880 520 960 530 C1040 520 1060 420 1036 340 Z" fill="#B5651D"/><path d="M890 372 C930 386 990 386 1030 372" stroke="#F2B705" stroke-width="5" fill="none"/>
${[0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${850 + i * 36}" cy="580" r="4" fill="#FFFFFF" opacity="0.85"/>`).join("")}` },
  lohri: { deep: "#140604", mid: "#4A1408", warm: "#FF8A1A",
    art: `<circle cx="960" cy="420" r="210" fill="url(#glow)" opacity="0.65"/>
<g transform="translate(960 540)"><rect x="-120" y="-10" width="240" height="22" rx="10" fill="#5E3113" transform="rotate(14)"/><rect x="-120" y="-10" width="240" height="22" rx="10" fill="#6E3B17" transform="rotate(-14)"/></g>
<path d="M960 300 C1030 380 1050 450 1010 520 C990 470 980 450 960 430 C940 460 930 480 910 520 C870 450 890 380 960 300z" fill="#E0612B"/>
<path d="M960 360 C1010 420 1016 470 990 520 C976 486 970 470 960 456 C950 476 944 490 930 520 C904 470 914 420 960 360z" fill="#F5A524"/>
<path d="M960 420 C984 456 986 488 972 520 L948 520 C934 488 938 456 960 420z" fill="#FFE08A"/>
${[[900, 250], [1010, 220], [960, 180], [1060, 290], [860, 300]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#FFD27A"/>`).join("")}` },
  gurpurab: { deep: "#0C1A36", mid: "#1F3A6B", warm: "#F2B705",
    art: `${Array.from({ length: 13 }, (_, i) => { const a = Math.PI + (i / 12) * Math.PI; return `<line x1="960" y1="300" x2="${(960 + Math.cos(a) * 260).toFixed(1)}" y2="${(300 + Math.sin(a) * 260).toFixed(1)}" stroke="#F2B705" stroke-width="2" opacity="0.18"/>`; }).join("")}
<circle cx="960" cy="300" r="150" fill="url(#glow)" opacity="0.5"/>${diyas(520)}
${[880, 960, 1040].map((x) => diya(x, 400, 0.7)).join("")}` },
  durgapuja: { deep: "#330606", mid: "#8E1717", warm: "#F2B705",
    art: `<circle cx="960" cy="300" r="190" fill="url(#glow)" opacity="0.35"/>
${petals(990, 300, [[124, 20, "#FFFFFF", 0.85], [88, 16, "#FFFFFF", 0.6], [54, 12, "#F2B705", 0.85]])}
${dotRing(990, 300, 160, 32, ["#FFFFFF"], 4)}<circle cx="990" cy="300" r="22" fill="#C7332B" stroke="#FFFFFF" stroke-width="4"/>
<rect x="820" y="540" width="364" height="16" fill="#FFFFFF" opacity="0.9"/><rect x="820" y="560" width="364" height="10" fill="#C7332B"/>` },
  republicday: { deep: "#0A1B33", mid: "#123A6B", warm: "#FF9933",
    art: `${[["#FF9933", 240], ["#FFFFFF", 300], ["#138808", 360]].map(([c, y]) => `<path d="M830 ${y} C910 ${y - 34} 990 ${y + 34} 1070 ${y} S1160 ${y - 22} 1184 ${y - 14}" stroke="${c}" stroke-width="46" fill="none" opacity="0.92" stroke-linecap="round"/>`).join("")}
<circle cx="1010" cy="300" r="40" fill="#FFFFFF"/>${wheel(1010, 300, 32, "#000080")}` },
  indiaindependence: { deep: "#0A1B33", mid: "#123A6B", warm: "#FF9933",
    art: `${[["#FF9933", 240], ["#FFFFFF", 300], ["#138808", 360]].map(([c, y]) => `<path d="M830 ${y} C910 ${y - 34} 990 ${y + 34} 1070 ${y} S1160 ${y - 22} 1184 ${y - 14}" stroke="${c}" stroke-width="46" fill="none" opacity="0.92" stroke-linecap="round"/>`).join("")}
<circle cx="1010" cy="300" r="40" fill="#FFFFFF"/>${wheel(1010, 300, 32, "#000080")}
${bursts([[1100, 120, 40], [820, 110, 30]], ["#FF9933", "#FFFFFF", "#138808"])}` },
  independence: { deep: "#0B1740", mid: "#1B2A5B", warm: "#E8C766",
    art: `${bursts([[960, 210, 90], [1110, 360, 62], [830, 340, 48]], ["#E8C766", "#FFFFFF", "#7C8CFF"])}` },
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
