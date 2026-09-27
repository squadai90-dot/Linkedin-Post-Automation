/* ============================================================
   VIDEO SCENES

   Every scene used to be drawn the same way: a label, a headline, an
   optional note, a drifting gradient and a progress bar. Five of those in a
   row is a slideshow with a fade, whatever the post said.

   A scene now has a KIND, chosen from what that scene is carrying, and each
   kind draws the thing it is about — a figure counts up, a set of steps
   arrives in order with the connector drawing between them, a comparison
   slides its two sides in, a timeline draws its own line. All of it is
   canvas 2D in the browser, so it costs nothing, renders offline and the
   words are always exactly right, which no video model can promise.

   The same function draws the preview and the exported file, so what the
   user approves is what gets encoded.
   ============================================================ */

import { BRAND, FONT, wrapText } from "./brand.js";
import { findStats } from "./intel.js";

const FAMILY = FONT;
const brandName = () => (typeof window !== "undefined" ? "" : "");

/* ---------- easing ---------- */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x) => (clamp01(x) < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * clamp01(x) + 2, 3) / 2);
/* A scene fades in, holds, fades out. `t` is 0..1 across the whole scene. */
const envelope = (t) => (t < 0.12 ? t / 0.12 : t > 0.9 ? (1 - t) / 0.1 : 1);
/* Stagger: the nth of `count` items, given scene progress. */
const stagger = (t, i, count, start = 0.15, span = 0.5) =>
  easeOut((clamp01(t) - start - (i / Math.max(count, 1)) * span) / 0.28);

/* ---------- shared furniture ---------- */

function background(ctx, W, H, t) {
  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, W, H);
  const drift = (t - 0.5) * 36;
  const g = ctx.createRadialGradient(W * 0.78 + drift, H * 0.18, 40, W * 0.78 + drift, H * 0.18, 640);
  g.addColorStop(0, "rgba(124,140,255,0.26)");
  g.addColorStop(1, "rgba(124,140,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function chrome(ctx, W, H, scene, i, total, t, name) {
  ctx.globalAlpha = envelope(t);
  ctx.fillStyle = BRAND.acc2;
  ctx.font = `600 22px ${FAMILY}`;
  ctx.fillText(String(scene.label || `SCENE ${i + 1}`).toUpperCase(), 90, 118);
  ctx.fillStyle = BRAND.acc;
  ctx.fillRect(90, 138, 64 * easeOut(t / 0.3), 5);
  ctx.globalAlpha = 1;

  ctx.fillStyle = BRAND.rule;
  ctx.fillRect(90, H - 60, W - 180, 3);
  ctx.fillStyle = BRAND.acc;
  ctx.fillRect(90, H - 60, (W - 180) * ((i + clamp01(t)) / total), 3);
  if (name) {
    ctx.fillStyle = BRAND.mute;
    ctx.font = `500 20px ${FAMILY}`;
    ctx.fillText(String(name).toUpperCase(), 90, H - 90);
  }
}

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/* A figure counted up to its own value, keeping whatever suffix it carried
   ("9 days", "38%", "£50,000") so the units never get lost in the animation. */
export function countUp(text, p) {
  const m = String(text).match(/^([^\d]*)([\d][\d,.]*)(.*)$/);
  if (!m) return String(text);
  const [, pre, num, post] = m;
  const decimals = (num.split(".")[1] || "").length;
  const target = Number(num.replace(/,/g, ""));
  if (!Number.isFinite(target)) return String(text);
  const now = target * easeOut(p);
  const shown = decimals ? now.toFixed(decimals) : Math.round(now).toLocaleString("en-US");
  return `${pre}${shown}${post}`;
}

/* ---------- the kinds ---------- */

