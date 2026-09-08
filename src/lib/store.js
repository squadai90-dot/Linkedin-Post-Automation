/* Persistence backend. */
export const STORE_KEY = "unison:session:v1";

/* ---------- persistence backend ----------
   Inside a Claude artifact, window.storage is the sandbox's key-value store.
   Deployed, the same three calls run on localStorage. The value shape is kept
   identical ({ key, value }) so the app code doesn't care which one it got. */
export const persistentStore = (typeof window !== "undefined" && window.storage) ? window.storage : {
  async get(k) { const v = typeof localStorage !== "undefined" ? localStorage.getItem(k) : null; return v == null ? null : { key: k, value: v }; },
  async set(k, v) { localStorage.setItem(k, v); return { key: k, value: v }; },
  async delete(k) { localStorage.removeItem(k); return { key: k, deleted: true }; },
};
