import { useState, useEffect, useRef } from "react";
import { FORMATS, toggleFormat, labelFor } from "../lib/formats.js";

/* ============================================================
   DASHBOARD — the first screen. A command centre, not a pitch.
   ============================================================ */

export function Dashboard({ posts, linkedin, schedule, drafts, activeId, onEditDraft, onRemoveDraft, onDiscover, setView, open, setModal, composer }) {
  const review = posts.filter((p) => p.state === "HUMAN_REVIEW");
  const scheduled = posts.filter((p) => p.state === "SCHEDULED");
  const recent = posts.filter((p) => p.state === "PUBLISHED").slice(0, 3);

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <div className="eyebrow">Acme Systems</div>
          <h1 className="disp">Good morning, Jaynil.</h1>
        </div>
      </div>

      {composer}

      {drafts.length > 0 && (
        <div className="card dash-resume">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span className="eyebrow">Drafts</span>
            <button className="btn sm" onClick={() => setView("drafts")}>All drafts ({drafts.length})</button>
          </div>
          {drafts.slice(0, 3).map((d) => <DraftRow key={d.id} d={d} active={d.id === activeId} onEdit={onEditDraft} onRemove={onRemoveDraft} />)}
        </div>
      )}

      <div className="dash-grid">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="eyebrow">Waiting for review</span>
            <span className="mono u-muted">{review.length}</span>
          </div>
          {review.length === 0 && <div className="u-muted" style={{ fontSize: 13.5 }}>Nothing waiting.</div>}
          {review.slice(0, 4).map((p) => (
            <button className="dash-row" key={p.id} onClick={() => open(p)}>
              <span className="dot y" />
              <span style={{ minWidth: 0 }}>{p.title}</span>
              <span className="mono u-muted">{p.date.slice(5)}</span>
            </button>
          ))}
          {review.length > 0 && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setView("content")}>Open review queue</button>}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="eyebrow">Recent content</span>
            <span className="mono u-muted">{recent.length}</span>
          </div>
          {recent.length === 0 && <div className="u-muted" style={{ fontSize: 13.5 }}>Nothing published yet.</div>}
          {recent.map((p) => (
            <button className="dash-row" key={p.id} onClick={() => open(p)}>
              <span className="dot g" />
              <span style={{ minWidth: 0 }}>{p.title}</span>
              <span className="mono u-muted">{p.metrics ? `${(p.metrics.impressions / 1000).toFixed(1)}k` : p.date.slice(5)}</span>
            </button>
          ))}
          {recent.length > 0 && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setView("insights")}>See performance</button>}
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Status</div>
          <div className="dash-stat">
            <span className={"dot " + (linkedin.connected ? "g" : "r")} />
            <span>{linkedin.viaWorkflow ? "LinkedIn publishing connected" : linkedin.connected ? `${linkedin.org} connected` : "No Company Page connected"}</span>
            {!linkedin.connected && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setModal("linkedin")}>Connect</button>}
          </div>
          {posts.some((p) => p.state === "SENT") && (
            <div className="dash-stat">
              <span className="dot y" />
              <span>{posts.filter((p) => p.state === "SENT").length} sent to Make, awaiting LinkedIn</span>
            </div>
          )}
          <div className="dash-stat">
            <span className="dot b" />
            <span>{scheduled.length} scheduled</span>
            {scheduled.length > 0 && <span className="mono u-muted" style={{ marginLeft: "auto" }}>next {scheduled[0].date.slice(5)}</span>}
          </div>
          <div className="dash-stat">
            <span className="dot b" />
            <span>Publishing timezone {schedule.tz}</span>
          </div>
          <button className="btn sm" style={{ marginTop: 12 }} onClick={onDiscover}>Find something to post</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- drafts ---------- */

export const stageWord = (s) => ({
  IDEA: "not started", RESEARCHING: "researching", RESEARCH_COMPLETE: "angle to pick", DRAFT: "writing",
  AI_REVIEW: "checking", HUMAN_REVIEW: "ready to review", APPROVED: "approved, not scheduled", FAILED: "publish failed",
}[s] || String(s || "").toLowerCase().replace(/_/g, " "));

