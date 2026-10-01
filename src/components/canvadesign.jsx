import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  connectionState, onCanvaChange, refreshConnection, canvaStatus, listTemplates,
  templateFields, fillTemplate, exportDesign, uploadAsset, dataUrlToFile, fileToBase64,
} from "../lib/canva.js";
import { suggestTemplates, mapFields, SHAPES } from "../lib/canvamatch.js";
import { FIELDS, autoFill, renderTemplate } from "../lib/templates.js";
import { classify } from "../lib/intel.js";
import { svgToPng } from "../lib/brand.js";

/* ============================================================
   DESIGN FROM A TEMPLATE

   Suggests three or four different designs for the post that is already
   written, lets the words and pictures in the chosen one be edited, renders
   what will actually be published, and only then — on an explicit click —
   hands it to the rest of the product.

   Two things this is strict about:

   — A Canva template is only ever shown when Canva really returned it. When
     the account has nothing that fits, the option offered is one of Unison's
     own layouts and it says so. There are no invented Canva thumbnails here.
   — Nothing is finalized by choosing a template. The picture or video has to
     be rendered, looked at, and accepted.

   What Canva's API can and cannot do is stated on screen rather than papered
   over: autofill replaces the text and image contents of a brand template's
   own fields. It does not recolour a design, change its fonts, or restructure
   its scenes, and Canva publishes no endpoint that would. Those edits happen
   in Canva's editor, which is one click away.
   ============================================================ */

const NAMES = { image: "image", video: "video" };

