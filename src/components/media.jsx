import { useState, useEffect, useRef } from "react";
import { FORMAT_BY_ID, normalizeFormats, visualOf } from "../lib/formats.js";
import { pad } from "../lib/util.js";
import { drawScene, svgToPng, downloadBlob } from "../lib/brand.js";
import { SCENE_SECONDS, videoProvider, extensionOf } from "../lib/media.js";
import { ImageStudio } from "./imagestudio.jsx";

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
   refresh because it replays data rather than a blob. The exported file is a
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

/* Why this graphic and not another one. Shown because a visual the user
   cannot account for is one they cannot trust — and because the decision is
   now a real one worth reading. Findings from the quality gate sit with it,
   since they are about this same asset. */
export function VisualRationale({ asset }) {
  const s = asset?.strategy;
  const findings = asset?.check?.findings || [];
  if (!s && !findings.length) return null;
  return (
    <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
      {s && <div><b style={{ color: "var(--ink)" }}>{s.label}</b> — {s.reason}</div>}
      {findings.map((f, i) => (
        <div key={i} className={"badge " + (f.severity === "blocking" ? "bad" : "warn")} style={{ marginTop: 8 }}>
          {f.message} {f.fix}
        </div>
      ))}
    </div>
  );
}

export function ImagePanel({ assets, mstate, makeImage, patchAssets, attachUpload, prototypeNote, draft, profile, extras = {}, notify }) {
  const [variant, setVariant] = useState(0);
  /* Open once the picture exists: the design is the interesting part, and
     hiding it behind a click is what made the old output feel fixed. */
  const [studioOpen, setStudioOpen] = useState(true);
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
      {img && <><SvgFrame src={srcOf(img)} /><VisualRationale asset={img} />{img.kind === "url" ? <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>AI photo from Pollinations (free). Regenerate for a different take, or switch back to the brand renderer under Settings → Advanced.</div> : prototypeNote}</>}

      {/* Rolling the dice again is a poor way to fix one wrong word, so the
          composition and the words in it are both editable here. */}
      {img && img.kind !== "url" && (
        <details className="studio" open={studioOpen} onToggle={(e) => setStudioOpen(e.currentTarget.open)}>
          <summary>Change the design and the words</summary>
          <ImageStudio
            brief={img.brief} draft={draft} profile={profile} photosOn={extras.commons !== false}
            value={assets.imageDesign}
            onChange={(d) => patchAssets({ imageDesign: d, images: [{ ...(assets.images[0] || {}), kind: "svg", svg: d.svg, source: "template", template: d.templateId, photoCredit: d.photo?.credit || null, id: assets.images[0]?.id || "img-studio" }] })}
            notify={notify}
          />
        </details>
      )}
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
          <VisualRationale asset={v} />

          <div className="row" style={{ marginTop: 12 }}>
            {!v.url && (
              <button className="btn sm" disabled={!canEncode || enc.status === "generating"} onClick={exportVideo}>
                {enc.status === "generating" ? `Encoding… ${Math.round((enc.progress || 0) * 100)}%` : "Export a file"}
              </button>
            )}
            {v.url && (
              <button className="btn sm" onClick={async () => {
                const bytes = v.blob || await fetch(v.url).then((r) => r.blob());
                downloadBlob(bytes, `unison-video.${extensionOf(v.mime || bytes.type)}`);
              }}>Download .{extensionOf(v.mime)}</button>
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

/* ---------- a document you already have, read for research ----------
   Not a post type — LinkedIn document posts cannot be published from here.
   This reads a file you wrote already and lifts the facts out of it into
   the sources, so the post can be built from your own material. */

export function SourceDocPanel({ assets, mstate, ingestDocument }) {
  const fileRef = useRef(null);
  const ing = mstate.sourceDoc;

  return (
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
        What comes out of it goes into Sources as a primary document, and its claims are handed
        to the writer — so the post is written from your file, not only from the web.
      </div>
      {assets.sourceDoc && (
        <div className="srcdoc">
          <div style={{ fontWeight: 600 }}>{assets.sourceDoc.name}</div>
          <div className="u-muted" style={{ fontSize: 13 }}>{assets.sourceDoc.summary}</div>
          {["claims", "stats", "facts", "insights"].map((k) => (assets.sourceDoc[k] || []).length > 0 && (
            <div key={k} style={{ marginTop: 8 }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>
                {k === "claims" ? "Claims the writer will use" : k}
              </div>
              {assets.sourceDoc[k].map((x, i) => <div key={i} style={{ fontSize: 13.5, padding: "2px 0" }}>— {x}</div>)}
            </div>
          ))}
          {/* Say exactly what the upload did. "Added as a source" on its own
              reads like a filing cabinet — the point is that the words in the
              document reach the draft. */}
          <div className="badge" style={{ marginTop: 10 }}>
            {(assets.sourceDoc.claims || []).length
              ? `In Sources as a primary document · ${assets.sourceDoc.claims.length} claim${assets.sourceDoc.claims.length === 1 ? "" : "s"} given to the writer`
              : "In Sources as a primary document · nothing quotable was found in it"}
          </div>
          {assets.sourceDoc.degraded && (
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              Read without AI — these are the document's own sentences, quoted as they stand.
            </div>
          )}
        </div>
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

/* ---------- what shows inside the LinkedIn preview ---------- */

export function AssetPreview({ format: rawFormat, formats, assets, media }) {
  const list = normalizeFormats(formats || rawFormat);
  const visual = visualOf(list);

  /* the one attachment LinkedIn shows: an upload, a video, or an image */
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
  } else if (assets.images.length) {
    attachment = <div className="li-visual"><img src={srcOf(assets.images[0])} alt="" /></div>;
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

  if (!attachment && !poll) return null;
  return <>{attachment}{poll}</>;
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
  if (format === "video") return <VideoPanel {...shared} />;
  if (format === "poll") return <PollPanel {...shared} />;
  return null;
}
