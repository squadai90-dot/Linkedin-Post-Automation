import { useState, useEffect, useRef } from "react";
import { labelFor } from "../lib/formats.js";

import { greeting, relativeTime } from "../lib/dates.js";
import { postDue } from "./views.jsx";

/* ============================================================
   DASHBOARD — the first screen. A command centre, not a pitch.
   ============================================================ */

/* What a new team still has to set up. Disappears once done or dismissed. */
function SetupCard({ profile, aiInfo, publishReady, linkedin, openSettings, onDismiss }) {
  const items = [
    { ok: !!profile.company, label: "Name your company", sub: "Shown in previews and stamped on images.", tab: "workspace" },
    { ok: !!aiInfo?.ready, label: "Connect the AI", sub: aiInfo ? aiInfo.summary : "Checking…", tab: "ai" },
    { ok: publishReady, label: "Connect publishing", sub: publishReady ? (linkedin.org || "Make workflow ready") : "Make webhook or LinkedIn sign-in — until then publishing is a dry run.", tab: "linkedin" },
  ];
  const left = items.filter((i) => !i.ok).length;
  if (!left) return null;
  return (
    <div className="card setup">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <div><span className="eyebrow">Set up Unison</span><div style={{ fontWeight: 600, marginTop: 4 }}>{left} of {items.length} steps left</div></div>
        <button className="btn sm" onClick={onDismiss}>Hide for now</button>
      </div>
      {items.map((i) => (
        <button key={i.tab} className="dash-row" onClick={() => openSettings(i.tab)}>
          <span className={"dot " + (i.ok ? "g" : "y")} />
          <span style={{ minWidth: 0 }}><span style={{ fontWeight: 600 }}>{i.label}</span><span className="u-muted" style={{ display: "block", fontSize: 12.5, whiteSpace: "normal" }}>{i.sub}</span></span>
          <span className="u-muted">{i.ok ? "Done" : "Set up →"}</span>
        </button>
      ))}
    </div>
  );
}

