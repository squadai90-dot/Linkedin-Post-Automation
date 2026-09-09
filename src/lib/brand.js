/* ---------- branded media templates ----------
   Generative SVG is good for a one-off hero image but unreliable for anything
   that has to look consistent. So the model supplies the words and these
   deterministic templates draw them — same palette, same grid, every time. */

export const BRAND = { bg: "#0A0F1A", panel: "#111A2B", acc: "#7C8CFF", acc2: "#39D3C7", ink: "#EEF2F8", mute: "#8B95AB", rule: "#26314A" };
export const FONT = 'Inter, Helvetica, Arial, sans-serif';

/* The company name and site stamped on every rendered asset. App keeps this in
   sync with the workspace profile so templates never carry a placeholder. */
export const BRAND_TEXT = { name: "", site: "" };
export function setBrandText({ name, site } = {}) {
  BRAND_TEXT.name = String(name || "").trim();
  BRAND_TEXT.site = String(site || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}
const brandName = () => BRAND_TEXT.name || "";
const brandSite = () => BRAND_TEXT.site || BRAND_TEXT.name || "";

/* Escape LAST. Uppercasing an escaped string turns &amp; into &AMP;, which is
   not a valid XML entity and makes the whole SVG fail to parse. */
export const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function wrapText(str, max) {
  const words = String(str || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function tplCard(kicker, title, footer) {
  const lines = wrapText(title, 26).slice(0, 4);
  const fs = lines.length > 3 ? 58 : lines.length > 2 ? 66 : 74;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
<circle cx="1090" cy="70" r="240" fill="${BRAND.acc}" opacity="0.10"/>
<circle cx="150" cy="600" r="180" fill="${BRAND.acc2}" opacity="0.07"/>
<text x="80" y="98" fill="${BRAND.acc2}" font-family="${FONT}" font-size="21" letter-spacing="5">${esc(String(kicker).toUpperCase())}</text>
<rect x="80" y="120" width="72" height="5" fill="${BRAND.acc}"/>
${lines.map((l, i) => `<text x="80" y="${222 + i * (fs + 14)}" fill="${BRAND.ink}" font-family="${FONT}" font-size="${fs}" font-weight="700">${esc(l)}</text>`).join("")}
<rect x="80" y="524" width="1040" height="1" fill="${BRAND.rule}"/>
<text x="80" y="572" fill="${BRAND.mute}" font-family="${FONT}" font-size="20" letter-spacing="4">${esc(String(footer).toUpperCase())}</text>
</svg>`;
}

export function tplPage(n, total, heading, body) {
  const h = wrapText(heading, 22).slice(0, 3);
  const b = wrapText(body, 40).slice(0, 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">
<rect width="1200" height="1200" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="1200" height="10" fill="${BRAND.acc}" opacity="0.9"/>
<text x="90" y="150" fill="${BRAND.acc2}" font-family="${FONT}" font-size="24" letter-spacing="5">${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>
${h.map((l, i) => `<text x="90" y="${330 + i * 96}" fill="${BRAND.ink}" font-family="${FONT}" font-size="82" font-weight="700">${esc(l)}</text>`).join("")}
<rect x="90" y="${360 + h.length * 96}" width="90" height="5" fill="${BRAND.acc}"/>
${b.map((l, i) => `<text x="90" y="${450 + h.length * 96 + i * 54}" fill="${BRAND.mute}" font-family="${FONT}" font-size="38">${esc(l)}</text>`).join("")}
${Array.from({ length: total }).map((_, i) => `<rect x="${90 + i * 34}" y="1070" width="24" height="6" rx="3" fill="${i < n ? BRAND.acc : BRAND.rule}"/>`).join("")}
<text x="1110" y="1080" text-anchor="end" fill="${BRAND.mute}" font-family="${FONT}" font-size="22" letter-spacing="4">${esc(brandName().toUpperCase())}</text>
</svg>`;
}

export function tplTile(label, stat) {
  const l = wrapText(label, 20).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">
<rect width="1200" height="1200" fill="${BRAND.bg}"/>
<circle cx="1050" cy="1140" r="260" fill="${BRAND.acc}" opacity="0.09"/>
<text x="90" y="480" fill="${BRAND.acc}" font-family="${FONT}" font-size="190" font-weight="700">${esc(stat)}</text>
<rect x="90" y="540" width="110" height="6" fill="${BRAND.acc2}"/>
${l.map((x, i) => `<text x="90" y="${650 + i * 68}" fill="${BRAND.ink}" font-family="${FONT}" font-size="52" font-weight="500">${esc(x)}</text>`).join("")}
<text x="90" y="1110" fill="${BRAND.mute}" font-family="${FONT}" font-size="24" letter-spacing="4">${esc(brandName().toUpperCase())}</text>
</svg>`;
}

export function tplPoster(title) {
  const lines = wrapText(title, 30).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
<circle cx="600" cy="240" r="300" fill="${BRAND.acc}" opacity="0.08"/>
<circle cx="600" cy="250" r="74" fill="none" stroke="${BRAND.acc}" stroke-width="5"/>
<path d="M580 218 L630 250 L580 282 Z" fill="${BRAND.acc}"/>
${lines.map((l, i) => `<text x="600" y="${406 + i * 52}" text-anchor="middle" fill="${BRAND.ink}" font-family="${FONT}" font-size="44" font-weight="600">${esc(l)}</text>`).join("")}
<text x="600" y="572" text-anchor="middle" fill="${BRAND.mute}" font-family="${FONT}" font-size="20" letter-spacing="4">${esc(brandName().toUpperCase())}</text>
</svg>`;
}

/* freeform SVG from the model gets cut off the same way JSON does */
export function repairSVG(raw) {
  const t = String(raw || "").replace(/```svg/gi, "").replace(/```/g, "").trim();
  const i = t.indexOf("<svg");
  if (i === -1) return null;
  const j = t.lastIndexOf("</svg>");
  if (j > i) return t.slice(i, j + 6);
  const body = t.slice(i);
  const lastClose = body.lastIndexOf(">");
  if (lastClose < 4) return null;
  return body.slice(0, lastClose + 1) + "</svg>";
}

export function drawScene(ctx, W, H, scene, i, total, t, brief) {
  const ease = t < 0.12 ? t / 0.12 : t > 0.88 ? (1 - t) / 0.12 : 1;
  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, W, H);

  // slow drift so it reads as motion rather than a slideshow
  const drift = (t - 0.5) * 40;
  const g = ctx.createRadialGradient(W * 0.78 + drift, H * 0.2, 40, W * 0.78 + drift, H * 0.2, 620);
  g.addColorStop(0, "rgba(124,140,255,0.30)");
  g.addColorStop(1, "rgba(124,140,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = ease;
  ctx.fillStyle = BRAND.acc2;
  ctx.font = "500 22px Inter, Helvetica, Arial, sans-serif";
  ctx.fillText(String(scene.label || `SCENE ${i + 1}`).toUpperCase(), 90, 120);
  ctx.fillStyle = BRAND.acc;
  ctx.fillRect(90, 140, 64, 5);

  ctx.fillStyle = BRAND.ink;
  ctx.font = "700 62px Inter, Helvetica, Arial, sans-serif";
  wrapText(scene.line || "", 28).slice(0, 4).forEach((l, k) => ctx.fillText(l, 90 + drift * 0.25, 300 + k * 76));

  if (scene.note) {
    ctx.fillStyle = BRAND.mute;
    ctx.font = "400 28px Inter, Helvetica, Arial, sans-serif";
    wrapText(scene.note, 52).slice(0, 2).forEach((l, k) => ctx.fillText(l, 90, 560 + k * 40));
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = BRAND.rule;
  ctx.fillRect(90, H - 60, W - 180, 3);
  ctx.fillStyle = BRAND.acc;
  ctx.fillRect(90, H - 60, (W - 180) * ((i + t) / total), 3);
  ctx.fillStyle = BRAND.mute;
  ctx.font = "500 20px Inter, Helvetica, Arial, sans-serif";
  ctx.fillText(brandName().toUpperCase(), 90, H - 90);
}

/* ---------- image layouts ----------
   Four compositions, picked by variant, so regenerating visibly changes the
   result instead of returning the same card. */

export function renderBrandImage(brief, variant = 0) {
  const b = brief || {};
  const title = b.headline || b.subject || brandName() || "Untitled";
  const kicker = b.kicker || brandName();
  const support = b.support || "";
  const v = ((variant % 4) + 4) % 4;

  if (v === 1) {
    const lines = wrapText(title, 20).slice(0, 4);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="470" height="630" fill="${BRAND.panel}"/>
<circle cx="470" cy="315" r="150" fill="none" stroke="${BRAND.acc}" stroke-width="4" opacity="0.55"/>
<circle cx="470" cy="315" r="230" fill="none" stroke="${BRAND.acc2}" stroke-width="2" opacity="0.35"/>
<text x="90" y="120" fill="${BRAND.acc2}" font-family="${FONT}" font-size="20" letter-spacing="5">${esc(String(kicker).toUpperCase())}</text>
${lines.map((l, i) => `<text x="90" y="${300 + i * 62}" fill="${BRAND.ink}" font-family="${FONT}" font-size="54" font-weight="700">${esc(l)}</text>`).join("")}
<text x="640" y="560" fill="${BRAND.mute}" font-family="${FONT}" font-size="22">${esc(wrapText(support, 44)[0] || "")}</text>
</svg>`;
  }
  if (v === 2) {
    const lines = wrapText(title, 24).slice(0, 3);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
${Array.from({ length: 14 }).map((_, i) => `<rect x="${60 + i * 80}" y="${430 - (i % 5) * 46}" width="34" height="${120 + (i % 5) * 46}" fill="${i % 5 === 3 ? BRAND.acc : BRAND.panel}" opacity="${i % 5 === 3 ? 0.95 : 0.7}"/>`).join("")}
<rect x="0" y="0" width="1200" height="330" fill="${BRAND.bg}" opacity="0.88"/>
<text x="80" y="96" fill="${BRAND.acc2}" font-family="${FONT}" font-size="20" letter-spacing="5">${esc(String(kicker).toUpperCase())}</text>
${lines.map((l, i) => `<text x="80" y="${186 + i * 66}" fill="${BRAND.ink}" font-family="${FONT}" font-size="58" font-weight="700">${esc(l)}</text>`).join("")}
</svg>`;
  }
  if (v === 3) {
    const lines = wrapText(title, 22).slice(0, 3);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
<path d="M0 630 L420 180 L760 420 L1200 60 L1200 630 Z" fill="${BRAND.panel}" opacity="0.85"/>
<path d="M0 630 L420 180 L760 420 L1200 60" fill="none" stroke="${BRAND.acc}" stroke-width="5"/>
<circle cx="760" cy="420" r="14" fill="${BRAND.acc2}"/>
<text x="80" y="100" fill="${BRAND.acc2}" font-family="${FONT}" font-size="20" letter-spacing="5">${esc(String(kicker).toUpperCase())}</text>
${lines.map((l, i) => `<text x="80" y="${200 + i * 64}" fill="${BRAND.ink}" font-family="${FONT}" font-size="56" font-weight="700">${esc(l)}</text>`).join("")}
</svg>`;
  }
  return tplCard(kicker, title, support || brandSite());
}

/* ---------- rasterise so assets are LinkedIn-uploadable ---------- */

export function svgToPng(svg, w = 1200, h = 630) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = BRAND.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("raster failed")); };
    img.src = url;
  });
}

export function downloadBlob(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = typeof data === "string" && data.startsWith("data:") ? data : URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  if (!a.href.startsWith("data:")) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
