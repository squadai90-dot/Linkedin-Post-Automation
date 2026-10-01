/* ============================================================
   DESIGN ENGINE

   Turns a finished post into a small set of genuinely different designs,
   each one fully described by plain data — text, palette, typeface, layout,
   background, picture and crop — so that every quick edit changes exactly
   the thing that was edited and nothing else.

   Three rules this file keeps:

   — What the design says comes from the post. A product launch gets its
     feature list from the post's own bullet points or not at all; a
     milestone gets its number from the topic or the post or no number.
     Nothing here invents a claim to fill a space.
   — A festival greeting looks like that festival. The occasion's own motif
     and colours are drawn (see OCCASION_ART), so a Navratri greeting does not
     come out as a generic office card.
   — No empty layouts. Every style pairs the words with a visual element and
     a clear hierarchy — headline, supporting line, sign-off — rather than one
     oversized sentence on a flat colour.

   The output is SVG. It is rasterised in the browser (PNG for an image post,
   or a 1920 × 1080 frame for a video) only when the user asks for a file.
   ============================================================ */

import { esc, wrapText } from "./brand.js";
import { OCCASION_ART, namespaceIds } from "./templates.js";
import { occasionById, findStats } from "./intel.js";
import { subjectOf } from "./intent.js";

/* ---------- canvases ---------- */

export const CANVASES = {
  image: { W: 1200, H: 630, px: [1200, 630], label: "1200 × 630" },
  video: { W: 1200, H: 675, px: [1920, 1080], label: "1920 × 1080 (16:9)" },
};

/* System typefaces only. An SVG rasterised through an <img> cannot load a
   web font, so a font that is not installed would silently fall back — these
   stacks are chosen so the fallback is close to the intent. `w` is the
   average glyph width as a fraction of the size, used to wrap lines. */
export const FONTS = {
  sans:    { label: "Clean sans",   stack: "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif", w: 0.54 },
  serif:   { label: "Classic serif", stack: "Georgia, 'Times New Roman', Times, serif", w: 0.53 },
  display: { label: "Friendly",     stack: "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif", w: 0.56 },
};

/* ---------- colour ---------- */

const hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "").trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
export const mix = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (c) => {
  const [r, g, b] = hex(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ""));

/* Darken a background until the text on it reads at the WCAG AA ratio. Used
   only when a style is first built — a colour the user picks is respected and
   warned about, never silently changed. */
const readableOn = (bg, ink, min = 4.5) => {
  let c = bg;
  for (let i = 0; i < 12 && contrast(c, ink) < min; i += 1) c = mix(c, lum(ink) > 0.5 ? "#000000" : "#FFFFFF", 0.12);
  return c;
};

/* ---------- reading the post ---------- */

const firstSentence = (s) => (String(s || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/)[0] || "").trim();
const clip = (s, n) => { const t = String(s || "").trim(); return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };

/* Bullet lines only. A launch graphic lists features the post actually
   lists; it does not turn ordinary sentences into "features". */
export function bulletsOf(body, max = 3) {
  const lines = String(body || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const marked = lines
    .filter((l) => /^(?:[•\-–—*▪●·✓✔→]|✅|\d{1,2}[.)])\s*/.test(l))
    .map((l) => l.replace(/^(?:[•\-–—*▪●·✓✔→]|✅|\d{1,2}[.)])\s*/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 4);
  return marked.slice(0, max).map((l) => clip(l, 64));
}

/* The number a milestone is about: "10 years", "1,000 clients", "25%". Taken
   from the topic first, because that is what the user said the post is for. */
const FIGURE = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(\+)?\s*(years?|yrs|months?|clients?|customers?|members?|employees?|people|projects?|countries|offices?|users?|downloads?|followers?|partners?|million|thousand|k\b|%)/i;
export function milestoneFigure(...texts) {
  for (const t of texts) {
    const m = FIGURE.exec(String(t || ""));
    if (m) {
      const unit = m[3].toLowerCase();
      const value = `${m[1]}${m[2] || ""}${unit === "%" ? "%" : ""}`;
      return { stat: value, statLabel: unit === "%" ? "" : unit === "k" ? "thousand" : unit };
    }
  }
  const s = findStats(texts.join("\n"));
  return s.length ? { stat: s[0], statLabel: "" } : null;
}

/* ---------- what kind of design this post needs ---------- */

const FESTIVAL_INTENTS = new Set(["greeting", "occasion_info", "occasion_recap", "occasion_csr", "occasion_event"]);

export function studioContext({ intent, topic = "", draft = {}, profile = {} } = {}) {
  const occasion = intent?.occasion ? (typeof intent.occasion === "string" ? occasionById(intent.occasion) : intent.occasion) : null;
  const kind = intent?.kind || "thought";
  const group = occasion && FESTIVAL_INTENTS.has(kind) ? "festival" : kind === "launch" ? "launch" : kind === "milestone" ? "milestone" : "general";
  const figure = group === "milestone" ? milestoneFigure(topic, draft.hook, draft.body) : null;
  return {
    group, kind, occasion, topic,
    greeting: kind === "greeting" ? (intent?.greeting || occasion?.greeting || "") : "",
    subject: group === "launch" ? subjectOf(topic) : "",
    items: group === "launch" ? bulletsOf(draft.body) : [],
    figure,
    company: String(profile.company || "").trim(),
    site: String(profile.website || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, ""),
  };
}

