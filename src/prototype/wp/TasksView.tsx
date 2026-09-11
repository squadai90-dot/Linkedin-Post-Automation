"use client";

/* Task management — the ops board: who is preparing which return and where
   it stands. Statuses advance automatically from workpaper events
   (processed → in progress, generated → completed) and can be set by hand.
   Assignees are plain names until Microsoft sign-in lands. */

import { useEffect, useState, useSyncExternalStore } from "react";
import { Callout, SectionHeader } from "../primitives";
import { api, type TaskRow } from "../api";
import { sessionSnapshot, sessionSubscribe } from "../session";
import { openTaskWorkpaper, refreshTasks } from "./persist";
import { actions, getSnapshot, subscribe } from "./store";
import type { ViewId } from "../Shell";

const STATUS_META: Record<TaskRow["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "actor-tag user" },
  in_progress: { label: "In progress", cls: "actor-tag groq" },
  completed: { label: "Completed", cls: "actor-tag system" },
};

export function TasksView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const session = useSyncExternalStore(sessionSubscribe, sessionSnapshot, sessionSnapshot);
  const wp = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [draft, setDraft] = useState({ client: "", subClient: "", taxYear: "", assigneeName: "", dueDate: "" });
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (session.remote && session.connected) void refreshTasks();
  }, [session.remote, session.connected]);

  // The guard runs BEFORE any dereference of session.tasks: a broken or
  // absent backend must degrade to the friendly callout, never a white
  // screen. Array.isArray also catches a null smuggled in by an SPA-fallback
  // host answering /api/* with its own HTML.
  if (!session.remote || session.connected === false || !Array.isArray(session.tasks)) {
    return (
      <div className="view-stack">
        <SectionHeader kicker="Operations" title="Task management" description="Create and assign preparation tasks, and track each return from pending to completed." />
        <Callout title="Task management is currently unavailable — backend connection required" tone="amber">
          Task management needs the backend service. {session.remote
            ? "The configured backend did not respond — check the URL under Settings ▸ Backend."
            : "This build is running in local mode: open the app from its server URL, or set the backend URL under Settings ▸ Backend."}
        </Callout>
      </div>
    );
  }

  const names = [...new Set(session.tasks.map((t) => t.assignee_name).filter(Boolean))] as string[];

  const create = async () => {
    if (!draft.client.trim() || !draft.subClient.trim()) return;
    setCreating(true);
    try {
      await api.createTask({
        client: draft.client.trim(),
        subClient: draft.subClient.trim(),
        taxYear: draft.taxYear ? Number(draft.taxYear) : undefined,
        assigneeName: draft.assigneeName.trim() || undefined,
        dueDate: draft.dueDate || undefined,
      });
      setDraft({ client: "", subClient: "", taxYear: "", assigneeName: "", dueDate: "" });
      await refreshTasks();
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (t: TaskRow, status: TaskRow["status"]) => {
    setBusyId(t.id);
    try { await api.patchTask(t.id, { status }); await refreshTasks(); } finally { setBusyId(null); }
  };

  const open = async (t: TaskRow) => {
    setBusyId(t.id);
    try {
      const entityId = await openTaskWorkpaper(t);
      if (entityId) {
        actions.setActiveEntity(entityId);
        onNavigate("entities");
      }
    } finally {
      setBusyId(null);
    }
  };

  const counts = {
    pending: session.tasks.filter((t) => t.status === "pending").length,
    in_progress: session.tasks.filter((t) => t.status === "in_progress").length,
    completed: session.tasks.filter((t) => t.status === "completed").length,
  };

  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Operations"
        title="Task management"
        description="Create a task per return, assign it, and watch it advance: processing a workpaper moves its task to in progress, generating the workbook completes it."
      />

      <div className="metric-grid">
        <div className="metric-card warn"><strong>{counts.pending}</strong><span>Pending</span><em>not started</em></div>
        <div className="metric-card"><strong>{counts.in_progress}</strong><span>In progress</span><em>being prepared</em></div>
        <div className="metric-card"><strong>{counts.completed}</strong><span>Completed</span><em>workbook generated</em></div>
        <div className="metric-card"><strong>{session.tasks.length}</strong><span>Total tasks</span><em>{session.saveState === "saved" ? `synced ${session.lastSavedAt ?? ""}` : session.saveState}</em></div>
      </div>

      <section className="panel">
        <div className="panel-heading"><div><span className="section-kicker">New task</span><h2>Create and assign</h2></div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="stake-input" style={{ maxWidth: 180 }} placeholder="Client / stakeholder" value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })} />
          <input className="stake-input" style={{ maxWidth: 220 }} placeholder="Entity (sub-client)" value={draft.subClient} onChange={(e) => setDraft({ ...draft, subClient: e.target.value })} />
          <input className="stake-input" style={{ maxWidth: 90 }} placeholder="Tax year" value={draft.taxYear} onChange={(e) => setDraft({ ...draft, taxYear: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
          <input className="stake-input" style={{ maxWidth: 150 }} placeholder="Assignee" list="wp-assignees" value={draft.assigneeName} onChange={(e) => setDraft({ ...draft, assigneeName: e.target.value })} />
          <datalist id="wp-assignees">{names.map((n) => <option key={n} value={n} />)}</datalist>
          <input className="stake-input" style={{ maxWidth: 150 }} type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
          <button type="button" className="button primary" disabled={creating || !draft.client.trim() || !draft.subClient.trim()} onClick={() => void create()}>
            {creating ? "Creating…" : "+ Add task"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><span className="section-kicker">{session.tasks.length} tasks</span><h2>All tasks</h2></div>
          <button type="button" className="button" onClick={() => void refreshTasks()}>Refresh</button>
        </div>
        <div className="wp-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 76 }}>Task</th><th style={{ width: 92 }}>Date</th><th>Client</th><th>Entity</th>
                <th style={{ width: 64 }}>Return</th><th style={{ width: 64 }}>Year</th><th style={{ width: 120 }}>Assignee</th>
                <th style={{ width: 120 }}>Status</th><th style={{ width: 200 }} />
              </tr>
            </thead>
            <tbody>
              {session.tasks.map((t) => {
                const meta = STATUS_META[t.status];
                const linkedOpen = t.entity_client_id && wp.entities.some((e) => e.id === t.entity_client_id);
                return (
                  <tr key={t.id}>
                    <td className="ref-cell">T-{String(t.task_no).padStart(4, "0")}</td>
                    <td>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td><strong>{t.client}</strong></td>
                    <td>{t.sub_client}{t.due_date ? <small style={{ display: "block", color: "var(--muted)" }}>due {t.due_date}</small> : null}</td>
                    <td>{t.return_type}</td>
                    <td>{t.tax_year ?? "—"}</td>
                    <td>{t.assignee_name || "—"}</td>
                    <td>
                      <span className={meta.cls}>{meta.label}</span>
                      <select
                        className="stake-input"
                        style={{ display: "block", marginTop: 4, padding: "1px 4px", fontSize: 12 }}
                        value={t.status}
                        disabled={busyId === t.id}
                        onChange={(e) => void setStatus(t, e.target.value as TaskRow["status"])}
                      >
                        <option value="pending">pending</option>
                        <option value="in_progress">in progress</option>
                        <option value="completed">completed</option>
                      </select>
                    </td>
                    <td>
                      <button type="button" className="button" disabled={busyId === t.id} onClick={() => void open(t)}>
                        {linkedOpen || t.workpaper_id ? "Open workpaper" : "Start workpaper"}
                      </button>{" "}
                      <button
                        type="button"
                        className="button"
                        disabled={busyId === t.id}
                        onClick={() => { if (window.confirm(`Delete task T-${String(t.task_no).padStart(4, "0")}?`)) void api.deleteTask(t.id).then(refreshTasks); }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!session.tasks.length ? <p className="hint" style={{ padding: "10px 4px" }}>No tasks yet — create the first one above.</p> : null}
        </div>
      </section>
    </div>
  );
}
