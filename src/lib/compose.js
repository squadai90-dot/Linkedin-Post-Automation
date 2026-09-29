/* ============================================================
   COMPOSITING

   AI artwork carries the picture; this carries the words.

   No diffusion model can be trusted to spell a greeting or place a decimal
   point, and a company page cannot publish a graphic that is subtly wrong.
   So the model is asked for artwork with no text in it at all, and the exact
   approved words are drawn over it here, in the brand's own type, at a size
   that is legible on a phone.

   It runs on a canvas in the browser, which means it is free, instant, and
   the output is a real PNG the existing publishing path already accepts —
   nothing downstream of this changes.
   ============================================================ */

import { BRAND, FONT, wrapText } from "./brand.js";

export const W = 1200, H = 630;

/* Where the type sits. The prompt asks the model to leave the left third
   clear, but a model is not a layout engine, so a scrim guarantees contrast
   whatever comes back. */
export const LAYOUTS = {
  left: { id: "left", label: "Text left", x: 72, width: 560, align: "left" },
  bottom: { id: "bottom", label: "Text across the bottom", x: 72, width: W - 144, align: "left" },
  centre: { id: "centre", label: "Centred", x: W / 2, width: 820, align: "center" },
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const im = new Image();
  /* crossOrigin is only meaningful for a remote URL, and setting it on a
     data: or blob: URL makes the browser refuse to load it — which broke
     every piece of generated artwork, since that is exactly how it arrives. */
  if (/^https?:/i.test(String(src))) im.crossOrigin = "anonymous";
  im.onload = () => resolve(im);
  im.onerror = () => reject(new Error("The artwork could not be read."));
  im.src = src;
});

/* Cover-fit, so the artwork fills the frame without distorting. */
function drawCover(ctx, im) {
  const s = Math.max(W / im.width, H / im.height);
  const w = im.width * s, h = im.height * s;
  ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
}

function scrim(ctx, layout) {
  if (layout.id === "left") {
    const g = ctx.createLinearGradient(0, 0, W * 0.72, 0);
    g.addColorStop(0, "rgba(6,10,18,0.92)");
    g.addColorStop(0.55, "rgba(6,10,18,0.72)");
    g.addColorStop(1, "rgba(6,10,18,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const g = ctx.createLinearGradient(0, H * 0.25, 0, H);
  g.addColorStop(0, "rgba(6,10,18,0)");
  g.addColorStop(0.45, "rgba(6,10,18,0.62)");
  g.addColorStop(1, "rgba(6,10,18,0.94)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* Step the size down until the headline fits the column it was given, rather
   than clipping it or letting it run off the frame. */
function fitHeadline(ctx, text, width, { max = 62, min = 34, maxLines = 4 } = {}) {
  let size = max;
  for (; size >= min; size -= 2) {
    ctx.font = `700 ${size}px ${FONT}`;
    const chars = Math.max(12, Math.floor(width / (size * 0.52)));
    const lines = wrapText(text, chars);
    if (lines.length <= maxLines) return { lines, size };
  }
  ctx.font = `700 ${min}px ${FONT}`;
  const chars = Math.max(12, Math.floor(width / (min * 0.52)));
  return { lines: wrapText(text, chars).slice(0, maxLines), size: min };
}

/* Draw the exact words over the artwork. `fields` are already approved — this
   never shortens, rewrites or invents any of them.

   The bottom band is reserved: the footer rule, the company line and the
   source sit there and nothing else may enter it. Without that reservation
   the source line drew straight through the footer whenever the headline ran
   long, which looked like a rendering fault on an otherwise finished
   graphic. */
const FOOTER_BAND = 132;          // everything below H - this belongs to the footer

export function paint(ctx, fields = {}, layoutId = "left") {
  const layout = LAYOUTS[layoutId] || LAYOUTS.left;
  scrim(ctx, layout);
  ctx.textAlign = layout.align;
  ctx.textBaseline = "alphabetic";

  const floor = H - FOOTER_BAND;
  const hasKicker = !!fields.kicker;
  const hasSource = !!fields.source;

  /* Fit the headline to the room actually left once the kicker, the support
     and the reserved band have taken theirs. */
  let lines, size, supportLines;
  for (let maxLines = 4; maxLines >= 2; maxLines--) {
    ({ lines, size } = fitHeadline(ctx, String(fields.headline || ""), layout.width, { maxLines }));
    supportLines = fields.support
      ? wrapText(String(fields.support), Math.floor(layout.width / 11)).slice(0, 2) : [];
    const h = (hasKicker ? 46 : 0) + lines.length * (size + 10) + (supportLines.length ? 18 + supportLines.length * 30 : 0);
    const top = layout.id === "bottom" ? floor - h : Math.round((H - h) / 2);
    if (top >= (hasKicker ? 78 : 56) && top + h <= floor) break;
  }

  const blockH = (hasKicker ? 46 : 0) + lines.length * (size + 10) + (supportLines.length ? 18 + supportLines.length * 30 : 0);
  let top = layout.id === "bottom" ? floor - blockH : Math.round((H - blockH) / 2);
  top = Math.max(top, (hasKicker ? 78 : 56));
  top = Math.min(top, Math.max((hasKicker ? 78 : 56), floor - blockH));

  let y = top + (hasKicker ? 46 : 0) + size;

  if (hasKicker) {
    ctx.fillStyle = BRAND.acc2;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(String(fields.kicker).toUpperCase().slice(0, 40), layout.x, top + 24);
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 ${size}px ${FONT}`;
  lines.forEach((l, i) => ctx.fillText(l, layout.x, y + i * (size + 10)));
  y += (lines.length - 1) * (size + 10);

  if (supportLines.length) {
    ctx.fillStyle = "rgba(255,255,255,0.84)";
    ctx.font = `400 24px ${FONT}`;
    supportLines.forEach((l, i) => ctx.fillText(l, layout.x, y + 52 + i * 30));
  }

  /* A figure on a graphic travels without the post when someone screenshots
     it, so its source goes on the graphic too — inside the reserved band,
     above the footer rule, never across it. */
  if (hasSource) {
    ctx.fillStyle = BRAND.acc2;
    ctx.font = `500 17px ${FONT}`;
    ctx.fillText(`Source: ${String(fields.source).slice(0, 44)}`, layout.x, H - 104);
  }

  if (fields.footer) {
    ctx.fillStyle = BRAND.acc;
    ctx.fillRect(layout.align === "center" ? layout.x - 21 : layout.x, H - 84, 42, 3);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `500 20px ${FONT}`;
    ctx.fillText(String(fields.footer).slice(0, 48), layout.x, H - 50);
  }
  ctx.textAlign = "left";
}

/* artwork (a data URL or an object URL) + approved words -> one PNG data URL.
   Throws rather than returning artwork with no words on it, because a
   half-composited graphic looks finished and is not. */
export async function composite({ artwork, fields = {}, layout = "left", type = "image/png" } = {}) {
  if (!artwork) throw new Error("No artwork to compose onto.");
  const im = await loadImage(artwork);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  drawCover(ctx, im);
  paint(ctx, fields, layout);
  return cv.toDataURL(type);
}

/* A still frame from artwork, used as the poster for a generated video and
   as the starting image for image-to-video providers. */
export async function posterFrom(artwork, fields, layout = "bottom") {
  return composite({ artwork, fields, layout });
}