/* The words, filled from the post. Every field can be edited; anything the
   post does not supply is left empty rather than padded. */
export function autoText(ctx, draft = {}) {
  const hook = String(draft.hook || "").trim();
  const lead = firstSentence(draft.body);
  const sign = ctx.company || ctx.site || "";
  if (ctx.group === "festival") {
    const greeting = ctx.greeting;
    const message = lead && lead.length <= 170 && lead !== hook ? lead : (ctx.occasion?.wish || "");
    return {
      kicker: greeting ? "" : (ctx.occasion?.label || ""),
      headline: clip(greeting || hook, 90),
      message: clip(greeting ? message : (lead || ""), 170),
      items: "", cta: "", stat: "", statLabel: "",
      signoff: greeting && ctx.company ? `Warm wishes from ${ctx.company}` : sign,
    };
  }
  if (ctx.group === "launch") {
    const cta = String(draft.cta || "").trim();
    return {
      kicker: "Introducing",
      headline: clip(ctx.subject || hook, 70),
      message: clip(ctx.subject ? (lead || hook) : lead, 160),
      items: ctx.items.join("\n"),
      cta: cta.length <= 48 ? cta : "",
      stat: "", statLabel: "",
      signoff: sign,
    };
  }
  if (ctx.group === "milestone") {
    return {
      kicker: "Milestone",
      headline: clip(hook, 90),
      message: clip(lead !== hook ? lead : "", 160),
      items: "", cta: "",
      stat: ctx.figure?.stat || "", statLabel: ctx.figure?.statLabel || "",
      signoff: sign,
    };
  }
  return {
    kicker: "", headline: clip(hook, 90), message: clip(lead !== hook ? lead : "", 160),
    items: "", cta: "", stat: "", statLabel: "", signoff: sign,
  };
}

/* ---------- styles ----------
   Each style is a complete starting point. They differ in palette, typeface,
   arrangement and ornament together — four options are four different
   designs, not one design in four colourways. */

const GOLD = "#E8C766";

