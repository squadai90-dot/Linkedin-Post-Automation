"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { BrandMark } from "./wp/BrandMark";
import { Toaster } from "./wp/Toaster";
import { getSnapshot, subscribe } from "./wp/store";
import { sessionSnapshot, sessionSubscribe } from "./session";

export type ViewId =
  | "overview"
  | "tasks"
  | "portfolio"
  | "entities"
  | "workspace"
  | "intake"
  | "evidence"
  | "category"
  | "mapping"
  | "fx"
  | "preview"
  | "workpaper"
  | "exceptions"
  | "audit"
  | "signoff"
  | "settings";

export const NAV_ITEMS: Array<{ id: ViewId; label: string; marker: string }> = [
  { id: "overview", label: "Executive overview", marker: "01" },
  { id: "tasks", label: "Task management", marker: "02" },
  { id: "portfolio", label: "Portfolio dashboard", marker: "03" },
  { id: "entities", label: "Entities & documents", marker: "04" },
  { id: "workspace", label: "Entity workspace", marker: "05" },
  { id: "intake", label: "Document intake", marker: "06" },
  { id: "evidence", label: "Multilingual evidence", marker: "07" },
  { id: "category", label: "Ownership & category", marker: "08" },
  { id: "mapping", label: "Mapping & adjustments", marker: "09" },
  { id: "fx", label: "FX policy & rates", marker: "10" },
  { id: "preview", label: "Workpaper preview", marker: "11" },
  { id: "workpaper", label: "Workpaper readiness", marker: "12" },
  { id: "exceptions", label: "Exception center", marker: "13" },
  { id: "audit", label: "Audit trail", marker: "14" },
  { id: "signoff", label: "Review & sign-off", marker: "15" },
  { id: "settings", label: "Settings", marker: "16" },
];

type ShellProps = {
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
  children: ReactNode;
};

export function Shell({ activeView, onNavigate, children }: ShellProps) {
  const activeLabel = NAV_ITEMS.find((item) => item.id === activeView)?.label;
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const session = useSyncExternalStore(sessionSubscribe, sessionSnapshot, sessionSnapshot);
  const stakeholder = state.stakeholder;
  const entityCount = state.entities.length;
  const docCount = state.entities.reduce((n, e) => n + e.files.length, 0);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <strong>5471 Work Paper</strong>
            <span>Tax Intelligence Suite</span>
          </div>
        </div>
        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeView === item.id ? "nav-item active" : "nav-item"}
              onClick={() => onNavigate(item.id)}
              aria-current={activeView === item.id ? "page" : undefined}
            >
              <span>{item.marker}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          {session.remote
            ? session.connected === false
              ? "Backend unreachable · working locally"
              : session.saveState === "saved"
                ? `Synced · saved ${session.lastSavedAt ?? ""}`
                : session.saveState === "dirty" || session.saveState === "saving"
                  ? "Syncing…"
                  : session.saveState === "conflict"
                    ? "Sync conflict · reload"
                    : "Connected to backend"
            : "Runs locally · no data leaves this browser"}
        </div>
      </aside>
      <div className="workspace-shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">Stakeholder review</span>
            <strong>{activeLabel}</strong>
          </div>
          <div className="topbar-meta">
            <span>{stakeholder}</span>
            <span>{entityCount} entit{entityCount === 1 ? "y" : "ies"}</span>
            <span>{docCount} document{docCount === 1 ? "" : "s"}</span>
          </div>
        </header>
        <main className="main-content" id="main-content" tabIndex={-1}>{children}</main>
        <Toaster />
      </div>
    </div>
  );
}
