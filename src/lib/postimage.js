/* ============================================================
   ONE POST, ONE PICTURE

   A post carries a single attachment, and publishing already decides which
   one it is: an attached file (`assets.upload`) if there is one, otherwise
   the first image (`assets.images[0]`). Nothing here changes that rule — it
   is read, never redefined — so the media step can say plainly which
   picture will be posted and every other picture is only a candidate.

   The candidates are:
     - a Unison design from the studio, re-drawn from its settings on demand;
     - the generated picture (Unison's renderer, AI artwork or a photo),
       kept aside when another candidate takes its place so it can be chosen
       again;
     - a file — the user's own upload, or a design brought back from Canva.

   Choosing a candidate makes it the post's picture. It is never added
   beside the previous one.
   ============================================================ */

const svgSrc = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg || "");
const isVideoFile = (up) => String(up?.type || "").startsWith("video");

/** Drawn by the design studio, and so re-drawable from its settings. */
export const isStudioImage = (img) => img?.source === "studio";

/** The picture that publishing would attach right now, described for the UI.
    Mirrors collectMedia: an attached image file wins over images[0]. */
export function currentImage(assets) {
  const up = assets?.upload;
  if (up && !isVideoFile(up)) {
    const canva = assets.canvaDesign && assets.canvaDesign.file === up.name ? assets.canvaDesign : null;
    return {
      kind: canva ? "canva" : "upload",
      src: up.data,
      label: canva ? canva.label || "Canva design" : up.name || "Your image",
      canva, upload: up,
    };
  }
  const img = assets?.images?.[0];
  if (!img) return null;
  const src = img.kind === "url" ? img.url : svgSrc(img.svg);
  if (isStudioImage(img)) return { kind: "design", key: img.designKey, label: img.label || "Unison design", src, image: img };
  return { kind: "generated", src, image: img, label: img.strategy?.label || (img.source === "ai" ? "AI artwork" : "Generated design") };
}

/** The generated picture, whether it is the post's picture now or was set
    aside when something else was chosen. */
export function generatedImage(assets) {
  const img = assets?.images?.[0];
  if (img && !isStudioImage(img)) return img;
  return assets?.generatedImage || null;
}

/** Make a studio design the post's picture. It goes in as images[0], the
    same slot and shape (an SVG) the generated picture already uses, so the
    publishing path that turns it into a PNG is the one that already runs. */
export function designPatch(assets, { key, label, svg, sig }) {
  return {
    images: [{ id: `studio-${key}`, kind: "svg", svg, source: "studio", designKey: key, label, sig }],
    upload: null,
    canvaDesign: null,
    generatedImage: generatedImage(assets),
  };
}

/** Make the generated picture the post's picture again. */
export function generatedPatch(assets) {
  const g = generatedImage(assets);
  if (!g) return null;
  return { images: [g], upload: null, canvaDesign: null };
}

/** Before a file replaces images[0], keep the generated picture so it stays
    one click away. (Attaching a file clears images[]; that is unchanged.) */
export const keepGeneratedPatch = (assets) => ({ generatedImage: generatedImage(assets) });

/** Put back a file that was the post's picture earlier in this session. */
export function filePatch(entry) {
  return { upload: entry.upload, images: [], video: null, canvaDesign: entry.canvaDesign || null };
}

/* ---------- the same rule for a video post ----------
   collectMedia sends an attached video file if there is one, otherwise it
   encodes the storyboard. Attaching a file clears the storyboard, so it is
   set aside first — without the live blob, which does not survive anyway —
   and can be put back. */

export function currentVideo(assets) {
  const up = assets?.upload;
  if (up && isVideoFile(up)) {
    const canva = assets.canvaDesign && assets.canvaDesign.file === up.name ? assets.canvaDesign : null;
    return { kind: canva ? "canva" : "upload", src: up.data, label: canva ? canva.label || "Canva video" : up.name || "Your video", canva, upload: up };
  }
  if (assets?.video?.storyboard?.length) return { kind: "storyboard", video: assets.video, label: "Unison storyboard" };
  return null;
}

export const storyboardOf = (assets) => assets?.video || assets?.generatedVideo || null;

export const keepStoryboardPatch = (assets) => {
  const v = assets?.video;
  return { generatedVideo: v ? { ...v, url: null, blob: null } : assets?.generatedVideo || null };
};

export function storyboardPatch(assets) {
  const v = storyboardOf(assets);
  return v ? { video: v, upload: null, canvaDesign: null } : null;
}

/* ---------- files used earlier, this session only ----------
   An attached file can be large, and the drafts live in this browser's
   small storage, so earlier files are kept in memory rather than saved with
   the post. They are there to undo a choice, not to archive it. */

const RECENT = new Map();      // scope -> [{ id, kind, label, upload, canvaDesign, at }]
const KEEP = 4;

export function rememberFile(scope, { upload, canvaDesign = null }) {
  if (!scope || !upload?.data) return;
  const list = RECENT.get(scope) || [];
  const same = (e) => e.upload.data === upload.data;
  const entry = {
    id: `${upload.name}:${upload.data.length}`,
    kind: canvaDesign ? "canva" : "upload",
    label: canvaDesign ? canvaDesign.label || "Canva design" : upload.name || "Your file",
    upload, canvaDesign, at: Date.now(),
  };
  RECENT.set(scope, [entry, ...list.filter((e) => !same(e))].slice(0, KEEP));
}

export const recentFiles = (scope) => (scope && RECENT.get(scope)) || [];

/** For tests. */
export const forgetRecentFiles = () => RECENT.clear();
