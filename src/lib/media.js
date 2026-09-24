import { askJSON, askText, JSON_RULE } from "./ai.js";

import { tplPoster, drawScene, renderBrandImage, BRAND_TEXT } from "./brand.js";
import { pollinationsUrl } from "./freeApis.js";

/* The model can return an object, a string or nothing where a list is
   expected. `|| []` does not catch that; this does. */
const arr = (v) => (Array.isArray(v) ? v : []);

/* ============================================================
   MEDIA ENGINE
   The UI calls this. It never talks to a provider directly.
   Real providers plug into imageProvider / videoProvider without
   the engine or the UI changing.
   ============================================================ */

/* ---------- provider: image ----------
   No external image model is configured in this build. The prototype
   renderer draws a real, previewable, downloadable asset from the brief so
   the workflow is complete end to end. It does not pretend to be a model. */

export const SCENE_SECONDS = 2.2;

export const imageProvider = {
  id: "prototype-renderer",
  configured: false,
  label: "Brand renderer (SVG templates) · optional AI photo via Pollinations",
  async generate({ brief, prompt, variant = 0, photo = false, signal }) {
    if (photo) {
      /* Free, keyless image generation. The URL is the asset; the browser
         renders it directly and publishing fetches it into base64 when the
         host allows, else sends the link. */
      const seed = (variant * 7919 + 17) % 100000;
      const url = pollinationsUrl(`${prompt || brief?.headline || brief?.subject || "professional B2B brand imagery"}. Clean, modern, editorial, no text, no logos.`, { width: 1200, height: 630, seed });
      /* No ceiling here would leave the task "generating" for good. */
      await new Promise((resolve, reject) => {
        const im = new Image();
        const timer = setTimeout(() => { im.src = ""; reject(new Error("The image service took too long.")); }, 60000);
        const stop = () => { clearTimeout(timer); signal?.removeEventListener?.("abort", onAbort); };
        const onAbort = () => { im.src = ""; stop(); reject(Object.assign(new Error("Cancelled."), { name: "AbortError" })); };
        im.onload = () => { stop(); resolve(); };
        im.onerror = () => { stop(); reject(new Error("The image service did not return an image.")); };
        signal?.addEventListener?.("abort", onAbort, { once: true });
        im.src = url;
      });
      return { kind: "url", url, width: 1200, height: 630, source: "pollinations", generated: true };
    }
    const svg = renderBrandImage(brief, variant);
    return { kind: "svg", svg, source: this.id, generated: false };
  },
};

/* ---------- provider: video ----------
   Renders the storyboard to a genuine playable WebM in the browser. It is a
   real video file you can play, scrub and download — it is not the output of
   a video model, and the UI says so. */

/* Preference order for the recorder. H.264 in MP4 first: that is the pairing
   LinkedIn's Videos API documents, and what every player handles without
   re-encoding.

   Every MP4 entry names its codec on purpose. Asking for a bare "video/mp4"
   gets a yes from Chromium builds that then record VP9 inside the MP4
   container — a file LinkedIn accepts, spends a minute transcoding and
   rejects as corrupt, while the app cheerfully calls it an MP4. Better to
   fall back to WebM and say so than to hand over an MP4 that isn't one. */
export const VIDEO_MIMES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1.4D401E",
  "video/mp4;codecs=h264",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/* The container, stripped of codec parameters — "video/mp4;codecs=avc1" is a
   recorder instruction, not a media type LinkedIn should be sent. */
export const containerOf = (mime) => (String(mime || "").split(";")[0].trim() || "video/webm");
export const extensionOf = (mime) => (containerOf(mime) === "video/mp4" ? "mp4" : "webm");

/* Two encodes of the same storyboard.

   "full" is what a post published straight away gets. "compact" exists for a
   scheduled post, which has to sit in Make's data store until its time comes
   — and that store holds one megabyte for the whole team, which a 720p encode
   uses several times over. The storyboard is flat colour and type, so a much
   lower bitrate costs very little that anyone can see, and it is the
   difference between being able to schedule a video and not. */