const KINDS = {
  /* The sentence is the scene. Lines arrive one after another. */
  statement(ctx, W, H, scene, t) {
    const lines = wrapText(scene.line || "", 26).slice(0, 4);
    ctx.fillStyle = BRAND.ink;
    ctx.font = `700 ${lines.length > 3 ? 52 : 62}px ${FAMILY}`;
    lines.forEach((l, k) => {
      const a = stagger(t, k, lines.length, 0.05, 0.3);
      ctx.globalAlpha = a * envelope(t);
      ctx.fillText(l, 90 + (1 - a) * 26, 300 + k * (lines.length > 3 ? 64 : 76));
    });
    ctx.globalAlpha = 1;
    note(ctx, W, H, scene, t);
  },

  /* One figure, counted up, with what it measures under it. */
  stat(ctx, W, H, scene, t) {
    const value = scene.data?.value || (findStats(scene.line)[0] || "");
    const label = scene.data?.label || scene.line || "";
    /* The ring sits above the label rather than around it: at r=208 with the
       label at cy+108 the two drew on top of each other. */
    const cx = W * 0.5, cy = H * 0.42, r = 186;

    ctx.strokeStyle = BRAND.acc;
    ctx.globalAlpha = 0.5 * envelope(t);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * easeInOut(t / 0.75));
    ctx.stroke();
    ctx.globalAlpha = envelope(t);

    const shown = countUp(value, t / 0.65);
    ctx.fillStyle = BRAND.ink;
    ctx.font = `700 ${shown.length > 7 ? 104 : 132}px ${FAMILY}`;
    ctx.textAlign = "center";
    ctx.fillText(shown, cx, cy + 34);

    ctx.fillStyle = BRAND.mute;
    ctx.font = `400 26px ${FAMILY}`;
    wrapText(label, 38).slice(0, 2).forEach((l, k) => {
      ctx.globalAlpha = stagger(t, k, 2, 0.45, 0.2) * envelope(t);
      ctx.fillText(l, cx, cy + r + 62 + k * 34);
    });
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  },

  /* Bars grow from zero. Values are drawn as given — never recomputed. */
  bars(ctx, W, H, scene, t) {
    const items = (scene.data?.items || []).slice(0, 4);
    if (!items.length) return KINDS.statement(ctx, W, H, scene, t);
    const max = Math.max(...items.map((x) => Number(x.value) || 0), 1);
    const top = 250, rowH = 74, barX = 380, barW = W - barX - 150;

    heading(ctx, scene, t);
    items.forEach((it, k) => {
      const a = stagger(t, k, items.length, 0.12, 0.45);
      const y = top + k * rowH;
      ctx.globalAlpha = a * envelope(t);
      ctx.fillStyle = BRAND.ink;
      ctx.font = `500 26px ${FAMILY}`;
      ctx.textAlign = "right";
      ctx.fillText(String(it.label).slice(0, 26), barX - 26, y + 30);
      ctx.textAlign = "left";

      ctx.fillStyle = BRAND.rule;
      roundRect(ctx, barX, y + 6, barW, 32, 16); ctx.fill();
      ctx.fillStyle = k === 0 ? BRAND.acc : BRAND.acc2;
      const w = Math.max(6, barW * ((Number(it.value) || 0) / max) * a);
      roundRect(ctx, barX, y + 6, w, 32, 16); ctx.fill();

      ctx.fillStyle = BRAND.ink;
      ctx.font = `700 24px ${FAMILY}`;
      ctx.fillText(String(it.display ?? it.value), barX + w + 16, y + 31);
    });
    ctx.globalAlpha = 1;
  },

  /* Numbered cards arriving in order, with the connector drawing between. */
  steps(ctx, W, H, scene, t) {
    const items = (scene.data?.items || []).slice(0, 4);
    if (!items.length) return KINDS.statement(ctx, W, H, scene, t);
    heading(ctx, scene, t);
    const n = items.length;
    const gap = 26, left = 90, cardW = (W - left * 2 - gap * (n - 1)) / n;
    const top = 280, cardH = 230;

    items.forEach((it, k) => {
      const a = stagger(t, k, n, 0.1, 0.5);
      if (a <= 0) return;
      const x = left + k * (cardW + gap);
      ctx.globalAlpha = a * envelope(t);
      ctx.fillStyle = BRAND.panel;
      roundRect(ctx, x, top + (1 - a) * 18, cardW, cardH, 18); ctx.fill();
      ctx.strokeStyle = BRAND.rule; ctx.lineWidth = 2; ctx.stroke();

      ctx.fillStyle = BRAND.acc;
      ctx.beginPath(); ctx.arc(x + 42, top + 52 + (1 - a) * 18, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BRAND.bg;
      ctx.font = `700 22px ${FAMILY}`;
      ctx.textAlign = "center";
      ctx.fillText(String(k + 1), x + 42, top + 60 + (1 - a) * 18);
      ctx.textAlign = "left";

      ctx.fillStyle = BRAND.ink;
      ctx.font = `400 22px ${FAMILY}`;
      wrapText(String(it), Math.floor(cardW / 11)).slice(0, 5)
        .forEach((l, j) => ctx.fillText(l, x + 24, top + 112 + j * 30 + (1 - a) * 18));

      if (k < n - 1) {
        const ca = clamp01((stagger(t, k + 1, n, 0.1, 0.5)) * 1.4);
        ctx.globalAlpha = ca * envelope(t);
        ctx.strokeStyle = BRAND.acc2; ctx.lineWidth = 3;
        const y = top + cardH / 2, sx = x + cardW + 4;
        ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx + (gap - 8) * ca, y); ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
  },

  /* Two sides, arriving from their own edges. */
  compare(ctx, W, H, scene, t) {
    const d = scene.data || {};
    const L = (d.left || []).slice(0, 4), R = (d.right || []).slice(0, 4);
    if (!L.length || !R.length) return KINDS.statement(ctx, W, H, scene, t);
    heading(ctx, scene, t);
    const panelW = (W - 90 * 2 - 40) / 2, top = 270, panelH = 260;

    const side = (x, title, list, accent, from) => {
      const a = easeOut((t - 0.12) / 0.4);
      ctx.globalAlpha = a * envelope(t);
      ctx.save();
      ctx.translate(from * (1 - a) * 70, 0);
      ctx.fillStyle = BRAND.panel;
      roundRect(ctx, x, top, panelW, panelH, 18); ctx.fill();
      ctx.strokeStyle = accent; ctx.globalAlpha *= 0.55; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = a * envelope(t);
      ctx.fillStyle = accent;
      ctx.font = `700 22px ${FAMILY}`;
      ctx.fillText(String(title).toUpperCase().slice(0, 22), x + 28, top + 48);
      ctx.fillStyle = BRAND.ink;
      ctx.font = `400 24px ${FAMILY}`;
      list.forEach((it, k) => {
        const ia = stagger(t, k, list.length, 0.3, 0.4);
        ctx.globalAlpha = ia * envelope(t);
        wrapText(`— ${it}`, Math.floor(panelW / 12)).slice(0, 2)
          .forEach((l, j) => ctx.fillText(l, x + 28, top + 96 + k * 46 + j * 26));
      });
      ctx.restore();
    };
    side(90, d.leftLabel || "Now", L, BRAND.mute, -1);
    side(90 + panelW + 40, d.rightLabel || "Instead", R, BRAND.acc, 1);
    ctx.globalAlpha = 1;
  },

  /* A line that draws itself, with dated markers appearing on it. */
  timeline(ctx, W, H, scene, t) {
    const items = (scene.data?.items || []).slice(0, 4);
    if (!items.length) return KINDS.statement(ctx, W, H, scene, t);
    heading(ctx, scene, t);
    const y = H * 0.56, x0 = 130, x1 = W - 130;
    const p = easeInOut(clamp01((t - 0.08) / 0.5));

    ctx.globalAlpha = envelope(t);
    ctx.strokeStyle = BRAND.rule; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.strokeStyle = BRAND.acc;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + (x1 - x0) * p, y); ctx.stroke();

    items.forEach((it, k) => {
      const frac = k / Math.max(items.length - 1, 1);
      const x = x0 + (x1 - x0) * frac;
      /* Keyed to the line's progress rather than to its pixel position: at
         p = 1 the leading edge lands exactly on the last marker, so a
         distance-based test left the final date permanently invisible. */
      const a = clamp01((p - frac * 0.9) * 10);
      if (a <= 0) return;
      ctx.globalAlpha = a * envelope(t);
      ctx.fillStyle = BRAND.acc;
      ctx.beginPath(); ctx.arc(x, y, 11 * a, 0, Math.PI * 2); ctx.fill();
      ctx.textAlign = "center";
      ctx.fillStyle = BRAND.acc2;
      ctx.font = `700 24px ${FAMILY}`;
      ctx.fillText(String(it.when || "").slice(0, 18), x, y - 46);
      ctx.fillStyle = BRAND.ink;
      ctx.font = `400 21px ${FAMILY}`;
      wrapText(String(it.what || ""), 20).slice(0, 3).forEach((l, j) => ctx.fillText(l, x, y + 52 + j * 26));
      ctx.textAlign = "left";
    });
    ctx.globalAlpha = 1;
  },

  /* The closing frame: the ask, then the name. */
  cta(ctx, W, H, scene, t) {
    const lines = wrapText(scene.line || "", 24).slice(0, 3);
    ctx.textAlign = "center";
    ctx.fillStyle = BRAND.ink;
    ctx.font = `700 56px ${FAMILY}`;
    lines.forEach((l, k) => {
      const a = stagger(t, k, lines.length, 0.05, 0.3);
      ctx.globalAlpha = a * envelope(t);
      ctx.fillText(l, W / 2, H * 0.44 + k * 68);
    });
    ctx.globalAlpha = envelope(t);
    ctx.fillStyle = BRAND.acc;
    const bw = 200 * easeOut((t - 0.35) / 0.3);
    ctx.fillRect(W / 2 - bw / 2, H * 0.44 + lines.length * 68 + 22, bw, 4);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  },
};

function heading(ctx, scene, t) {
  if (!scene.line) return;
  ctx.globalAlpha = envelope(t);
  ctx.fillStyle = BRAND.ink;
  ctx.font = `700 40px ${FAMILY}`;
  wrapText(scene.line, 40).slice(0, 2).forEach((l, k) => ctx.fillText(l, 90, 206 + k * 46));
  ctx.globalAlpha = 1;
}

function note(ctx, W, H, scene, t) {
  if (!scene.note) return;
  ctx.globalAlpha = stagger(t, 0, 1, 0.4, 0.2) * envelope(t);
  ctx.fillStyle = BRAND.mute;
  ctx.font = `400 28px ${FAMILY}`;
  wrapText(scene.note, 52).slice(0, 2).forEach((l, k) => ctx.fillText(l, 90, 560 + k * 40));
  ctx.globalAlpha = 1;
}

export const SCENE_KINDS = Object.keys(KINDS);

/* Draws one frame. Same entry point the preview and the encoder both use, so
   what is approved is what is encoded. */
export function drawScene(ctx, W, H, scene, i, total, t, brief) {
  const s = scene || {};
  background(ctx, W, H, t);
  const draw = KINDS[s.kind] || KINDS.statement;
  ctx.textBaseline = "alphabetic";
  draw(ctx, W, H, s, clamp01(t));
  chrome(ctx, W, H, s, i, total, t, brief?.brand || brandName());
}
