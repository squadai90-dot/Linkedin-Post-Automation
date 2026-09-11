"use client";

import { useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "./store";

export function Toaster() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!state.toast) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className={`toast ${state.toast.kind}`} key={state.toast.id}>{state.toast.text}</div>
    </div>
  );
}
