"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import { Callout } from "./primitives";
import { NAV_ITEMS, Shell, type ViewId } from "./Shell";
import { TasksView } from "./wp/TasksView";
import { initPersistence } from "./wp/persist";
import { initLocalPersistence } from "./wp/localStore";
import {
  CategoryView, ExceptionsView, IntakeView, MappingView, OverviewView,
  PortfolioView, ReadinessView, SignoffView, WorkspaceView,
} from "./wp/CoreViews";
import { AuditTrailView } from "./wp/AuditTrailView";
import { EntitiesView } from "./wp/EntitiesView";
import { EvidenceView } from "./wp/EvidenceRealView";
import { FxRatesView } from "./wp/FxRatesView";
import { PreviewView } from "./wp/PreviewView";
import { SettingsView } from "./wp/SettingsView";
import { Splash } from "./wp/Splash";
import { safeReplaceState } from "./wp/safeBrowser";

type AppProps = { initialView: string };

/* One crashing view must never take the whole app with it: the boundary
   keeps the shell alive and, keyed on the active view, resets itself the
   moment the user navigates elsewhere. */
class ViewBoundary extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: unknown) { console.error("view crashed:", e); }
  render() {
    if (this.state.err) {
      return (
        <div className="view-stack">
          <Callout title="This view hit an error" tone="amber">
            This view hit an error — switch views or reload the page. Details are in the browser console.
          </Callout>
        </div>
      );
    }
    return this.props.children;
  }
}

function normalizeView(value: string): ViewId {
  return NAV_ITEMS.some((item) => item.id === value) ? (value as ViewId) : "overview";
}

export function PrototypeApp({ initialView }: AppProps) {
  const [activeView, setActiveView] = useState<ViewId>(normalizeView(initialView));

  // Local persistence restores the last session first; remote mode then
  // hydrates over it when a backend is configured (the server is the truth).
  useEffect(() => { void initLocalPersistence().then(() => initPersistence()); }, []);

  const navigate = (view: ViewId) => {
    setActiveView(view);
    safeReplaceState(`?view=${view}`);
  };

  let content = <OverviewView onNavigate={navigate} />;
  if (activeView === "tasks") content = <TasksView onNavigate={navigate} />;
  if (activeView === "portfolio") content = <PortfolioView onNavigate={navigate} />;
  if (activeView === "entities") content = <EntitiesView />;
  if (activeView === "workspace") content = <WorkspaceView onNavigate={navigate} />;
  if (activeView === "intake") content = <IntakeView onNavigate={navigate} />;
  if (activeView === "evidence") content = <EvidenceView />;
  if (activeView === "category") content = <CategoryView />;
  if (activeView === "mapping") content = <MappingView />;
  if (activeView === "fx") content = <FxRatesView />;
  if (activeView === "preview") content = <PreviewView onNavigate={navigate} />;
  if (activeView === "workpaper") content = <ReadinessView onNavigate={navigate} />;
  if (activeView === "exceptions") content = <ExceptionsView onNavigate={navigate} />;
  if (activeView === "audit") content = <AuditTrailView />;
  if (activeView === "signoff") content = <SignoffView onNavigate={navigate} />;
  if (activeView === "settings") content = <SettingsView />;

  return (
    <>
      <Splash />
      <Shell activeView={activeView} onNavigate={navigate}>
        <ViewBoundary key={activeView}>{content}</ViewBoundary>
      </Shell>
    </>
  );
}
