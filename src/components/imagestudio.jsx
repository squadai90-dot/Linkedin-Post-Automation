import { useState, useEffect, useRef, useCallback } from "react";
import { TEMPLATES, TEMPLATE_BY_ID, FIELDS, autoFill, renderTemplate } from "../lib/templates.js";
import { commonsPhotos, photoQuery, fetchImageAsDataUrl } from "../lib/freeApis.js";

/* ============================================================
   IMAGE STUDIO

   Pick a composition, then change the words in it. The previous renderer gave
   you four fixed layouts and a "regenerate" button, which meant the only way
   to fix a headline was to roll the dice again.

   Everything here is deterministic: the template plus the fields fully
   determine the picture, so editing a word changes exactly that word. Photos
   come from Wikimedia Commons because it is keyless and every file states its
   licence — which is then drawn onto the image, since attribution is a
   condition of those licences rather than a courtesy.
   ============================================================ */

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

export function ImageStudio({ brief, draft, profile, photosOn = true, value, onChange, notify }) {
  const [templateId, setTemplateId] = useState(value?.templateId || "statement");
  const [fields, setFields] = useState(() => value?.fields || autoFill(value?.templateId || "statement", brief, draft));
  const [photo, setPhoto] = useState(value?.photo || null);
  const [photos, setPhotos] = useState([]);
  const [photoState, setPhotoState] = useState("idle");   // idle | loading | empty | error | off
  const [query, setQuery] = useState("");
  const tpl = TEMPLATE_BY_ID[templateId] || TEMPLATES[0];

  /* Report upward on every change so the post always carries what is on
     screen, never a stale render. */
  const emit = useCallback((t, f, p) => onChange?.({ templateId: t, fields: f, photo: p, svg: renderTemplate(t, f, p) }), [onChange]);
  useEffect(() => { emit(templateId, fields, photo);   }, [templateId, fields, photo]);

  /* Switching template keeps any field the new one also uses, so a headline
     you have already edited is not lost to a layout change. */
  const chooseTemplate = (id) => {
    const filled = autoFill(id, brief, draft);
    setFields((cur) => Object.fromEntries(Object.keys(filled).map((k) => [k, cur[k] ?? filled[k]])));
    setTemplateId(id);
  };

  const setField = (k, v) => setFields((f) => ({ ...f, [k]: v }));
  const refill = () => { setFields(autoFill(templateId, brief, draft)); notify?.("Fields refilled from the post.", { tone: "ok" }); };

  const search = useCallback(async (q) => {
    if (!photosOn) { setPhotoState("off"); return; }
    setPhotoState("loading");
    try {
      const list = await commonsPhotos(q, { limit: 12 });
      setPhotos(list);
      setPhotoState(list.length ? "idle" : "empty");
    } catch { setPhotoState("error"); }
  }, [photosOn]);

  const debouncedSearch = useRef(debounce((q) => search(q), 500)).current;

  /* Load photographs only for the templates that use one. */
  useEffect(() => {
    if (!tpl.photo) return;
    const q = query || photoQuery(draft, profile);
    if (!query) setQuery(q);
    search(q);
     
  }, [tpl.photo]);

  const pickPhoto = async (p) => {
    /* Inline the bytes: an SVG referencing a remote URL will not export to
       PNG, and publishing needs the picture, not a link to it. */
    const dataUrl = await fetchImageAsDataUrl(p.url).catch(() => null);
    setPhoto({ ...p, dataUrl });
    if (!dataUrl) notify?.("The photo is shown from its web address — downloading it for export was blocked.", { tone: "warn" });
  };

  return (
    <div>
      <div className="eyebrow" style={{ margin: "4px 0 8px" }}>Composition</div>
      <div className="tpl-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} className={"tpl " + (t.id === templateId ? "on" : "")} onClick={() => chooseTemplate(t.id)} aria-pressed={t.id === templateId}>
            <span className="tpl-thumb" dangerouslySetInnerHTML={{ __html: renderTemplate(t.id, autoFill(t.id, brief, draft), photo) }} />
            <span className="tpl-name">{t.label}</span>
            <span className="u-muted tpl-note">{t.note}</span>
          </button>
        ))}
      </div>

      <div className="row" style={{ justifyContent: "space-between", margin: "22px 0 8px" }}>
        <span className="eyebrow">Words on the image</span>
        <button className="btn sm" onClick={refill}>Refill from the post</button>
      </div>
      <div className="grid2">
        {tpl.fields.map((k) => {
          const f = FIELDS[k];
          if (!f) return null;
          return (
            <div key={k} style={{ marginBottom: 12, gridColumn: f.multiline ? "1 / -1" : undefined }}>
              <label className="eyebrow" htmlFor={`fld-${k}`} style={{ display: "block", marginBottom: 5 }}>{f.label}</label>
              {f.multiline
                ? <textarea id={`fld-${k}`} className="ta" rows={4} value={fields[k] || ""} onChange={(e) => setField(k, e.target.value)} />
                : <input id={`fld-${k}`} className="ta" maxLength={f.max} value={fields[k] || ""} onChange={(e) => setField(k, e.target.value)} />}
              <div className="u-muted" style={{ fontSize: 12, marginTop: 4 }}>
                {f.hint}{f.max ? ` · ${(fields[k] || "").length}/${f.max}` : ""}
              </div>
            </div>
          );
        })}
      </div>

      {tpl.photo && (
        <>
          <div className="row" style={{ justifyContent: "space-between", margin: "18px 0 8px" }}>
            <span className="eyebrow">Photograph</span>
            <span className="u-muted" style={{ fontSize: 12.5 }}>Wikimedia Commons · only CC0, public domain and CC-BY files are shown</span>
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="ta" style={{ flex: 1, minWidth: 200 }} value={query}
              onChange={(e) => { setQuery(e.target.value); debouncedSearch(e.target.value); }}
              placeholder="What should the photo show?" aria-label="Photo search" />
            <button className="btn sm" onClick={() => search(query)}>Search</button>
            {photo && <button className="btn sm" onClick={() => setPhoto(null)}>Remove photo</button>}
          </div>

          {photoState === "off" && <div className="badge warn">Photo search is turned off under Settings → Advanced. The template still works without one.</div>}
          {photoState === "loading" && <div className="u-muted" style={{ fontSize: 13 }}>Searching…</div>}
          {photoState === "empty" && <div className="u-muted" style={{ fontSize: 13 }}>Nothing freely licensed matched “{query}”. Try one or two plainer words — “office”, “handshake”, “ledger”.</div>}
          {photoState === "error" && <div className="badge warn">Could not reach Wikimedia Commons. The template still works without a photo.</div>}

          {photos.length > 0 && (
            <div className="photo-grid">
              {photos.map((p) => (
                <button key={p.id} className={"photo " + (photo?.id === p.id ? "on" : "")} onClick={() => pickPhoto(p)} title={`${p.author} · ${p.licence}`}>
                  <img src={p.url} alt={p.title} loading="lazy" />
                  <span className="photo-cap">{p.licence}</span>
                </button>
              ))}
            </div>
          )}

          {photo && (
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.6 }}>
              Credited on the image as <b>{photo.credit}</b>.{" "}
              <a href={photo.source} target="_blank" rel="noreferrer">See the original</a>. Most of these licences
              require that credit to stay visible, which is why it is drawn on rather than shown beside.
            </div>
          )}
        </>
      )}
    </div>
  );
}
