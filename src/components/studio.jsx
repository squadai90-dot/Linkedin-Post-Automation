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

/* ============================================================
   DESIGN STUDIO

   One place to make the picture or the video for a post:

   1. A short visual brief, from what the post is for.
   2. Distinct options — your Canva brand templates when Canva returns any,
      and Unison's own designs, each labelled as what it is.
   3. Quick edits here that change the actual design: words, colours,
      background, picture, crop, arrangement and type.
   4. Deep edits in Canva's own editor, with the way back: the edited design
      is exported from Canva as it stands — never re-filled over the top.
   5. A preview of the real file, and nothing attached to the post until the
      user presses the button that says so.

   What this cannot do is said where it would otherwise be expected, rather
   than offered as a control that does nothing.
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

export function DesignStudio({ postType = "image", draft, profile = {}, assets, patchAssets, attachUpload, notify, topic = "", intent, gen, workId }) {
  const saved = assets?.designStudio?.[postType] || {};
  const canvas = CANVASES[postType] || CANVASES.image;

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

  /* ---------- the user's work, kept per post ---------- */
  const [optionKey, setOptionKey] = useState(saved.optionKey || null);
  const [edits, setEdits] = useState(saved.edits || {});
  const [tweaks, setTweaks] = useState(saved.tweaks || {});
  const [photo, setPhoto] = useState(saved.photo || null);
  const [canvaRef, setCanvaRef] = useState(saved.canva || null);
  const [attached, setAttached] = useState(saved.attached || null);
  const [history, setHistory] = useState([]);

  const [phase, setPhase] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
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
      patchAssets?.({ designStudio: { ...(assets?.designStudio || {}), [postType]: { optionKey, edits, tweaks, photo: keepPhoto, canva: canvaRef, attached } } });
    }, 350);
    return () => clearTimeout(t);
  }, [optionKey, edits, tweaks, photo, canvaRef, attached]);

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
  const stale = attached && attached.key === option?.key && attached.sig && attached.sig !== currentSig;

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

  const choose = (opt) => {
    setOptionKey(opt.key); setError(""); setNote("");
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

  /* ---------- attaching ---------- */
  const fileOf = async () => {
    const [w, h] = canvas.px;
    const blob = await rasterize(current.svg, { width: w, height: h, type: "image/png" });
    return new File([blob], `unison-${(option.label || "design").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`, { type: "image/png" });
  };
  const useDesign = () => run("attaching", async () => {
    const file = await fileOf();
    await attachUpload(file);
    patchAssets?.({ canvaDesign: null });
    setAttached({ key: option.key, label: option.label, source: "unison", sig: currentSig, at: new Date().toISOString() });
    notify?.(`${option.label} is now the post's image.`, { tone: "ok" });
  });
  const useOutput = () => run("attaching", async () => {
    const ext = output.format === "jpg" ? "jpg" : output.format;
    const file = new File([output.blob], `${output.source === "ai" ? "ai-footage" : "canva-design"}-${Date.now()}.${ext}`, { type: output.mime });
    await attachUpload(file);
    patchAssets?.({
      canvaDesign: output.source === "canva" ? {
        source: "canva", label: output.title || "Canva design", family: output.origin || "", designId: output.designId || null,
        editUrl: canvaRef?.editUrl || null, at: new Date().toISOString(),
      } : null,
    });
    setAttached({ key: output.source === "ai" ? "ai" : `canva-design:${output.designId}`, label: output.label, source: output.source, at: new Date().toISOString() });
    notify?.(`That ${output.video ? "video" : "image"} is now attached to the post.`, { tone: "ok" });
  });

  /* ---------- Canva: deep edit and the way back ---------- */
  const canvaReady = !!info?.present && conn.connected;
  const canvaWhy = !info?.present ? "Canva needs this app's backend, which is not deployed here."
    : !info?.configured ? "Canva is not set up on this deployment yet — see Settings → AI."
      : !conn.connected ? "Connect Canva under Settings → AI first." : "";

  const openEditor = (ref, win) => {
    const state = rememberEdit({ designId: ref.designId, editUrl: ref.editUrl, title: ref.title, origin: ref.origin, workId, postType });
    const url = editUrlWithReturn(ref.editUrl, state);
    setEditLink(url);
    if (win && !win.closed) { try { win.location.href = url; return; } catch { /* fall through */ } }
    const w = window.open(url, "_blank", "noopener");
    if (!w) setNote("Your browser blocked the new tab. Use the “Open in Canva” link below.");
  };
  const placeholderTab = () => {
    const w = window.open("", "_blank");
    if (w) {
      try { w.opener = null; w.document.title = "Opening Canva…"; w.document.body.innerHTML = '<p style="font:16px system-ui,sans-serif;padding:32px;color:#333">Preparing your design for Canva…</p>'; } catch { /* cross-origin already */ }
    }
    return w;
  };

  /* Sends this exact design to Canva as the first layer of a new design of the
     same size, then opens Canva's editor on it. Works on every Canva plan. */
  const editInCanva = async () => {
    if (!current) return;
    const win = placeholderTab();
    const ok = await run("uploading", async (signal) => {
      const [w, h] = canvas.px;
      let blob = await rasterize(current.svg, { width: w, height: h, type: "image/png" });
      if (blob.size > UPLOAD_CEILING) blob = await rasterize(current.svg, { width: w, height: h, type: "image/jpeg", quality: 0.9 });
      const assetId = await uploadBlob(blob, { name: `Unison ${option.label}`, signal, onState });
      setPhase("creating");
      const d = await createDesign({ assetId, width: w, height: h, title: `Unison · ${(text.headline || option.label).slice(0, 80)}`, signal });
      if (!d?.id || !d?.editUrl) throw new Error("Canva created the design but did not return a link to edit it.");
      const ref = { designId: d.id, editUrl: d.editUrl, title: d.title, origin: "unison", fromOption: option.key, at: new Date().toISOString() };
      setCanvaRef(ref);
      openEditor(ref, win);
      return true;
    });
    if (!ok && win && !win.closed) win.close();
  };
  const blankInCanva = async () => {
    const win = placeholderTab();
    const ok = await run("creating", async (signal) => {
      const [w, h] = canvas.px;
      const d = await createDesign({ width: w, height: h, title: `Unison · ${(text.headline || "post").slice(0, 80)}`, signal });
      if (!d?.id || !d?.editUrl) throw new Error("Canva created the design but did not return a link to edit it.");
      const ref = { designId: d.id, editUrl: d.editUrl, title: d.title, origin: "blank", at: new Date().toISOString() };
      setCanvaRef(ref);
      openEditor(ref, win);
      return true;
    });
    if (!ok && win && !win.closed) win.close();
  };

  /* Export the design as it stands in Canva now. Never autofills it again, so
     nothing done in Canva's editor is overwritten. */
  const bringBack = useCallback((designId, { title, origin } = {}) => run("exporting", async (signal) => {
    if (!designId) throw new Error("There is no Canva design to bring back yet.");
    const video = postType === "video";
    if (video) {
      const formats = await exportFormats(designId, { signal }).catch(() => null);
      if (formats && !formats.includes("mp4")) throw new Error("Canva says this design cannot be exported as an MP4 video. Open it in Canva and make sure it is a video design, then try again.");
    }
    const out = await exportDesign({ designId, format: video ? "mp4" : "png", quality: video ? "horizontal_720p" : undefined, signal, onState });
    setOutput((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return { ...out, source: "canva", designId, title, origin, video, label: `From Canva — ${title || "your design"}, exported as it stands in Canva now` }; });
  }), [postType]);

  const canvaRefRef = useRef(canvaRef);
  canvaRefRef.current = canvaRef;
  useEffect(() => onReturn((state) => {
    const p = pendingEdit(state);
    if (!p || p.workId !== workId || p.postType !== postType) return;
    forgetEdit(state);
    setCanvaRef((c) => ({ ...(c || {}), designId: p.designId, editUrl: p.editUrl, title: p.title, origin: p.origin }));
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
      const ref = { designId: d.id, editUrl: d.editUrl, title: d.title, origin: "autofill", templateId: option.s.templateId, at: new Date().toISOString() };
      setCanvaRef(ref);
      const video = postType === "video";
      const out = await exportDesign({ designId: d.id, format: video ? "mp4" : "png", quality: video ? "horizontal_720p" : undefined, signal, onState });
      setOutput((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return { ...out, source: "canva", designId: d.id, title: d.title, origin: option.label, video, label: `From your Canva template “${option.label}”` }; });
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
    setOutput((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return { ...clip, source: "ai", format: "mp4", video: true, label: `AI-generated footage — ${clip.provider}/${clip.model}${clip.usd ? `, about $${clip.usd}` : ""}` }; });
  });
  const clipToCanva = async () => {
    if (!output || output.source !== "ai") return;
    const win = placeholderTab();
    const ok = await run("uploading", async (signal) => {
      if (output.blob.size <= UPLOAD_CEILING) await uploadBlob(output.blob, { name: "Unison AI footage", signal, onState });
      else if (output.sourceUrl) await uploadFromUrl(output.sourceUrl, { name: "Unison AI footage", signal, onState });
      else throw new Error(`This clip is ${kb(output.blob.size)}, above the 4.5 MB a Vercel function accepts, and the provider gave no public address Canva could fetch it from. Download it below and drag it into your Canva design instead.`);
      setPhase("creating");
      const [w, h] = canvas.px;
      let assetId;
      if (current) {
        const frame = await rasterize(current.svg, { width: w, height: h, type: "image/jpeg", quality: 0.9 });
        assetId = await uploadBlob(frame, { name: "Unison opening frame", signal, onState });
      }
      const d = await createDesign({ assetId, width: w, height: h, title: `Unison video · ${(text.headline || "post").slice(0, 70)}`, signal });
      const ref = { designId: d.id, editUrl: d.editUrl, title: d.title, origin: "ai-footage", at: new Date().toISOString() };
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

  if (!info) return <div className="u-muted" style={{ fontSize: 13 }}>Checking what is available…</div>;

  return (
    <div data-testid={`studio-${postType}`}>
      <Brief ctx={ctx} intent={intent} postType={postType} />

      {/* where options come from, stated before they are shown */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginTop: 14 }}>
        <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 600 }} data-testid="studio-source">
          {canvaReady
            ? <>Canva is connected. {templates.length
              ? <>Options marked <b style={{ color: "var(--ink)" }}>Your Canva template</b> are your account's own brand templates ({templates.length}).</>
              : <>Your account returned no brand templates, so the options below are Unison designs — you can still open any of them in Canva to edit.</>}{" "}
              Canva's API only reaches templates your account owns; it has no endpoint for searching Canva's public library.</>
            : <>Options below are <b style={{ color: "var(--ink)" }}>Unison designs</b>, drawn from your post. {canvaWhy}</>}
        </div>
        {canvaReady && <button className="btn sm" disabled={tplState === "loading"} onClick={loadTemplates}>{tplState === "loading" ? "Loading…" : "Refresh templates"}</button>}
      </div>
      {tplState === "error" && (
        <div className="badge warn" style={{ display: "block", marginTop: 10, lineHeight: 1.6 }} data-testid="templates-error">
          Canva did not list your brand templates: {tplError}
          <div style={{ marginTop: 6 }}><button className="btn sm" onClick={loadTemplates}>Try again</button></div>
        </div>
      )}

      {/* the options */}
      <div className="eyebrow" style={{ margin: "16px 0 8px" }}>
        {postType === "video" ? "Designs for the video's opening frame" : "Designs for this post"} · {options.length}
      </div>
      <div className="tpl-grid" data-testid="studio-options">
        {options.map((o) => {
          const r = o.kind === "canva" ? null : renderOption(o);
          return (
            <button key={o.key} className={"tpl " + (o.key === option?.key ? "on" : "")} aria-pressed={o.key === option?.key} onClick={() => choose(o)} disabled={busy}>
              {o.kind === "canva"
                ? (o.s.thumbnail
                  ? <span className="tpl-thumb"><img src={o.s.thumbnail} alt="" style={{ width: "100%", display: "block" }} loading="lazy" /></span>
                  : <span className="tpl-thumb" style={{ aspectRatio: `${canvas.W} / ${canvas.H}`, display: "grid", placeItems: "center" }}><span className="u-muted" style={{ fontSize: 11.5 }}>No thumbnail from Canva</span></span>)
                : <span className="tpl-thumb" dangerouslySetInnerHTML={{ __html: r.svg }} />}
              <span className="tpl-name">{o.label}</span>
              <span className={"badge " + (o.kind === "canva" ? "" : "warn")} style={{ alignSelf: "flex-start", fontSize: 10.5 }}>
                {o.kind === "canva" ? "Your Canva template" : "Unison design"}
              </span>
              <span className="u-muted tpl-note">{o.why}</span>
            </button>
          );
        })}
      </div>

      {/* ---------- the chosen Unison design ---------- */}
      {option && option.kind !== "canva" && current && (
        <div style={{ marginTop: 18 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 600 }}>{option.label}</div>
              <div className="u-muted" style={{ fontSize: 12.5 }}>
                Unison design · live preview — {postType === "video"
                  ? `this is the video's opening frame, ${canvas.label}. It is a still picture, not a video.`
                  : `this exact design is what gets rendered, at ${canvas.label}.`}
              </div>
            </div>
            <div className="row">
              <button className="btn sm" disabled={!history.length || busy} onClick={undo}>Undo</button>
              <button className="btn sm" disabled={busy} onClick={resetDesign} title="Colours, picture placement, layout and type back to this style's own">Reset design</button>
            </div>
          </div>
          <div className="visual-frame" data-testid="studio-preview" data-sig={currentSig} dangerouslySetInnerHTML={{ __html: current.svg }} />
          {current.warnings.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {current.warnings.map((w) => <div key={w} className="badge warn" style={{ display: "block", marginTop: 6 }} data-testid="design-warning">{w}</div>)}
            </div>
          )}
          {photo?.dropped && !photo.dataUrl && (
            <div className="badge warn" style={{ display: "block", marginTop: 8 }}>The picture you added was too large to keep in this browser after a reload. Add it again to use it.</div>
          )}

          <details className="brief" open>
            <summary>Quick edit — changes the design above</summary>
            <QuickEdit
              option={option} d={d} ctx={ctx} text={text} auto={auto} edits={edits} vf={vf} layoutTpl={layoutTpl} layoutFieldsOf={layoutFieldsOf}
              setText={setText} resetText={resetText} resetAllText={resetAllText} snapshot={snapshot} setTweak={setTweak}
              palette={palette} presets={presets} tweak={tweak}
              photo={photo} setPhotoPatch={setPhotoPatch} removePhoto={() => { snapshot(); setPhoto(null); }}
              fileRef={fileRef} imageCaps={imageCaps} makeArt={makeArt} busy={busy}
            />
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} data-testid="studio-photo-input"
              onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          </details>

          <div className="row" style={{ marginTop: 14 }}>
            {postType === "image" && (
              <button className="btn acc sm" disabled={busy} onClick={useDesign} data-testid="use-design">
                {phase === "attaching" ? "Attaching…" : attached?.key === option.key && !stale ? "Attached — use again" : "Use this design"}
              </button>
            )}
            <button className="btn sm" disabled={busy || !canvaReady} onClick={editInCanva} title={canvaWhy || "Opens Canva's editor on a copy of this design"} data-testid="edit-in-canva">
              {postType === "video" ? "Start this video in Canva" : "Edit in Canva"}
            </button>
            {postType === "video" && <button className="btn sm" disabled={busy || !canvaReady} onClick={blankInCanva} title={canvaWhy}>Blank 16:9 design in Canva</button>}
            <button className="btn sm" disabled={busy} onClick={async () => { try { downloadBlob(await fileOf(), `unison-${postType}-frame.png`); } catch (e) { setError(e.message); } }}>Download PNG</button>
          </div>
          {stale && <div className="badge warn" style={{ display: "block", marginTop: 8 }} data-testid="attached-stale">The image attached to the post is from before your latest changes. Press “Use this design” again to update it.</div>}
          {attached?.key === option.key && !stale && <div className="badge" style={{ marginTop: 8 }} data-testid="attached-ok">Attached to the post · {attached.label}</div>}
          <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 8 }}>
            {postType === "video"
              ? <>Canva receives this frame as a picture on a new {canvas.label} design. Add motion, footage, music and more pages in Canva's editor, then come back here to fetch the finished MP4. Unison cannot add animation, transitions or audio itself.</>
              : <>“Edit in Canva” sends this design to Canva as one picture on a new {canvas.label} design — use Canva to add elements, photos or new text on top. Text inside the picture is not separately editable in Canva; change words here first. For designs whose text stays editable in Canva, use a Canva brand template.</>}
          </div>
        </div>
      )}

      {/* ---------- a Canva brand template ---------- */}
      {option?.kind === "canva" && (
        <div style={{ marginTop: 18 }} data-testid="canva-template-editor">
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
            Autofill replaces the contents of the template's fields. Colours, fonts, layout{postType === "video" ? ", scenes, animation and timing" : ""} are the template's own — change them in Canva's editor after it is filled.
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn acc sm" disabled={busy || !tpl.fields.length} onClick={fillCanva} data-testid="fill-canva">
              {canvaRef?.origin === "autofill" && canvaRef.templateId === option.s.templateId ? "Fill again (new design)" : `Fill and export the ${NOUN[postType]}`}
            </button>
          </div>
        </div>
      )}

      {/* ---------- Canva: the way back, and existing designs ---------- */}
      <div className="studio-canva" style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Canva</div>
        {canvaRef?.designId ? (
          <div data-testid="canva-ref">
            <div style={{ fontSize: 13 }}>
              Working design in Canva: <b>{canvaRef.title || canvaRef.designId}</b>
              <span className="u-muted"> · {{ unison: "made from a Unison design", blank: "blank design", autofill: "filled from your template", existing: "chosen from your designs", "ai-footage": "made for your AI footage" }[canvaRef.origin] || "Canva design"}</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {canvaRef.editUrl && <button className="btn sm" disabled={busy || !canvaReady} onClick={() => { setCanvaRef((c) => ({ ...c, opened: true })); openEditor(canvaRef); }}>Open in Canva</button>}
              <button className="btn acc sm" disabled={busy || !canvaReady} onClick={() => bringBack(canvaRef.designId, { title: canvaRef.title, origin: canvaRef.origin })} data-testid="bring-back">
                {phase === "exporting" ? "Exporting…" : "Bring back my Canva edits"}
              </button>
            </div>
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
              Bringing it back exports the design exactly as it stands in Canva — it never refills it, so nothing you changed there is lost.
              {editLink && <> If no tab opened, <a href={editLink} target="_blank" rel="noreferrer">open in Canva</a>.</>}
            </div>
          </div>
        ) : (
          <div className="u-muted" style={{ fontSize: 12.5 }}>No Canva design yet for this {NOUN[postType]}.</div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" disabled={busy || !canvaReady} title={canvaWhy} onClick={() => (picker ? setPicker(null) : searchDesigns(""))} data-testid="my-designs">
            {picker ? "Close my designs" : `Use one of my Canva designs`}
          </button>
          {!canvaReady && <span className="u-muted" style={{ fontSize: 12.5 }}>{canvaWhy}</span>}
        </div>
        {picker && (
          <div style={{ marginTop: 10 }} data-testid="design-picker">
            <div className="row">
              <input className="ta" style={{ flex: 1, minWidth: 200 }} placeholder="Search your Canva designs" value={picker.query}
                onChange={(e) => setPicker((p) => ({ ...p, query: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && searchDesigns(picker.query)} aria-label="Search your Canva designs" />
              <button className="btn sm" onClick={() => searchDesigns(picker.query)}>Search</button>
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
        )}
      </div>

      {/* ---------- AI footage ---------- */}
      {postType === "video" && (
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
                  The clip is fetched through this deployment, checked as a real MP4 and played here before you can use it. It has no words on it; add titles in Canva.
                </div>
              </>
            )}
        </div>
      )}

      {/* ---------- progress and errors ---------- */}
      {busy && (
        <div className="u-muted" style={{ fontSize: 12.5, marginTop: 12 }} data-testid="studio-busy">
          <span className="pulse" /> {PHASE[phase] || "Working…"}
          {cancellable && <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => abort.current?.abort()}>Cancel</button>}
        </div>
      )}
      {error && <div className="badge bad" style={{ display: "block", marginTop: 12, lineHeight: 1.6 }} data-testid="studio-error">{error}</div>}
      {note && <div className="badge" style={{ display: "block", marginTop: 12, lineHeight: 1.6 }}>{note}</div>}

      {/* ---------- a real file, from Canva or a model ---------- */}
      {output && (
        <div style={{ marginTop: 18 }} data-testid="studio-output">
          <div className="eyebrow" style={{ marginBottom: 8 }}>The file that will be attached</div>
          <div className="visual-frame" style={{ marginTop: 0 }}>
            {output.video
              ? <video src={output.url} controls playsInline preload="metadata" style={{ width: "100%", display: "block" }} data-testid="output-video" />
              : <img src={output.url} alt="" style={{ width: "100%", display: "block" }} data-testid="output-image" />}
          </div>
          <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }} data-testid="output-meta">
            {output.label} · {output.mime} · {kb(output.bytes)}{output.width ? ` · ${output.width} × ${output.height}` : ""}{output.duration ? ` · ${output.duration.toFixed(1)} s` : ""}
          </div>
          {output.video && output.bytes > 6 * 1024 * 1024 && (
            <div className="badge warn" style={{ display: "block", marginTop: 8 }}>This video is over 6 MB. It can be previewed, but the browser cannot send a video that large to publishing — shorten it or export at a lower quality in Canva.</div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn acc sm" disabled={busy} onClick={useOutput} data-testid="use-output">{phase === "attaching" ? "Attaching…" : `Use this ${output.video ? "video" : "image"}`}</button>
            {output.source === "ai" && <button className="btn sm" disabled={busy || !canvaReady} title={canvaWhy} onClick={clipToCanva}>Send to Canva to add titles</button>}
            <button className="btn sm" disabled={busy} onClick={() => downloadBlob(output.blob, `unison-${output.source}.${output.format === "jpg" ? "jpg" : output.format}`)}>Download</button>
            <button className="btn sm" disabled={busy} onClick={() => { URL.revokeObjectURL(output.url); setOutput(null); }}>Discard</button>
          </div>
          <div className="u-muted" style={{ fontSize: 12.5, marginTop: 6 }}>Nothing is attached to the post until you press “Use this”. Publishing is unchanged — the file goes in as the post's single attachment, exactly as an upload would.</div>
        </div>
      )}
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
  attaching: "Attaching it to the post.",
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
