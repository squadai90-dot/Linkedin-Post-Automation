import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  connectionState, onCanvaChange, canvaStatus, refreshConnection, listTemplates, templateFields, fillTemplate,
  exportDesign, exportFormats, listDesigns, createDesign, uploadBlob, uploadFromUrl, UPLOAD_CEILING,
  rememberEdit, pendingEdit, forgetEdit, editUrlWithReturn, onReturn,
} from "../lib/canva.js";
import { suggestTemplates, mapFields } from "../lib/canvamatch.js";
import { visualFields } from "../lib/visual.js";
import { FIELDS as LAYOUT_FIELDS, TEMPLATE_BY_ID, OCCASION_ART, renderTemplate } from "../lib/templates.js";
import { classify } from "../lib/intel.js";
import {
  CANVASES, FONTS, studioContext, autoText, stylesFor, designFor, renderDesign, restyleSvg, rasterize,
  preparePhoto, measureDataUrl, artPrompt, footagePrompt, isHex, mix, HOUSE, signature,
} from "../lib/designer.js";
import { generateArtwork, generateClip, videoCapabilities } from "../lib/aigen.js";
import { downloadBlob } from "../lib/brand.js";
import {
  currentImage, currentVideo, generatedImage, isStudioImage, designPatch, generatedPatch, keepGeneratedPatch,
  keepStoryboardPatch, filePatch, rememberFile, recentFiles,
} from "../lib/postimage.js";

/* ============================================================
   THE POST'S PICTURE (and the studio behind it)

   A post has one picture, and this panel is built around it:

   1. The picture that will be posted, large, with what it is and where it
      came from. Every action below acts on that one picture.
   2. Designs to choose from — Unison's own, the generated picture, your
      Canva brand templates when Canva returns any, and files you have
      used. Choosing one makes it the post's picture; it is never stacked
      beside the old one.
   3. Quick edits that change the picture itself, opened when asked for.
   4. Canva for deep edits, with the way back: the edited design is
      exported from Canva as it stands — never re-filled over the top — and
      becomes the post's picture.

   Which picture is posted is publishing's rule, not this panel's: an
   attached file, otherwise images[0] (see lib/postimage.js). Designs are
   written into exactly those two places, in the shapes publishing already
   sends.

   For a video post the same studio makes the opening frame, the Canva
   video and AI footage; the video itself is shown by VideoPanel.
   ============================================================ */

const NOUN = { image: "image", video: "video" };

/* Words that every Unison design can carry. */
const TEXT_FIELDS = [
  { k: "kicker", label: "Eyebrow", max: 32, hint: "A few words above the headline — leave empty for none" },
  { k: "headline", label: "Headline", max: 90, hint: "The line people read while scrolling" },
  { k: "message", label: "Supporting line", max: 170, multiline: true, hint: "One or two sentences" },
  { k: "items", label: "Points", multiline: true, hint: "One per line", when: (d) => d.showItems },
  { k: "stat", label: "Big number", max: 12, hint: "As your post states it", when: (d) => d.layout === "figure" },
  { k: "statLabel", label: "What it counts", max: 26, when: (d) => d.layout === "figure" },
  { k: "cta", label: "Button", max: 48, hint: "Leave empty for no button", when: (d, ctx, text) => ctx.group === "launch" || !!text.cta },
  { k: "signoff", label: "Sign-off", max: 60, hint: "Usually your company name" },
];

/* The existing layouts call two of these fields by other names. */
const SHARED = { support: "message", footer: "signoff" };

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const PHOTO_KEEP = 450 * 1024;
const ORIGIN = {
  unison: "made from a Unison design", upload: "made from your image", blank: "blank design",
  autofill: "filled from your template", existing: "chosen from your designs", "ai-footage": "made for your AI footage",
};