export const ago = (iso) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function DraftRow({ d, active, onEdit, onRemove }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="draftrow">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="draft-title">{d.title || d.idea}{active && <span className="badge" style={{ marginLeft: 8 }}>Open now</span>}</div>
        <div className="u-muted" style={{ fontSize: 12.5 }}>
          {labelFor(d.formats || "text")} · {stageWord(d.stage)}{d.draft?.hook ? ` · "${d.draft.hook.slice(0, 70)}${d.draft.hook.length > 70 ? "…" : ""}"` : ""} · saved {ago(d.savedAt)}
        </div>
      </div>
      <div className="row" style={{ flex: "none" }}>
        {confirm ? (
          <>
            <button className="btn sm" onClick={() => { setConfirm(false); onRemove(d.id); }}>Yes, remove</button>
            <button className="btn sm" onClick={() => setConfirm(false)}>Keep</button>
          </>
        ) : (
          <>
            <button className="btn sm acc" onClick={() => onEdit(d)}>{active ? "Resume" : "Edit"}</button>
            <button className="btn sm" onClick={() => setConfirm(true)}>Remove</button>
          </>
        )}
      </div>
    </div>
  );
}

export function DraftsList({ drafts, activeId, onEdit, onRemove, onResume, onCreate }) {
  const sorted = [...drafts].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : String(b.savedAt).localeCompare(String(a.savedAt))));
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Drafts</h2><span className="eyebrow">{drafts.length} unfinished</span></div>
      {drafts.length === 0 ? (
        <div className="card">
          <div style={{ fontWeight: 600 }}>No drafts.</div>
          <div className="u-muted" style={{ fontSize: 13.5, marginTop: 6, maxWidth: 520 }}>
            Anything you start and leave unfinished is saved here automatically — when you begin another post, open an old one, or move to another tab.
          </div>
          <button className="btn acc" style={{ marginTop: 14 }} onClick={onCreate}>+ Create new content</button>
        </div>
      ) : (
        <div className="card">
          {sorted.map((d) => <DraftRow key={d.id} d={d} active={d.id === activeId} onEdit={d.id === activeId ? onResume : onEdit} onRemove={onRemove} />)}
        </div>
      )}
    </div>
  );
}

/* ---------- composer ---------- */

/* Starters put an opening phrase into the box so the user only has to finish
   the sentence. */
export const STARTERS = [
  { label: "Idea", text: "I want to create a post about " },
  { label: "Announcement", text: "We're announcing " },
  { label: "Lesson learned", text: "Something we learned recently: " },
  { label: "Ask the audience", text: "A question for our audience: " },
  { label: "Data point", text: "A number worth talking about: " },
];

export function CreateFlow({ onStart, recommend, recommending, recommended, seed, clearSeed }) {
  const [formats, setFormats] = useState(["text"]);
  const [text, setText] = useState(seed || "");
  const inputRef = useRef(null);
  useEffect(() => { if (seed) { setText(seed); inputRef.current?.focus(); clearSeed?.(); } }, [seed]);
  const go = () => text.trim() && onStart(formats, text.trim());
  const pick = (id) => setFormats((f) => toggleFormat(f, id));
  const starter = (t) => {
    setText((cur) => (!cur.trim() || STARTERS.some((s) => cur === s.text) ? t : t + cur.trimStart()));
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };
  const recList = Array.isArray(recommended) ? recommended : recommended ? [recommended] : [];

  return (
    <div className="create">
      <div className="composer">
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="What is this post about?" />
        <button className="btn pri" onClick={go} disabled={!text.trim()}>Start</button>
      </div>

      <div className="chips" style={{ marginTop: 12 }}>
        {STARTERS.map((s) => <button key={s.label} className="chip" onClick={() => starter(s.text)}>{s.label}</button>)}
        <button className="chip" disabled={!text.trim() || recommending} onClick={() => recommend(text, setFormats)}>
          {recommending ? "Thinking…" : "Let Unison pick the format"}
        </button>
      </div>

      <div className="row" style={{ justifyContent: "space-between", margin: "22px 0 10px" }}>
        <span className="eyebrow">Components · {labelFor(formats)}</span>
        <span className="u-muted" style={{ fontSize: 12.5 }}>Pick as many as the post needs. One visual per post.</span>
      </div>
      <div className="fmt-grid">
        {FORMATS.map((f) => {
          const on = formats.includes(f.id);
          const base = f.id === "text";
          return (
            <button key={f.id} className={"fmt " + (on ? "on" : "") + (base ? " base" : "") + (recList.includes(f.id) && !base ? " rec" : "")}
              onClick={() => pick(f.id)} aria-pressed={on}>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="fmt-label">{f.label}</span>
                <span className={"fmt-check " + (on ? "on" : "")}>{on ? "✓" : ""}</span>
              </span>
              <span className="u-muted">{base ? "Always included — the written post." : f.hint}</span>
              {recList.includes(f.id) && !base && <span className="eyebrow" style={{ marginTop: 6 }}>Recommended</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
