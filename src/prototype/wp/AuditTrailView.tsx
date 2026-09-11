"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Callout, SectionHeader } from "../primitives";
import { getSnapshot, safeDownloadJson, subscribe } from "./store";

const ACTORS = ["all", "user", "system", "groq"] as const;

export function AuditTrailView() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [actor, setActor] = useState<(typeof ACTORS)[number]>("all");
  const [entity, setEntity] = useState("all");

  const filtered = useMemo(
    () =>
      state.events.filter(
        (e) => (actor === "all" || e.actor === actor) && (entity === "all" || e.entity === entity),
      ),
    [state.events, actor, entity],
  );

  const entityNames = [...new Set(state.events.map((e) => e.entity).filter(Boolean))] as string[];

  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Provenance"
        title="Audit trail"
        description="Every action taken in this session, in order, with the entity it applied to. This is the real event log — it grows as you work and exports as JSON for the engagement file."
        action={
          <button
            type="button"
            className="button"
            disabled={!state.events.length}
            onClick={() => safeDownloadJson(state)}
          >
            Export audit log
          </button>
        }
      />

      <div className="metric-grid">
        <div className="metric-card"><strong>{state.events.length}</strong><span>Recorded events</span><em>this session</em></div>
        <div className="metric-card"><strong>{state.events.filter((e) => e.actor === "user").length}</strong><span>User actions</span><em>manual input</em></div>
        <div className="metric-card"><strong>{state.events.filter((e) => e.actor === "system").length}</strong><span>System actions</span><em>processing and output</em></div>
        <div className="metric-card"><strong>{state.events.filter((e) => e.actor === "groq").length}</strong><span>AI actions</span><em>label mapping only</em></div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">{filtered.length} shown</span>
            <h2>Event log</h2>
          </div>
          <div className="signoff-actions">
            <select className="stake-input" value={actor} onChange={(e) => setActor(e.target.value as typeof actor)}>
              {ACTORS.map((a) => <option key={a} value={a}>{a === "all" ? "All actors" : a}</option>)}
            </select>
            <select className="stake-input" value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="all">All entities</option>
              {entityNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {filtered.length ? (
          <div className="wp-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 92 }}>Time</th>
                  <th style={{ width: 70 }}>Actor</th>
                  <th style={{ width: 170 }}>Action</th>
                  <th>Detail</th>
                  <th style={{ width: 140 }}>Entity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ev) => (
                  <tr key={ev.id}>
                    <td className="ref-cell">{new Date(ev.at).toLocaleTimeString()}</td>
                    <td><span className={`actor-tag ${ev.actor}`}>{ev.actor}</span></td>
                    <td><strong>{ev.action}</strong></td>
                    <td style={{ color: "var(--muted)" }}>{ev.detail}</td>
                    <td>{ev.entity || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <span>◦</span>
            <strong>{state.events.length ? "No events match this filter" : "No events recorded yet"}</strong>
            <p>{state.events.length ? "Clear the filters to see the full log." : "Add an entity or load a document and the log starts filling in."}</p>
          </div>
        )}
      </section>

      <Callout title="What is recorded" tone="teal">
        Entity creation, renaming and removal; every document added or removed with its byte size; processing runs and
        their outcome; manual and AI label assignments; mapping-rule edits; and every work paper generated with its
        filename and cell count.
      </Callout>
    </div>
  );
}
