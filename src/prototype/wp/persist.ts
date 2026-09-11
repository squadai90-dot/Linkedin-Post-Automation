/* Remote-mode persistence. Local mode registers nothing and the app behaves
   exactly as the standalone build always has.

   Sync model: entity state (blobless) autosaves to the backend, debounced,
   with optimistic versioning; document bytes upload on add and download on
   hydration so re-processing has real File objects; audit events append
   (deduped server-side) and drive task auto-advance; global policies sync
   through the settings endpoint. The Groq key never leaves the browser. */

import { api, isRemote } from "../api";
import { setSession, sessionSnapshot } from "../session";
import {
  getSnapshot, loadState, makeEntity, registerStoreHooks, toast,
  type Entity, type EntityFile, type WpState,
} from "./store";

const versions: Record<string, number> = {};        // entityClientId -> server version
const postedEvents = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushMaxTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

export function serializeEntity(e: Entity) {
  return { ...e, files: e.files.map(({ blob: _blob, ...meta }) => meta) };
}

function deserializeEntity(raw: unknown, filesById: Map<string, File>): Entity {
  const base = makeEntity("Entity", "");
  const stored = raw as Entity;
  const files: EntityFile[] = (stored.files || []).map((f) => ({
    ...f,
    blob: filesById.get(f.id) || new File([], f.name),
  }));
  return { ...base, ...stored, files };
}

async function ensureWorkpaper(ent: Entity): Promise<string> {
  const s = sessionSnapshot();
  const existing = s.workpaperIds[ent.id];
  if (existing) return existing;
  const created = await api.createWorkpaper({
    stakeholder: getSnapshot().stakeholder,
    entityName: ent.profile.legalName || ent.name,
    entityClientId: ent.id,
    stateJson: serializeEntity(ent),
  });
  // A null create (204 / parse failure) must fail loudly ONCE — dereferencing
  // it made every autosave flush throw the same TypeError forever.
  if (!created?.id) throw new Error("createWorkpaper returned no record");
  versions[ent.id] = created.version;
  setSession({ workpaperIds: { ...sessionSnapshot().workpaperIds, [ent.id]: created.id } });
  return created.id;
}

async function flush() {
  if (flushing) return;
  const state = getSnapshot();
  if (state.entities.some((e) => e.status === "processing")) return;   // mid-run states are noise
  flushing = true;
  setSession({ saveState: "saving" });
  try {
    for (const ent of state.entities) {
      const wpId = await ensureWorkpaper(ent);
      try {
        const r = await api.putState(wpId, {
          stateJson: serializeEntity(ent),
          baseVersion: versions[ent.id],
          stakeholder: state.stakeholder,
          entityName: ent.profile.legalName || ent.name,
        });
        versions[ent.id] = r.version;
      } catch (err) {
        if ((err as { status?: number }).status === 409) {
          setSession({ saveState: "conflict" });
          toast("Another session updated this workpaper — reload to pick up the latest version.", "bad");
          flushing = false;
          return;
        }
        throw err;
      }
      // Audit events for this entity (they reference it by name).
      const evs = state.events
        .filter((ev) => !postedEvents.has(ev.id) && (ev.entity === ent.name || ev.entity === null))
        .slice(0, 200);
      if (evs.length) {
        await api.postAudit(wpId, evs);
        evs.forEach((ev) => postedEvents.add(ev.id));
      }
    }
    setSession({ saveState: "saved", lastSavedAt: new Date().toLocaleTimeString() });
    void refreshTasks();
  } catch (err) {
    setSession({ saveState: "error" });
    console.warn("sync failed:", err);
  } finally {
    flushing = false;
  }
}

function scheduleFlush() {
  setSession({ saveState: "dirty" });
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 1500);
  if (!flushMaxTimer) {
    flushMaxTimer = setTimeout(() => { flushMaxTimer = null; void flush(); }, 10000);
  }
}