export function DesignStudio({
  postType = "image", draft, profile = {}, assets, patchAssets, attachUpload, notify, topic = "", intent, gen, workId,
  generatedTools = null, generatedEditor = null, generatedNote = null, imageTask = null, onGenerate = null,
}) {
  const saved = assets?.designStudio?.[postType] || {};
  const canvas = CANVASES[postType] || CANVASES.image;
  const isImage = postType === "image";
  const scope = `${workId || "w"}:${postType}`;
  /* Async work finishes after renders have moved on; it reads the post as it
     is then, not as it was when the work started. */
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  /* ---------- Canva connection ---------- */
  const [conn, setConn] = useState(connectionState());
  const [info, setInfo] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [tplState, setTplState] = useState("idle");
  const [tplError, setTplError] = useState("");

  useEffect(() => {
    let alive = true;
    canvaStatus().then((i) => { if (!alive) return; setInfo(i); if (i?.present) refreshConnection(); });
    const off = onCanvaChange(setConn);
    return () => { alive = false; off(); };
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!conn.connected) { setTemplates([]); setTplState("idle"); return; }
    setTplState("loading"); setTplError("");
    try { const r = await listTemplates({}); setTemplates(r.items); setTplState("ready"); }
    catch (e) { setTemplates([]); setTplState("error"); setTplError(e.message); }
  }, [conn.connected]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  /* ---------- what the post is ---------- */
  const ctx = useMemo(() => studioContext({ intent, topic, draft, profile }),
    [intent?.kind, intent?.occasion?.id, intent?.greeting, topic, draft?.hook, draft?.body, profile?.company, profile?.website]);
  const auto = useMemo(() => autoText(ctx, draft || {}), [ctx, draft?.hook, draft?.body, draft?.cta]);
  const styles = useMemo(() => stylesFor(ctx), [ctx]);
  const cls = useMemo(() => classify({ hook: draft?.hook, body: draft?.body, cta: draft?.cta, topic }), [draft?.hook, draft?.body, draft?.cta, topic]);
  const content = useMemo(() => ({ hook: draft?.hook || "", body: draft?.body || "", cta: draft?.cta || "", topic }), [draft?.hook, draft?.body, draft?.cta, topic]);
  const brand = useMemo(() => ({ name: profile?.company || "", site: profile?.website || "" }), [profile?.company, profile?.website]);
  const vf = useMemo(() => visualFields(cls, content, { brand }), [cls, content, brand]);

  const { suggestions } = useMemo(() => suggestTemplates({
    cls, content, postType, templates, canvaConnected: conn.connected, brand, limit: 6,
  }), [cls, content, postType, templates, conn.connected, brand]);

  /* ---------- the post's picture, as publishing would send it ---------- */
  const cur = isImage ? currentImage(assets) : currentVideo(assets);

  /* ---------- the user's work, kept per post ---------- */
  const [optionKey, setOptionKey] = useState(cur?.kind === "design" ? cur.key : saved.optionKey || null);
  const [edits, setEdits] = useState(saved.edits || {});
  const [tweaks, setTweaks] = useState(saved.tweaks || {});
  const [photo, setPhoto] = useState(saved.photo || null);
  const [canvaRef, setCanvaRef] = useState(saved.canva || null);
  const [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(false);

  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  /* The last file brought in from Canva or a model. It is attached as soon
     as it arrives; this keeps what the panel needs to describe it, and the
     clip itself for "Send to Canva to add titles". */
  const [output, setOutput] = useState(null);
  const [editLink, setEditLink] = useState("");
  const abort = useRef(null);
  const [cancellable, setCancellable] = useState(false);

  /* Saved with the post, so leaving the Media step, switching angle or
     reloading does not lose an edit. A large picture is not stored — the
     session lives in this browser's storage, which is small — and the editor
     says so if it is missing after a reload. */
  useEffect(() => {
    const t = setTimeout(() => {
      const keepPhoto = photo && photo.dataUrl && photo.dataUrl.length > PHOTO_KEEP ? { ...photo, dataUrl: null, dropped: true } : photo;
      patchAssets?.({ designStudio: { ...(assetsRef.current?.designStudio || {}), [postType]: { optionKey, edits, tweaks, photo: keepPhoto, canva: canvaRef } } });
    }, 350);
    return () => clearTimeout(t);
  }, [optionKey, edits, tweaks, photo, canvaRef]);

  /* Files used for this post stay one click away for the rest of the
     session, wherever they came from. */
  const [, setFilesSeen] = useState(0);
  useEffect(() => {
    const up = assets?.upload;
    if (!up?.data || String(up.type || "").startsWith("video") !== !isImage) return;
    rememberFile(scope, { upload: up, canvaDesign: assets.canvaDesign && assets.canvaDesign.file === up.name ? assets.canvaDesign : null });
    setFilesSeen((n) => n + 1);
  }, [assets?.upload, assets?.canvaDesign]);

  /* ---------- the options ---------- */
  const canvaOptions = suggestions.filter((s) => s.source === "canva").map((s) => ({ key: `canva:${s.templateId}`, kind: "canva", label: s.label, why: s.why, family: s.family, s }));
  const styleOptions = styles.map((st) => ({ key: `style:${st.id}`, kind: "style", label: st.label, why: st.why, style: st }));
  const layoutOptions = ctx.group === "general"
    ? suggestions.filter((s) => s.source === "unison" && !s.photo && TEMPLATE_BY_ID[s.template]).slice(0, 2)
      .map((s) => ({ key: `layout:${s.template}`, kind: "layout", label: s.label, why: s.why, template: s.template }))
    : [];
  const options = [...canvaOptions, ...styleOptions, ...layoutOptions];
  const option = options.find((o) => o.key === optionKey) || styleOptions[0] || options[0] || null;
  const tweak = (option && tweaks[option.key]) || {};
  const text = useMemo(() => ({ ...auto, ...edits }), [auto, edits]);

  const designOf = (opt) => designFor(opt.style, { text, tweak: tweaks[opt.key] || {}, photo: photo?.dataUrl ? photo : null });
  const layoutFieldsOf = (template) => {
    const t = TEMPLATE_BY_ID[template];
    if (!t) return {};
    return Object.fromEntries(t.fields.map((k) => {
      const shared = SHARED[k] || k;
      const v = edits[shared] ?? (k === "headline" ? text.headline : k === "kicker" && edits.kicker != null ? edits.kicker : vf[k]);
      return [k, v ?? ""];
    }));
  };
  const renderOption = (opt) => {
    if (opt.kind === "style") return renderDesign(designOf(opt), postType);
    if (opt.kind === "layout") {
      const tw = tweaks[opt.key] || {};
      const fields = layoutFieldsOf(opt.template);
      return {
        svg: restyleSvg(renderTemplate(opt.template, fields, null), tw.palette, tw.font),
        sig: signature(JSON.stringify([opt.template, fields, tw.palette || null, tw.font || null])),
        warnings: [],
      };
    }
    return null;
  };

  const current = option && option.kind !== "canva" ? renderOption(option) : null;
  const currentSig = current ? current.sig : 0;

  /* A design that is the post's picture follows its edits. The picture is
     the design, so an edit cannot leave an older version attached. Skipped
     when the user's photo could not be kept after a reload: re-drawing then
     would quietly drop it from the picture that is attached. */
  const liveImg = assets?.images?.[0];
  useEffect(() => {
    if (!isImage || !current || !option || option.kind === "canva") return;
    if (photo?.dropped && !photo.dataUrl) return;
    const ok = (a) => { const i = a?.images?.[0]; return !a?.upload && isStudioImage(i) && i.designKey === option.key && i.sig !== current.sig; };
    if (!ok(assetsRef.current)) return;
    const t = setTimeout(() => {
      if (!ok(assetsRef.current)) return;
      patchAssets({ images: [{ ...assetsRef.current.images[0], svg: current.svg, sig: current.sig, label: option.label }] });
    }, 120);
    return () => clearTimeout(t);
  }, [isImage, option?.key, currentSig, liveImg?.sig, liveImg?.designKey, !!assets?.upload]);

  /* ---------- editing ---------- */
  const snapshot = () => setHistory((h) => [...h.slice(-39), { edits, tweaks, photo }]);
  const undo = () => setHistory((h) => {
    if (!h.length) return h;
    const last = h[h.length - 1];
    setEdits(last.edits); setTweaks(last.tweaks); setPhoto(last.photo);
    return h.slice(0, -1);
  });
  const setText = (k, v) => setEdits((e) => ({ ...e, [k]: v }));
  const resetText = (k) => { snapshot(); setEdits((e) => { const n = { ...e }; delete n[k]; return n; }); };
  const setTweak = (patch) => {
    if (!option) return;
    snapshot();
    setTweaks((t) => {
      const cur = t[option.key] || {};
      return { ...t, [option.key]: { ...cur, ...patch, ...(patch.palette ? { palette: { ...(cur.palette || {}), ...patch.palette } } : {}) } };
    });
  };
  const setPhotoPatch = (patch) => { snapshot(); setPhoto((p) => (p ? { ...p, ...patch } : p)); };
  const resetDesign = () => {
    if (!option) return;
    snapshot();
    setTweaks((t) => { const n = { ...t }; delete n[option.key]; return n; });
  };
  const resetAllText = () => { snapshot(); setEdits({}); };

  /* Choosing a design is the decision: for an image post it becomes the
     post's picture at once. A Canva brand template has to be filled first,
     so choosing one opens its fields instead. */
  const choose = (opt) => {
    setOptionKey(opt.key); setError(""); setNote("");
    if (!isImage || opt.kind === "canva") return;
    const r = renderOption(opt);
    if (!r) return;
    const was = currentImage(assetsRef.current);
    patchAssets(designPatch(assetsRef.current, { key: opt.key, label: opt.label, svg: r.svg, sig: r.sig }));
    if (was && (was.kind === "upload" || was.kind === "canva")) {
      notify?.(`${opt.label} is now the post image. ${was.kind === "canva" ? "Your Canva version" : "Your file"} is still under “Choose a design” if you want it back.`, { tone: "ok", ms: 6000 });
    }
  };
  const chooseGenerated = () => {
    setError(""); setNote("");
    const patch = generatedPatch(assetsRef.current);
    if (patch) patchAssets(patch);
  };
  const chooseFile = (entry) => {
    setError(""); setNote("");
    patchAssets({ ...(isImage ? keepGeneratedPatch(assetsRef.current) : keepStoryboardPatch(assetsRef.current)), ...filePatch(entry) });
  };

  /* ---------- long-running work ---------- */
  const run = async (label, fn) => {
    const ctl = new AbortController();
    abort.current = ctl; setCancellable(true);
    setPhase(label); setError(""); setNote("");
    try { return await fn(ctl.signal); }
    catch (e) { if (e?.name !== "AbortError") setError(e?.message || "That did not work."); return null; }
    finally { setPhase(""); abort.current = null; setCancellable(false); }
  };
  const onState = ({ state }) => state && setPhase(state);

  /* A picture for the design: your own, or AI artwork. Either is labelled. */
  const fileRef = useRef(null);
  const upRef = useRef(null);
  const pickPhoto = async (file) => {
    if (!file) return;
    try {
      const p = await preparePhoto(file);
      snapshot();
      setPhoto({ ...p, zoom: 1, x: 50, y: 50, credit: "", source: "upload", name: file.name });
      if (option?.kind === "style" && (tweaks[option.key]?.layout || option.style.defaults.layout) !== "spotlight") setTweaks((t) => ({ ...t, [option.key]: { ...(t[option.key] || {}), background: "photo" } }));
    } catch (e) { setError(e.message); }
  };
  const imageCaps = gen?.image;
  const makeArt = () => run("art", async (signal) => {
    const st = option?.kind === "style" ? option.style : styles[0];
    const art = await generateArtwork({ prompt: artPrompt(ctx, st), shape: "wide", signal });
    const size = await measureDataUrl(art.dataUrl);
    snapshot();
    setPhoto({ dataUrl: art.dataUrl, w: size?.w || 0, h: size?.h || 0, zoom: 1, x: 50, y: 50, credit: "", source: "ai", provider: art.provider, model: art.model, usd: art.usd });
    if (option?.kind === "style" && (tweaks[option.key]?.layout || option.style.defaults.layout) !== "spotlight") setTweaks((t) => ({ ...t, [option.key]: { ...(t[option.key] || {}), background: "photo" } }));
  });

  /* ---------- files ---------- */
  const [w0, h0] = canvas.px;
  const pngOf = async (svg) => rasterize(svg, { width: w0, height: h0, type: "image/png" });
  const slug = (s) => String(s || "design").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  /* A file from Canva or a model becomes the post's picture (or video) as
     soon as it arrives — through attachUpload, the same door an upload
     uses, so publishing sends it exactly as it sends an upload. What it
     replaces is set aside first so it can be chosen again. */
  const canvaRefRef = useRef(canvaRef);
  canvaRefRef.current = canvaRef;
  const attachFile = async (out) => {
    setPhase("attaching");
    const ext = out.format === "jpg" ? "jpg" : out.format || String(out.mime || "").split("/")[1] || "bin";
    const name = `${out.source === "ai" ? "ai-footage" : "canva-design"}-${Date.now()}.${ext}`;
    const file = new File([out.blob], name, { type: out.mime });
    patchAssets(isImage ? keepGeneratedPatch(assetsRef.current) : keepStoryboardPatch(assetsRef.current));
    await attachUpload(file);
    patchAssets({
      canvaDesign: out.source === "canva" ? {
        source: "canva", label: out.title || "Canva design", family: out.origin || "", designId: out.designId || null,
        editUrl: canvaRefRef.current?.editUrl || null, file: name, at: new Date().toISOString(),
      } : null,
    });
    setOutput((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return { ...out, url: null, name }; });
  };
  const attachRef = useRef(attachFile);
  attachRef.current = attachFile;

  /* ---------- Canva: deep edit and the way back ---------- */
  const canvaReady = !!info?.present && conn.connected;
  const canvaWhy = !info ? "Checking whether Canva is available…"
    : !info.present ? "Canva needs this app's backend, which is not deployed here."
    : !info?.configured ? "Canva is not set up on this deployment yet — see Settings → AI."
      : !conn.connected ? "Connect Canva under Settings → AI first." : "";

  const openEditor = (ref, win) => {
    const state = rememberEdit({ designId: ref.designId, editUrl: ref.editUrl, title: ref.title, origin: ref.origin, workId, postType });
    const url = editUrlWithReturn(ref.editUrl, state);
    setEditLink(url);
    setCanvaRef((c) => (c && c.designId === ref.designId ? { ...c, opened: true } : c));
    if (win && !win.closed) { try { win.location.href = url; return; } catch { /* fall through */ } }
    const w = window.open(url, "_blank", "noopener");
    if (!w) setNote("Your browser blocked the new tab. Use the “open in Canva” link below.");
  };
  const placeholderTab = () => {
    const w = window.open("", "_blank");
    if (w) {
      try { w.opener = null; w.document.title = "Opening Canva…"; w.document.body.innerHTML = '<p style="font:16px system-ui,sans-serif;padding:32px;color:#333">Preparing your design for Canva…</p>'; } catch { /* cross-origin already */ }
    }
    return w;
  };

  /* Sends a picture to Canva as the first layer of a new design of the
     post's size, then opens Canva's editor on it. Works on every Canva plan. */
  const sendToCanva = async (makeBlob, { name, title, origin, from }) => {
    const win = placeholderTab();
    const ok = await run("uploading", async (signal) => {
      const blob = await makeBlob();
      const assetId = await uploadBlob(blob, { name, signal, onState });
      setPhase("creating");
      const d = await createDesign({ assetId, width: w0, height: h0, title, signal });
      if (!d?.id || !d?.editUrl) throw new Error("Canva created the design but did not return a link to edit it.");
      const ref = { designId: d.id, editUrl: d.editUrl, title: d.title, origin, from, opened: true, at: new Date().toISOString() };
      setCanvaRef(ref);
      openEditor(ref, win);
      return true;
    });
    if (!ok && win && !win.closed) win.close();
  };
  const svgBlob = async (svg) => {
    let blob = await pngOf(svg);
    if (blob.size > UPLOAD_CEILING) blob = await rasterize(svg, { width: w0, height: h0, type: "image/jpeg", quality: 0.9 });
    return blob;
  };
  const headline = (text.headline || option?.label || "post").slice(0, 80);
  /* Edit in Canva always means "this picture": the one that will be posted
     (or, for a video, the opening frame chosen below). */
  const editInCanva = () => {
    if (!isImage) {
      if (!current) return;
      return sendToCanva(() => svgBlob(current.svg), { name: `Unison ${option.label}`, title: `Unison · ${headline}`, origin: "unison", from: option.label });
    }
    const c = currentImage(assetsRef.current);
    if (!c) return;
    if (c.kind === "canva" && canvaRef?.editUrl && canvaRef.designId === c.canva.designId) return openEditor(canvaRef);
    if (c.kind === "upload" || c.kind === "canva") {
      return sendToCanva(() => fetch(c.src).then((r) => r.blob()), { name: c.label, title: `Unison · ${headline}`, origin: "upload", from: c.label });
    }
    if (c.image?.kind === "url") return;
    return sendToCanva(() => svgBlob(c.image.svg), { name: `Unison ${c.label}`, title: `Unison · ${headline}`, origin: "unison", from: c.label });
  };
  const blankInCanva = async () => {
    const win = placeholderTab();
    const ok = await run("creating", async (signal) => {
      const d = await createDesign({ width: w0, height: h0, title: `Unison · ${(text.headline || "post").slice(0, 80)}`, signal });
      if (!d?.id || !d?.editUrl) throw new Error("Canva created the design but did not return a link to edit it.");
      const ref = { designId: d.id, editUrl: d.editUrl, title: d.title, origin: "blank", opened: true, at: new Date().toISOString() };
      setCanvaRef(ref);
      openEditor(ref, win);
      return true;
    });
    if (!ok && win && !win.closed) win.close();
  };

  /* Export the design as it stands in Canva now, and make it the post's
     picture. Never autofills it again, so nothing done in Canva's editor is
     overwritten. */
  const bringBack = useCallback((designId, { title, origin } = {}) => run("exporting", async (signal) => {
    if (!designId) throw new Error("There is no Canva design to bring back yet.");
    const video = postType === "video";
    if (video) {
      const formats = await exportFormats(designId, { signal }).catch(() => null);
      if (formats && !formats.includes("mp4")) throw new Error("Canva says this design cannot be exported as an MP4 video. Open it in Canva and make sure it is a video design, then try again.");
    }
    const out = await exportDesign({ designId, format: video ? "mp4" : "png", quality: video ? "horizontal_720p" : undefined, signal, onState });
    await attachRef.current({ ...out, source: "canva", designId, title, origin, video, label: `From Canva — ${title || "your design"}, exported as it stands in Canva now` });
    notify?.(video ? "Your Canva video is now the post's video." : "Your Canva design is now the post image.", { tone: "ok" });
  }), [postType]);

  useEffect(() => onReturn((state) => {
    const p = pendingEdit(state);
    if (!p || p.workId !== workId || p.postType !== postType) return;
    forgetEdit(state);
    setCanvaRef((c) => ({ ...(c || {}), designId: p.designId, editUrl: p.editUrl, title: p.title, origin: p.origin, opened: true }));
    notify?.("Back from Canva — fetching your edited design.", { tone: "ok" });
    bringBack(p.designId, { title: p.title, origin: p.origin });
  }), [workId, postType, bringBack]);

  /* ---------- the account's own designs ---------- */
  const [picker, setPicker] = useState(null);       // null | { query, items, state, error }
  const searchDesigns = async (query = picker?.query || "") => {
    setPicker({ query, items: picker?.items || [], state: "loading", error: "" });
    try { const r = await listDesigns({ query: query || undefined }); setPicker({ query, items: r.items, state: "ready", error: "" }); }
    catch (e) { setPicker({ query, items: [], state: "error", error: e.message }); }
  };
  const pickDesign = (d) => {
    setPicker(null);
    setCanvaRef({ designId: d.id, editUrl: d.editUrl, title: d.title, origin: "existing", at: new Date().toISOString() });
    bringBack(d.id, { title: d.title, origin: "existing" });
  };

  /* ---------- Canva brand templates (Autofill) ---------- */
  const [tpl, setTpl] = useState({ id: null, fields: [], values: {}, unfilled: [], uploads: {} });
  useEffect(() => {
    if (option?.kind !== "canva" || tpl.id === option.s.templateId) return;
    let alive = true;
    (async () => {
      setPhase("fields"); setError("");
      try {
        const f = await templateFields(option.s.templateId);
        const offer = { ...vf, headline: text.headline, support: text.message, kicker: text.kicker || vf.kicker, footer: text.signoff || vf.footer, greeting: ctx.greeting || vf.greeting, items: text.items || vf.items };
        const { values, unmatched } = mapFields(f, offer);
        if (!alive) return;
        setTpl({ id: option.s.templateId, fields: f, values, unfilled: unmatched.map((x) => x.name), uploads: {} });
        if (!f.length) setError("Canva reports that this template has no fields set up for Autofill. Open it in Canva, mark its text and image elements as fields, then refresh — or choose another option.");
      } catch (e) { if (alive) { setTpl({ id: option.s.templateId, fields: [], values: {}, unfilled: [], uploads: {} }); setError(e.message); } }
      finally { if (alive) setPhase(""); }
    })();
    return () => { alive = false; };
  }, [option?.key]);

  const fillCanva = async () => {
    if (canvaRef?.origin === "autofill" && canvaRef.templateId === option.s.templateId && canvaRef.opened
      && !window.confirm("Filling the template again makes a NEW Canva design from these fields. What you changed in Canva stays in the earlier design. Continue?")) return;
    await run("filling", async (signal) => {
      const d = await fillTemplate({ templateId: option.s.templateId, fields: tpl.fields, values: tpl.values, title: `Unison · ${(text.headline || "post").slice(0, 60)}`, signal, onState });
      const ref = { designId: d.id, editUrl: d.editUrl, title: d.title, origin: "autofill", templateId: option.s.templateId, from: option.label, at: new Date().toISOString() };
      setCanvaRef(ref);
      const video = postType === "video";
      const out = await exportDesign({ designId: d.id, format: video ? "mp4" : "png", quality: video ? "horizontal_720p" : undefined, signal, onState });
      await attachFile({ ...out, source: "canva", designId: d.id, title: d.title, origin: option.label, video, label: `From your Canva template “${option.label}”` });
      notify?.(`Filled from “${option.label}” — it is now the post's ${NOUN[postType]}.`, { tone: "ok" });
    });
  };
  const tplImage = (field, file) => file && run("uploading", async (signal) => {
    const assetId = await uploadBlob(file, { name: file.name, signal, onState });
    setTpl((t) => ({ ...t, values: { ...t.values, [field]: assetId }, uploads: { ...t.uploads, [field]: file.name } }));
  });

  /* ---------- AI footage (video posts) ---------- */
  const [vcaps, setVcaps] = useState(null);
  useEffect(() => { if (postType === "video") videoCapabilities().then(setVcaps); }, [postType]);
  const [clipPrompt, setClipPrompt] = useState("");
  const [clipSeconds, setClipSeconds] = useState(8);
  const promptValue = clipPrompt || footagePrompt(ctx);
  const provider = vcaps?.defaultProvider;
  const price = provider ? vcaps?.pricing?.[provider] : null;
  const maxSec = price?.maxSeconds || 8;
  const makeClip = () => run("starting", async (signal) => {
    let imageB64, imageMime;
    if (provider === "runway") {
      /* Runway animates a still. The opening frame is the design itself, so
         the footage and the graphic agree. */
      const frame = current || renderDesign(designFor(styles[0], { text, photo: photo?.dataUrl ? photo : null }), "video");
      const blob = await rasterize(frame.svg, { width: 1280, height: 720, type: "image/jpeg", quality: 0.85 });
      imageB64 = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.onerror = reject; r.readAsDataURL(blob); });
      imageMime = "image/jpeg";
    }
    const clip = await generateClip({ prompt: promptValue, seconds: Math.min(clipSeconds, maxSec), provider, imageB64, imageMime, signal, onState: ({ state }) => setPhase(state === "running" ? "generating" : state) });
    await attachFile({ ...clip, source: "ai", format: "mp4", video: true, label: `AI-generated footage — ${clip.provider}/${clip.model}${clip.usd ? `, about $${clip.usd}` : ""}` });
    notify?.("The AI footage is now the post's video.", { tone: "ok" });
  });
  const clipToCanva = async () => {
    if (!output || output.source !== "ai") return;
    const win = placeholderTab();
    const ok = await run("uploading", async (signal) => {
      if (output.blob.size <= UPLOAD_CEILING) await uploadBlob(output.blob, { name: "Unison AI footage", signal, onState });
      else if (output.sourceUrl) await uploadFromUrl(output.sourceUrl, { name: "Unison AI footage", signal, onState });
      else throw new Error(`This clip is ${kb(output.blob.size)}, above the 4.5 MB a Vercel function accepts, and the provider gave no public address Canva could fetch it from. Download it and drag it into your Canva design instead.`);
      setPhase("creating");
      let assetId;
      if (current) {
        const frame = await rasterize(current.svg, { width: w0, height: h0, type: "image/jpeg", quality: 0.9 });
        assetId = await uploadBlob(frame, { name: "Unison opening frame", signal, onState });
      }
      const d = await createDesign({ assetId, width: w0, height: h0, title: `Unison video · ${(text.headline || "post").slice(0, 70)}`, signal });
      const ref = { designId: d.id, editUrl: d.editUrl, title: d.title, origin: "ai-footage", opened: true, at: new Date().toISOString() };
      setCanvaRef(ref);
      setNote("The clip is now in your Canva Uploads. In the editor, open Uploads and drag it onto the page — Canva's API cannot place a video on the page for you.");
      openEditor(ref, win);
      return true;
    });
    if (!ok && win && !win.closed) win.close();
  };

  /* ---------- presentation ---------- */
  const busy = !!phase;
  const d = option?.kind === "style" ? designOf(option) : null;
  const layoutTpl = option?.kind === "layout" ? TEMPLATE_BY_ID[option.template] : null;
  const palette = d?.palette || { bg1: HOUSE.bg, accent: HOUSE.acc, ink: HOUSE.ink, soft: HOUSE.mute, ...(tweak.palette || {}) };
  const art = OCCASION_ART[ctx.occasion?.id];
  const presets = [
    option?.kind === "style" ? { name: "This style", p: option.style.defaults.palette } : { name: "House", p: { bg1: HOUSE.bg, bg2: "#1B2A5B", accent: HOUSE.acc, ink: HOUSE.ink, soft: HOUSE.mute } },
    ...(art ? [{ name: "Festival", p: { bg1: art.deep, bg2: art.mid, accent: art.warm, ink: "#FFFFFF", soft: "#F3E3C0" } }] : []),
    { name: "Dark", p: { bg1: "#0B1220", bg2: "#17243F", accent: palette.accent, ink: "#F4F6FA", soft: "#AAB4C6" } },
    { name: "Light", p: { bg1: "#FAF7F2", bg2: "#F1ECE3", accent: mix(palette.accent, "#000000", 0.35), ink: "#16181D", soft: "#4E5562" } },
  ];

  /* The picture never waits for Canva: only the Canva controls do. */
  if (!info && !isImage) return <div className="u-muted" style={{ fontSize: 13 }}>Checking what is available…</div>;

  const files = recentFiles(scope);
  const canvaInUse = cur?.kind === "canva" && !!canvaRef?.designId && cur.canva?.designId === canvaRef.designId;
  const fileMeta = output && cur?.upload?.name === output.name ? output : null;

  const quickEdit = (
    <>
      <QuickEdit
        option={option} d={d} ctx={ctx} text={text} auto={auto} edits={edits} vf={vf} layoutTpl={layoutTpl} layoutFieldsOf={layoutFieldsOf}
        setText={setText} resetText={resetText} resetAllText={resetAllText} snapshot={snapshot} setTweak={setTweak}
        palette={palette} presets={presets} tweak={tweak}
        photo={photo} setPhotoPatch={setPhotoPatch} removePhoto={() => { snapshot(); setPhoto(null); }}
        fileRef={fileRef} imageCaps={imageCaps} makeArt={makeArt} busy={busy}
      />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} data-testid="studio-photo-input"
        onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );

  const progress = (
    <>
      {busy && (
        <div className="u-muted" style={{ fontSize: 12.5, marginTop: 12 }} data-testid="studio-busy">
          <span className="pulse" /> {PHASE[phase] || "Working…"}
          {cancellable && <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => abort.current?.abort()}>Cancel</button>}
        </div>
      )}
      {error && <div className="badge bad" style={{ display: "block", marginTop: 12, lineHeight: 1.6 }} data-testid="studio-error">{error}</div>}
      {note && <div className="badge" style={{ display: "block", marginTop: 12, lineHeight: 1.6 }}>{note}</div>}
    </>
  );

  /* Unison design → edited in Canva → brought back → the post's picture.
     Each step says whether it has happened, so the way back is obvious. */
  const canvaStrip = canvaRef?.designId ? (
    <div className="pimg-canva" data-testid="canva-ref">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          <span className="eyebrow">In Canva</span>{" "}
          <b style={{ fontSize: 13.5 }}>{canvaRef.title || canvaRef.designId}</b>
          <span className="u-muted" style={{ fontSize: 12.5 }}> · {ORIGIN[canvaRef.origin] || "Canva design"}{canvaRef.from ? ` (${canvaRef.from})` : ""}</span>
        </div>
      </div>
      <ol className="flow" aria-label="Canva steps">
        <li className="done">{canvaRef.origin === "existing" ? "Chosen in Canva" : "Sent to Canva"}</li>
        <li className={canvaRef.opened || canvaInUse ? "done" : "on"}>Edit it in Canva</li>
        <li className={canvaInUse ? "done" : canvaRef.opened ? "on" : ""}>Bring it back</li>
        <li className={canvaInUse ? "done" : ""}>{canvaInUse ? `It is the post's ${NOUN[postType]}` : `Becomes the post's ${NOUN[postType]}`}</li>
      </ol>
      <div className="row" style={{ marginTop: 10 }}>
        <button className={"btn sm " + (canvaInUse ? "" : "acc")} disabled={busy || !canvaReady} onClick={() => bringBack(canvaRef.designId, { title: canvaRef.title, origin: canvaRef.origin })} data-testid="bring-back">
          {phase === "exporting" ? "Exporting…" : canvaInUse ? "Bring back newer Canva edits" : "Bring back my Canva edits"}
        </button>
        {canvaRef.editUrl && <button className="btn sm" disabled={busy || !canvaReady} onClick={() => openEditor(canvaRef)}>Open in Canva</button>}
      </div>
      <div className="u-muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
        Bringing it back exports the design exactly as it stands in Canva — it never refills it, so nothing you changed there is lost — and makes it the post's {NOUN[postType]}.
        {editLink && <> If no tab opened, <a href={editLink} target="_blank" rel="noreferrer">open in Canva</a>.</>}
        {!canvaReady && <> {canvaWhy}</>}
      </div>
    </div>
  ) : null;

  const designPicker = picker && (
    <div style={{ marginTop: 10 }} data-testid="design-picker">
      <div className="row">
        <input className="ta" style={{ flex: 1, minWidth: 200 }} placeholder="Search your Canva designs" value={picker.query}
          onChange={(e) => setPicker((p) => ({ ...p, query: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && searchDesigns(picker.query)} aria-label="Search your Canva designs" />
        <button className="btn sm" onClick={() => searchDesigns(picker.query)}>Search</button>
        <button className="btn sm ghost" onClick={() => setPicker(null)}>Close</button>
      </div>
      {picker.state === "loading" && <div className="u-muted" style={{ fontSize: 13, marginTop: 8 }}>Loading your designs…</div>}
      {picker.state === "error" && <div className="badge warn" style={{ display: "block", marginTop: 8 }}>{picker.error}</div>}
      {picker.state === "ready" && picker.items.length === 0 && <div className="u-muted" style={{ fontSize: 13, marginTop: 8 }}>No designs found.</div>}
      <div className="tpl-grid" style={{ marginTop: 10 }}>
        {picker.items.map((it) => (
          <button key={it.id} className="tpl" onClick={() => pickDesign(it)}>
            {it.thumbnail ? <span className="tpl-thumb"><img src={it.thumbnail} alt="" style={{ width: "100%", display: "block" }} loading="lazy" /></span>
              : <span className="tpl-thumb" style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center" }}><span className="u-muted" style={{ fontSize: 11.5 }}>No thumbnail</span></span>}
            <span className="tpl-name">{it.title}</span>
            <span className="badge" style={{ alignSelf: "flex-start", fontSize: 10.5 }}>Your Canva design</span>
          </button>
        ))}
      </div>
    </div>
  );

  const templateEditor = option?.kind === "canva" && (
    <div className="pimg-edit" data-testid="canva-template-editor">
      <div style={{ fontWeight: 600 }}>{option.label}</div>
      <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Your Canva brand template · {option.family} · {option.s.shapeNote}</div>
      {tpl.fields.length === 0
        ? <div className="u-muted" style={{ fontSize: 13 }}>{phase === "fields" ? "Asking Canva which fields this template has…" : "This template has no Autofill fields."}</div>
        : (
          <div className="grid2">
            {tpl.fields.map((f) => (
              <div key={f.name} style={{ marginBottom: 12, gridColumn: f.type === "image" ? "1 / -1" : undefined }}>
                <label className="eyebrow" htmlFor={`cv-${f.name}`} style={{ display: "block", marginBottom: 5 }}>{f.name}</label>
                {f.type === "image" ? (
                  <div className="row">
                    <input id={`cv-${f.name}`} type="file" accept="image/*" className="ta" style={{ flex: 1, minWidth: 200 }} disabled={busy}
                      onChange={(e) => { tplImage(f.name, e.target.files?.[0]); e.target.value = ""; }} />
                    {tpl.uploads[f.name] && <span className="badge">{tpl.uploads[f.name]} sent to Canva</span>}
                  </div>
                ) : f.type === "text" ? (
                  <textarea id={`cv-${f.name}`} className="ta" rows={2} value={tpl.values[f.name] || ""} onChange={(e) => setTpl((t) => ({ ...t, values: { ...t.values, [f.name]: e.target.value } }))} />
                ) : (
                  <div className="u-muted" style={{ fontSize: 12.5 }}>Canva reports this as a {f.type} field. Unison fills text and image fields; this one keeps what the template has.</div>
                )}
              </div>
            ))}
          </div>
        )}
      {tpl.unfilled.length > 0 && (
        <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Left blank because Unison could not tell what they are for: <b style={{ color: "var(--ink)" }}>{tpl.unfilled.join(", ")}</b>. Blank fields keep what the template already has.
        </div>
      )}
      <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        Autofill replaces the contents of the template's fields. Colours, fonts, layout{postType === "video" ? ", scenes, animation and timing" : ""} are the template's own — change them in Canva's editor after it is filled. The filled design becomes the post's {NOUN[postType]}.
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn acc sm" disabled={busy || !tpl.fields.length} onClick={fillCanva} data-testid="fill-canva">
          {canvaRef?.origin === "autofill" && canvaRef.templateId === option.s.templateId ? "Fill again (new design)" : `Fill and use as the ${NOUN[postType]}`}
        </button>
      </div>
    </div>
  );

  const sourceNote = (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginTop: 12 }}>
      <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 600 }} data-testid="studio-source">
        {canvaReady
          ? <>Canva is connected. {templates.length
            ? <>Designs marked <b style={{ color: "var(--ink)" }}>Your Canva template</b> are your account's own brand templates ({templates.length}).</>
            : <>Your account returned no brand templates, so the designs are Unison's — you can still open any of them in Canva to edit.</>}{" "}
            Canva's API only reaches templates your account owns; it has no endpoint for searching Canva's public library.</>
          : <>The designs are <b style={{ color: "var(--ink)" }}>Unison designs</b>, drawn from your post. {canvaWhy}</>}
      </div>
      {canvaReady && <button className="btn sm" disabled={tplState === "loading"} onClick={loadTemplates}>{tplState === "loading" ? "Loading…" : "Refresh templates"}</button>}
    </div>
  );
  const templatesError = tplState === "error" && (
    <div className="badge warn" style={{ display: "block", marginTop: 10, lineHeight: 1.6 }} data-testid="templates-error">
      Canva did not list your brand templates: {tplError}
      <div style={{ marginTop: 6 }}><button className="btn sm" onClick={loadTemplates}>Try again</button></div>
    </div>
  );

  /* One tile. The picture that will be posted is marked "In use"; every
     other tile is a choice, and choosing it replaces that picture. */
  const tile = ({ key, thumb, svg, name, badge, tone = "", note: why, inUse, selected, onClick, testid }) => (
    <button key={key} className={"tpl" + (inUse ? " inuse" : "") + (selected ? " on" : "")} aria-pressed={!!(inUse || selected)} onClick={onClick} disabled={busy} data-testid={testid}>
      <span className="tpl-thumbwrap">
        {svg != null
          ? <span className="tpl-thumb" dangerouslySetInnerHTML={{ __html: svg }} />
          : <span className="tpl-thumb">{thumb}</span>}
        {inUse && <span className="tpl-inuse">✓ In use</span>}
      </span>
      <span className="tpl-name">{name}</span>
      <span className={"badge " + tone} style={{ alignSelf: "flex-start", fontSize: 10.5 }}>{badge}</span>
      {why && <span className="u-muted tpl-note">{why}</span>}
    </button>
  );
  const fileThumb = (up) => (String(up.type || "").startsWith("video")
    ? <span style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center", color: "#C9D2E3", fontSize: 26 }}>▶</span>
    : <img src={up.data} alt="" style={{ width: "100%", display: "block", aspectRatio: "1200 / 630", objectFit: "cover" }} />);
  const fileTiles = () => {
    const list = [...files];
    if (cur?.upload && !list.some((e) => e.upload.data === cur.upload.data)) list.unshift({ id: "now", kind: cur.kind, label: cur.label, upload: cur.upload, canvaDesign: cur.canva || null });
    return list.map((e) => tile({
      key: `file:${e.id}`, thumb: fileThumb(e.upload), name: e.label,
      badge: e.kind === "canva" ? "From Canva" : "Your file", inUse: cur?.upload?.data === e.upload.data,
      onClick: () => (cur?.upload?.data === e.upload.data ? null : chooseFile(e)), testid: "file-option",
    }));
  };

  /* ================= video: the studio behind VideoPanel ================= */
  if (!isImage) {
    return (
      <div data-testid={`studio-${postType}`}>
        <Brief ctx={ctx} intent={intent} postType={postType} />
        {sourceNote}
        {templatesError}

        {(files.length > 0 || cur?.upload) && (
          <>
            <div className="eyebrow" style={{ margin: "16px 0 8px" }}>Videos you have used for this post</div>
            <div className="tpl-grid">{fileTiles()}</div>
          </>
        )}

        <div className="eyebrow" style={{ margin: "16px 0 8px" }}>Designs for the video's opening frame · {options.length}</div>
        <div className="tpl-grid" data-testid="studio-options">
          {options.map((o) => tile({
            key: o.key, name: o.label, note: o.why, selected: o.key === option?.key, onClick: () => choose(o),
            badge: o.kind === "canva" ? "Your Canva template" : "Unison design", tone: o.kind === "canva" ? "" : "warn",
            ...(o.kind === "canva"
              ? { thumb: o.s.thumbnail ? <img src={o.s.thumbnail} alt="" style={{ width: "100%", display: "block" }} loading="lazy" /> : <span className="u-muted" style={{ fontSize: 11.5, display: "grid", placeItems: "center", aspectRatio: `${canvas.W} / ${canvas.H}` }}>No thumbnail from Canva</span> }
              : { svg: renderOption(o).svg }),
          }))}
        </div>

        {option && option.kind !== "canva" && current && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 600 }}>{option.label}</div>
            <div className="u-muted" style={{ fontSize: 12.5 }}>The video's opening frame, {canvas.label}. It is a still picture, not a video. Use it to start the video in Canva, or as the first frame of AI footage.</div>
            <div className="visual-frame" data-testid="studio-preview" data-sig={currentSig} dangerouslySetInnerHTML={{ __html: current.svg }} />
            {current.warnings.length > 0 && current.warnings.map((w) => <div key={w} className="badge warn" style={{ display: "block", marginTop: 6 }} data-testid="design-warning">{w}</div>)}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn acc sm" disabled={busy || !canvaReady} onClick={editInCanva} title={canvaWhy || "Opens Canva's editor on a copy of this frame"} data-testid="edit-in-canva">Start this video in Canva</button>
              <button className="btn sm" disabled={busy || !canvaReady} onClick={blankInCanva} title={canvaWhy}>Blank 16:9 design in Canva</button>
              <button className="btn sm ghost" disabled={busy} onClick={async () => { try { downloadBlob(await pngOf(current.svg), `unison-${postType}-frame.png`); } catch (e) { setError(e.message); } }}>Download frame</button>
            </div>
            <details className="brief">
              <summary>Edit the opening frame</summary>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" disabled={!history.length || busy} onClick={undo}>Undo</button>
                <button className="btn sm" disabled={busy} onClick={resetDesign}>Reset design</button>
              </div>
              {quickEdit}
            </details>
            <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 8 }}>
              Canva receives this frame as a picture on a new {canvas.label} design. Add motion, footage, music and more pages in Canva's editor, then bring it back here as the finished MP4. Unison cannot add animation, transitions or audio itself.
            </div>
          </div>
        )}
        {templateEditor}

        {canvaStrip && <div style={{ marginTop: 18 }}>{canvaStrip}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn sm" disabled={busy || !canvaReady} title={canvaWhy} onClick={() => (picker ? setPicker(null) : searchDesigns(""))} data-testid="my-designs">
            {picker ? "Close my designs" : "Use one of my Canva designs"}
          </button>
          {!canvaReady && <span className="u-muted" style={{ fontSize: 12.5 }}>{canvaWhy}</span>}
        </div>
        {designPicker}

        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }} data-testid="ai-footage">
          <div className="eyebrow" style={{ marginBottom: 8 }}>AI footage (Veo or Runway)</div>
          {!vcaps ? <div className="u-muted" style={{ fontSize: 13 }}>Checking…</div>
            : !vcaps.configured ? (
              <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.6 }} data-testid="ai-footage-off">
                AI footage is off — {String(vcaps.reason || "no video key is set on the server").replace(/\.+$/, "")}. To turn it on, add <code>GOOGLE_API_KEY</code> (Veo) or <code>RUNWAY_API_KEY</code> (Runway) in Vercel → Settings → Environment Variables, then redeploy.
              </div>
            ) : (
              <>
                <label className="eyebrow" htmlFor="clip-prompt" style={{ display: "block", marginBottom: 5 }}>What the footage should show</label>
                <textarea id="clip-prompt" className="ta" rows={3} value={promptValue} onChange={(e) => setClipPrompt(e.target.value)} disabled={busy} />
                <div className="row" style={{ marginTop: 8 }}>
                  <select className="ta" style={{ width: 120 }} value={Math.min(clipSeconds, maxSec)} onChange={(e) => setClipSeconds(+e.target.value)} disabled={busy} aria-label="Length in seconds">
                    {[4, 6, 8, 10].filter((s) => s <= maxSec).map((s) => <option key={s} value={s}>{s} seconds</option>)}
                  </select>
                  <button className="btn acc sm" disabled={busy} onClick={makeClip} data-testid="make-clip">
                    Generate footage{price ? ` (about $${(price.usdPerSecond * Math.min(clipSeconds, maxSec)).toFixed(2)})` : ""}
                  </button>
                </div>
                <div className="u-muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
                  {provider === "runway" ? "Runway animates a still: the opening frame above is used as its first frame. " : "Veo generates from the description. "}
                  The clip is fetched through this deployment and checked as a real MP4, then becomes the post's video. It has no words on it; add titles in Canva.
                </div>
              </>
            )}
        </div>

        {progress}
        {fileMeta && (
          <div style={{ marginTop: 12 }} data-testid="studio-output">
            <div className="u-muted" style={{ fontSize: 12.5 }} data-testid="output-meta">
              Now the post's video: {fileMeta.label} · {fileMeta.mime} · {kb(fileMeta.bytes)}{fileMeta.width ? ` · ${fileMeta.width} × ${fileMeta.height}` : ""}{fileMeta.duration ? ` · ${fileMeta.duration.toFixed(1)} s` : ""}
            </div>
            {fileMeta.bytes > 6 * 1024 * 1024 && (
              <div className="badge warn" style={{ display: "block", marginTop: 8 }}>This video is over 6 MB. It can be previewed, but the browser cannot send a video that large to publishing — shorten it or export at a lower quality in Canva.</div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              {fileMeta.source === "ai" && <button className="btn sm" disabled={busy || !canvaReady} title={canvaWhy} onClick={clipToCanva}>Send to Canva to add titles</button>}
              <button className="btn sm ghost" disabled={busy} onClick={() => downloadBlob(fileMeta.blob, fileMeta.name)}>Download</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ================= image: the post's picture ================= */
  const gen0 = generatedImage(assets);
  const genBusy = imageTask?.status === "generating";
  const editable = cur && (cur.kind === "design" || (cur.kind === "generated" && cur.image.kind !== "url" && !!generatedEditor));
  /* Canva controls appear only where Canva can exist: a deployment without
     the Canva backend never offers them. */
  const canvaable = !!info?.present && cur && !(cur.kind === "generated" && cur.image.kind === "url");
  const sourceLine = !cur ? null
    : cur.kind === "design" ? <>Unison design · <b>{cur.label}</b>{(Object.keys(edits).length || tweaks[cur.key]) ? " · edited" : ""}</>
      : cur.kind === "generated" ? <>Generated by Unison · <b>{cur.label}</b></>
        : cur.kind === "canva" ? <>Edited in Canva · <b>{cur.label}</b></>
          : <>Your image · <b>{cur.label}</b></>;
  const replaceWith = async (file) => {
    if (!file) return;
    setError(""); setNote("");
    patchAssets(keepGeneratedPatch(assetsRef.current));
    await attachUpload(file);
    patchAssets({ canvaDesign: null });
  };
  const download = async () => {
    try {
      if (!cur) return;
      if (cur.kind === "upload" || cur.kind === "canva") return downloadBlob(cur.src, cur.upload.name || "unison-image");
      if (cur.image.kind === "url") return window.open(cur.image.url, "_blank", "noopener");
      downloadBlob(await pngOf(cur.image.svg), `unison-${slug(cur.label)}.png`);
    } catch (e) { setError(e.message); }
  };
  const remove = () => { setEditing(false); patchAssets({ ...keepGeneratedPatch(assetsRef.current), images: [], upload: null, canvaDesign: null }); };
  const showInPost = () => document.querySelector(".li-visual")?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div data-testid="studio-image" className="pimg">
      {/* 1 — the picture that will be posted */}
      <div className="pimg-hero" data-testid="current">
        {cur ? (
          <div className={"svgframe" + (cur.kind === "upload" || cur.kind === "canva" ? " pimg-file" : "")} style={cur.kind === "upload" || cur.kind === "canva" ? undefined : { aspectRatio: "1200 / 630" }}>
            <img src={cur.src} alt="The image that will be posted" data-testid="current-image" data-sig={cur.image?.sig || undefined} />
          </div>
        ) : (
          <div className="pimg-empty">
            <div style={{ fontWeight: 600 }}>{genBusy ? "Making the image…" : "No image yet"}</div>
            <div className="u-muted" style={{ fontSize: 13, marginTop: 6 }}>{genBusy ? <><span className="pulse" /> Drawing it from your post.</> : "Choose a design below, generate one, or upload your own."}</div>
            {!genBusy && onGenerate && <button className="btn acc sm" style={{ marginTop: 12 }} onClick={onGenerate}>Generate image</button>}
          </div>
        )}
        {cur && (
          <div className="pimg-cap" data-testid="current-source">
            <span className="pimg-tick" aria-hidden="true">✓</span>
            <span><b>This is the image that will be posted.</b> <span className="u-muted">{sourceLine}</span></span>
          </div>
        )}
        {cur?.kind === "generated" && generatedNote}
        {fileMeta && (
          <div className="u-muted" style={{ fontSize: 12, marginTop: 6 }} data-testid="output-meta">
            {fileMeta.label} · {fileMeta.mime} · {kb(fileMeta.bytes)}{fileMeta.width ? ` · ${fileMeta.width} × ${fileMeta.height}` : ""}
          </div>
        )}
        {imageTask?.status === "error" && (
          <div className="badge bad" style={{ marginTop: 10 }}>{imageTask.error || "The image could not be made."}{onGenerate && <button className="btn sm" style={{ marginLeft: 8 }} onClick={onGenerate}>Try again</button>}</div>
        )}
        {cur?.kind === "design" && current?.warnings?.length > 0 && option?.key === cur.key && current.warnings.map((w) => (
          <div key={w} className="badge warn" style={{ display: "block", marginTop: 8 }} data-testid="design-warning">{w}</div>
        ))}
        {photo?.dropped && !photo.dataUrl && cur?.kind === "design" && (
          <div className="badge warn" style={{ display: "block", marginTop: 8 }}>The picture you added was too large to keep in this browser after a reload. It is still in the image that will be posted; add it again if you want to edit the design.</div>
        )}

        <div className="pimg-actions">
          {editable && (
            <button className={"btn sm " + (editing ? "" : "acc")} onClick={() => { if (cur.kind === "design") setOptionKey(cur.key); setEditing((e) => !e); }} aria-expanded={editing} data-testid="edit-design">
              {editing ? "Close editor" : "Edit design"}
            </button>
          )}
          {canvaable && !canvaInUse && (
            <button className="btn sm" disabled={busy || !canvaReady} onClick={editInCanva} title={canvaWhy || "Opens Canva's editor on a copy of this image"} data-testid="edit-in-canva">Edit in Canva</button>
          )}
          <button className="btn sm" onClick={() => upRef.current?.click()} data-testid="upload-own">{cur ? "Replace with your own" : "Upload your own"}</button>
          <input ref={upRef} type="file" accept="image/*" style={{ display: "none" }} data-testid="upload-input"
            onChange={(e) => { replaceWith(e.target.files?.[0]); e.target.value = ""; }} />
          {canvaReady && (
            <button className="btn sm" disabled={busy} onClick={() => (picker ? setPicker(null) : searchDesigns(""))} data-testid="my-designs">
              {picker ? "Close my designs" : "Use a Canva design"}
            </button>
          )}
          <span className="pimg-spacer" />
          {cur && <button className="btn sm ghost" onClick={showInPost}>See it in the post</button>}
          {cur && <button className="btn sm ghost" onClick={download}>Download</button>}
          {cur && <button className="btn sm ghost" onClick={remove}>Remove</button>}
        </div>
        {!canvaReady && canvaable && <div className="u-muted" style={{ fontSize: 11.5, marginTop: 6 }}>Edit in Canva: {canvaWhy}</div>}
        {designPicker}
        {progress}
      </div>

      {/* 2 — editing the picture itself */}
      {editing && cur?.kind === "design" && option?.key === cur.key && (
        <div className="pimg-edit" data-testid="edit-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Editing · {option.label}</div>
              <div className="u-muted" style={{ fontSize: 12.5 }}>Changes apply to the image above straight away, at {canvas.label}.</div>
            </div>
            <div className="row">
              <button className="btn sm" disabled={!history.length || busy} onClick={undo}>Undo</button>
              <button className="btn sm" disabled={busy} onClick={resetDesign} title="Colours, picture placement, layout and type back to this design's own">Reset design</button>
              <button className="btn sm acc" onClick={() => setEditing(false)}>Done</button>
            </div>
          </div>
          {quickEdit}
          <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 10 }}>
            For anything this editor cannot do, use “Edit in Canva”: the image goes to Canva as one picture on a new {canvas.label} design, to add elements, photos or text on top. Words inside the picture are easiest to change here first.
          </div>
        </div>
      )}
      {editing && cur?.kind === "generated" && generatedEditor && (
        <div className="pimg-edit" data-testid="edit-panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600 }}>Editing · {cur.label}</div>
              <div className="u-muted" style={{ fontSize: 12.5 }}>Changes apply to the image above straight away.</div>
            </div>
            <button className="btn sm acc" onClick={() => setEditing(false)}>Done</button>
          </div>
          {generatedEditor}
        </div>
      )}

      {canvaStrip}

      {/* 3 — choosing a different picture */}
      <div className="pimg-choose">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="eyebrow">Choose a design</div>
          <div className="u-muted" style={{ fontSize: 12.5 }}>Pick one to make it the post image.</div>
        </div>
        <div className="tpl-grid" data-testid="studio-options" style={{ marginTop: 8 }}>
          {gen0 && tile({
            key: "generated", thumb: <img src={gen0.kind === "url" ? gen0.url : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(gen0.svg || "")} alt="" style={{ width: "100%", display: "block" }} />,
            name: gen0.source === "ai" ? "AI artwork" : gen0.strategy?.label || "Generated design", badge: genBusy ? "Generating…" : "Generated",
            note: gen0.source === "ai" ? "Artwork with your exact words on it." : "Drawn from your post's own words.",
            inUse: cur?.kind === "generated", onClick: chooseGenerated, testid: "generated-option",
          })}
          {options.map((o) => tile({
            key: o.key, name: o.label, note: o.why, inUse: cur?.kind === "design" && cur.key === o.key, selected: o.kind === "canva" && o.key === option?.key,
            onClick: () => choose(o), badge: o.kind === "canva" ? "Your Canva template" : "Unison design", tone: o.kind === "canva" ? "" : "warn",
            ...(o.kind === "canva"
              ? { thumb: o.s.thumbnail ? <img src={o.s.thumbnail} alt="" style={{ width: "100%", display: "block" }} loading="lazy" /> : <span className="u-muted" style={{ fontSize: 11.5, display: "grid", placeItems: "center", aspectRatio: `${canvas.W} / ${canvas.H}` }}>No thumbnail from Canva</span> }
              : { svg: renderOption(o).svg }),
          }))}
          {fileTiles()}
        </div>
        {templateEditor}
      </div>

      {/* 4 — everything else, out of the way until wanted */}
      <details className="pimg-more">
        <summary>More options — new generated image, AI artwork, visual brief</summary>
        <div style={{ marginTop: 12 }}>
          {generatedTools}
          <div style={{ marginTop: 16 }}><Brief ctx={ctx} intent={intent} postType={postType} /></div>
          {sourceNote}
          {templatesError}
          {!canvaReady && info?.present && (
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" disabled title={canvaWhy} data-testid="my-designs">Use one of my Canva designs</button>
              <span className="u-muted" style={{ fontSize: 12.5 }}>{canvaWhy}</span>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

const PHASE = {
  fields: "Asking Canva which fields this template has…",
  filling: "Canva is filling the template.",
  running: "Canva is still working on it.",
  exporting: "Canva is exporting the design.",
  downloading: "Bringing the finished file back through this deployment's backend.",
  validating: "Checking the file is what it claims to be, and that this browser can play it.",
  validated: "Checked.",
  uploading: "Sending it to Canva.",
  creating: "Creating the design in Canva.",
  attaching: "Making it the post's picture.",
  art: "Generating AI artwork — this costs a few cents and takes up to a minute.",
  starting: "Starting the video job.",
  generating: "The provider is generating the footage. This usually takes one to three minutes.",
};

/* ---------- the visual brief ---------- */
function Brief({ ctx, intent, postType }) {
  const occ = ctx.occasion;
  const rows = [];
  rows.push(["For", `${intent?.label || "Post"}${occ ? ` · ${occ.label}` : ""}`]);
  if (ctx.group === "festival") {
    rows.push(["Tone", intent?.kind === "greeting" ? "Warm, respectful and professional — a greeting, not a sales message." : "Professional, with the occasion's colours and symbols."]);
    rows.push(["Cues", (occ.symbols || []).join(", ")]);
    rows.push(["Avoids", "Offers or calls to buy; drawings of deities or religious figures; costume or skin-tone stereotypes."]);
    if (occ.care) rows.push(["Care", occ.care]);
  } else if (ctx.group === "launch") {
    rows.push(["Shows", `${ctx.subject || "The product"}${ctx.items.length ? `, and the ${ctx.items.length} points your post lists` : ""}. Add a real product picture for the spotlight design.`]);
    rows.push(["Avoids", "Features, prices or numbers your post does not state; mock-ups of a product that does not look like this."]);
  } else if (ctx.group === "milestone") {
    rows.push(["Shows", ctx.figure?.stat ? `${ctx.figure.stat}${ctx.figure.statLabel ? ` ${ctx.figure.statLabel}` : ""}, as your post states it.` : "Your headline — no figure was found in the topic or the post, so none is drawn."]);
    rows.push(["Avoids", "Figures your post does not state."]);
  } else {
    rows.push(["Shows", "Your headline and supporting line, with a quiet brand motif."]);
  }
  rows.push(["Size", postType === "video" ? "1920 × 1080 (16:9)" : "1200 × 630 (LinkedIn landscape)"]);
  return (
    <div className="brief-card" data-testid="visual-brief" style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", fontSize: 13, lineHeight: 1.55 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Visual brief</div>
      {rows.map(([k, v]) => <div key={k}><span className="u-muted" style={{ display: "inline-block", minWidth: 62 }}>{k}</span> {v}</div>)}
    </div>
  );
}

/* ---------- quick edit ---------- */
function QuickEdit({ option, d, ctx, text, auto, edits, vf, layoutTpl, layoutFieldsOf, setText, resetText, resetAllText, snapshot, setTweak, palette, presets, tweak, photo, setPhotoPatch, removePhoto, fileRef, imageCaps, makeArt, busy }) {
  const isStyle = option.kind === "style";
  const fields = isStyle
    ? TEXT_FIELDS.filter((f) => !f.when || f.when(d, ctx, text))
    : (layoutTpl?.fields || []).filter((k) => k !== "occasionId").map((k) => {
      const shared = SHARED[k] || k;
      const L = LAYOUT_FIELDS[k] || { label: k };
      return { k: shared, label: L.label, max: L.max, hint: L.hint, multiline: !!L.multiline, layoutKey: k };
    });
  const valueOf = (f) => (isStyle ? text[f.k] ?? "" : layoutFieldsOf(option.template)[f.layoutKey] ?? "");
  const autoOf = (f) => (isStyle ? auto[f.k] ?? "" : vf[f.layoutKey] ?? "");
  const usesPhoto = isStyle;
  const layouts = isStyle ? [
    { id: "column", label: "Text beside the motif" },
    ...(ctx.group === "launch" ? [{ id: "spotlight", label: "Product panel" }] : []),
    ...(text.stat ? [{ id: "figure", label: "Big number" }] : []),
  ] : [];

  return (
    <div style={{ marginTop: 10 }} data-testid="quick-edit">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span className="eyebrow">Words</span>
        <button className="btn sm" disabled={busy || !Object.keys(edits).length} onClick={resetAllText}>Refill all from the post</button>
      </div>
      <div className="grid2">
        {fields.map((f) => {
          const v = valueOf(f);
          const changed = edits[f.k] != null && edits[f.k] !== autoOf(f);
          return (
            <div key={f.k} style={{ marginBottom: 10, gridColumn: f.multiline ? "1 / -1" : undefined }}>
              <label className="eyebrow" htmlFor={`qe-${f.k}`} style={{ display: "block", marginBottom: 5 }}>{f.label}{changed ? " · edited" : ""}</label>
              {f.multiline
                ? <textarea id={`qe-${f.k}`} className="ta" rows={f.k === "items" ? 4 : 2} value={v} onFocus={snapshot} onChange={(e) => setText(f.k, e.target.value)} />
                : <input id={`qe-${f.k}`} className="ta" maxLength={f.max} value={v} onFocus={snapshot} onChange={(e) => setText(f.k, e.target.value)} />}
              <div className="u-muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                {f.hint || ""}{f.max ? ` · ${String(v).length}/${f.max}` : ""}
                {changed && <> · <button className="linkish" style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit" }} onClick={() => resetText(f.k)}>use the post's</button></>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="eyebrow" style={{ margin: "12px 0 6px" }}>Colours</div>
      <div className="row">
        {presets.map((p) => (
          <button key={p.name} className="chip" disabled={busy} onClick={() => setTweak({ palette: p.p })} title={`Use the ${p.name.toLowerCase()} palette`}>
            <span style={{ display: "inline-flex", gap: 2, marginRight: 6, verticalAlign: "-2px" }}>
              {[p.p.bg1, p.p.bg2 || p.p.bg1, p.p.accent, p.p.ink].map((c, i) => <i key={i} style={{ width: 10, height: 12, background: c, borderRadius: 2, display: "inline-block", border: "1px solid rgba(127,127,127,.4)" }} />)}
            </span>{p.name}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {[["bg1", "Background"], ...(isStyle ? [["bg2", "Background 2"]] : []), ["accent", "Accent"], ["ink", "Headline text"], ["soft", "Supporting text"]].map(([k, label]) => (
          <label key={k} className="u-muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="color" value={isHex(palette[k]) ? palette[k] : "#000000"} disabled={busy} onChange={(e) => setTweak({ palette: { [k]: e.target.value.toUpperCase() } })} aria-label={`${label} colour`} data-testid={`colour-${k}`} />
            {label}
          </label>
        ))}
      </div>

      {isStyle && (
        <>
          <div className="eyebrow" style={{ margin: "14px 0 6px" }}>Background and picture</div>
          <div className="row">
            {[["gradient", "Gradient"], ["solid", "Solid colour"], ...(photo?.dataUrl && d.layout !== "spotlight" ? [["photo", "Picture"]] : [])].map(([id, label]) => (
              <button key={id} className={"chip " + (d.background === id ? "on" : "")} disabled={busy} onClick={() => setTweak({ background: id })}>{label}</button>
            ))}
            {usesPhoto && <button className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="add-photo">{photo?.dataUrl ? "Replace picture" : "Add your picture"}</button>}
            {usesPhoto && (
              <button className="btn sm" disabled={busy || !imageCaps?.configured} onClick={makeArt}
                title={imageCaps?.configured ? "Generate a background with AI — no words, no logos" : imageCaps?.reason || "No image key is set on the server"}>
                AI artwork{imageCaps?.configured && typeof imageCaps?.pricing?.[imageCaps.defaultProvider]?.usdPerImage === "number" ? ` (about $${imageCaps.pricing[imageCaps.defaultProvider].usdPerImage.toFixed(2)})` : ""}
              </button>
            )}
            {photo?.dataUrl && <button className="btn sm" disabled={busy} onClick={removePhoto}>Remove picture</button>}
          </div>
          {!imageCaps?.configured && (
            <div className="u-muted" style={{ fontSize: 11.5, marginTop: 4 }}>AI artwork is off: add <code>OPENAI_API_KEY</code> or <code>GOOGLE_API_KEY</code> on the server to turn it on.</div>
          )}
          {photo?.dataUrl && (
            <div style={{ marginTop: 8 }} data-testid="photo-controls">
              <div className="u-muted" style={{ fontSize: 12 }}>
                {photo.source === "ai" ? `AI artwork — ${photo.provider}/${photo.model}. ` : `Your picture${photo.name ? ` (${photo.name})` : ""}. `}
                {d.layout === "spotlight" ? "Shown in the product panel." : d.background === "photo" ? "Used as the background." : "Choose “Picture” above to use it as the background."}
              </div>
              <div className="grid2" style={{ marginTop: 6 }}>
                <Slider label="Zoom" min={1} max={3} step={0.05} value={photo.zoom || 1} onChange={(v) => setPhotoPatch({ zoom: v })} disabled={busy} />
                <Slider label="Left ↔ right" min={0} max={100} step={1} value={photo.x ?? 50} onChange={(v) => setPhotoPatch({ x: v })} disabled={busy} />
                <Slider label="Top ↕ bottom" min={0} max={100} step={1} value={photo.y ?? 50} onChange={(v) => setPhotoPatch({ y: v })} disabled={busy} />
                {d.background === "photo" && d.layout !== "spotlight" && <Slider label="Shade over picture" min={0} max={0.9} step={0.05} value={d.overlay ?? 0.55} onChange={(v) => setTweak({ overlay: v })} disabled={busy} />}
                <label className="u-muted" style={{ fontSize: 12 }}>Credit on the image
                  <input className="ta" value={photo.credit || ""} maxLength={90} placeholder="e.g. Photo: Jane Doe, CC BY 4.0" onChange={(e) => setPhotoPatch({ credit: e.target.value })} disabled={busy} />
                </label>
              </div>
            </div>
          )}

          <div className="eyebrow" style={{ margin: "14px 0 6px" }}>Arrangement</div>
          <div className="row">
            {layouts.map((l) => <button key={l.id} className={"chip " + (d.layout === l.id ? "on" : "")} disabled={busy} onClick={() => setTweak({ layout: l.id })}>{l.label}</button>)}
            {[["left", "Text left"], ...(d.layout === "column" ? [["center", "Centred"]] : []), ["right", "Text right"]].map(([id, label]) => (
              <button key={id} className={"chip " + (d.align === id ? "on" : "")} disabled={busy} onClick={() => setTweak({ align: id })}>{label}</button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {[["colour", "Motif in colour"], ["mono", "Motif in one colour"], ["off", "No motif"]].map(([id, label]) => (
              <button key={id} className={"chip " + (d.motifMode === id ? "on" : "")} disabled={busy} onClick={() => setTweak({ motifMode: id })}>{label}</button>
            ))}
            {[["none", "No frame"], ["line", "Fine frame"], ["ornate", "Ornate frame"]].map(([id, label]) => (
              <button key={id} className={"chip " + (d.frame === id ? "on" : "")} disabled={busy} onClick={() => setTweak({ frame: id })}>{label}</button>
            ))}
            {[["none", "Plain"], ["confetti", "Confetti"], ["sparkle", "Sparkle"]].map(([id, label]) => (
              <button key={id} className={"chip " + (d.decor === id ? "on" : "")} disabled={busy} onClick={() => setTweak({ decor: id })}>{label}</button>
            ))}
          </div>
        </>
      )}

      <div className="eyebrow" style={{ margin: "14px 0 6px" }}>Type</div>
      <div className="row">
        {Object.entries(FONTS).map(([id, f]) => (
          <button key={id} className={"chip " + (((isStyle ? d.font : tweak.font) || "sans") === id ? "on" : "")} disabled={busy} onClick={() => setTweak({ font: id })} style={{ fontFamily: f.stack }}>{f.label}</button>
        ))}
        {isStyle && [[600, "Medium"], [700, "Bold"], [800, "Heavy"]].map(([w, label]) => (
          <button key={w} className={"chip " + (d.weight === w ? "on" : "")} disabled={busy} onClick={() => setTweak({ weight: w })}>{label}</button>
        ))}
      </div>
      {isStyle && <div style={{ maxWidth: 320, marginTop: 6 }}><Slider label="Text size" min={0.8} max={1.25} step={0.05} value={d.scale || 1} onChange={(v) => setTweak({ scale: v })} disabled={busy} /></div>}
      {!isStyle && (
        <div className="u-muted" style={{ fontSize: 12, marginTop: 8 }}>
          This composition has a fixed arrangement and no picture slot — choose a different option for another layout, or a Unison style for full control.
        </div>
      )}
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, disabled }) {
  return (
    <label className="u-muted" style={{ fontSize: 12, display: "block" }}>
      {label} <span className="mono">{Number(value).toFixed(step < 1 ? 2 : 0)}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} style={{ width: "100%" }} aria-label={label} />
    </label>
  );
}