export function stylesFor(ctx) {
  const art = OCCASION_ART[ctx.occasion?.id] || OCCASION_ART.default;
  const occ = ctx.occasion;

  if (ctx.group === "festival") {
    const vivid1 = readableOn(art.mid, "#FFFFFF");
    const vivid2 = readableOn(mix(occ?.palette?.[0] || art.warm, "#000000", 0.22), "#FFFFFF");
    return [
      { id: "traditional", label: "Elegant traditional", why: `${occ.label}'s own colours with a gold frame and a classic serif — formal and warm.`,
        defaults: { palette: { bg1: art.deep, bg2: art.mid, accent: GOLD, ink: "#FFF8E7", soft: "#F1E2C2" }, font: "serif", weight: 700,
          align: "left", layout: "column", background: "gradient", frame: "ornate", decor: "none", motif: occ.id, motifMode: "colour", occasionPalette: occ.palette } },
      { id: "corporate", label: "Premium corporate", why: "A dark, restrained company card with one festive accent — suits a firm's page.",
        defaults: { palette: { bg1: "#0B1220", bg2: "#17243F", accent: art.warm, ink: "#F4F6FA", soft: "#AAB4C6" }, font: "sans", weight: 600,
          align: "left", layout: "column", background: "gradient", frame: "line", decor: "none", motif: occ.id, motifMode: "mono" } },
      { id: "celebratory", label: "Colourful celebratory", why: "Bright, centred and joyful, with confetti — for a lively tone.",
        defaults: { palette: { bg1: vivid1, bg2: vivid2, accent: "#FFE08A", ink: "#FFFFFF", soft: "#FFF1D6" }, font: "display", weight: 800,
          align: "center", layout: "column", background: "gradient", frame: "none", decor: "confetti", motif: occ.id, motifMode: "colour", occasionPalette: occ.palette } },
      { id: "minimal", label: "Modern minimal", why: "Light, quiet and spacious, with the motif as a single-colour line drawing.",
        defaults: { palette: { bg1: "#FAF7F2", bg2: "#FAF7F2", accent: readableOn(art.mid, "#FAF7F2", 3), ink: "#16181D", soft: "#4E5562" }, font: "sans", weight: 600,
          align: "left", layout: "column", background: "solid", frame: "none", decor: "none", motif: occ.id, motifMode: "mono" } },
    ];
  }

  const corporate = (motif, why) => ({ id: "corporate", label: "Premium corporate", why,
    defaults: { palette: { bg1: "#0A0F1A", bg2: "#1B2A5B", accent: "#7C8CFF", ink: "#F4F6FA", soft: "#AAB4C6" }, font: "sans", weight: 700,
      align: "left", layout: "column", background: "gradient", frame: "line", decor: "none", motif, motifMode: "colour" } });
  const minimal = (motif) => ({ id: "minimal", label: "Modern minimal", why: "Light, quiet and spacious — the words carry it.",
    defaults: { palette: { bg1: "#F7F8FB", bg2: "#F7F8FB", accent: "#3B5BDB", ink: "#111827", soft: "#4B5563" }, font: "sans", weight: 700,
      align: "left", layout: "column", background: "solid", frame: "none", decor: "none", motif, motifMode: "mono" } });

  if (ctx.group === "launch") {
    const out = [
      { id: "spotlight", label: "Product spotlight", why: "A dark stage with your product in a framed panel — add a product photo or screenshot.",
        defaults: { palette: { bg1: "#0A0F1A", bg2: "#1B2A5B", accent: "#7C8CFF", ink: "#F4F6FA", soft: "#AAB4C6" }, font: "sans", weight: 700,
          align: "left", layout: "spotlight", background: "gradient", frame: "none", decor: "none", motif: "launch", motifMode: "colour" } },
      { id: "announcement", label: "Launch announcement", why: "Bold and centred — announces the launch at a glance.",
        defaults: { palette: { bg1: "#2E1A7A", bg2: "#0E5E78", accent: "#FDE68A", ink: "#FFFFFF", soft: "#E0E7FF" }, font: "display", weight: 800,
          align: "center", layout: "column", background: "gradient", frame: "none", decor: "sparkle", motif: "launch", motifMode: "colour" } },
    ];
    if (ctx.items.length >= 2) {
      out.push({ id: "features", label: "Feature highlights", why: `Lists the ${ctx.items.length} points your post makes about it.`,
        defaults: { palette: { bg1: "#F6F8FC", bg2: "#E8EEF9", accent: "#3B5BDB", ink: "#111827", soft: "#4B5563" }, font: "sans", weight: 700,
          align: "left", layout: "column", background: "gradient", frame: "none", decor: "none", motif: "abstract", motifMode: "mono", showItems: true } });
    } else {
      out.push(corporate("abstract", "A dark, restrained company card — lets the product name lead."));
    }
    out.push(minimal("launch"));
    return out;
  }

  if (ctx.group === "milestone") {
    const out = [];
    if (ctx.figure?.stat) {
      out.push({ id: "figure", label: "Big number", why: `Puts ${ctx.figure.stat}${ctx.figure.statLabel ? ` ${ctx.figure.statLabel}` : ""} at the centre, inside a laurel.`,
        defaults: { palette: { bg1: "#0B1220", bg2: "#1C2B4A", accent: GOLD, ink: "#F8F5EC", soft: "#C9C3B3" }, font: "serif", weight: 700,
          align: "left", layout: "figure", background: "gradient", frame: "none", decor: "none", motif: "laurel", motifMode: "colour" } });
    }
    out.push({ id: "thanks", label: "Thank-you card", why: "Warm and centred, with confetti — thanks the people who made it happen.",
      defaults: { palette: { bg1: "#4A1D2A", bg2: "#8E3445", accent: "#FFD27A", ink: "#FFFFFF", soft: "#FBE3D6" }, font: "serif", weight: 700,
        align: "center", layout: "column", background: "gradient", frame: "none", decor: "confetti", motif: "milestone", motifMode: "colour" } });
    out.push(corporate("milestone", "A dark, restrained company card with a medal motif."));
    out.push(minimal("milestone"));
    return out;
  }

  return [corporate("abstract", "A dark, restrained company card — headline first."), minimal("abstract")];
}

export function designFor(style, { text = {}, tweak = {}, photo = null } = {}) {
  const d = style.defaults;
  return {
    styleId: style.id,
    ...d,
    ...tweak,
    palette: { ...d.palette, ...(tweak.palette || {}) },
    text,
    photo,
  };
}

/* ---------- drawing ---------- */

const T = (x, y, str, { size, weight = 400, fill, font, spacing = 0, anchor = "start", opacity = 1, italic = false }) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-family="${font}" font-size="${size.toFixed(1)}" font-weight="${weight}"${italic ? ' font-style="italic"' : ""}${spacing ? ` letter-spacing="${spacing}"` : ""}${anchor !== "start" ? ` text-anchor="${anchor}"` : ""}${opacity !== 1 ? ` opacity="${opacity}"` : ""}>${esc(str)}</text>`;

/* Wrap to a column, stepping the size down until it fits. Reports overflow
   rather than letting text run off the canvas or vanish silently. */
function fit(str, { width, size, min, maxLines, F, weight = 400 }) {
  const wf = weight >= 800 ? 1.06 : weight >= 700 ? 1.03 : 1;
  let s = size;
  let lines = [];
  for (;;) {
    const chars = Math.max(6, Math.floor(width / (s * F.w * wf)));
    lines = wrapText(str, chars);
    if (lines.length <= maxLines || s <= min) break;
    s = Math.max(min, s - 3);
  }
  let overflow = false;
  if (lines.length > maxLines) {
    overflow = true;
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s,.;:]*$/, "") + "…";
  }
  return { lines, size: s, overflow };
}

/* Cover-fit a picture into a box, then zoom and pan within it. */
export function placePhoto(photo, box) {
  const pw = photo?.w || 0, ph = photo?.h || 0;
  if (!pw || !ph) return { ...box, slice: true };
  const zoom = Math.max(1, Number(photo.zoom) || 1);
  const fx = Math.min(100, Math.max(0, photo.x ?? 50)) / 100;
  const fy = Math.min(100, Math.max(0, photo.y ?? 50)) / 100;
  const s = Math.max(box.w / pw, box.h / ph) * zoom;
  const w = pw * s, h = ph * s;
  return { x: box.x + (box.w - w) * fx, y: box.y + (box.h - h) * fy, w, h, slice: false };
}

const photoTag = (photo, box) => {
  const p = placePhoto(photo, box);
  return `<image href="${esc(photo.dataUrl)}" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h.toFixed(1)}" preserveAspectRatio="${p.slice ? "xMidYMid slice" : "none"}"/>`;
};

