/* Local persistence: the whole project — files, entities, calculations,
   edits, mappings, translations, policies, the rate database — survives
   refresh, navigation and reopening the browser, in IndexedDB. In remote
   mode the server remains the source of truth (its hydration overwrites the
   local restore); the local copy still refreshes so a later offline open
   shows the last known state. Reset Project clears everything, behind a
   confirmation. */

import {
  getSnapshot, loadState, registerStoreHooks, toast,
  type Entity, type EntityFile, type WpState,
} from "./store";

const DB_NAME = "wp-local";
const KV = "kv";
const FILES = "files";

let db: IDBDatabase | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savedFileKeys = new Set<string>();
let disabled = false;   // set by resetProject so the unload save cannot resurrect data

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
        if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);   // IndexedDB unavailable (some file:// contexts) — run without persistence
    }
  });
}

const tx = <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> =>
  new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

function serialize(state: WpState) {
  return {
    ...state,
    busy: false,
    toast: null,
    entities: state.entities.map((e) => ({ ...e, files: e.files.map(({ blob: _b, ...meta }) => meta) })),
  };
}

async function persistNow() {
  if (!db || disabled) return;
  const state = getSnapshot();
  if (state.entities.some((e) => e.status === "processing")) return;
  await tx(KV, "readwrite", (s) => s.put(serialize(state), "state"));

  // Blobs: write new files, remove deleted ones.
  const wanted = new Map<string, File>();
  for (const e of state.entities) for (const f of e.files) wanted.set(`${e.id}/${f.id}`, f.blob);
  for (const [key, blob] of wanted) {
    if (savedFileKeys.has(key)) continue;
    if (blob && blob.size > 0) {
      await tx(FILES, "readwrite", (s) => s.put(blob, key));
      savedFileKeys.add(key);
    }
  }
  for (const key of [...savedFileKeys]) {
    if (!wanted.has(key)) {
      await tx(FILES, "readwrite", (s) => s.delete(key));
      savedFileKeys.delete(key);
    }
  }
}

function scheduleSave() {
  if (!db || disabled) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void persistNow(); }, 800);
}

/** Restore the saved project into the store. Returns true when restored. */
async function restore(): Promise<boolean> {
  const raw = await tx<ReturnType<typeof serialize>>(KV, "readonly", (s) => s.get("state"));
  if (!raw || !raw.entities?.length) return false;

  const keys = (await tx<IDBValidKey[]>(FILES, "readonly", (s) => s.getAllKeys())) || [];
  const blobs = new Map<string, Blob>();
  for (const k of keys) {
    const b = await tx<Blob>(FILES, "readonly", (s) => s.get(k));
    if (b) blobs.set(String(k), b);
  }
  savedFileKeys = new Set(blobs.keys());

  const cur = getSnapshot();
  const entities: Entity[] = raw.entities.map((stored) => ({
    ...(stored as unknown as Entity),
    files: ((stored as unknown as Entity).files || []).map((f): EntityFile => {
      const blob = blobs.get(`${(stored as unknown as Entity).id}/${f.id}`);
      return { ...f, blob: blob ? new File([blob], f.name) : new File([], f.name) };
    }),
  }));
  loadState({
    ...cur,
    ...(raw as unknown as WpState),
    entities,
    activeEntityId: entities.some((e) => e.id === raw.activeEntityId) ? raw.activeEntityId : entities[0].id,
    busy: false,
    toast: null,
  });
  return true;
}

/** Boot local persistence: restore the last session, then autosave every
    mutation (debounced). Safe no-op when IndexedDB is unavailable. */
export async function initLocalPersistence(): Promise<boolean> {
  db = await openDb();
  if (!db) return false;
  let restored = false;
  try {
    restored = await restore();
    if (restored) toast("Project restored from this browser", "ok");
  } catch (err) {
    console.warn("local restore failed:", err);
  }
  registerStoreHooks({
    onMutate(patch) {
      const keys = Object.keys(patch).filter((k) => k !== "toast" && k !== "busy");
      if (keys.length) scheduleSave();
    },
    onFilesAdded() { scheduleSave(); },
  });
  window.addEventListener("beforeunload", () => { void persistNow(); });
  return restored;
}

/** Permanently clear the local project. The caller confirms first. */
export async function resetProject(): Promise<void> {
  disabled = true;                    // no save may run after this point
  if (saveTimer) clearTimeout(saveTimer);
  await tx(KV, "readwrite", (s) => s.clear());
  await tx(FILES, "readwrite", (s) => s.clear());
  savedFileKeys = new Set();
}
