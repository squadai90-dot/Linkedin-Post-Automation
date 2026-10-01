/* ============================================================
   MEDIA CHECKS

   A file is an image or a video because its bytes say so and the browser can
   decode it — not because a provider said a job succeeded. Everything that
   brings a finished file into Unison (Canva exports, AI clips, AI artwork)
   goes through here before it can be previewed or approved.
   ============================================================ */

export async function sniffBlob(blob) {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const s = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0x89 && s(1, 4) === "PNG") return { kind: "png", mime: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "jpg", mime: "image/jpeg" };
  if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return { kind: "webp", mime: "image/webp" };
  if (s(4, 8) === "ftyp") return { kind: "mp4", mime: "video/mp4" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: "webm", mime: "video/webm" };
  if (s(0, 3) === "GIF") return { kind: "gif", mime: "image/gif" };
  return null;
}

export const isVideoKind = (kind) => kind === "mp4" || kind === "webm";

/* The real properties of the file, read by the browser from the file itself. */
export function measureMedia(url, isVideo) {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const el = document.createElement(isVideo ? "video" : "img");
    const t = setTimeout(() => resolve(null), 20000);
    const done = () => {
      clearTimeout(t);
      resolve(isVideo
        ? (el.videoWidth ? { width: el.videoWidth, height: el.videoHeight, duration: Number.isFinite(el.duration) ? el.duration : null } : null)
        : (el.naturalWidth ? { width: el.naturalWidth, height: el.naturalHeight } : null));
    };
    el.onloadedmetadata = done; el.onload = done; el.onerror = () => { clearTimeout(t); resolve(null); };
    if (isVideo) { el.preload = "metadata"; el.muted = true; }
    el.src = url;
  });
}

export class MediaError extends Error {
  constructor(message, code) { super(message); this.code = code || "bad_file"; }
}

/* Signature, then decode, then (for video) a real duration. Resolves to a
   typed Blob plus an object URL the caller owns, or throws a MediaError that
   says what was wrong. `expect` is "image", "video", or a specific kind. */
export async function validateMedia(blob, { expect, label = "file" } = {}) {
  if (!blob || !blob.size) throw new MediaError(`The ${label} is empty.`, "empty");
  const kind = await sniffBlob(blob);
  if (!kind) throw new MediaError(`The ${label} is not an image or a video this app can use.`, "bad_file");
  const video = isVideoKind(kind.kind);
  if (expect === "video" && !video) throw new MediaError(`A video was expected, but the ${label} is a ${kind.kind.toUpperCase()} image.`, "wrong_type");
  if (expect === "image" && video) throw new MediaError(`An image was expected, but the ${label} is a video.`, "wrong_type");
  if (expect && expect !== "image" && expect !== "video" && expect !== kind.kind && !(expect === "jpeg" && kind.kind === "jpg")) {
    throw new MediaError(`A ${expect.toUpperCase()} was expected, but the ${label} is a ${kind.kind.toUpperCase()}.`, "wrong_type");
  }
  const typed = blob.type === kind.mime ? blob : new Blob([blob], { type: kind.mime });
  const url = URL.createObjectURL(typed);
  const props = await measureMedia(url, video);
  if (!props) { URL.revokeObjectURL(url); throw new MediaError(`This browser could not decode the ${label}, so it was not offered for approval.`, "undecodable"); }
  if (video && !(props.duration > 0)) { URL.revokeObjectURL(url); throw new MediaError(`The ${label} has no playable duration.`, "undecodable"); }
  return { blob: typed, url, mime: kind.mime, format: kind.kind, bytes: typed.size, video, ...props };
}