export function Dashboard({ posts, linkedin, schedule, drafts, activeId, onEditDraft, onRemoveDraft, onDiscover, setView, open, publish, setModal, composer, profile = {}, aiInfo, publishReady, openSettings, setupHidden, hideSetup }) {
  const review = posts.filter((p) => p.state === "HUMAN_REVIEW");
  const scheduled = posts.filter((p) => p.state === "SCHEDULED").sort((a, b) => String(a.date + a.time).localeCompare(String(b.date + b.time)));
  const due = scheduled.filter(postDue);
  const sent = posts.filter((p) => p.state === "SENT");
  const recent = posts.filter((p) => p.state === "PUBLISHED").slice(0, 3);
  const firstName = String(profile.userName || "").trim().split(/\s+/)[0];

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <div className="eyebrow">{profile.company || "Your workspace"}</div>
          <h1 className="disp">{greeting()}{firstName ? `, ${firstName}` : ""}.</h1>
        </div>
      </div>

      {!setupHidden && <SetupCard profile={profile} aiInfo={aiInfo} publishReady={publishReady} linkedin={linkedin} openSettings={openSettings} onDismiss={hideSetup} />}

      {due.length > 0 && (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <div><b>{due.length === 1 ? `"${due[0].title.slice(0, 48)}" is due.` : `${due.length} scheduled posts are due.`}</b> Unison only publishes while it's open — press Publish now.</div>
          <button className="btn sm acc" onClick={() => publish(due[0])}>Publish now</button>
        </div>
      )}

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
              <span className="mono u-muted">{String(p.date || "").slice(5)}</span>
            </button>
          ))}
          {review.length > 0 && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setView("content")}>Open review queue</button>}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="eyebrow">Scheduled</span>
            <span className="mono u-muted">{scheduled.length}</span>
          </div>
          {scheduled.length === 0 && <div className="u-muted" style={{ fontSize: 13.5 }}>Nothing scheduled.</div>}
          {scheduled.slice(0, 4).map((p) => (
            <button className="dash-row" key={p.id} onClick={() => open(p)}>
              <span className={"dot " + (postDue(p) ? "y" : "b")} />
              <span style={{ minWidth: 0 }}>{p.title}</span>
              <span className="mono u-muted">{postDue(p) ? "due" : `${String(p.date || "").slice(5)} ${p.time || ""}`}</span>
            </button>
          ))}
          {sent.length > 0 && <div className="dash-stat" style={{ marginTop: 8 }}><span className="dot y" /><span>{sent.length} sent to Make, awaiting LinkedIn</span></div>}
          {(scheduled.length > 0 || sent.length > 0) && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setView("calendar")}>Open calendar</button>}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="eyebrow">Recently published</span>
            <span className="mono u-muted">{recent.length}</span>
          </div>
          {recent.length === 0 && <div className="u-muted" style={{ fontSize: 13.5 }}>Nothing published yet.</div>}
          {recent.map((p) => (
            <button className="dash-row" key={p.id} onClick={() => open(p)}>
              <span className="dot g" />
              <span style={{ minWidth: 0 }}>{p.title}</span>
              <span className="mono u-muted">{p.metrics?.impressions ? `${(p.metrics.impressions / 1000).toFixed(1)}k` : p.simulated ? "sim" : String(p.date || "").slice(5)}</span>
            </button>
          ))}
          {recent.length > 0 && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setView("insights")}>See performance</button>}
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Status</div>
          <div className="dash-stat">
            <span className={"dot " + (publishReady ? "g" : linkedin.connected ? "y" : "r")} />
            <span>{publishReady ? (linkedin.viaWorkflow && !linkedin.org ? "Publishing via Make" : `${linkedin.org || "Company Page"} connected`) : linkedin.simulated ? "Sample Page — publishing is simulated" : "Publishing not connected"}</span>
            {!publishReady && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => openSettings("linkedin")}>Connect</button>}
          </div>
          <div className="dash-stat">
            <span className={"dot " + (aiInfo?.ready ? "g" : "r")} />
            <span>{aiInfo ? (aiInfo.ready ? (aiInfo.local ? "AI ready · local model" : "AI ready") : "AI not configured — sample data") : "Checking AI…"}</span>
            {aiInfo && !aiInfo.ready && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => openSettings("ai")}>Set up</button>}
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

export const ago = relativeTime;

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
            <button className="btn sm bad" onClick={() => { setConfirm(false); onRemove(d.id); }}>Yes, remove</button>
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
  { label: "Client win", text: "A practice we work with just " },
  { label: "Lesson learned", text: "Something we learned running finance work for CA firms: " },
  { label: "Compliance update", text: "A change practices need to know about: " },
  { label: "Ask the audience", text: "A question for practice owners: " },
  { label: "Data point", text: "A number worth talking about: " },
];

export function CreateFlow({ onStart, seed, clearSeed }) {
  const [text, setText] = useState(seed || "");
  const inputRef = useRef(null);
  useEffect(() => { if (seed) { setText(seed); inputRef.current?.focus(); clearSeed?.(); } }, [seed]);  
  const go = () => text.trim() && onStart(["text"], text.trim());
  const starter = (t) => {
    setText((cur) => (!cur.trim() || STARTERS.some((s) => cur === s.text) ? t : t + cur.trimStart()));
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };
  return (
    <div className="create">
      <div className="composer">
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="What is this post about?" aria-label="What is this post about?" />
        <button className="btn pri" onClick={go} disabled={!text.trim()}>Start</button>
      </div>

      <div className="chips" style={{ marginTop: 12 }}>
        {STARTERS.map((s) => <button key={s.label} className="chip" onClick={() => starter(s.text)}>{s.label}</button>)}
      </div>

      <p className="u-muted" style={{ margin: "18px 0 0", fontSize: 13.5, maxWidth: 560 }}>
        Unison writes the post first. Once you can read it, you decide whether it needs an image, a poll,
        a document or nothing at all — and you can change your mind then.
      </p>
    </div>
  );
}