/* Non-occasion motifs, drawn in the same right-hand region as the festival
   artwork (x 700–1190, y 50–600) so every layout can place any motif. */
function motifArt(motif, P) {
  if (!motif || motif === "none") return "";
  if (OCCASION_ART[motif]) return OCCASION_ART[motif].art;
  if (motif === "launch") {
    const star = (cx, cy, r, op) => `<path d="M${cx} ${cy - r} Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r}Z" fill="${P.accent}" opacity="${op}"/>`;
    return `${[170, 240, 310, 380].map((r, i) => `<path d="M${960 - r} 600 A${r} ${r} 0 0 1 ${960 + r} 600" stroke="${P.accent}" stroke-width="2" fill="none" opacity="${(0.5 - i * 0.1).toFixed(2)}"/>`).join("")}
<path d="M780 540 C880 520 1000 420 1090 200" stroke="${P.accent}" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M1090 200 l-30 14 m30 -14 l2 33" stroke="${P.accent}" stroke-width="5" fill="none" stroke-linecap="round"/>
${star(980, 250, 56, 0.95)}${star(1110, 340, 22, 0.8)}${star(860, 230, 16, 0.7)}${star(1060, 120, 12, 0.6)}`;
  }
  if (motif === "milestone") {
    return `${laurel(970, 300, 150, P.accent)}
<circle cx="970" cy="300" r="86" fill="${P.accent}" opacity="0.16"/><circle cx="970" cy="300" r="86" fill="none" stroke="${P.accent}" stroke-width="3"/>
<path d="M970 248 l15 31 l34 5 l-25 24 l6 34 l-30 -16 l-30 16 l6 -34 l-25 -24 l34 -5z" fill="${P.accent}"/>`;
  }
  if (motif === "laurel") return laurel(970, 315, 180, P.accent);
  if (motif === "abstract") {
    return `${[130, 200, 270].map((r, i) => `<circle cx="980" cy="310" r="${r}" fill="none" stroke="${P.accent}" stroke-width="2" opacity="${(0.42 - i * 0.12).toFixed(2)}"/>`).join("")}
${[[980 + 130, 310], [980 - 141, 310 - 141], [980 + 191, 310 + 191], [980, 310 - 270]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${[9, 7, 6, 5][i]}" fill="${P.accent}"/>`).join("")}
<circle cx="980" cy="310" r="54" fill="${P.accent}" opacity="0.22"/>`;
  }
  return "";
}

function laurel(cx, cy, r, colour) {
  const side = (dir) => {
    const leaves = Array.from({ length: 11 }, (_, k) => {
      const deg = 105 + k * 13;
      const a = (deg * Math.PI) / 180;
      const x = cx + dir * Math.cos(a) * -r, y = cy + Math.sin(a) * r;
      const rot = dir === 1 ? 180 - deg + 90 : deg - 90;
      return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * 0.11).toFixed(1)}" ry="${(r * 0.045).toFixed(1)}" fill="${colour}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }).join("");
    return leaves;
  };
  return `<path d="M${cx - r * 0.26} ${cy + r * 0.97} A${r} ${r} 0 0 1 ${cx - r * 0.97} ${cy - r * 0.26}" stroke="${colour}" stroke-width="3" fill="none" opacity="0.85"/>
<path d="M${cx + r * 0.26} ${cy + r * 0.97} A${r} ${r} 0 0 0 ${cx + r * 0.97} ${cy - r * 0.26}" stroke="${colour}" stroke-width="3" fill="none" opacity="0.85"/>
${side(1)}${side(-1)}`;
}

/* Deterministic scatter, so the same design always renders identically. */
function scatter(n, seed, avoid, W, H) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const out = [];
  for (let i = 0; out.length < n && i < n * 8; i += 1) {
    const x = 30 + rnd() * (W - 60), y = 30 + rnd() * (H - 60);
    if (avoid && x > avoid.x1 && x < avoid.x2 && y > avoid.y1 && y < avoid.y2) continue;
    out.push([x, y, rnd(), rnd()]);
  }
  return out;
}

function decorArt(kind, P, colours, avoid, W, H) {
  if (kind === "confetti") {
    return scatter(46, 7, avoid, W, H).map(([x, y, a, b], i) => {
      const c = colours[i % colours.length];
      return i % 3 === 0
        ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(3 + a * 4).toFixed(1)}" fill="${c}" opacity="0.85"/>`
        : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(6 + a * 6).toFixed(1)}" height="${(12 + b * 8).toFixed(1)}" rx="2" fill="${c}" opacity="0.85" transform="rotate(${Math.round(b * 180)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }).join("");
  }
  if (kind === "sparkle") {
    return scatter(18, 11, avoid, W, H).map(([x, y, a]) => {
      const r = 5 + a * 9;
      return `<path d="M${x} ${y - r} L${x + r * 0.25} ${y - r * 0.25} L${x + r} ${y} L${x + r * 0.25} ${y + r * 0.25} L${x} ${y + r} L${x - r * 0.25} ${y + r * 0.25} L${x - r} ${y} L${x - r * 0.25} ${y - r * 0.25}Z" fill="${P.accent}" opacity="${(0.45 + a * 0.4).toFixed(2)}"/>`;
    }).join("");
  }
  return "";
}