export function CanvaDesigner({ postType = "image", draft, profile, assets, patchAssets, attachUpload, notify, brief = {} }) {
  const [conn, setConn] = useState(connectionState());
  const [info, setInfo] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [tplState, setTplState] = useState("idle");        // idle | loading | error | ready
  const [tplError, setTplError] = useState("");

  const [chosen, setChosen] = useState(null);
  const [fields, setFields] = useState([]);                // Canva dataset fields
  const [values, setValues] = useState({});
  const [base, setBase] = useState({});                    // what auto-fill produced, for Reset
  const [history, setHistory] = useState([]);
  const [uploads, setUploads] = useState({});              // field name -> { name, assetId }
  const [unfilled, setUnfilled] = useState([]);            // fields Unison could not pre-fill

  const [phase, setPhase] = useState("");                  // "" | filling | exporting | downloading | uploading
  const [error, setError] = useState("");
  const [design, setDesign] = useState(null);              // the Canva design autofill produced
  const [preview, setPreview] = useState(null);            // { dataUrl, mime, bytes, format }
  const abort = useRef(null);
  /* A ref change does not re-render, so whether Cancel is offered is state. */
  const [cancellable, setCancellable] = useState(false);

  useEffect(() => {
    canvaStatus().then(setInfo);
    /* The relay keeps sessions in memory, so it can lose one between visits.
       Asking now means "connect again" is said before a long render, not in
       the middle of it. No-ops when nothing is connected. */
    refreshConnection();
    return onCanvaChange(setConn);
  }, []);

  const cls = useMemo(
    () => classify({ hook: draft?.hook, body: draft?.body, cta: draft?.cta, topic: draft?.topic }),
    [draft?.hook, draft?.body, draft?.cta, draft?.topic],
  );
  const content = useMemo(
    () => ({ hook: draft?.hook || "", body: draft?.body || "", cta: draft?.cta || "", topic: draft?.topic || "" }),
    [draft?.hook, draft?.body, draft?.cta, draft?.topic],
  );

  const load = useCallback(async () => {
    if (!conn.connected) { setTemplates([]); setTplState("idle"); return; }
    setTplState("loading"); setTplError("");
    try {
      const r = await listTemplates({});
      setTemplates(r.items);
      setTplState("ready");
    } catch (e) {
      setTemplates([]); setTplState("error");
      setTplError(e.message);
    }
  }, [conn.connected]);
  useEffect(() => { load(); }, [load]);

  const { suggestions, fields: autoFields } = useMemo(() => suggestTemplates({
    cls, content, postType, templates, canvaConnected: conn.connected,
    brand: { name: profile?.company || "", site: profile?.website || "" }, brief,
  }), [cls, content, postType, templates, conn.connected, profile?.company, profile?.website, brief]);

  /* A video has to come out of Canva: Unison's own layouts are still pictures,
     and offering a control that cannot produce a video would be a lie. */
  const videoUnavailable = postType === "video" && !suggestions.some((s) => s.source === "canva");

  /* ---------- choosing ---------- */

  const choose = async (s) => {
    setChosen(s); setPreview(null); setDesign(null); setError(""); setUploads({}); setHistory([]); setUnfilled([]);
    if (s.source === "unison") {
      const filled = autoFill(s.template, brief, draft);
      setFields([]); setValues(filled); setBase(filled);
      return;
    }
    setPhase("fields");
    try {
      const f = await templateFields(s.templateId);
      /* Pre-filled by matching the template's own field names against what the
         post provides. A name Unison cannot recognise is left blank rather
         than guessed at, and named below so it is obvious what to type. */
      const { values: v, unmatched } = mapFields(f, autoFields);
      setFields(f); setValues(v); setBase(v); setUnfilled(unmatched.map((x) => x.name));
      if (!f.length) setError("Canva reports that this template has no fields set up for autofill. Open it in Canva, mark its text and image elements as fields, and refresh — or choose another option.");
    } catch (e) {
      setFields([]); setError(e.message);
    } finally { setPhase(""); }
  };

  const setValue = (name, v) => {
    setHistory((h) => [...h.slice(-19), values]);
    setValues((cur) => ({ ...cur, [name]: v }));
  };
  const undo = () => setHistory((h) => { if (!h.length) return h; setValues(h[h.length - 1]); return h.slice(0, -1); });
  const reset = () => { setHistory((h) => [...h.slice(-19), values]); setValues(base); setUploads({}); };

  /* ---------- rendering ---------- */

  /* The caption used to quote the shapes this screen ACCEPTS — "1200 × 627
     (landscape) or square" — next to a file that is actually 1200 × 630, and
     for a Canva export the real size is whatever the template is. So the file
     is measured and its own dimensions reported. */
  const measure = (dataUrl, isVideo) => new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const el = document.createElement(isVideo ? "video" : "img");
    const done = () => resolve(isVideo
      ? (el.videoWidth ? { width: el.videoWidth, height: el.videoHeight } : null)
      : (el.naturalWidth ? { width: el.naturalWidth, height: el.naturalHeight } : null));
    el.onloadedmetadata = done; el.onload = done; el.onerror = () => resolve(null);
    el.src = dataUrl;
  });

  const dataUrlBytes = (u) => {
    const i = String(u).indexOf(",");
    if (i < 0) return 0;
    const b = u.length - i - 1;
    return Math.round(b * 3 / 4) - (u.endsWith("==") ? 2 : u.endsWith("=") ? 1 : 0);
  };

  const renderUnison = async () => {
    setPhase("exporting"); setError("");
    try {
      const svg = renderTemplate(chosen.template, values, null);
      const dataUrl = await svgToPng(svg, 1200, 630);
      const size = await measure(dataUrl, false);
      setPreview({ dataUrl, mime: "image/png", bytes: dataUrlBytes(dataUrl), format: "png", ...(size || {}) });
    } catch (e) {
      setError(`That layout could not be rendered: ${e.message}`);
    } finally { setPhase(""); }
  };

  const renderCanva = async () => {
    setError(""); setPreview(null);
    const ctl = new AbortController();
    abort.current = ctl; setCancellable(true);
    try {
      const d = await fillTemplate({
        templateId: chosen.templateId, fields, values,
        title: `Unison · ${(draft?.hook || "post").slice(0, 60)}`,
        signal: ctl.signal, onState: ({ state }) => setPhase(state),
      });
      setDesign(d);
      const out = await exportDesign({
        designId: d.id, format: postType === "video" ? "mp4" : "png",
        signal: ctl.signal, onState: ({ state }) => setPhase(state),
      });
      const size = await measure(out.dataUrl, out.format === "mp4");
      setPreview({ ...out, ...(size || {}) });
    } catch (e) {
      if (e?.name !== "AbortError") setError(e.message);
    } finally { setPhase(""); abort.current = null; setCancellable(false); }
  };

  /* Export the design that already exists, WITHOUT autofilling it again.
     This is the way back from Canva's editor: autofill would rebuild the
     design from the fields on this screen and discard whatever was changed
     over there. */
  const reexport = async () => {
    if (!design?.id) return;
    setError(""); setPreview(null);
    const ctl = new AbortController();
    abort.current = ctl; setCancellable(true);
    try {
      const out = await exportDesign({
        designId: design.id, format: postType === "video" ? "mp4" : "png",
        signal: ctl.signal, onState: ({ state }) => setPhase(state),
      });
      const size = await measure(out.dataUrl, out.format === "mp4");
      setPreview({ ...out, ...(size || {}) });
    } catch (e) {
      if (e?.name !== "AbortError") setError(e.message);
    } finally { setPhase(""); abort.current = null; setCancellable(false); }
  };

  const render = () => (chosen?.source === "unison" ? renderUnison() : renderCanva());

  const pickImage = async (field, file) => {
    if (!file) return;
    setPhase("uploading"); setError("");
    try {
      const b64 = await fileToBase64(file);
      const assetId = await uploadAsset({ name: file.name, b64 });
      setHistory((h) => [...h.slice(-19), values]);
      setValues((cur) => ({ ...cur, [field]: assetId }));
      setUploads((u) => ({ ...u, [field]: { name: file.name, assetId } }));
    } catch (e) {
      setError(`That picture could not be sent to Canva: ${e.message}`);
    } finally { setPhase(""); }
  };

  /* ---------- finalizing ----------
     The only step that touches the post. It hands over an ordinary file, which
     is what the publishing path already accepts for an upload — so nothing in
     the publishing code had to change to support this. */
  const finalize = async () => {
    if (!preview) return;
    setPhase("attaching");
    try {
      const ext = preview.format === "mp4" ? "mp4" : "png";
      const file = await dataUrlToFile(preview.dataUrl, `canva-${postType}-${Date.now()}.${ext}`);
      await attachUpload(file);
      patchAssets?.({
        canvaDesign: {
          source: chosen.source, label: chosen.label, family: chosen.family,
          templateId: chosen.templateId || chosen.template, designId: design?.id || null,
          editUrl: design?.editUrl || null, at: new Date().toISOString(),
        },
      });
      notify?.(`That ${NAMES[postType]} is now attached to the post.`, { tone: "ok" });
    } catch (e) {
      setError(`Could not attach it: ${e.message}`);
    } finally { setPhase(""); }
  };

  /* ---------- rendering the UI ---------- */

  const busy = !!phase;
  const shape = SHAPES[postType];

  if (!info) return <div className="u-muted" style={{ fontSize: 13 }}>Checking what is available…</div>;

  return (
    <div>
      {/* where the templates are coming from, stated before anything is shown */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 560 }}>
          {conn.connected
            ? <>Suggestions are matched against <b style={{ color: "var(--ink)" }}>your {templates.length} Canva brand template{templates.length === 1 ? "" : "s"}</b>. Canva's API only reaches templates the connected account owns — it has no endpoint for searching Canva's public library.</>
            : info.present
              ? <>Canva is not connected, so these are Unison's own layouts. Connect Canva under <b style={{ color: "var(--ink)" }}>Settings → AI</b> to use your brand templates.</>
              : <>There is no backend here, so Canva cannot be reached. These are Unison's own layouts.</>}
        </div>
        <div className="row" style={{ flex: "none" }}>
          <span className={"dot " + (conn.connected ? "g" : "y")} />
          {conn.connected && <button className="btn sm" disabled={tplState === "loading"} onClick={load}>{tplState === "loading" ? "Loading…" : "Refresh"}</button>}
        </div>
      </div>

      {tplState === "error" && (
        <div className="badge bad" style={{ display: "block", marginTop: 12, lineHeight: 1.6 }}>
          Canva refused to list your brand templates: {tplError}
          <div style={{ marginTop: 6 }}><button className="btn sm" onClick={load}>Try again</button></div>
        </div>
      )}
      {conn.connected && tplState === "ready" && templates.length === 0 && (
        <div className="badge warn" style={{ display: "block", marginTop: 12, lineHeight: 1.6 }}>
          The connected Canva account has no brand templates, so there is nothing to fill. Brand templates are a Canva
          Enterprise feature; create one in Canva, or use a Unison layout below.
        </div>
      )}

      {videoUnavailable ? (
        <div className="badge warn" style={{ display: "block", marginTop: 14, lineHeight: 1.65 }}>
          <b>Template video is not available for this post.</b> A video has to be exported from a Canva brand template
          that is {shape.label} — Unison's own layouts render pictures, not video, and Canva's API cannot generate
          original footage from a prompt. Connect a Canva account with a 16:9 brand template, or use the storyboard
          video above, which Unison renders and encodes in this browser.
        </div>
      ) : !chosen ? (
        <>
          <div className="eyebrow" style={{ margin: "16px 0 8px" }}>
            {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} for this post
          </div>
          <div className="tpl-grid">
            {suggestions.map((s) => (
              <button key={s.key} className="tpl" onClick={() => choose(s)}>
                {s.source === "canva" && s.thumbnail
                  ? <span className="tpl-thumb"><img src={s.thumbnail} alt="" style={{ width: "100%", display: "block" }} loading="lazy" /></span>
                  : s.source === "unison"
                    ? <span className="tpl-thumb" dangerouslySetInnerHTML={{ __html: renderTemplate(s.template, autoFill(s.template, brief, draft), null) }} />
                    : <span className="tpl-thumb" style={{ aspectRatio: "1200 / 630", display: "grid", placeItems: "center" }}><span className="u-muted" style={{ fontSize: 11.5 }}>No thumbnail from Canva</span></span>}
                <span className="tpl-name">{s.label}</span>
                <span className={"badge " + (s.source === "canva" ? "" : "warn")} style={{ alignSelf: "flex-start", fontSize: 10.5 }}>
                  {s.source === "canva" ? "Your Canva template" : "Unison layout"}
                </span>
                <span className="u-muted tpl-note">{s.family} — {s.why}</span>
                {s.shapeNote && <span className="u-muted tpl-note">{s.shapeNote}</span>}
                {s.note && <span className="u-muted tpl-note">{s.note}</span>}
              </button>
            ))}
          </div>
          {suggestions.length === 0 && (
            <div className="u-muted" style={{ fontSize: 13, marginTop: 10 }}>
              There is not enough in the post yet to suggest a design. Write the hook and body first.
            </div>
          )}
        </>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between", margin: "14px 0 10px", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{chosen.label}</div>
              <div className="u-muted" style={{ fontSize: 12.5 }}>
                {chosen.source === "canva" ? "Your Canva brand template" : "Unison layout"} · {chosen.family}
              </div>
            </div>
            <div className="row" style={{ flex: "none" }}>
              <button className="btn sm" disabled={busy} onClick={() => { setChosen(null); setPreview(null); setDesign(null); setError(""); }}>Back to options</button>
            </div>
          </div>

          {/* the post itself, kept to hand so editing the graphic never means
              losing sight of what it is for */}
          <details className="brief">
            <summary>The post this is for</summary>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div><span className="eyebrow">hook</span> {draft?.hook || "—"}</div>
              <div style={{ marginTop: 6 }}><span className="eyebrow">body</span> {draft?.body || "—"}</div>
              {draft?.cta && <div style={{ marginTop: 6 }}><span className="eyebrow">call to action</span> {draft.cta}</div>}
            </div>
          </details>

          <div className="row" style={{ justifyContent: "space-between", margin: "18px 0 8px" }}>
            <span className="eyebrow">What you can change here</span>
            <div className="row">
              <button className="btn sm" disabled={!history.length || busy} onClick={undo}>Undo</button>
              <button className="btn sm" disabled={busy} onClick={reset}>Reset</button>
            </div>
          </div>

          {chosen.source === "canva" ? (
            fields.length === 0 ? (
              <div className="u-muted" style={{ fontSize: 13 }}>{phase === "fields" ? "Reading the template's fields…" : "This template has no autofill fields."}</div>
            ) : (
              <div className="grid2">
                {fields.map((f) => (
                  <div key={f.name} style={{ marginBottom: 12, gridColumn: f.type === "image" ? "1 / -1" : undefined }}>
                    <label className="eyebrow" htmlFor={`cv-${f.name}`} style={{ display: "block", marginBottom: 5 }}>{f.name}</label>
                    {f.type === "image" ? (
                      <div className="row">
                        <input id={`cv-${f.name}`} type="file" accept="image/*" className="ta" style={{ flex: 1, minWidth: 200 }}
                          disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; pickImage(f.name, file); e.target.value = ""; }} />
                        {uploads[f.name] && <span className="badge">{uploads[f.name].name} sent to Canva</span>}
                      </div>
                    ) : f.type === "text" ? (
                      <textarea id={`cv-${f.name}`} className="ta" rows={2} value={values[f.name] || ""} onChange={(e) => setValue(f.name, e.target.value)} />
                    ) : (
                      <div className="u-muted" style={{ fontSize: 12.5 }}>
                        Canva reports this as a {f.type} field. Unison fills text and image fields; a {f.type} keeps
                        whatever the template already has.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="grid2">
              {Object.keys(values).map((k) => {
                const f = FIELDS[k];
                if (!f) return null;
                return (
                  <div key={k} style={{ marginBottom: 12, gridColumn: f.multiline ? "1 / -1" : undefined }}>
                    <label className="eyebrow" htmlFor={`uv-${k}`} style={{ display: "block", marginBottom: 5 }}>{f.label}</label>
                    {f.multiline
                      ? <textarea id={`uv-${k}`} className="ta" rows={4} value={values[k] || ""} onChange={(e) => setValue(k, e.target.value)} />
                      : <input id={`uv-${k}`} className="ta" maxLength={f.max} value={values[k] || ""} onChange={(e) => setValue(k, e.target.value)} />}
                    <div className="u-muted" style={{ fontSize: 12, marginTop: 4 }}>{f.hint}{f.max ? ` · ${(values[k] || "").length}/${f.max}` : ""}</div>
                  </div>
                );
              })}
            </div>
          )}

          {unfilled.length > 0 && (
            <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
              Unison could not tell what {unfilled.length === 1 ? "this field is" : "these fields are"} for from
              {unfilled.length === 1 ? " its" : " their"} name, so {unfilled.length === 1 ? "it was" : "they were"} left
              blank: <b style={{ color: "var(--ink)" }}>{unfilled.join(", ")}</b>. Anything left blank keeps whatever the
              template already has.
            </div>
          )}

          {/* what this screen cannot do, said plainly rather than shown as a
              control that does nothing */}
          <div className="u-muted" style={{ fontSize: 12.5, lineHeight: 1.65, marginTop: 4 }}>
            {chosen.source === "canva"
              ? <>Colours, fonts, backgrounds and layout come from the brand template itself, and Canva's API has no call
                  that changes them — autofill only replaces the contents of the fields above.
                  {postType === "video" ? " Scenes, transitions, animation and timing are likewise the template's own." : ""}
                  {design?.editUrl
                    ? <> To change any of that, <a href={design.editUrl} target="_blank" rel="noreferrer">open this design in Canva</a>, edit and save it there, then come back and press <b style={{ color: "var(--ink)" }}>Bring back my Canva edits</b> — which fetches the design as it now stands. Pressing <b style={{ color: "var(--ink)" }}>Render again</b> instead would rebuild it from the fields above and lose that work.</>
                    : chosen.editUrl
                      ? <> To change any of that, <a href={chosen.editUrl} target="_blank" rel="noreferrer">open the template in Canva</a> and save your own version.</>
                      : null}
                </>
              : <>Unison layouts use your brand colours and Inter throughout, which is what keeps a month of posts looking like one company. For a different palette or typeface, use a Canva brand template.</>}
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn acc sm" disabled={busy || (chosen.source === "canva" && !fields.length)} onClick={render}>
              {busy ? PHASE_LABEL[phase] || "Working…" : preview ? "Render again" : `Render the ${NAMES[postType]}`}
            </button>
            {preview && <button className="btn sm" disabled={busy} onClick={render}>Regenerate</button>}
            {design?.id && (
              <button className="btn sm" disabled={busy} onClick={reexport}
                title="Fetch the design as it stands in Canva, without rebuilding it from the fields above">
                Bring back my Canva edits
              </button>
            )}
            {busy && cancellable && <button className="btn sm" onClick={() => abort.current?.abort()}>Cancel</button>}
          </div>

          {busy && (
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              {PHASE_NOTE[phase] || "Working…"}
            </div>
          )}

          {error && (
            <div className="badge bad" style={{ display: "block", marginTop: 12, lineHeight: 1.6 }}>
              {error}
              <div style={{ marginTop: 6 }}><button className="btn sm" disabled={busy} onClick={render}>Try again</button></div>
            </div>
          )}

          {preview && (
            <>
              <div className="eyebrow" style={{ margin: "18px 0 8px" }}>
                This is what will be published
              </div>
              <div className="visual-frame">
                {preview.format === "mp4"
                  ? <video src={preview.dataUrl} controls playsInline style={{ width: "100%", display: "block" }} />
                  : <img src={preview.dataUrl} alt="" style={{ width: "100%", display: "block" }} />}
              </div>
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                {chosen.source === "canva" ? "Exported from Canva" : "Rendered by Unison"} · {preview.mime}
                {preview.bytes ? ` · ${(preview.bytes / 1024).toFixed(0)} KB` : ""}
                {preview.width ? ` · ${preview.width} × ${preview.height}` : ""}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn acc sm" disabled={busy} onClick={finalize}>
                  {phase === "attaching" ? "Attaching…" : `Use this ${NAMES[postType]}`}
                </button>
                {assets?.canvaDesign && assets?.upload && (
                  <span className="badge">Attached · {assets.canvaDesign.label}</span>
                )}
              </div>
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                Nothing is attached to the post until you press that. Publishing itself is unchanged — this becomes the
                post's single attachment, exactly as an uploaded file would.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const PHASE_LABEL = {
  filling: "Filling in Canva…", exporting: "Exporting…", downloading: "Downloading…",
  running: "Waiting for Canva…", uploading: "Uploading…", attaching: "Attaching…", fields: "Reading fields…",
};

const PHASE_NOTE = {
  filling: "Canva is filling the template with your text. This is a job on their side, so it takes a few seconds.",
  running: "Canva is still working on it.",
  exporting: "Canva is rendering the file.",
  downloading: "Bringing the finished file back through this deployment's own backend — the browser never talks to Canva directly.",
  uploading: "Sending the picture to Canva as an asset, which is the only way a template's image field can be filled.",
  fields: "Asking Canva which fields this template actually has.",
  attaching: "Attaching it to the post.",
};
