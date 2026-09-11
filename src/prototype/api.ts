/* Backend client. Resolution order for the API base: build-time define →
   runtime override saved in this browser → none, which is LOCAL MODE: the
   app behaves exactly as the standalone build always has and never fetches. */

declare const __API_BASE__: string | undefined;

const OVERRIDE_KEY = "wp-api-base";

export function apiBase(): string {
  try {
    const o = typeof localStorage !== "undefined" ? localStorage.getItem(OVERRIDE_KEY) : null;
    if (o) return o.replace(/\/+$/, "");
  } catch { /* storage unavailable (file://) */ }
  if (typeof __API_BASE__ !== "undefined" && __API_BASE__) return __API_BASE__.replace(/\/+$/, "");
  // Served by the backend itself → same-origin /api works.
  if (typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)) return "";
  return "__local__";
}

export function setApiBaseOverride(url: string) {
  try {
    if (url.trim()) localStorage.setItem(OVERRIDE_KEY, url.trim());
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* ignore */ }
}

export function isRemote(): boolean {
  return apiBase() !== "__local__";
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = apiBase();
  if (base === "__local__") throw new Error("local mode — no backend configured");
  const res = await fetch(base + path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null as T;
  // An SPA-fallback host answers /api/* with 200 + the app's own HTML — that
  // is NOT a backend. Treating it as one turned lists into nulls and
  // white-screened the Tasks view.
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw Object.assign(new Error("no backend at this origin (non-JSON response)"), {
      status: res.status,
      EN9nobackend: true,
    });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && (data as { error?: string }).error) || `HTTP ${res.status}`) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}

export type WorkpaperSummary = {
  id: string; stakeholder: string; entity_name: string; entity_client_id: string;
  version: number; updated_at: string; document_count: number;
};
export type TaskRow = {
  id: string; task_no: number; client: string; sub_client: string; return_type: string;
  tax_year: number | null; assignee_name: string | null; status: "pending" | "in_progress" | "completed";
  workpaper_id: string | null; due_date: string | null; created_at: string; updated_at: string;
  entity_client_id: string | null;
};

export const api = {
  health: () => call<{ ok: boolean }>("GET", "/api/health"),
  listWorkpapers: () => call<WorkpaperSummary[]>("GET", "/api/workpapers"),
  createWorkpaper: (b: { stakeholder: string; entityName: string; entityClientId: string; stateJson: unknown }) =>
    call<{ id: string; version: number }>("POST", "/api/workpapers", b),
  getWorkpaper: (id: string) =>
    call<WorkpaperSummary & { state_json: unknown }>("GET", `/api/workpapers/${id}`),
  putState: (id: string, b: { stateJson: unknown; baseVersion?: number; stakeholder?: string; entityName?: string }) =>
    call<{ id: string; version: number }>("PUT", `/api/workpapers/${id}/state`, b),
  deleteWorkpaper: (id: string) => call<null>("DELETE", `/api/workpapers/${id}`),
  listDocuments: (wpId: string) =>
    call<Array<{ id: string; client_file_id: string; filename: string; size_bytes: number; content_type: string | null }>>(
      "GET", `/api/workpapers/${wpId}/documents`),
  async uploadDocument(wpId: string, clientFileId: string, file: File) {
    const fd = new FormData();
    fd.append("clientFileId", clientFileId);
    fd.append("file", file, file.name);
    const res = await fetch(`${apiBase()}/api/workpapers/${wpId}/documents`, { method: "POST", body: fd, credentials: "include" });
    if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
    return res.json();
  },
  async downloadDocument(docId: string): Promise<ArrayBuffer> {
    const res = await fetch(`${apiBase()}/api/documents/${docId}/content`, { credentials: "include" });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    return res.arrayBuffer();
  },
  postAudit: (wpId: string, events: unknown[]) => call<{ inserted: number }>("POST", `/api/workpapers/${wpId}/audit`, { events }),
  listTasks: () => call<TaskRow[]>("GET", "/api/tasks"),
  createTask: (b: { client: string; subClient: string; taxYear?: number; assigneeName?: string; dueDate?: string; workpaperId?: string }) =>
    call<TaskRow>("POST", "/api/tasks", b),
  patchTask: (id: string, b: Partial<{ status: string; assigneeName: string; dueDate: string | null; workpaperId: string }>) =>
    call<TaskRow>("PATCH", `/api/tasks/${id}`, b),
  deleteTask: (id: string) => call<null>("DELETE", `/api/tasks/${id}`),
  getSetting: <T>(key: string) => call<T | null>("GET", `/api/settings/${key}`),
  putSetting: (key: string, value: unknown) => call<{ ok: boolean }>("PUT", `/api/settings/${key}`, { value }),
};
