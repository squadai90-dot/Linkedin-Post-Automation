import { askJSON, askText, JSON_RULE } from "./ai.js";

import { tplPage, tplTile, tplPoster, drawScene, renderBrandImage, BRAND_TEXT } from "./brand.js";
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

export const videoProvider = {
  id: "prototype-renderer",
  configured: false,
  label: "Local storyboard renderer (prototype)",
  supported: () => typeof window !== "undefined" && !!window.MediaRecorder && !!document.createElement("canvas").captureStream,
  async generate({ storyboard, brief, onProgress }) {
    if (!this.supported()) throw new Error("recorder unavailable");
    const W = 1280, H = 720, FPS = 30, PER = SCENE_SECONDS;
    const scenes = (storyboard || []).slice(0, 5);
    if (!scenes.length) throw new Error("no scenes");

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(FPS);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
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
      mime,
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

    async imageSet(ctx, { count = 3, signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You plan branded image sets for LinkedIn. ${JSON_RULE}`,
        user: `Turn this post into ${count} image tiles that read as one set.
Post: ${ctx.hook} ${ctx.body || ""}
{"tiles":[{"stat":"a number or short figure, under 6 characters","label":"under 8 words"}]}`,
        fallback: () => ({ tiles: [{ stat: "01", label: "The problem" }, { stat: "02", label: "What changed" }, { stat: "03", label: "What to do" }] }),
        track, onNotice, signal,
      });
      let tiles = arr(r.tiles).filter((t) => t && (t.label || t.stat)).slice(0, count);
      if (!tiles.length) tiles = [{ stat: "01", label: "The problem" }, { stat: "02", label: "What changed" }, { stat: "03", label: "What to do" }].slice(0, count);
      log?.(`Image set rendered — ${tiles.length} tiles`);
      return tiles.map((t, i) => ({
        kind: "svg", svg: tplTile(t.label, t.stat), source: imageProvider.id, generated: false,
        meta: t, id: "tile-" + i + "-" + Math.random().toString(36).slice(2, 6),
      }));
    },

    async retile(tile, ctx, { signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You rewrite one tile in a branded image set. ${JSON_RULE}`,
        user: `Post: ${ctx.hook}
Rewrite this single tile so it says something different but still fits the set. Current: ${JSON.stringify(tile.meta || {})}
{"stat":"under 6 characters","label":"under 8 words"}`,
        fallback: () => ({ stat: tile.meta?.stat || "02", label: "A different angle on the same point" }),
        track, onNotice, signal,
      });
      return { ...tile, svg: tplTile(r.label, r.stat), meta: r, id: tile.id };
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

    /* Encode the storyboard to a real WebM. Only called on export. */
    async encodeVideo(asset, { onProgress } = {}) {
      return videoProvider.generate({ storyboard: asset.storyboard, brief: asset.brief, onProgress });
    },

    async document(ctx, { pages = 5, signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You structure branded LinkedIn documents. ${JSON_RULE}`,
        user: `Break this into a ${pages}-page document. Page 1 is the cover, the last page is the takeaway.
Topic: ${ctx.hook}
${ctx.body || ""}
{"title":"under 8 words","pages":[{"heading":"under 6 words","body":"under 20 words"}]}`,
        fallback: () => ({
          title: ctx.hook?.slice(0, 50) || "Document",
          pages: [
            { heading: ctx.hook?.slice(0, 40) || "Overview", body: "" },
            { heading: "The problem", body: "What slows teams down today." },
            { heading: "What changed", body: "The shift worth paying attention to." },
            { heading: "What to do", body: "One concrete step you can take." },
            { heading: "The takeaway", body: "What this means for your team." },
          ],
        }),
        track, onNotice, signal,
      });
      let pgs = arr(r.pages).filter((x) => x && x.heading).slice(0, 8);
      if (!pgs.length) pgs = [
        { heading: String(ctx.hook || "Overview").slice(0, 40), body: "" },
        { heading: "The problem", body: "What slows teams down today." },
        { heading: "What changed", body: "The shift worth paying attention to." },
        { heading: "What to do", body: "One concrete step you can take." },
        { heading: "The takeaway", body: "What this means for your team." },
      ];
      log?.(`Document rendered — ${pgs.length} pages`);
      return { title: r.title || ctx.hook, pages: pgs.map((pg, i) => ({ ...pg, svg: tplPage(i + 1, pgs.length, pg.heading, pg.body), id: "pg-" + i + "-" + Math.random().toString(36).slice(2, 6) })) };
    },

    async carousel(ctx, { slides = 6, signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You structure visual carousels. ${JSON_RULE}`,
        user: `Turn this into a ${slides}-slide carousel story.
Topic: ${ctx.hook}
${ctx.body || ""}
Use this arc: hook, problem, insight, framework, example, conclusion.
{"slides":[{"role":"Hook|Problem|Insight|Framework|Example|Conclusion","heading":"under 6 words","body":"under 18 words"}]}`,
        fallback: () => ({
          slides: [
            { role: "Hook", heading: ctx.hook?.slice(0, 40) || "Start here", body: "" },
            { role: "Problem", heading: "Where it breaks", body: "The step everyone skips." },
            { role: "Insight", heading: "What actually matters", body: "The part that changes the outcome." },
            { role: "Framework", heading: "How to think about it", body: "Three moves, in order." },
            { role: "Example", heading: "In practice", body: "What this looked like for one team." },
            { role: "Conclusion", heading: "The takeaway", body: "What to do on Monday." },
          ],
        }),
        track, onNotice, signal,
      });
      let sl = arr(r.slides).filter((x) => x && x.heading).slice(0, 10);
      if (!sl.length) sl = [
        { role: "Hook", heading: String(ctx.hook || "Start here").slice(0, 40), body: "" },
        { role: "Problem", heading: "Where it breaks", body: "The step everyone skips." },
        { role: "Insight", heading: "What actually matters", body: "The part that changes the outcome." },
        { role: "Framework", heading: "How to think about it", body: "Three moves, in order." },
        { role: "Example", heading: "In practice", body: "What one team did." },
        { role: "Conclusion", heading: "The takeaway", body: "What to do on Monday." },
      ];
      log?.(`Carousel rendered — ${sl.length} slides`);
      return sl.map((s, i) => ({ ...s, svg: tplPage(i + 1, sl.length, s.heading, s.body), id: "sl-" + i + "-" + Math.random().toString(36).slice(2, 6) }));
    },

    async reslide(slide, index, total, ctx, { signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You rewrite one carousel slide. ${JSON_RULE}`,
        user: `Post topic: ${ctx.hook}
Rewrite only this slide (${slide.role}), keeping its job in the story but changing the wording.
Current: ${JSON.stringify({ heading: slide.heading, body: slide.body })}
{"heading":"under 6 words","body":"under 18 words"}`,
        fallback: () => ({ heading: slide.heading, body: slide.body }),
        track, onNotice, signal,
      });
      return { ...slide, ...r, svg: tplPage(index + 1, total, r.heading, r.body) };
    },

    /* renumber after a reorder / delete so page badges stay correct */
    renumber(items) {
      return items.map((it, i) => ({ ...it, svg: tplPage(i + 1, items.length, it.heading, it.body) }));
    },
  };
}
