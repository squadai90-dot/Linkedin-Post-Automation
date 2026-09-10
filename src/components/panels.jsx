import { pad, tierLabel } from "../lib/util.js";

/* ---------- drawers ---------- */

export function SourcesPanel({ research }) {
  if (!research) return <p className="u-muted">No research yet. Start a post and sources will collect here.</p>;
  return (
    <div>
      {(research.sources || []).map((s, i) => (
        <div className="src" key={i}>
          <span className={"tier t" + (s.tier || 4)}>T{s.tier}</span>
          <div style={{ minWidth: 0 }}>
            {s.url ? <a className="srclink" href={s.url} target="_blank" rel="noreferrer">{s.title} <span className="ext">↗</span></a> : <div style={{ fontWeight: 600 }}>{s.title}</div>}
            <div className="u-muted" style={{ fontSize: 13 }}>{s.publisher} · {s.date} · {tierLabel(s.tier)}</div>
            <div className="u-muted" style={{ fontSize: 13, marginTop: 3 }}>{s.note}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AuditPanel({ log }) {
  if (!log.length) return <p className="u-muted">Nothing has happened yet.</p>;
  return (
    <div>{log.map((l, i) => (
      <div key={i} className="row" style={{ gap: 13, padding: "8px 0", borderTop: i ? "1px solid var(--line)" : 0 }}>
        <span className="mono u-muted" style={{ fontSize: 12 }}>{l.t}</span><span style={{ fontSize: 14 }}>{l.text}</span>
      </div>
    ))}</div>
  );
}

export function VersionPanel({ versions, setDraft, pushUndo }) {
  if (!versions.length) return <p className="u-muted">No versions yet.</p>;
  return (
    <div>
      <p className="u-muted" style={{ fontSize: 13.5, marginTop: 0 }}>Approved versions are never overwritten.</p>
      {versions.map((v) => (
        <div className="card tight" key={v.n} style={{ marginBottom: 11 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <span className="num">{pad(v.n)}</span>
              <div style={{ fontWeight: 600 }}>{v.label}</div>
              <div className="u-muted" style={{ fontSize: 13 }}>{v.author} · {v.at}</div>
            </div>
            <button className="btn sm" onClick={() => { pushUndo("restore version"); setDraft(v.snapshot); }}>Restore</button>
          </div>
          <div className="u-muted" style={{ fontSize: 13, marginTop: 9 }}>{v.snapshot?.hook}</div>
        </div>
      ))}
    </div>
  );
}

export function NotesPanel({ notes, clear }) {
  if (!notes.length) return <p className="u-muted">You're all caught up.</p>;
  return (
    <div>
      <button className="btn sm" style={{ marginBottom: 14 }} onClick={clear}>Clear all</button>
      {notes.map((n, i) => (
        <div key={i} className="row" style={{ gap: 13, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : 0 }}>
          <span className="mono u-muted" style={{ fontSize: 12 }}>{n.t}</span><span style={{ fontSize: 14 }}>{n.text}</span>
        </div>
      ))}
    </div>
  );
}