function frameArt(kind, P, W, H) {
  if (kind === "ornate") {
    const corner = (x, y, sx, sy) => `<path d="M${x} ${y + sy * 34} L${x} ${y} L${x + sx * 34} ${y}" stroke="${P.accent}" stroke-width="4" fill="none"/>
<rect x="${x + sx * 10 - 5}" y="${y + sy * 10 - 5}" width="10" height="10" fill="${P.accent}" transform="rotate(45 ${x + sx * 10} ${y + sy * 10})"/>`;
    return `<rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="${P.accent}" stroke-width="1.6" opacity="0.9"/>
<rect x="32" y="32" width="${W - 64}" height="${H - 64}" fill="none" stroke="${P.accent}" stroke-width="0.8" opacity="0.55"/>
${corner(14, 14, 1, 1)}${corner(W - 14, 14, -1, 1)}${corner(14, H - 14, 1, -1)}${corner(W - 14, H - 14, -1, -1)}`;
  }
  if (kind === "line") return `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="6" fill="none" stroke="${P.accent}" stroke-width="1.5" opacity="0.35"/>`;
  return "";
}

/* The main text column. Returns SVG plus the box it occupies, so decoration
   can stay out of it, and any overflow so the editor can say so. */
function textColumn(d, { x, anchor, colW, top, bottom, F, P, headSize = 66 }) {
  const t = d.text || {};
  const sc = Math.min(1.4, Math.max(0.7, Number(d.scale) || 1));
  const weight = d.weight || 700;
  const parts = [];
  const warnings = [];
  const blocks = [];

  if (t.kicker) blocks.push({ kind: "kicker", h: 22 * sc + 22, size: 21 * sc });
  if (t.headline) {
    const f = fit(t.headline, { width: colW, size: headSize * sc, min: 30, maxLines: 3, F, weight });
    if (f.overflow) warnings.push("The headline is too long to fit and was shortened — make it shorter.");
    blocks.push({ kind: "headline", f, h: f.lines.length * f.size * 1.16 + 4 });
  }
  if (t.message) {
    const f = fit(t.message, { width: colW, size: 26 * sc, min: 19, maxLines: d.layout === "spotlight" ? 4 : 3, F });
    if (f.overflow) warnings.push("The supporting line is too long to fit and was shortened.");
    blocks.push({ kind: "message", f, h: f.lines.length * f.size * 1.38 + 22 });
  }
  const items = d.showItems ? String(t.items || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 4) : [];
  if (items.length) {
    const size = 23 * sc;
    const wrapped = items.map((it) => fit(it, { width: colW - 34, size, min: 18, maxLines: 2, F }));
    blocks.push({ kind: "items", wrapped, size, h: wrapped.reduce((a, w) => a + w.lines.length * w.size * 1.3 + 14, 0) + 14 });
  }
  if (t.cta) blocks.push({ kind: "cta", h: 50 + 34, size: 21 * sc });

  const total = blocks.reduce((a, b) => a + b.h, 0);
  let y = top + Math.max(0, (bottom - top - total) / 2);
  const left = anchor === "start" ? x : anchor === "end" ? x - colW : x - colW / 2;

  for (const b of blocks) {
    if (b.kind === "kicker") {
      parts.push(T(x, y + b.size, String(t.kicker).toUpperCase(), { size: b.size, weight: 700, fill: P.accent, font: F.stack, spacing: 4, anchor }));
    } else if (b.kind === "headline") {
      b.f.lines.forEach((l, i) => parts.push(T(x, y + b.f.size * (1 + i * 1.16), l, { size: b.f.size, weight, fill: P.ink, font: F.stack, anchor })));
    } else if (b.kind === "message") {
      const my = y + 22;
      b.f.lines.forEach((l, i) => parts.push(T(x, my + b.f.size * (1 + i * 1.38) - b.f.size * 0.2, l, { size: b.f.size, fill: P.soft, font: F.stack, anchor })));
    } else if (b.kind === "items") {
      let iy = y + 14;
      for (const w of b.wrapped) {
        const bx = anchor === "end" ? x - 6 : left + 6;
        parts.push(`<circle cx="${bx.toFixed(1)}" cy="${(iy + w.size * 0.62).toFixed(1)}" r="5" fill="${P.accent}"/>`);
        w.lines.forEach((l, j) => parts.push(T(anchor === "end" ? x - 26 : left + 26, iy + w.size * (1 + j * 1.3) - 2, l, { size: w.size, fill: P.ink, font: F.stack, anchor: anchor === "end" ? "end" : "start" })));
        iy += w.lines.length * w.size * 1.3 + 14;
      }
    } else if (b.kind === "cta") {
      const label = String(t.cta);
      const pw = Math.min(colW, label.length * b.size * 0.56 + 56);
      const px = anchor === "start" ? x : anchor === "end" ? x - pw : x - pw / 2;
      const py = y + 30;
      const pillInk = contrast(P.accent, P.bg1) >= contrast(P.accent, "#FFFFFF") ? P.bg1 : "#FFFFFF";
      parts.push(`<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="50" rx="25" fill="${P.accent}"/>`);
      parts.push(T(px + pw / 2, py + 32, label, { size: b.size, weight: 700, fill: pillInk, font: F.stack, anchor: "middle" }));
    }
    y += b.h;
  }
  return { svg: parts.join(""), box: { x1: left - 20, x2: left + colW + 20, y1: top - 10, y2: y + 10 }, warnings, tall: total > bottom - top };
}

