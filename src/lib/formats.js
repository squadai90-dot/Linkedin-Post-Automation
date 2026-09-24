/* ---------- formats ----------
   Each format declares which pipeline stages it needs, so the workspace
   only reveals what is relevant. The engines underneath are unchanged.

   Only what LinkedIn can actually be given from here is listed. Article,
   carousel, multi-image and document were all offered once; none of them
   could be published end to end — LinkedIn has no organic carousel API at
   all, and the binary upload that multi-image and document need cannot be
   signed by the LinkedIn connection this tool publishes through. An option
   that can be chosen and then fails at the last step is worse than no
   option, so they are gone rather than disabled. */

export const FORMATS = [
  { id: "text", label: "Text", hint: "A written post, nothing attached.", stages: ["research", "angle", "draft", "evidence", "health", "approval", "schedule"] },
  { id: "image", label: "Image", hint: "A post with one branded visual.", stages: ["research", "angle", "draft", "media", "evidence", "health", "approval", "schedule"] },
  { id: "video", label: "Video", hint: "A post with a short video.", stages: ["research", "angle", "draft", "media", "evidence", "health", "approval", "schedule"] },
  { id: "poll", label: "Poll", hint: "A written post that carries a poll with up to four options.", stages: ["research", "angle", "draft", "poll", "health", "approval", "schedule"] },
];

export const FORMAT_BY_ID = Object.fromEntries(FORMATS.map((f) => [f.id, f]));

/* ---------- combining formats ----------
   A post is written content plus any number of components. "text" is always
   present. LinkedIn accepts one attachment type per post, so the visual
   formats are mutually exclusive; a poll can sit alongside one of them. */
export const VISUAL_FORMATS = ["image", "video"];
export const STAGE_ORDER = ["research", "angle", "draft", "poll", "media", "evidence", "health", "approval", "schedule"];

export const normalizeFormats = (v) => {
  const list = Array.isArray(v) ? v : [v];
  const out = ["text"];
  list.map(normalizeFormat).forEach((f) => { if (f !== "text" && !out.includes(f)) out.push(f); });
  return out;
};
export const toggleFormat = (list, id) => {
  if (id === "text") return list;
  if (list.includes(id)) return list.filter((f) => f !== id);
  const next = VISUAL_FORMATS.includes(id) ? list.filter((f) => !VISUAL_FORMATS.includes(f)) : list;
  return [...next, id];
};
export const stagesFor = (formats) => {
  const set = new Set();
  normalizeFormats(formats).forEach((f) => FORMAT_BY_ID[f].stages.forEach((s) => set.add(s)));
  return STAGE_ORDER.filter((s) => set.has(s));
};
export const visualOf = (formats) => normalizeFormats(formats).find((f) => VISUAL_FORMATS.includes(f)) || null;
export const labelFor = (formats) => {
  const list = normalizeFormats(formats);
  return list.length === 1 ? "Text" : list.filter((f) => f !== "text").map((f) => FORMAT_BY_ID[f].label).join(" + ");
};
/* The composite the rest of the app treats as "the format". */
export const composeFormat = (formats) => ({ id: normalizeFormats(formats).join("+"), label: labelFor(formats), stages: stagesFor(formats), list: normalizeFormats(formats) });

/* Older sessions and the recommendation engine used display labels rather
   than ids, and sessions saved before the format list was cut down may name
   a format that no longer exists. Everything resolves to something that can
   actually be published: a document or a carousel becomes plain text, a
   multi-image set becomes the single image it always had. */
export const LEGACY_FORMAT = {
  "text": "text", "image + text": "image", "image": "image", "video + text": "video", "video": "video",
  "multi-image": "image", "multi": "image", "poll": "poll",
  "document + text": "text", "document": "text", "article": "text", "carousel": "text",
};
export const normalizeFormat = (v) => FORMAT_BY_ID[v] ? v : (LEGACY_FORMAT[String(v || "").trim().toLowerCase()] || "text");

export const STAGE_LABEL = {
  research: "Research", angle: "Angle", draft: "Draft",
  media: "Media", poll: "Poll",
  evidence: "Evidence", health: "Health", approval: "Approval", schedule: "Publish",
};

export const EMPTY_ASSETS = { images: [], video: null, poll: null, upload: null, uploadDropped: null, sourceDoc: null, imageDesign: null };
/* What survives a reload. Object URLs and Blobs do not, so the video keeps
   only its storyboard — publishing re-encodes it from that. An uploaded
   image is already downscaled, so it is kept unless it is large; when it has
   to be dropped, `uploadDropped` records that so the UI can say so instead
   of silently regenerating something else. */
export const MAX_PERSISTED_UPLOAD = 700 * 1024;
export const compactAssets = (a) => {
  const keepUpload = a.upload && !String(a.upload.type || "").startsWith("video") && String(a.upload.data || "").length <= MAX_PERSISTED_UPLOAD;
  return {
    ...a,
    upload: keepUpload ? a.upload : null,
    uploadDropped: a.upload && !keepUpload ? { name: a.upload.name, type: a.upload.type } : (a.uploadDropped || null),
    video: a.video ? { ...a.video, url: null, blob: null } : null,
    /* A chosen photograph is already inlined in the rendered SVG. Keeping a
       second base64 copy here would double the biggest thing in the session
       for no gain — the web address is enough to fetch it again. */
    imageDesign: a.imageDesign
      ? { ...a.imageDesign, photo: a.imageDesign.photo ? { ...a.imageDesign.photo, dataUrl: null } : null }
      : null,
  };
};

/* every generation task reports one of four states, never a silent failure */
export const idle = () => ({ status: "idle", error: null, progress: 0 });
