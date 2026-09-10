/* Uploaded images are re-encoded before they are kept in state: a 6 MB phone
   photo would otherwise be persisted as base64 and blow the localStorage
   quota, silently stopping every save after it. 1600px on the long side is
   more than LinkedIn shows. */

export const dataUrlBytes = (u) => {
  const i = String(u || "").indexOf(",");
  if (i < 0) return 0;
  const b64 = u.length - i - 1;
  return Math.floor(b64 * 3 / 4);
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("image decode failed"));
  img.src = src;
});

export async function downscaleImage(dataUrl, { maxSide = 1600, quality = 0.86, maxBytes = 450 * 1024 } = {}) {
  if (typeof document === "undefined") return dataUrl;
  const mime = /^data:([^;]+)/.exec(dataUrl || "")?.[1] || "";
  if (!mime.startsWith("image/") || mime === "image/svg+xml") return dataUrl;
  if (mime === "image/gif") return dataUrl; // keep animation; usually small
  let img;
  try { img = await loadImage(dataUrl); } catch { return dataUrl; }
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  if (scale === 1 && dataUrlBytes(dataUrl) <= maxBytes) return dataUrl;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  c.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  // PNG keeps transparency; anything else becomes JPEG, which is what LinkedIn serves anyway
  const outType = mime === "image/png" ? "image/png" : "image/jpeg";
  let out = c.toDataURL(outType, quality);
  if (outType === "image/png" && dataUrlBytes(out) > maxBytes) out = c.toDataURL("image/jpeg", quality);
  let q = quality;
  while (dataUrlBytes(out) > maxBytes && q > 0.5) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
  return out;
}

export const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error("read failed"));
  r.readAsDataURL(file);
});