/* Too much to fit at the chosen size steps the whole block down a little at a
   time, so the sign-off is never overrun; if even that fails, it is said. */
function fitColumn(d, opts) {
  let scale = Number(d.scale) || 1;
  let col = textColumn(d, opts);
  for (let i = 0; col.tall && i < 4; i += 1) {
    scale *= 0.93;
    col = textColumn({ ...d, scale }, opts);
  }
  if (col.tall) col.warnings.push("There is more text than this layout can hold — shorten the headline, the supporting line or the points.");
  return col;
}

/* The whole design. Pure: the same design object always produces the same
   SVG, which is what makes undo, reset and "bring my edits back" reliable. */
export function renderDesign(design, shape = "image") {
  const { W, H } = CANVASES[shape] || CANVASES.image;
  const d = design;
  const P = d.palette;
  const F = FONTS[d.font] || FONTS.sans;
  const dy = (H - 630) / 2;
  const art = OCCASION_ART[d.motif];
  const warm = art?.warm || P.accent;
  const hasPhoto = !!d.photo?.dataUrl;
  const photoBg = hasPhoto && d.background === "photo";
  /* Spotlight and big-number layouts put a panel beside the words, so they
     have a left or a right but no centre. */
  const layout = d.layout === "spotlight" || (d.layout === "figure" && d.text?.stat) ? d.layout : "column";
  const align = d.align === "right" ? "right" : d.align === "center" && layout === "column" ? "center" : "left";
  const warnings = [];

  const defs = [
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${P.bg1}"/><stop offset="1" stop-color="${P.bg2}"/></linearGradient>`,
    `<radialGradient id="hi" cx="${align === "right" ? 0.22 : 0.78}" cy="0.3" r="0.65"><stop offset="0" stop-color="${P.accent}" stop-opacity="0.16"/><stop offset="1" stop-color="${P.accent}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${warm}" stop-opacity="0.85"/><stop offset="1" stop-color="${warm}" stop-opacity="0"/></radialGradient>`,
    `<filter id="mono" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feFlood flood-color="${P.accent}" flood-opacity="0.92"/><feComposite in2="SourceAlpha" operator="in"/></filter>`,
    `<filter id="lift" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/></filter>`,
  ];
  const layers = [];

  /* background */
  if (d.background === "solid") layers.push(`<rect width="${W}" height="${H}" fill="${P.bg1}"/>`);
  else layers.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#hi)"/>`);
  if (photoBg) {
    layers.push(photoTag(d.photo, { x: 0, y: 0, w: W, h: H }));
    const ov = Math.min(0.92, Math.max(0, d.overlay ?? 0.55));
    if (align === "center") layers.push(`<rect width="${W}" height="${H}" fill="${P.bg1}" opacity="${ov.toFixed(2)}"/>`);
    else {
      const from = align === "right" ? 1 : 0;
      defs.push(`<linearGradient id="side" x1="${from}" y1="0" x2="${1 - from}" y2="0"><stop offset="0" stop-color="${P.bg1}" stop-opacity="${Math.min(0.95, ov + 0.3).toFixed(2)}"/><stop offset="0.6" stop-color="${P.bg1}" stop-opacity="${ov.toFixed(2)}"/><stop offset="1" stop-color="${P.bg1}" stop-opacity="${(ov * 0.35).toFixed(2)}"/></linearGradient>`);
      layers.push(`<rect width="${W}" height="${H}" fill="url(#side)"/>`);
    }
  }

  /* motif placement */
  const motif = d.motifMode === "off" || photoBg ? "" : motifArt(d.motif, P);
  const wrap = (inner, transform, opacity = 1) => inner
    ? `<g${transform ? ` transform="${transform}"` : ""}${opacity !== 1 ? ` opacity="${opacity}"` : ""}>${d.motifMode === "mono" ? `<g filter="url(#mono)">${inner}</g>` : inner}</g>`
    : "";

  const top = d.frame === "ornate" ? 104 : 88;
  const bottom = H - 120;
  let col;

  if (layout === "spotlight") {
    const cardLeft = align === "right";
    const card = { x: cardLeft ? 72 : W - 72 - 448, y: 80, w: 448, h: H - 160 };
    defs.push(`<clipPath id="card"><rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="28"/></clipPath>`);
    layers.push(`<g filter="url(#lift)"><rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="28" fill="${mix(P.bg2, P.ink, 0.06)}"/></g>`);
    if (hasPhoto && !photoBg) {
      layers.push(`<g clip-path="url(#card)">${photoTag(d.photo, card)}</g>`);
    } else if (motif) {
      const s = Math.min(card.w / 500, card.h / 560);
      const tx = card.x - 695 * s + (card.w - 500 * s) / 2, ty = card.y - 45 * s + (card.h - 560 * s) / 2;
      layers.push(`<g clip-path="url(#card)">${wrap(motif, `translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${s.toFixed(3)})`)}</g>`);
    }
    layers.push(`<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="28" fill="none" stroke="${P.ink}" stroke-opacity="0.14"/>`);
    col = fitColumn(d, { x: cardLeft ? W - 72 : 72, anchor: cardLeft ? "end" : "start", colW: 560, top, bottom, F, P, headSize: 60 });
  } else if (layout === "figure" && d.text?.stat) {
    const numLeft = align === "right";
    const cx = numLeft ? 300 : 900;
    layers.push(`<g transform="translate(${cx - 970} ${dy + 4})">${motifArt("laurel", P)}</g>`);
    const stat = String(d.text.stat);
    const nf = fit(stat, { width: 300, size: 132 * (Number(d.scale) || 1), min: 54, maxLines: 1, F, weight: 800 });
    layers.push(T(cx, dy + 330 + nf.size * 0.12, nf.lines[0] || stat, { size: nf.size, weight: 800, fill: P.ink, font: F.stack, anchor: "middle" }));
    if (d.text.statLabel) layers.push(T(cx, dy + 392, String(d.text.statLabel).toUpperCase().slice(0, 26), { size: 21, weight: 700, fill: P.accent, font: F.stack, spacing: 4, anchor: "middle" }));
    col = fitColumn(d, { x: numLeft ? W - 72 : 72, anchor: numLeft ? "end" : "start", colW: 520, top, bottom, F, P, headSize: 54 });
  } else if (align === "center") {
    if (motif) layers.push(wrap(motif, `translate(${-360} ${dy})`, 0.2));
    col = fitColumn(d, { x: W / 2, anchor: "middle", colW: 900, top, bottom, F, P, headSize: 70 });
  } else {
    const mirrored = align === "right";
    if (motif) layers.push(wrap(motif, mirrored ? `translate(${W} ${dy}) scale(-1 1)` : `translate(0 ${dy})`));
    const wide = !motif;
    col = fitColumn(d, { x: mirrored ? W - 72 : 72, anchor: mirrored ? "end" : "start", colW: wide ? W - 144 : d.showItems ? 700 : 610, top, bottom, F, P });
  }
  warnings.push(...col.warnings);

  /* ornament that must stay out of the words */
  const confettiColours = [P.accent, P.ink, ...(art ? [art.warm] : []), ...((d.occasionPalette || []).slice(0, 3))];
  /* the sign-off sits under the column, so the clear zone runs to the foot */
  const clear = { ...col.box, y2: H - 30 };
  const decor = d.decor && d.decor !== "none" && !photoBg ? decorArt(d.decor, P, confettiColours, clear, W, H) : "";

  /* sign-off */
  const t = d.text || {};
  const sx = align === "center" ? W / 2 : align === "right" ? W - 72 : 72;
  const sAnchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const ruleX = align === "center" ? W / 2 - 21 : align === "right" ? W - 72 - 42 : 72;
  const signoff = t.signoff
    ? `<rect x="${ruleX}" y="${H - 98}" width="42" height="3" fill="${P.accent}"/>${T(sx, H - 62, String(t.signoff).slice(0, 60), { size: 20, weight: 600, fill: P.soft, font: F.stack, spacing: 1.5, anchor: sAnchor })}`
    : "";
  const credit = hasPhoto && d.photo.credit
    ? T(align === "right" ? 40 : W - 40, H - 22, String(d.photo.credit).slice(0, 90), { size: 13, fill: P.ink, font: F.stack, anchor: align === "right" ? "start" : "end", opacity: 0.6 })
    : "";

  /* contrast, measured against the colour the words actually sit on */
  const under = photoBg ? P.bg1 : (align === "right" ? P.bg2 : P.bg1);
  const ratio = contrast(P.ink, under);
  if (ratio < 4.5) warnings.push(`The headline colour is hard to read on this background (contrast ${ratio.toFixed(1)}:1; aim for 4.5:1 or more).`);
  if (photoBg && (d.overlay ?? 0.55) < 0.35) warnings.push("With so little shade over the photo, the words may be hard to read on busy parts of it.");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs.join("")}</defs>
