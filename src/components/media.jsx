import { useState, useEffect, useRef } from "react";
import { FORMAT_BY_ID, normalizeFormats, visualOf } from "../lib/formats.js";
import { pad } from "../lib/util.js";
import { drawScene, svgToPng, downloadBlob } from "../lib/brand.js";
import { SCENE_SECONDS, videoProvider } from "../lib/media.js";

/* ============================================================
   MEDIA UI — one panel per format, all driven by the media engine
   ============================================================ */

export function TaskState({ state, idleLabel, busyLabel, onRun, disabled, extra }) {
  const st = state?.status || "idle";
  return (
    <div>
      <div className="row">
        <button className="btn acc sm" disabled={st === "generating" || disabled} onClick={onRun}>
          {st === "generating" ? busyLabel : st === "success" ? `Re${idleLabel[0].toLowerCase()}${idleLabel.slice(1)}` : idleLabel}
        </button>
        {extra}
      </div>
      {st === "generating" && (
        <div className="u-muted" style={{ marginTop: 12 }}>
          <span className="pulse" /> {busyLabel}
          {state.progress > 0 && <span className="mono" style={{ marginLeft: 8 }}>{Math.round(state.progress * 100)}%</span>}
          {state.progress > 0 && <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${state.progress * 100}%` }} /></div>}
        </div>
      )}
      {st === "error" && (
        <div className="badge bad" style={{ marginTop: 12 }}>
          {state.error || "Generation failed."}
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={onRun}>Try again</button>
        </div>
      )}
    </div>
  );
}

/* The preview draws the storyboard on a canvas on its own clock.
   Duration is known exactly, play and scrub always work, and it survives a
   refresh because it replays data rather than a blob. The exported .webm is a
   separate concern. */
export function StoryboardPlayer({ storyboard, brief, seconds }) {
  const cv = useRef(null), bar = useRef(null), lab = useRef(null);
  const at = useRef(0);
  const [playing, setPlaying] = useState(false);
  const total = (seconds || (storyboard?.length || 1) * SCENE_SECONDS) * 1000;
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

  const paint = (ms) => {
    const c = cv.current;
    if (!c || !storyboard?.length) return;
    const ctx = c.getContext("2d");
    const per = total / storyboard.length;
    const i = Math.min(storyboard.length - 1, Math.floor(ms / per));
    drawScene(ctx, c.width, c.height, storyboard[i], i, storyboard.length, (ms % per) / per, brief);
    if (bar.current) bar.current.value = String(ms);
    if (lab.current) lab.current.textContent = `${fmt(ms)} / ${fmt(total)}`;
  };

  useEffect(() => { at.current = 0; paint(0); }, [storyboard]);

  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      at.current = Math.min(total, at.current + (now - last));
      last = now;
      paint(at.current);
      if (at.current >= total) setPlaying(false);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, storyboard]);

  const toggle = () => {
    if (!playing && at.current >= total) { at.current = 0; paint(0); }
    setPlaying((p) => !p);
  };

  return (
    <div className="sbplayer">
      <canvas ref={cv} width={1280} height={720} onClick={toggle} />
      {!playing && (
        <button className="sb-play" onClick={toggle} aria-label="Play">
          <svg viewBox="0 0 64 64" width="58" height="58"><circle cx="32" cy="32" r="30" fill="rgba(10,15,26,.6)" stroke="#7C8CFF" strokeWidth="2.5" /><path d="M26 20 L46 32 L26 44 Z" fill="#7C8CFF" /></svg>
        </button>
      )}
      <div className="sb-bar">
        <button onClick={toggle}>{playing ? "❚❚" : "▶"}</button>
        <input ref={bar} type="range" min="0" max={total} defaultValue="0" step="50"
          onInput={(e) => { at.current = +e.target.value; paint(at.current); }} />
        <span className="mono" ref={lab}>0:00 / {fmt(total)}</span>
        <button onClick={() => { at.current = 0; paint(0); setPlaying(false); }} title="Restart">⟲</button>
      </div>
    </div>
  );
}

/* A WebM from MediaRecorder has no duration in its header — it was written as a
   live stream, so browsers report Infinity and the controls show 0:00 with a
   dead scrubber. Seeking to a huge timestamp forces the browser to scan to the
   end and compute the real duration, after which we rewind. */
export function VideoPlayer({ src, poster, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    let fixing = false;
    const onMeta = () => {
      if (v.duration === Infinity || Number.isNaN(v.duration)) {
        fixing = true;
        v.currentTime = 1e101;
      }
    };
    const onTime = () => {
      if (fixing && v.duration !== Infinity && !Number.isNaN(v.duration)) {
        fixing = false;
        v.currentTime = 0;
      }
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    return () => { v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("timeupdate", onTime); };
  }, [src]);
  return <video ref={ref} src={src} poster={poster} controls playsInline preload="metadata" className={className} />;
}

export const svgDataUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
/* An asset is either a rendered SVG or a URL (AI photo). */
export const srcOf = (x) => (x?.kind === "url" ? x.url : svgDataUrl(x?.svg || ""));

export function SvgFrame({ svg, src, ratio = "1200 / 630" }) {
  return <div className="svgframe" style={{ aspectRatio: ratio }}><img src={src || svgDataUrl(svg)} alt="" /></div>;
}

export async function saveAsset(svg, name, w, h) {
  try {
    const png = await svgToPng(svg, w, h);
    downloadBlob(png, name + ".png");
  } catch (e) {
    downloadBlob(svg, name + ".svg", "image/svg+xml");
  }
}
async function saveUrlAsset(url, name) {
  try { const blob = await fetch(url, { mode: "cors" }).then((r) => r.blob()); downloadBlob(blob, name + ".jpg"); }
  catch { window.open(url, "_blank", "noopener"); }
}

/* ---------- image ---------- */

export function ImagePanel({ assets, mstate, makeImage, patchAssets, attachUpload, prototypeNote }) {
  const [variant, setVariant] = useState(0);
  const img = assets.images[0];
  const fileRef = useRef(null);
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Post image</div>
      <TaskState
        state={mstate.image} idleLabel="Generate image" busyLabel="Generating image…"
        onRun={() => { const v = variant + 1; setVariant(v); makeImage(v); }}
        extra={<>
          {img && <button className="btn sm" onClick={() => makeImage(variant + 2)}>Another variation</button>}
          <button className="btn sm" onClick={() => fileRef.current?.click()}>Upload your own</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attachUpload(f); e.target.value = ""; }} />
          {img && <button className="btn sm" onClick={() => (img.kind === "url" ? saveUrlAsset(img.url, "unison-image") : saveAsset(img.svg, "unison-image", 1200, 630))}>Download</button>}
          {(img || assets.upload) && <button className="btn sm" onClick={() => patchAssets({ images: [], upload: null })}>Remove</button>}
        </>}
      />
      {img && <><SvgFrame src={srcOf(img)} />{img.kind === "url" ? <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>AI photo from Pollinations (free). Regenerate for a different take, or switch back to the brand renderer under Settings → Advanced.</div> : prototypeNote}</>}
      {assets.upload && !img && (
        <div className="svgframe" style={{ aspectRatio: "1200 / 630" }}><img src={assets.upload.data} alt={assets.upload.name} /></div>
      )}
      {img?.brief && (
        <details className="brief">
          <summary>Creative brief</summary>
          {Object.entries(img.brief).filter(([k]) => k !== "scenes").map(([k, v]) => (
            <div key={k}><span className="eyebrow">{k}</span> {String(v)}</div>
          ))}
          {img.prompt && <div style={{ marginTop: 8 }}><span className="eyebrow">generation prompt</span> {img.prompt}</div>}
        </details>
      )}
    </div>
  );
}

/* ---------- multi-image ---------- */

export function MultiPanel({ assets, mstate, makeImageSet, retile, addTile, moveItem, dropItem, prototypeNote }) {
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Image set · {assets.images.length} of 4</div>
      <TaskState
        state={mstate.multi} idleLabel="Generate set" busyLabel="Generating set…"
        onRun={() => makeImageSet(3)}
        extra={assets.images.length > 0 && assets.images.length < 4 && <button className="btn sm" onClick={addTile}>Add image</button>}
      />
      {assets.images.length > 0 && (
        <>
          <div className="tilegrid">
            {assets.images.map((t, i) => (
              <div className="tile" key={t.id}>
                <SvgFrame svg={t.svg} ratio="1 / 1" />
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="eyebrow">{pad(i + 1)}</span>
                  <button className="btn sm" disabled={mstate["tile-" + i]?.status === "generating"} onClick={() => retile(i)}>
                    {mstate["tile-" + i]?.status === "generating" ? "…" : "Regenerate"}
                  </button>
                  <button className="btn sm" onClick={() => moveItem("images", i, i - 1)} disabled={i === 0}>←</button>
                  <button className="btn sm" onClick={() => moveItem("images", i, i + 1)} disabled={i === assets.images.length - 1}>→</button>
                  <button className="btn sm" onClick={() => dropItem("images", i)}>Remove</button>
                </div>
                {mstate["tile-" + i]?.status === "error" && <div className="badge bad" style={{ marginTop: 8 }}>{mstate["tile-" + i].error}</div>}
              </div>
            ))}
          </div>
          {prototypeNote}
        </>
      )}
    </div>
  );
}

/* ---------- video ---------- */

export function VideoPanel({ assets, mstate, makeVideo, exportVideo, patchAssets, attachUpload, prototypeNote }) {
  const v = assets.video;
  const fileRef = useRef(null);
  const enc = mstate.encode || {};
  const canEncode = videoProvider.supported();

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Video</div>
      <TaskState
        state={mstate.video} idleLabel="Generate video" busyLabel="Building storyboard…"
        onRun={makeVideo}
        extra={<>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>Upload your own</button>
          <input ref={fileRef} type="file" accept="video/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attachUpload(f); e.target.value = ""; }} />
          {(v || assets.upload) && (
            <button className="btn sm" onClick={() => { if (v?.url) URL.revokeObjectURL(v.url); patchAssets({ video: null, upload: null }); }}>Remove</button>
          )}
        </>}
      />

      {v?.storyboard?.length > 0 && (
        <>
          <StoryboardPlayer storyboard={v.storyboard} brief={v.brief} seconds={v.seconds} />
          <div className="badge warn" style={{ marginTop: 10 }}>
            Rendered locally from the storyboard — {v.seconds}s. No video model produced this.
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            {!v.url && (
              <button className="btn sm" disabled={!canEncode || enc.status === "generating"} onClick={exportVideo}>
                {enc.status === "generating" ? `Encoding… ${Math.round((enc.progress || 0) * 100)}%` : "Export .webm"}
              </button>
            )}
            {v.url && (
              <button className="btn sm" onClick={async () => {
                const bytes = v.blob || await fetch(v.url).then((r) => r.blob());
                downloadBlob(bytes, "unison-video.webm");
              }}>Download .webm</button>
            )}
            {v.url && <button className="btn sm" onClick={exportVideo}>Re-encode</button>}
          </div>
          {enc.status === "generating" && (
            <div style={{ marginTop: 10 }}>
              <div className="bar"><i style={{ width: `${(enc.progress || 0) * 100}%` }} /></div>
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                Encoding runs in real time — about {v.seconds} seconds. Keep this tab in front.
              </div>
            </div>
          )}
          {enc.status === "error" && <div className="badge bad" style={{ marginTop: 10 }}>{enc.error}</div>}
          {v.url && enc.status !== "generating" && (
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              File ready · {v.mime?.replace("video/", "").split(";")[0].toUpperCase()} · {v.seconds}s
            </div>
          )}
          {!canEncode && (
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              This browser can't record a file, so the storyboard preview is the only output here.
            </div>
          )}
        </>
      )}

      {assets.upload?.type?.startsWith("video") && !v && (
        <div className="visual-frame" style={{ marginTop: 14 }}>
          <VideoPlayer src={assets.upload.data} />
        </div>
      )}

      {v?.storyboard?.length > 0 && (
        <details className="brief" open>
          <summary>Storyboard · {v.storyboard.length} scenes</summary>
          {v.storyboard.map((sc, i) => (
            <div key={i} style={{ padding: "6px 0" }}>
              <span className="eyebrow">{pad(i + 1)} {sc.label}</span> {sc.line}
              {sc.note && <div className="u-muted" style={{ fontSize: 13 }}>{sc.note}</div>}
            </div>
          ))}
          {v.prompt && <div style={{ marginTop: 8 }}><span className="eyebrow">generation prompt</span> {v.prompt}</div>}
        </details>
      )}
    </div>
  );
}

/* ---------- document ---------- */

export function DocumentPanel({ assets, mstate, makeDocument, editDocPage, ingestDocument, prototypeNote }) {
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(5);
  const fileRef = useRef(null);
  const doc = assets.doc;
  const idx = Math.min(page, (doc?.pages.length || 1) - 1);
  const cur = doc?.pages[idx];
  const ing = mstate.sourceDoc;

  return (
    <>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Work from a document you already have</div>
        <TaskState
          state={ing} idleLabel="Upload a document" busyLabel="Reading document…"
          onRun={() => fileRef.current?.click()}
          extra={<input ref={fileRef} type="file" accept=".docx,.txt,.md,.csv,.json,.pdf" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestDocument(f); e.target.value = ""; }} />}
        />
        <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          .docx, .txt, .md and .csv are read in full. PDFs only work if their text is uncompressed.
        </div>
        {assets.sourceDoc && (
          <div className="srcdoc">
            <div style={{ fontWeight: 600 }}>{assets.sourceDoc.name}</div>
            <div className="u-muted" style={{ fontSize: 13 }}>{assets.sourceDoc.summary}</div>
            {["facts", "stats", "insights"].map((k) => (assets.sourceDoc[k] || []).length > 0 && (
              <div key={k} style={{ marginTop: 8 }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>{k}</div>
                {assets.sourceDoc[k].map((x, i) => <div key={i} style={{ fontSize: 13.5, padding: "2px 0" }}>— {x}</div>)}
              </div>
            ))}
            <div className="badge" style={{ marginTop: 10 }}>Added to sources as a primary document</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <span className="eyebrow">Or have Unison build one</span>
          <select className="ta" style={{ width: 110 }} value={pages} onChange={(e) => setPages(+e.target.value)}>
            {[4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} pages</option>)}
          </select>
        </div>
        <TaskState
          state={mstate.doc} idleLabel="Generate document" busyLabel="Building document…"
          onRun={() => { setPage(0); makeDocument(pages); }}
          extra={doc && <>
            <button className="btn sm" onClick={() => saveAsset(cur.svg, `unison-page-${idx + 1}`, 1200, 1200)}>Download page</button>
            <button className="btn sm" onClick={() => doc.pages.forEach((pg, i) => setTimeout(() => saveAsset(pg.svg, `unison-page-${i + 1}`, 1200, 1200), i * 350))}>Download all</button>
          </>}
        />
        {doc && cur && (
          <>
            <div className="pager">
              <button className="btn sm" onClick={() => setPage(Math.max(0, idx - 1))} disabled={idx === 0}>←</button>
              <span className="mono">{idx + 1} / {doc.pages.length}</span>
              <button className="btn sm" onClick={() => setPage(Math.min(doc.pages.length - 1, idx + 1))} disabled={idx === doc.pages.length - 1}>→</button>
            </div>
            <SvgFrame svg={cur.svg} ratio="1 / 1" />
            <div style={{ marginTop: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Edit this page</div>
              <input className="ta" value={cur.heading} onChange={(e) => editDocPage(idx, { heading: e.target.value })} />
              <textarea className="ta" style={{ marginTop: 8 }} rows={3} value={cur.body} onChange={(e) => editDocPage(idx, { body: e.target.value })} />
            </div>
            {prototypeNote}
          </>
        )}
      </div>
    </>
  );
}

/* ---------- carousel ---------- */

export function CarouselPanel({ assets, mstate, makeCarousel, reslide, editSlide, moveItem, dropItem, prototypeNote }) {
  const [i, setI] = useState(0);
  const list = assets.carousel;
  const idx = Math.min(i, Math.max(0, list.length - 1));
  const s = list[idx];
  return (
    <div className="card">
      <div className="badge warn" style={{ marginBottom: 12 }}>
        LinkedIn has no organic carousel API. This exports as slides or a document — it is never published as a native carousel.
      </div>
      <TaskState
        state={mstate.carousel} idleLabel="Generate carousel" busyLabel="Building slides…"
        onRun={() => { setI(0); makeCarousel(6); }}
        extra={list.length > 0 && <>
          <button className="btn sm" onClick={() => saveAsset(s.svg, `unison-slide-${idx + 1}`, 1200, 1200)}>Export slide</button>
          <button className="btn sm" onClick={() => list.forEach((sl, k) => setTimeout(() => saveAsset(sl.svg, `unison-slide-${k + 1}`, 1200, 1200), k * 350))}>Export all</button>
        </>}
      />
      {list.length > 0 && s && (
        <>
          <div className="strip-thumbs">
            {list.map((sl, k) => (
              <button key={sl.id} className={"thumb " + (k === idx ? "on" : "")} onClick={() => setI(k)}>
                <img src={svgDataUrl(sl.svg)} alt="" />
                <span className="mono">{k + 1}</span>
              </button>
            ))}
          </div>
          <div className="pager">
            <button className="btn sm" onClick={() => setI(Math.max(0, idx - 1))} disabled={idx === 0}>←</button>
            <span className="mono">{s.role} · {idx + 1} / {list.length}</span>
            <button className="btn sm" onClick={() => setI(Math.min(list.length - 1, idx + 1))} disabled={idx === list.length - 1}>→</button>
          </div>
          <SvgFrame svg={s.svg} ratio="1 / 1" />
          <div style={{ marginTop: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Edit slide {idx + 1}</div>
            <input className="ta" value={s.heading} onChange={(e) => editSlide(idx, { heading: e.target.value })} />
            <textarea className="ta" style={{ marginTop: 8 }} rows={3} value={s.body} onChange={(e) => editSlide(idx, { body: e.target.value })} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" disabled={mstate["slide-" + idx]?.status === "generating"} onClick={() => reslide(idx)}>
                {mstate["slide-" + idx]?.status === "generating" ? "Rewriting…" : "Regenerate this slide only"}
              </button>
              <button className="btn sm" onClick={() => { moveItem("carousel", idx, idx - 1); setI(Math.max(0, idx - 1)); }} disabled={idx === 0}>Move left</button>
              <button className="btn sm" onClick={() => { moveItem("carousel", idx, idx + 1); setI(Math.min(list.length - 1, idx + 1)); }} disabled={idx === list.length - 1}>Move right</button>
              <button className="btn sm" onClick={() => { dropItem("carousel", idx); setI(Math.max(0, idx - 1)); }} disabled={list.length <= 2}>Delete</button>
            </div>
            {mstate["slide-" + idx]?.status === "error" && <div className="badge bad" style={{ marginTop: 10 }}>{mstate["slide-" + idx].error}</div>}
          </div>
          {prototypeNote}
        </>
      )}
    </div>
  );
}

/* ---------- poll ---------- */

export function PollPanel({ assets, mstate, makePoll, patchAssets }) {
  const poll = assets.poll;
  const set = (patch) => patchAssets({ poll: { ...poll, ...patch } });
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Poll</div>
      <TaskState state={mstate.poll} idleLabel="Generate poll" busyLabel="Writing poll…" onRun={makePoll} />
      {poll && (
        <div style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Question · {poll.question.length}/140</div>
          <input className="ta" maxLength={140} value={poll.question} onChange={(e) => set({ question: e.target.value })} />
          <div className="eyebrow" style={{ margin: "14px 0 6px" }}>Options · max 4, 30 characters each</div>
          {poll.options.map((o, i) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <span className="mono u-muted" style={{ width: 18 }}>{i + 1}</span>
              <input className="ta" style={{ flex: 1 }} maxLength={30} value={o}
                onChange={(e) => set({ options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })} />
              <button className="btn sm" disabled={poll.options.length <= 2} onClick={() => set({ options: poll.options.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" disabled={poll.options.length >= 4} onClick={() => set({ options: [...poll.options, ""] })}>Add option</button>
            <select className="ta" style={{ width: 140 }} value={poll.duration} onChange={(e) => set({ duration: e.target.value })}>
              {["1 day", "3 days", "1 week", "2 weeks"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- article ---------- */

export function ArticlePanel({ assets, mstate, makeArticle, editArticle }) {
  const a = assets.article;
  const words = a ? [a.standfirst, ...(a.sections || []).map((s) => s.body), a.conclusion].join(" ").split(/\s+/).filter(Boolean).length : 0;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <span className="eyebrow">Article</span>
        {a && <span className="u-muted" style={{ fontSize: 12.5 }}>{words} words · no post character limit applies</span>}
      </div>
      <TaskState state={mstate.article} idleLabel="Generate article" busyLabel="Writing article…" onRun={makeArticle} />
      {a && (
        <div className="article-edit">
          <div className="eyebrow" style={{ margin: "14px 0 6px" }}>Title</div>
          <input className="ta" value={a.title || ""} onChange={(e) => editArticle({ title: e.target.value })} />
          <div className="eyebrow" style={{ margin: "12px 0 6px" }}>Standfirst</div>
          <textarea className="ta" rows={2} value={a.standfirst || ""} onChange={(e) => editArticle({ standfirst: e.target.value })} />
          {(a.sections || []).map((s, i) => (
            <div key={i} style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="eyebrow">Section {i + 1}</span>
                <button className="btn sm" onClick={() => editArticle({ sections: a.sections.filter((_, j) => j !== i) })}>Remove</button>
              </div>
              <input className="ta" style={{ marginTop: 6 }} value={s.heading}
                onChange={(e) => editArticle({ sections: a.sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} />
              <textarea className="ta" style={{ marginTop: 6 }} rows={5} value={s.body}
                onChange={(e) => editArticle({ sections: a.sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
            </div>
          ))}
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => editArticle({ sections: [...(a.sections || []), { heading: "New section", body: "" }] })}>Add section</button>
          <div className="eyebrow" style={{ margin: "16px 0 6px" }}>Conclusion</div>
          <textarea className="ta" rows={3} value={a.conclusion || ""} onChange={(e) => editArticle({ conclusion: e.target.value })} />
          <div className="eyebrow" style={{ margin: "12px 0 6px" }}>Call to action</div>
          <input className="ta" value={a.cta || ""} onChange={(e) => editArticle({ cta: e.target.value })} />
        </div>
      )}
    </div>
  );
}

/* ---------- what shows inside the LinkedIn preview ---------- */

export function AssetPreview({ format: rawFormat, formats, assets, media }) {
  const [i, setI] = useState(0);
  const list = normalizeFormats(formats || rawFormat);
  const visual = visualOf(list);

  /* the one attachment LinkedIn shows: an upload, a video, pages, or images */
  let attachment = null;
  if (assets.upload) {
    attachment = <div className="li-visual">{assets.upload.type.startsWith("video")
      ? <video src={assets.upload.data} controls playsInline />
      : <img src={assets.upload.data} alt={assets.upload.name} />}</div>;
  } else if (visual === "video" && assets.video) {
    attachment = (
      <div className="li-visual">
        {assets.video.storyboard?.length
          ? <StoryboardPlayer storyboard={assets.video.storyboard} brief={assets.video.brief} seconds={assets.video.seconds} />
          : <img src={svgDataUrl(assets.video.poster)} alt="" />}
      </div>
    );
  } else if (visual === "document" && assets.doc?.pages?.length) {
    const pages = assets.doc.pages;
    const idx = Math.min(i, pages.length - 1);
    attachment = (
      <div className="li-visual li-doc">
        <img src={svgDataUrl(pages[idx].svg)} alt="" />
        <div className="li-pager">
          <button onClick={() => setI(Math.max(0, idx - 1))} disabled={idx === 0}>←</button>
          <span>{idx + 1} / {pages.length}</span>
          <button onClick={() => setI(Math.min(pages.length - 1, idx + 1))} disabled={idx === pages.length - 1}>→</button>
        </div>
      </div>
    );
  } else if (assets.images.length === 1) {
    attachment = <div className="li-visual"><img src={srcOf(assets.images[0])} alt="" /></div>;
  } else if (assets.images.length > 1) {
    attachment = (
      <div className={"li-mosaic n" + Math.min(4, assets.images.length)}>
        {assets.images.slice(0, 4).map((t) => <img key={t.id} src={srcOf(t)} alt="" />)}
      </div>
    );
  } else if (visual) {
    attachment = (
      <div className="li-media">
        <div>
          <div className="eyebrow">{FORMAT_BY_ID[visual].label} · nothing attached yet</div>
          <div style={{ fontSize: 13, maxWidth: 360, marginTop: 8, color: "#5E6A80" }}>Generate it in the Media step below.</div>
          {media?.concept && <div style={{ fontSize: 12.5, maxWidth: 360, marginTop: 8, color: "#8894A8" }}>{media.concept}</div>}
        </div>
      </div>
    );
  }

  const poll = list.includes("poll") ? (assets.poll ? (
    <div className="li-poll">
      <div style={{ fontWeight: 600, marginBottom: 10 }}>{assets.poll.question || "Your question"}</div>
      {assets.poll.options.filter(Boolean).map((o, k) => <div className="li-opt" key={k}>{o}</div>)}
      <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>0 votes · {assets.poll.duration} left</div>
    </div>
  ) : <div className="li-poll u-muted" style={{ fontSize: 13 }}>Poll · not written yet</div>) : null;

  /* carousel slides are exported, not attached — shown as a strip so the post reads as one thing */
  const slides = list.includes("carousel") && assets.carousel.length ? (
    <div className="li-strip">{assets.carousel.slice(0, 6).map((sl) => <img key={sl.id || sl.n} src={svgDataUrl(sl.svg)} alt="" />)}</div>
  ) : null;

  const article = list.includes("article") && assets.article ? (
    <div className="li-article">
      <div className="eyebrow">Article</div>
      <div style={{ fontWeight: 700, marginTop: 4 }}>{assets.article.title}</div>
      <div className="u-muted" style={{ fontSize: 13 }}>{assets.article.standfirst}</div>
    </div>
  ) : null;

  if (!attachment && !poll && !slides && !article) return null;
  return <>{attachment}{poll}{slides}{article}</>;
}

/* ---------- the section that switches on format ---------- */

export function MediaSection(p) {
  const { format } = p;
  const note = (
    <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
      Rendered by Unison's brand renderer from the post's own words — consistent, on-brand, and editable. Turn on Pollinations under Settings → Advanced for AI photos.
    </div>
  );
  const shared = { ...p, prototypeNote: note };
  if (format === "image") return <ImagePanel {...shared} />;
  if (format === "multi") return <MultiPanel {...shared} />;
  if (format === "video") return <VideoPanel {...shared} />;
  if (format === "document") return <DocumentPanel {...shared} />;
  if (format === "carousel") return <CarouselPanel {...shared} />;
  if (format === "poll") return <PollPanel {...shared} />;
  if (format === "article") return <ArticlePanel {...shared} />;
  return null;
}
