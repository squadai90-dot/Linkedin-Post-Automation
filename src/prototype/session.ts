/* Sync/session state, separate from the work-paper store: backend mode,
   task list, save status. Same subscribe/getSnapshot pattern. */

import type { TaskRow } from "./api";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export type SessionState = {
  remote: boolean;
  connected: boolean | null;        // null = probing
  tasks: TaskRow[];
  saveState: SaveState;
  lastSavedAt: string | null;
  /** entity client id -> server workpaper id */
  workpaperIds: Record<string, string>;
  /** The backend reports whether it has an AI key of its own. Undefined until
      the probe answers; false means "asked, and it has none" — a different
      situation from "not asked yet", and the preparer needs different advice
      in each. */
  aiProxy?: boolean;
  /** Token the backend requires from this browser to use its key. */
  aiToken?: string | null;
  aiTokenRequired?: boolean;
};

let state: SessionState = {
  remote: false,
  connected: null,
  tasks: [],
  saveState: "idle",
  lastSavedAt: null,
  workpaperIds: {},
  aiProxy: undefined,
  aiToken: null,
  aiTokenRequired: false,
};

const listeners = new Set<() => void>();

export function sessionSubscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const sessionSnapshot = () => state;
export function setSession(patch: Partial<SessionState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