${layers.join("\n")}
${decor}
${frameArt(d.frame, P, W, H)}
${col.svg}
${signoff}
${credit}</svg>`;
  /* The signature is taken before ids are namespaced (which adds a random
     prefix per render), so the same design always has the same signature. */
  return { svg: namespaceIds(svg), sig: signature(svg), warnings: [...new Set(warnings)], W, H };
}

export function signature(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/* ---------- restyling the existing Unison layouts ----------
   The compositions in templates.js are drawn in the house palette. Their
   colours and typeface can be swapped wholesale; their arrangement cannot,
   and the editor says so instead of offering a control that does nothing. */
export const HOUSE = { bg: "#0A0F1A", panel: "#111A2B", acc: "#7C8CFF", acc2: "#39D3C7", ink: "#EEF2F8", mute: "#8B95AB", rule: "#26314A" };
export const HOUSE_FONT = "Inter, Helvetica, Arial, sans-serif";

export function restyleSvg(svg, palette, font) {
  const P = { bg1: HOUSE.bg, accent: HOUSE.acc, ink: HOUSE.ink, soft: HOUSE.mute, ...(palette || {}) };
  const map = {
    [HOUSE.bg]: P.bg1,
    [HOUSE.panel]: mix(P.bg1, P.ink, 0.06),
    [HOUSE.acc]: P.accent,
    [HOUSE.acc2]: P.accent2 || mix(P.accent, P.ink, 0.35),
    [HOUSE.ink]: P.ink,
    [HOUSE.mute]: P.soft,
    [HOUSE.rule]: mix(P.bg1, P.ink, 0.16),
  };
  let out = String(svg);
  for (const [from, to] of Object.entries(map)) if (to && to.toUpperCase() !== from.toUpperCase()) out = out.split(from).join(to);
  const stack = FONTS[font]?.stack;
  if (stack && stack !== FONTS.sans.stack) out = out.split(`font-family="${HOUSE_FONT}"`).join(`font-family="${stack}"`);
  return out;
}

/* ---------- raster ---------- */

/* Rasterise an SVG to a file. The SVG must contain no remote references —
   pictures are always inlined as data URLs — or the canvas would be tainted
   and refuse to export. */
export function rasterize(svg, { width, height, type = "image/png", quality = 0.92 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") { reject(new Error("Rendering needs a browser.")); return; }
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = width; c.height = height;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("The browser could not encode the image."))), type, quality);
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The design could not be drawn.")); };
    img.src = url;
  });
}

/* A picture the user chose, made small enough to keep and to send: the
   longest side at most 1600 px, re-encoded as JPEG. Returns its real size,
   which the crop controls need. */
export function preparePhoto(file, { max = 1600, quality = 0.86 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || "")) { reject(new Error("That file is not an image.")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL("image/jpeg", quality), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image could not be opened.")); };
    img.src = url;
  });
}

export function measureDataUrl(dataUrl) {
  return new Promise((resolve) => {
    if (typeof document === "undefined") { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/* ---------- prompts for AI artwork and footage ----------
   No words, numbers, logos or people's faces are asked for: a generator
   cannot spell, and the words are set by the design. */
export function artPrompt(ctx, style) {
  const mood = {
    traditional: "rich jewel tones, warm lamplight, elegant and dignified",
    corporate: "dark, refined and minimal, a single warm accent of light",
    celebratory: "bright, joyful, saturated colour, festive energy",
    minimal: "light, airy, lots of empty space, soft natural light",
    spotlight: "dark studio backdrop with a soft spotlight, premium and modern",
    announcement: "bold gradient light, modern and energetic",
    features: "clean, light, modern workspace atmosphere",
    figure: "dark and celebratory, soft gold light",
    thanks: "warm, appreciative, soft celebratory light",
  }[style?.id] || "professional and restrained";
  const base = ctx.group === "festival" && ctx.occasion?.scene
    ? ctx.occasion.scene
    : ctx.group === "launch"
      ? `an abstract, premium background suggesting a new product launch${ctx.subject ? ` for ${ctx.subject}` : ""} — light, depth and motion, no product shown`
      : ctx.group === "milestone"
        ? "an abstract celebratory background suggesting achievement — soft light, depth, subtle festive particles"
        : `an abstract professional background suited to: ${String(ctx.topic || "").slice(0, 120)}`;
  const side = style?.defaults?.align === "right" ? "right" : style?.defaults?.align === "center" ? "centre" : "left";
  return `${base}. Mood: ${mood}. Leave clear empty space on the ${side} for text. No text, letters, numbers, logos, watermarks or signage.`;
}

export function footagePrompt(ctx) {
  const base = ctx.group === "festival" && ctx.occasion?.scene
    ? `${ctx.occasion.scene}, gentle camera drift`
    : ctx.group === "launch"
      ? `a slow, cinematic reveal of light and motion suggesting a new product launch${ctx.subject ? ` for ${ctx.subject}` : ""}, no product or screen shown`
      : ctx.group === "milestone"
        ? "slow cinematic shot of warm celebratory light and drifting particles, suggesting an achievement"
        : `slow cinematic abstract shot suited to: ${String(ctx.topic || "").slice(0, 120)}`;
  return `${base}. Professional, calm, suitable for a company LinkedIn page. No text, letters, numbers, logos or watermarks.`;
}
