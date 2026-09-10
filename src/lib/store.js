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

/* Optional shared secret for the deployed relays (UNISON_RELAY_TOKEN on the
   server). Stored on this device only. */
export const RELAY_TOKEN_KEY = "unison:relay-token";
export const relayAuthHeaders = () => { try { const t = localStorage.getItem(RELAY_TOKEN_KEY); return t ? { "X-Unison-Token": t } : {}; } catch { return {}; } };
export const getRelayToken = () => { try { return localStorage.getItem(RELAY_TOKEN_KEY) || ""; } catch { return ""; } };
export const setRelayToken = (t) => { try { if (t) localStorage.setItem(RELAY_TOKEN_KEY, String(t).trim()); else localStorage.removeItem(RELAY_TOKEN_KEY); } catch { /* ignore */ } };

/* ---------- restoring a saved session ----------
   A saved blob can be from an older build, hand-edited, or half-written. It
   is data from outside the running code, so every field is checked before it
   reaches React state — a wrong type must never take the app down. */
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : undefined);
const asObj = (v) => (isObj(v) ? v : undefined);
const asStr = (v) => (typeof v === "string" ? v : undefined);
const asBool = (v) => (typeof v === "boolean" ? v : undefined);

/* Field name -> the shape it must have. Anything failing its check is
   dropped, so a bad field costs that one feature, not the session. */
const SHAPE = {
  theme: asStr, idea: asStr, stage: asStr, workId: asStr, tone: asStr, pov: asStr, length: asStr,
  publishState: asStr, publishVia: asStr, publishError: asStr, publishKind: asStr,
  steps: asArray, drafts: asArray, versions: asArray, posts: asArray, team: asArray,
  notes: asArray, audit: asArray, sentKeys: asArray, attempts: asArray, publishLimits: asArray,
  research: asObj, angles: asObj, angle: asObj, draft: asObj, verification: asObj, quality: asObj,
  media: asObj, assets: asObj, schedule: asObj, analytics: asObj, voice: asObj, profile: asObj,
  makeCompany: asObj, usage: asObj, opps: asObj, extras: asObj,
  searchOn: asBool, bg3d: asBool, publishUnverified: asBool, setupHidden: asBool,
};

export function sanitizeSession(raw) {
  let d;
  try { d = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  if (!isObj(d)) return null;
  const out = {};
  for (const [key, check] of Object.entries(SHAPE)) {
    if (!(key in d)) continue;
    const v = check(d[key]);
    if (v !== undefined) out[key] = v;
  }
  /* formats was a string in older saves and an array now; both are accepted
     and normalised by the caller. */
  if (Array.isArray(d.formats) || typeof d.formats === "string") out.formats = d.formats;
  else if (typeof d.format === "string") out.formats = d.format;
  return out;
}