export async function refreshTasks() {
  try {
    setSession({ tasks: (await api.listTasks()) || [] });
  } catch { /* transient */ }
}

async function hydrateAll() {
  const list = (await api.listWorkpapers()) || [];
  if (!list.length) return;
  const entities: Entity[] = [];
  const ids: Record<string, string> = {};
  for (const wp of list) {
    const full = await api.getWorkpaper(wp.id);
    const docs = await api.listDocuments(wp.id);
    const filesById = new Map<string, File>();
    for (const d of docs) {
      try {
        const bytes = await api.downloadDocument(d.id);
        filesById.set(d.client_file_id, new File([bytes], d.filename, { type: d.content_type || undefined }));
      } catch { /* keep the placeholder; re-processing will flag it */ }
    }
    const ent = deserializeEntity(full.state_json, filesById);
    entities.push(ent);
    ids[ent.id] = wp.id;
    versions[ent.id] = full.version;
  }
  const cur = getSnapshot();
  loadState({ ...cur, stakeholder: list[0].stakeholder || cur.stakeholder, entities, activeEntityId: entities[0].id });
  setSession({ workpaperIds: ids });
}

async function syncPolicies() {
  try {
    const remote = await api.getSetting<WpState["policies"]>("policies");
    if (Array.isArray(remote) && remote.length && !getSnapshot().policies.length) {
      loadState({ ...getSnapshot(), policies: remote });
    }
  } catch { /* transient */ }
}

/** Boot the remote mode. Call once at app start; a no-op in local mode. */
export async function initPersistence() {
  if (!isRemote()) return;
  setSession({ remote: true, connected: null });
  try {
    await api.health();
  } catch {
    setSession({ connected: false });
    return;   // backend unreachable — behave like local mode, keep the probe result visible
  }
  setSession({ connected: true });
  await syncPolicies();
  try {
    await hydrateAll();
  } catch (err) {
    console.warn("hydration failed:", err);
  }
  void refreshTasks();

  registerStoreHooks({
    onMutate(patch) {
      // Anything except pure UI feedback is worth persisting — generation,
      // for instance, only touches usage counters but must flush its audit
      // events (they drive task auto-advance).
      const keys = Object.keys(patch).filter((k) => k !== "toast" && k !== "busy");
      if (keys.length) scheduleFlush();
      if (patch.policies) void api.putSetting("policies", patch.policies).catch(() => undefined);
    },
    onFilesAdded(entityId, files) {
      void (async () => {
        const ent = getSnapshot().entities.find((e) => e.id === entityId);
        if (!ent) return;
        const wpId = await ensureWorkpaper(ent);
        for (const f of files) {
          try {
            await api.uploadDocument(wpId, f.id, f.blob);
          } catch (err) {
            toast(`${f.name} could not be uploaded to the backend — it exists only in this tab.`, "bad");
            console.warn("upload failed:", err);
          }
        }
      })();
    },
  });

  window.addEventListener("beforeunload", (e) => {
    if (sessionSnapshot().saveState === "dirty" || sessionSnapshot().saveState === "saving") {
      e.preventDefault();
    }
  });
}

/** Open (or create) the workpaper behind a task and return the entity id. */
export async function openTaskWorkpaper(task: { workpaper_id: string | null; entity_client_id: string | null; client: string; sub_client: string; id: string }): Promise<string | null> {
  const state = getSnapshot();
  if (task.entity_client_id) {
    const existing = state.entities.find((e) => e.id === task.entity_client_id);
    if (existing) return existing.id;
  }
  // No workpaper yet: create a fresh entity named after the task's sub-client.
  const ent = makeEntity(task.sub_client, task.client || state.stakeholder);
  loadState({ ...state, entities: [...state.entities, ent], activeEntityId: ent.id });
  try {
    const wpId = await ensureWorkpaper(ent);
    await api.patchTask(task.id, { workpaperId: wpId });
    void refreshTasks();
  } catch { /* backend hiccup — entity still usable locally */ }
  return ent.id;
}
