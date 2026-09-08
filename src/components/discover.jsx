import { useState } from "react";
import { host } from "../lib/util.js";

export const GAP = { open: ["Not covered", "gap-open"], adjacent: ["Loosely covered", "gap-adj"], covered: ["Already covered", "gap-cov"] };

export function Discover({ opps, busy, rerun, start, profile, setProfile }) {
  const [editing, setEditing] = useState(false);
  const items = (opps?.items || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  return (
    <div style={{ paddingTop: 48 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Discover</h2><span className="eyebrow">Opportunity engine</span></div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Watching</div>
            <div style={{ fontWeight: 600 }}>{profile.industry} · {profile.audience}</div>
            <div className="u-muted" style={{ fontSize: 13.5 }}>{profile.keywords}</div>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button>
            <button className="btn acc sm" disabled={busy} onClick={rerun}>{busy ? "Scanning…" : opps?.degraded ? "Try again" : "Rescan"}</button>
          </div>
        </div>
        {editing && (
          <div style={{ marginTop: 14 }}>
            {[["industry", "Industry"], ["audience", "Audience"], ["keywords", "Watch terms"]].map(([k, l]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>{l}</div>
                <input className="ta" value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
              </div>
            ))}
          </div>
        )}
      </div>

      {busy && !opps && (
        <div className="card">
          <div className="pstep active"><span className="tick"><span className="pulse" /></span>Scanning the live web for this week's stories</div>
          <div className="pstep"><span className="tick">○</span>Scoring each one for urgency</div>
          <div className="pstep"><span className="tick">○</span>Checking them against what you've already posted</div>
        </div>
      )}

      {opps?.degraded && (
        <div className="badge warn" style={{ marginBottom: 12 }}>
          {opps.degraded === "sample" ? "The engine didn't respond — these rows are placeholders."
            : opps.degraded === "off" ? "Web search is off, so these come from the model's own knowledge and have no links."
            : "Live search didn't return usable results, so these come from the model's own knowledge and have no links."}
        </div>
      )}

      {items.map((o, i) => (
        <div className="opp" key={i}>
          <div className="opp-score">
            <b>{o.score}</b><span className="eyebrow">score</span>
            <div className="scorebar"><i style={{ height: `${o.score}%` }} /></div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className={"gap " + (GAP[o.gap]?.[1] || "gap-adj")}>{GAP[o.gap]?.[0] || "Unclear"}</span>
              <span className="eyebrow">{o.angle}</span>
              {o.date && <span className="eyebrow">{o.date}</span>}
            </div>
            <div className="opp-h">{o.headline}</div>
            {o.summary && <div className="u-muted" style={{ fontSize: 14, marginTop: 6 }}>{o.summary}</div>}
            <div style={{ marginTop: 10, fontSize: 13.5 }}><span className="eyebrow">Why now</span> {o.whyNow}</div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn acc sm" onClick={() => start(o.headline)}>Create from this</button>
              {o.url && <a className="btn sm" href={o.url} target="_blank" rel="noreferrer">{o.publisher || host(o.url)} ↗</a>}
              {!o.url && <span className="u-muted" style={{ fontSize: 12.5 }}>{o.publisher || "no link"}</span>}
            </div>
          </div>
        </div>
      ))}

      {!busy && !opps && (
        <div className="card">
          <div className="u-muted">Nothing scanned yet.</div>
          <button className="btn acc" style={{ marginTop: 12 }} onClick={rerun}>Find something to post</button>
        </div>
      )}
    </div>
  );
}