export const VIDEO_PROFILES = {
  full: { width: 1280, height: 720, bitrate: 2_500_000 },
  compact: { width: 854, height: 480, bitrate: 700_000 },
};

/* Recorders treat the bitrate as a ceiling and usually land well under it,
   but "usually" is not good enough when going over means the post cannot be
   queued at all. Given a byte budget and a duration, this is the ceiling that
   keeps the result inside it even if the encoder uses all of it. */
export const bitrateFor = (maxBytes, seconds) =>
  Math.max(120_000, Math.floor((maxBytes * 8) / Math.max(1, seconds)));

export const videoProvider = {
  id: "prototype-renderer",
  configured: false,
  label: "Local storyboard renderer (prototype)",
  supported: () => typeof window !== "undefined" && !!window.MediaRecorder && !!document.createElement("canvas").captureStream,
  async generate({ storyboard, brief, onProgress, profile = "full", maxBytes = 0 }) {
    if (!this.supported()) throw new Error("recorder unavailable");
    const { width: W, height: H, bitrate: cap } = VIDEO_PROFILES[profile] || VIDEO_PROFILES.full;
    const FPS = 30, PER = SCENE_SECONDS;
    const scenes = (storyboard || []).slice(0, 5);
    if (!scenes.length) throw new Error("no scenes");
    const bitrate = maxBytes ? Math.min(cap, bitrateFor(maxBytes, scenes.length * PER)) : cap;

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(FPS);
    /* LinkedIn wants MP4. Recent Chrome can record H.264 in MP4 directly, so
       ask for that first and only fall back to WebM where it cannot — the
       caller is told which one it actually got rather than being promised
       MP4 and handed something else. */
    const mime = VIDEO_MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const done = new Promise((res) => { rec.onstop = res; });

    // paint one frame before recording starts, otherwise the opening frames
    // are captured from a blank canvas and the video begins on black
    drawScene(ctx, W, H, scenes[0], 0, scenes.length, 0, brief);
    await new Promise((r) => requestAnimationFrame(r));

    // a timeslice makes the recorder emit chunks as it goes rather than one
    // blob at the end, which keeps memory flat on longer storyboards
    rec.start(250);

    const total = scenes.length * PER * 1000;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = () => {
        const t = performance.now() - t0;
        if (t >= total) return resolve();
        const i = Math.min(scenes.length - 1, Math.floor(t / (PER * 1000)));
        const local = (t % (PER * 1000)) / (PER * 1000);
        drawScene(ctx, W, H, scenes[i], i, scenes.length, local, brief);
        onProgress?.(t / total);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new Error("empty recording");
    return {
      kind: "video",
      blob,                                   // kept so downloads get real bytes
      url: URL.createObjectURL(blob),
      mime: containerOf(mime),
      profile,
      seconds: Math.round(scenes.length * PER),
      source: this.id,
      generated: false,
      poster: tplPoster(brief?.title || "Video"),
    };
  },
};

/* ---------- the engine ---------- */

export function createMediaEngine({ track, log, onNotice }) {
  const brief = async (kind, ctx, signal) => {
    // the reasoning capability writes the creative brief…
    const r = await askJSON({
      capability: "reasoning",
      system: `You write creative briefs for B2B brand media. ${JSON_RULE}`,
      user: kind === "video"
        ? `Write a video brief for this LinkedIn post.
Post: ${ctx.hook}
${ctx.body || ""}
{"title":"under 8 words","concept":"one line","audience":"one line","style":"one line","motion":"one line","aspect":"16:9","scenes":[{"label":"HOOK|PROBLEM|INSIGHT|PROOF|CTA","line":"under 9 words","note":"under 14 words"}],"avoid":"one line"}
Give 4 scenes.`
        : `Write an image brief for this LinkedIn post.
Post: ${ctx.hook}
${ctx.body || ""}
{"subject":"one line","headline":"under 9 words","message":"one line","audience":"one line","composition":"one line","kicker":"under 3 words","support":"under 10 words","aspect":"1.91:1","avoid":"one line"}`,
      fallback: () => (kind === "video"
        ? { title: ctx.hook?.slice(0, 60) || "Video", concept: "A short explainer built from the post.", audience: "Marketing leaders", style: "Dark, typographic, restrained", motion: "Slow drift between titles", aspect: "16:9", scenes: [{ label: "HOOK", line: ctx.hook || "", note: "" }, { label: "PROBLEM", line: "What actually slows teams down", note: "" }, { label: "INSIGHT", line: "The part nobody automates", note: "" }, { label: "CTA", line: "What would you fix first?", note: "" }], avoid: "stock footage clichés" }
        : { subject: ctx.hook || "", headline: (ctx.hook || "").slice(0, 60), message: "", audience: "Marketing leaders", composition: "Type-led with one geometric motif", kicker: BRAND_TEXT.name, support: BRAND_TEXT.site || BRAND_TEXT.name, aspect: "1.91:1", avoid: "stock photography" }),
      track, onNotice, signal,
    });
    return r;
  };

  /* …then the prompt model turns the brief into a generation prompt. */
  const enhance = async (kind, b, signal) => {
    try {
      const txt = await askText({
        capability: kind === "video" ? "videoPrompt" : "imagePrompt",
        system: "You turn a creative brief into a single detailed generation prompt. Output the prompt only — no preamble, no lists, no quotes. Professional B2B brand imagery only.",
        user: `Brief: ${JSON.stringify(b)}
Write one prompt of 40-70 words describing subject, composition, lighting, palette and mood for a ${kind === "video" ? "short brand video" : "brand image"}. Avoid: ${b.avoid || "clichés"}.`,
        track, onNotice,
        signal,
      });
      return txt.trim().slice(0, 600);
    } catch (e) {
      return `${b.headline || b.title || ""} — ${b.composition || b.style || ""}. Palette: deep navy, periwinkle accent, off-white type. ${b.avoid ? "Avoid " + b.avoid : ""}`.trim();
    }
  };

  return {
    providers: { image: imageProvider, video: videoProvider },

    async image(ctx, { variant = 0, signal, photo = false } = {}) {
      const b = await brief("image", ctx, signal);
      /* The generation prompt is only worth a model call when a generator will use it. */
      const prompt = photo ? await enhance("image", b, signal) : null;
      const asset = await imageProvider.generate({ brief: b, prompt, variant, photo, signal });
      log?.(photo ? "Image generated — Pollinations" : `Image rendered — ${imageProvider.id}`);
      return { ...asset, brief: b, prompt, id: "img-" + Math.random().toString(36).slice(2, 8) };
    },

    /* Building the storyboard is instant. Encoding a file is not, so that only
       happens when the user actually asks to export one. */
    async video(ctx, { signal } = {}) {
      const b = await brief("video", ctx, signal);
      const prompt = null;   // no video generator is connected, so no prompt is written for one
      let storyboard = arr(b.scenes).filter((x) => x && x.line).slice(0, 5);
      if (!storyboard.length) storyboard = [
        { label: "HOOK", line: String(ctx.hook || "").slice(0, 60), note: "" },
        { label: "PROBLEM", line: "What actually slows teams down", note: "" },
        { label: "INSIGHT", line: "The part nobody automates", note: "" },
        { label: "CTA", line: "What would you fix first?", note: "" },
      ];
      log?.(`Storyboard built — ${storyboard.length} scenes`);
      return {
        kind: "storyboard",
        storyboard,
        brief: b,
        prompt,
        poster: tplPoster(b.title || ctx.hook),
        seconds: Math.round(storyboard.length * SCENE_SECONDS),
        source: videoProvider.id,
        generated: false,
      };
    },

    /* Encode the storyboard to a real file. `profile` picks the size — see
       VIDEO_PROFILES for why a scheduled post needs the smaller one. */
    async encodeVideo(asset, { onProgress, profile = "full", maxBytes = 0 } = {}) {
      return videoProvider.generate({ storyboard: asset.storyboard, brief: asset.brief, onProgress, profile, maxBytes });
    },

  };
}
