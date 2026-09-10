import { relayAuthHeaders } from "./store.js";


/* ============================================================
   AI LAYER — router, registry, providers
   Nothing above this line knows a model name. Components ask the
   router for a capability; the router picks the provider.
   ============================================================ */

/* Build-time defaults. Vite inlines VITE_* at build time, so a key set this
   way ends up inside the bundle — fine for a build that never leaves the
   team, wrong for a public URL. There, deploy the relay (api/ai.js) and keep
   the key on the server. Settings → AI always wins over this. */
const envVar = (name) => {
  try { return (import.meta.env?.[name] || "").trim(); } catch { return ""; }
};

export const PROVIDERS = {
  groq: {
    id: "groq",
    label: "Groq",
    free: true,
    endpoint: "https://api.groq.com/openai/v1",
    keyPlaceholder: "gsk_…",
    keyUrl: "https://console.groq.com/keys",
    /* Groq's free tier is metered per day and the counters reset every 24h,
       which is why it is the default for an internal tool. */
    note: "Free tier. Daily request and token limits reset every 24 hours.",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    free: false,
    endpoint: "https://api.anthropic.com/v1/messages",
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
    note: "Paid per token. Use when a draft needs the strongest model available.",
  },
};

export const AI_CONFIG = {
  provider: envVar("VITE_AI_PROVIDER") || "groq",   // groq | anthropic
  keys: { groq: envVar("VITE_GROQ_API_KEY"), anthropic: envVar("VITE_ANTHROPIC_API_KEY") },
  models: { groq: "llama-3.3-70b-versatile", anthropic: "claude-opus-5" },
  /* Groq runs web search inside the compound models rather than as a tool,
     so a search call swaps the model instead of attaching one. */
  searchModel: "groq/compound",
  /* Per-tier overrides; empty means "use TIER_DEFAULTS". */
  tiers: { groq: { fast: "", strong: "" }, anthropic: { fast: "", strong: "" } },
  useTiers: true,        // route each capability to its tier rather than one model
  autoDowngrade: true,   // when the day's allowance for a model is spent, drop a tier instead of giving up
  effort: "medium",              // low | medium | high — Anthropic thinking depth
  temperature: 0.6,
  /* Deployed with the optional relay, AI calls go through Unison's own API,
     which holds the key. Frontend-only, the key lives in this browser's
     localStorage (Settings → AI) and the call goes straight to the provider. */
  aiRelayEndpoint: (typeof window !== "undefined" && window.UNISON_AI_API) || "/api/ai",
  ollamaEndpoint: "http://localhost:11434",
  localModel: "nemotron3",       // the Ollama tag used for every text capability
  useLocal: false,               // off by default: the probe costs 1.5s and most machines have no Ollama
  probeTimeoutMs: 1500,
  maxTokens: 4000,
};

export const activeProvider = () => PROVIDERS[AI_CONFIG.provider] || PROVIDERS.groq;
export const activeKey = () => String(AI_CONFIG.keys[AI_CONFIG.provider] || "").trim();
export const activeModel = () => AI_CONFIG.models[AI_CONFIG.provider] || "";

/* Models the team can pick from, with list prices per million tokens
   (input, output) for the running cost estimate. Zero means free tier.

   Groq deprecates and adds ids faster than a release cycle, so this list is
   the offline fallback and the source of the notes — the picker refreshes it
   from GET /models whenever a key is present. */
export const MODELS = {
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", rates: [0, 0], note: "Best all-round free model — default" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", rates: [0, 0], note: "Strongest reasoning on the free tier" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", rates: [0, 0], note: "Faster, still good at structure" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", rates: [0, 0], note: "Fastest; use for short rewrites" },
    { id: "qwen/qwen3-32b", label: "Qwen 3 32B", rates: [0, 0], note: "Careful reasoning, slower" },
    { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2", rates: [0, 0], note: "Long context, strong writing" },
    { id: "groq/compound", label: "Compound (web search)", rates: [0, 0], search: true, note: "Searches the web while answering" },
    { id: "groq/compound-mini", label: "Compound mini (web search)", rates: [0, 0], search: true, note: "Faster search, shallower" },
  ],
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5", rates: [5, 25], search: true, note: "Best quality" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", rates: [2, 10], search: true, note: "Fast and cheaper" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", rates: [1, 5], search: true, note: "Cheapest; simple tasks" },
  ],
};

/* Ids the picker learned from GET /models this session, merged over MODELS.
   Tied to the key that produced it: a different key is a different account
   with a different entitlement list, so keeping the old one would let a
   stale list veto models the new key can use. */
const discovered = { groq: null };

export const resetDiscovered = () => { discovered.groq = null; };

/* ---------- model tiers (#3) ----------
   One model for every job wastes the free allowance on rewrites and
   under-serves the draft, which is the one output a human actually reads.
   Capabilities name a tier; the tier resolves to a model per provider.

   "standard" is whatever the Model picker is set to, so the visible control
   still means what it says. The other two are derived from it and can be
   overridden in Settings. */
export const TIERS = ["fast", "standard", "strong"];

export const TIER_DEFAULTS = {
  groq:      { fast: "llama-3.1-8b-instant", strong: "openai/gpt-oss-120b" },
  anthropic: { fast: "claude-haiku-4-5", strong: "claude-opus-5" },
};

export function modelForTier(tier, provider = AI_CONFIG.provider) {
  if (tier === "standard" || !TIERS.includes(tier)) return AI_CONFIG.models[provider] || "";
  const chosen = AI_CONFIG.tiers?.[provider]?.[tier];
  if (chosen) return chosen;
  const fallback = TIER_DEFAULTS[provider]?.[tier];
  /* A tier model the key cannot use is worse than no tiering at all, so fall
     back to the standard model whenever the list says it is gone. */
  if (!fallback) return AI_CONFIG.models[provider] || "";
  const live = discovered[provider];
  if (live && !live.includes(fallback)) return AI_CONFIG.models[provider] || "";
  return fallback;
}

export function modelsFor(provider = AI_CONFIG.provider) {
  const base = MODELS[provider] || [];
  const live = discovered[provider];
  if (!live) return base;
  const known = new Map(base.map((m) => [m.id, m]));
  return live.map((id) => known.get(id) || { id, label: id, rates: [0, 0], note: "" });
}

export const isFreeModel = (id) => {
  const m = Object.values(MODELS).flat().find((x) => x.id === id);
  return m ? m.rates[0] === 0 && m.rates[1] === 0 : AI_CONFIG.provider === "groq";
};

export const rateFor = (model) => {
  const m = Object.values(MODELS).flat().find((x) => x.id === model);
  /* An id we have never seen is a Groq id discovered at runtime — free. */
  return (m ? m.rates : [0, 0]).map((r) => r / 1e6);
};

/* Anthropic runs web search as a server-side tool. Groq bakes it into the
   compound models, so it needs no tool block. */
export const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 3 };

/* ---------- AI settings persisted on this device ----------
   Kept in its own key (never inside the session blob) so clearing a session
   does not wipe the key, and exporting a session never carries it. */
export const AI_SETTINGS_KEY = "unison:ai:v1";

export function loadAISettings() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(AI_SETTINGS_KEY) : null;
    const s = raw ? JSON.parse(raw) : {};
    if (PROVIDERS[s.provider]) AI_CONFIG.provider = s.provider;
    if (s.keys && typeof s.keys === "object") {
      for (const p of Object.keys(PROVIDERS)) if (typeof s.keys[p] === "string") AI_CONFIG.keys[p] = s.keys[p].trim();
    }
    if (s.models && typeof s.models === "object") {
      for (const p of Object.keys(PROVIDERS)) if (typeof s.models[p] === "string" && s.models[p].trim()) AI_CONFIG.models[p] = s.models[p].trim();
    }
    /* Settings saved before Groq existed were Anthropic-only and flat. */
    if (typeof s.apiKey === "string" && s.apiKey.trim() && !AI_CONFIG.keys.anthropic) AI_CONFIG.keys.anthropic = s.apiKey.trim();
    if (typeof s.model === "string" && s.model.startsWith("claude")) AI_CONFIG.models.anthropic = s.model;

    if (typeof s.searchModel === "string" && s.searchModel.trim()) AI_CONFIG.searchModel = s.searchModel.trim();
    if (s.tiers && typeof s.tiers === "object") {
      for (const p of Object.keys(PROVIDERS)) {
        for (const t of ["fast", "strong"]) {
          const v = s.tiers[p]?.[t];
          if (typeof v === "string") AI_CONFIG.tiers[p][t] = v.trim();
        }
      }
    }
    if (typeof s.useTiers === "boolean") AI_CONFIG.useTiers = s.useTiers;
    if (typeof s.autoDowngrade === "boolean") AI_CONFIG.autoDowngrade = s.autoDowngrade;
    if (["low", "medium", "high"].includes(s.effort)) AI_CONFIG.effort = s.effort;
    if (typeof s.localModel === "string" && s.localModel.trim()) AI_CONFIG.localModel = s.localModel.trim();
    if (typeof s.ollamaEndpoint === "string" && s.ollamaEndpoint.trim()) AI_CONFIG.ollamaEndpoint = s.ollamaEndpoint.trim();
    if (typeof s.useLocal === "boolean") AI_CONFIG.useLocal = s.useLocal;
  } catch { /* first run */ }
  return snapshotAISettings();
}

export const snapshotAISettings = () => ({
  provider: AI_CONFIG.provider,
  keys: { ...AI_CONFIG.keys },
  models: { ...AI_CONFIG.models },
  searchModel: AI_CONFIG.searchModel,
  tiers: { groq: { ...AI_CONFIG.tiers.groq }, anthropic: { ...AI_CONFIG.tiers.anthropic } },
  useTiers: AI_CONFIG.useTiers,
  autoDowngrade: AI_CONFIG.autoDowngrade,
  effort: AI_CONFIG.effort,
  localModel: AI_CONFIG.localModel,
  ollamaEndpoint: AI_CONFIG.ollamaEndpoint,
  useLocal: AI_CONFIG.useLocal,
});

export function saveAISettings(patch = {}) {
  /* keys and models are per-provider maps, so a partial patch has to merge
     into them — a plain spread would drop the provider you did not touch. */
  const cur = snapshotAISettings();
  const mergeTiers = () => {
    const out = {};
    for (const p of Object.keys(PROVIDERS)) out[p] = { ...cur.tiers[p], ...(patch.tiers?.[p] || {}) };
    return out;
  };
  const next = { ...cur, ...patch, keys: { ...cur.keys, ...(patch.keys || {}) }, models: { ...cur.models, ...(patch.models || {}) }, tiers: mergeTiers() };
  AI_CONFIG.provider = PROVIDERS[next.provider] ? next.provider : "groq";
  for (const p of Object.keys(PROVIDERS)) {
    AI_CONFIG.keys[p] = String(next.keys?.[p] || "").trim();
    const m = String(next.models?.[p] || "").trim();
    if (m) AI_CONFIG.models[p] = m;
  }
  AI_CONFIG.searchModel = String(next.searchModel || "groq/compound").trim();
  for (const p of Object.keys(PROVIDERS)) {
    for (const t of ["fast", "strong"]) AI_CONFIG.tiers[p][t] = String(next.tiers?.[p]?.[t] || "").trim();
  }
  AI_CONFIG.useTiers = next.useTiers !== false;
  AI_CONFIG.autoDowngrade = next.autoDowngrade !== false;
  AI_CONFIG.effort = ["low", "medium", "high"].includes(next.effort) ? next.effort : "medium";
  AI_CONFIG.localModel = String(next.localModel || "nemotron3").trim();
  AI_CONFIG.ollamaEndpoint = String(next.ollamaEndpoint || "http://localhost:11434").trim();
  AI_CONFIG.useLocal = next.useLocal === true;
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(snapshotAISettings())); } catch { /* private mode */ }
  if (AI_CONFIG.provider !== cur.provider || AI_CONFIG.keys[AI_CONFIG.provider] !== cur.keys[AI_CONFIG.provider]) resetDiscovered();
  ollamaProvider.reset(); hostedProvider.reset();
  return snapshotAISettings();
}

/* Intended model per capability. Swap a value here and the whole product
   follows — no component references a model name directly. */
export const MODEL_REGISTRY = {
  /* tier: what the job is worth. The draft and the evidence check are what a
     human reads and what carries risk, so they get the strongest model; a
     prompt for the image renderer does not. */
  reasoning:             { provider: "text", label: "Text model", tier: "standard" },
  writing:               { provider: "text", label: "Text model", tier: "strong" },
  research:              { provider: "text", label: "Text model", tier: "standard", search: true },
  verification:          { provider: "text", label: "Text model", tier: "strong" },
  quality:               { provider: "text", label: "Text model", tier: "standard" },
  documentUnderstanding: { provider: "text", label: "Text model", tier: "standard" },
  imagePrompt:           { provider: "text", label: "Text model", tier: "fast" },
  videoPrompt:           { provider: "text", label: "Text model", tier: "fast" },
  imageGeneration:       { provider: "image", model: null, label: "Image provider" },
  videoGeneration:       { provider: "video", model: null, label: "Video provider" },
};

/* Developer-facing only. Surfaced in Settings under Developer, never in the
   creation workflow. quota is whatever the provider last told us about the
   daily allowance, so the team can see what is left before it runs out. */
export const AI_STATUS = { local: "unknown", localModels: [], lastError: null, routed: {}, calls: 0, hostedVia: null, quota: null, blocked: null };

export const friendlyError = (e) => {
  const m = String(e?.message || e || "");
  if (e?.code === "no-key" || /No AI key/i.test(m)) return "No AI key configured — add one under Settings → AI.";
  if (e?.code === "bad-key" || /invalid x-api-key|invalid_api_key|authentication/i.test(m)) return "The AI key was rejected. Check it under Settings → AI.";
  if (e?.code === "refusal") return "The model declined this request.";
  if (e?.code === "no-model" || /model_not_found|does not exist|decommissioned/i.test(m)) return "That model is no longer available. Pick another under Settings → AI.";
  if (e?.code === "blocked") return "The browser could not reach the AI service. Check your network, or deploy the relay so calls go server-side.";
  if (e?.code === "daily-limit" || /tokens per day|requests per day|TPD|RPD/i.test(m)) return "The free daily AI limit is used up. It resets 24 hours after the first call — or switch model under Settings → AI.";
  if (/abort/i.test(m)) return "Cancelled.";
  if (/Failed to fetch|NetworkError|ECONNREFUSED|load failed/i.test(m)) return "The AI service is unreachable right now.";
  if (/401|403|credential|api key/i.test(m)) return "The AI service rejected the request.";
  if (/429|rate/i.test(m)) return "The AI service is busy. Try again in a moment.";
  if (/parse|JSON/i.test(m)) return "The AI service returned something unreadable.";
  return "The AI service didn't respond as expected.";
};

/* ---------- provider: local Ollama ---------- */

export const ollamaProvider = {
  _probe: null,
  endpoint: () => AI_CONFIG.ollamaEndpoint.replace(/\/$/, ""),
  async available() {
    if (!AI_CONFIG.useLocal) { AI_STATUS.local = "off"; return false; }
    if (this._probe) return this._probe;
    this._probe = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), AI_CONFIG.probeTimeoutMs);
        const res = await fetch(`${this.endpoint()}/api/tags`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error("probe " + res.status);
        const data = await res.json();
        AI_STATUS.localModels = (data.models || []).map((m) => m.name);
        AI_STATUS.local = "reachable";
        return true;
      } catch (e) {
        AI_STATUS.local = "unreachable";
        AI_STATUS.lastError = friendlyError(e);
        return false;
      }
    })();
    return this._probe;
  },
  reset() { this._probe = null; AI_STATUS.local = "unknown"; AI_STATUS.localModels = []; },
  async chat({ model, system, user, signal }) {
    const res = await fetch(`${this.endpoint()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { num_predict: AI_CONFIG.maxTokens },
        messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }],
      }),
      signal,
    });
    if (!res.ok) throw new Error("ollama " + res.status);
    const data = await res.json();
    return data?.message?.content || "";
  },
};

/* ---------- shared helpers for hosted providers ---------- */

/* A model that thinks out loud wraps it in <think>…</think>. The JSON is
   after it, so strip the block rather than letting extractJSON guess. */
const stripReasoning = (text) => String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "").trim();

/* Turn any non-2xx into an Error the UI can explain. code drives the copy in
   friendlyError; status is kept for the developer panel. */
export function providerError(status, body, res) {
  const raw = body?.error?.message || body?.error || body?.message || `HTTP ${status}`;
  const msg = String(raw);
  let code = "api";
  if (status === 401 || status === 403) code = "bad-key";
  else if (status === 404 || /model_not_found|decommissioned|does not exist/i.test(msg)) code = "no-model";
  else if (status === 429) code = /per day|TPD|RPD/i.test(msg) ? "daily-limit" : "rate";
  /* "try again in 2m59s" appears in the message; the headers carry the same
     thing more reliably. Either beats assuming a full day. */
  const resetHint = res?.headers?.get?.("retry-after")
    || res?.headers?.get?.("x-ratelimit-reset-tokens")
    || res?.headers?.get?.("x-ratelimit-reset-requests")
    || (msg.match(/try again in ([\dhms.]+)/i) || [])[1]
    || null;
  return Object.assign(new Error(msg), { status, code, resetHint });
}

/* Models whose daily allowance is spent, and when each becomes usable again.
   Remembered for the session so a second call does not have to rediscover a
   429 the first one already paid for. */
const spentUntil = new Map();

const RESET_MS = (v) => {
  /* Groq reports "2m59.56s", "7h12m" and friends rather than a timestamp. */
  const m = String(v || "").match(/(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?/);
  if (!m) return null;
  const [, h, mi, sec] = m;
  const ms = (Number(h || 0) * 3600 + Number(mi || 0) * 60 + Number(sec || 0)) * 1000;
  return ms > 0 ? ms : null;
};

export function markSpent(model, resetHint) {
  if (!model) return;
  spentUntil.set(model, Date.now() + (RESET_MS(resetHint) || 24 * 3600 * 1000));
}

export function isSpent(model) {
  const until = spentUntil.get(model);
  if (!until) return false;
  if (until > Date.now()) return true;
  spentUntil.delete(model);
  return false;
}

export const clearSpent = () => spentUntil.clear();

/* Groq reports the remaining daily allowance on every response. Keeping it
   means Settings can show what is left instead of only reporting the 429. */
function readQuota(res) {
  const h = res?.headers;
  if (!h?.get) return;
  const limit = h.get("x-ratelimit-limit-requests");
  if (!limit) return;
  /* "0 remaining" is the number that matters most, so an empty header has to
     read as unknown rather than collapsing to zero. */
  const num = (v) => { const n = Number(v); return v === null || v === "" || Number.isNaN(n) ? null : n; };
  AI_STATUS.quota = {
    requests: { limit: num(limit), remaining: num(h.get("x-ratelimit-remaining-requests")), reset: h.get("x-ratelimit-reset-requests") || null },
    tokens: { limit: num(h.get("x-ratelimit-limit-tokens")), remaining: num(h.get("x-ratelimit-remaining-tokens")), reset: h.get("x-ratelimit-reset-tokens") || null },
    at: Date.now(),
  };
}

/* fetch() rejects with a bare TypeError for both a dead network and a CORS
   refusal, and the two need different advice, so say what is knowable. */
const asNetworkError = (e) => {
  if (e?.name === "AbortError" || e?.status) return e;
  /* fetch rejects with a bare TypeError for a dead network and for a browser
     that refused the cross-origin call. They are indistinguishable from
     script, so record it and let the UI offer both remedies. */
  AI_STATUS.blocked = { at: Date.now(), provider: AI_CONFIG.provider, message: String(e?.message || e) };
  return Object.assign(new Error(String(e?.message || e)), { code: "blocked" });
};

/* What to do about a blocked call, in the order worth trying. */
export const blockedRemedy = () => {
  const p = activeProvider();
  return {
    provider: p.label,
    steps: [
      `Check this machine can reach ${p.label} at all — a VPN, a corporate proxy or an offline laptop all look identical from here.`,
      "Deploy api/ai.js (one Vercel function, no server to run) with GROQ_API_KEY set. Calls then leave from the server, where no browser rule applies.",
      "Or run a local model: turn on Ollama under Settings → AI.",
    ],
  };
};

/* ---------- request builders, one per wire format ---------- */

/* Groq speaks the OpenAI chat-completions format. */
export function groqBody({ system, user, model, json, search }) {
  const id = search ? AI_CONFIG.searchModel : model;
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }];
  /* The compound systems run their own search loop and reject the tuning and
     response_format parameters, so they get the bare minimum. */
  if (/^groq\/compound/.test(id)) return { model: id, messages };
  const body = { model: id, messages, temperature: AI_CONFIG.temperature, max_completion_tokens: AI_CONFIG.maxTokens };
  /* JSON mode guarantees parseable output, which removes a whole class of
     "the AI returned something unreadable" failures. The API rejects it
     unless the prompt itself says JSON, so make sure one of them does. */
  if (json) {
    body.response_format = { type: "json_object" };
    if (!/json/i.test(`${system || ""} ${user || ""}`)) messages[messages.length - 1].content += "\n\nReply with one raw JSON object.";
  }
  return body;
}

export function anthropicBody({ system, user, model, search }) {
  const body = { model, max_tokens: AI_CONFIG.maxTokens, messages: [{ role: "user", content: user }], output_config: { effort: AI_CONFIG.effort } };
  if (system) body.system = system;
  if (search) body.tools = [WEB_SEARCH_TOOL];
  return body;
}

/* ---------- what the model actually looked at (#2) ----------
   A model writing a URL into JSON is generating text; the URL may not exist.
   The compound models also report the searches they really ran, and those
   URLs came out of a search index. Collecting them lets the app tell a
   retrieved link from an invented one instead of presenting both as sources.

   The field has moved between shapes across releases, so read defensively and
   return nothing rather than guess. */
export function searchedUrls(data) {
  const out = new Set();
  const visit = (v, depth = 0) => {
    if (!v || depth > 6) return;
    if (typeof v === "string") {
      const m = v.match(/https?:\/\/[^\s"'<>)\]]+/g);
      if (m) m.forEach((u) => out.add(u));
      return;
    }
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (typeof v === "object") for (const k of Object.keys(v)) visit(v[k], depth + 1);
  };
  const msg = data?.choices?.[0]?.message;
  /* Only the tool-execution record, never the message content — the content
     is exactly the generated text whose links we are trying to check. */
  visit(msg?.executed_tools ?? msg?.tool_calls ?? data?.search_results ?? null);
  return [...out];
}

/* Two URLs point at the same page often enough that a strict compare would
   flag real sources. Compare host plus a normalised path instead. */
export const sameTarget = (a, b) => {
  const norm = (u) => {
    try {
      const x = new URL(u);
      return x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "").toLowerCase();
    } catch { return null; }
  };
  const na = norm(a), nb = norm(b);
  return !!na && na === nb;
};

/* Domains that mean "the model had nothing". Never a real source. */
const PLACEHOLDER_HOSTS = /(^|\.)(example|test|localhost|invalid|domain|yoursite|website|placeholder)\.(com|org|net|invalid|local)$|^example\./i;

export const isPlaceholderUrl = (u) => {
  try { return PLACEHOLDER_HOSTS.test(new URL(u).hostname); } catch { return true; }
};

/* Mark each source: "retrieved" if the model's own search returned it,
   "unconfirmed" if it only wrote it down, "placeholder" if it is fake on its
   face. The caller decides how loudly to say so. */
export function corroborateSources(sources, urls) {
  const list = Array.isArray(sources) ? sources : [];
  const checked = Array.isArray(urls) && urls.length > 0;
  return list.map((src) => {
    if (!src || typeof src !== "object") return src;
    if (!src.url) return { ...src, link: "none" };
    if (isPlaceholderUrl(src.url)) return { ...src, link: "placeholder" };
    if (src.uploaded || src.background) return { ...src, link: "retrieved" };
    /* With no record of what was searched we cannot claim either way, and
       inventing a verdict is the thing this function exists to prevent. */
    if (!checked) return { ...src, link: "unknown" };
    return { ...src, link: urls.some((u) => sameTarget(u, src.url)) ? "retrieved" : "unconfirmed" };
  });
}

export const readGroq = (data) => {
  const msg = data?.choices?.[0]?.message;
  if (data?.choices?.[0]?.finish_reason === "content_filter") throw Object.assign(new Error("The model declined this request."), { code: "refusal" });
  return stripReasoning(msg?.content || "");
};

export const readAnthropic = (data) => {
  if (!data || !Array.isArray(data.content)) throw new Error("empty response");
  if (data.stop_reason === "refusal") throw Object.assign(new Error("The model declined this request."), { code: "refusal" });
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
};

/* ---------- provider: hosted (Groq by default, Anthropic optional) ---------- */

export const hostedProvider = {
  _mode: null,      // "relay" | "direct"
  _relayKey: null,
  reset() { this._mode = null; this._relayKey = null; AI_STATUS.hostedVia = null; },
  async resolve() {
    if (this._mode) return this._mode;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), AI_CONFIG.probeTimeoutMs);
      const res = await fetch(AI_CONFIG.aiRelayEndpoint, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: ctrl.signal });
      clearTimeout(t);
      const body = await res.json().catch(() => null);
      this._mode = res.ok && body?.service === "unison-ai-relay" ? "relay" : "direct";
      /* The relay reports which providers it holds a key for. */
      this._relayKey = this._mode === "relay" ? (body.providers?.[AI_CONFIG.provider] ?? body.keyConfigured) !== false : null;
      if (this._mode === "relay" && this._relayKey === false) console.warn(`[unison] AI relay is deployed but has no key for ${AI_CONFIG.provider}.`);
    } catch { this._mode = "direct"; }
    AI_STATUS.hostedVia = this._mode;
    return this._mode;
  },
  /* Can a hosted call succeed right now? */
  async configured() {
    const mode = await this.resolve();
    if (mode === "relay") return this._relayKey !== false;
    return !!activeKey();
  },
  /* The list of ids the key can actually use, so a decommissioned default
     shows up as a picker that self-corrects rather than a 404 mid-draft. */
  async listModels(signal) {
    if (AI_CONFIG.provider !== "groq") return modelsFor("anthropic").map((m) => m.id);
    const key = activeKey();
    if (!key) throw Object.assign(new Error("No AI key configured."), { code: "no-key" });
    let res;
    try {
      res = await fetch(`${PROVIDERS.groq.endpoint}/models`, { headers: { Authorization: `Bearer ${key}` }, signal });
    } catch (e) { throw asNetworkError(e); }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw providerError(res.status, data, res);
    const ids = (data?.data || [])
      .filter((m) => m?.active !== false && !/whisper|tts|guard|prompt-guard/i.test(m.id || ""))
      .map((m) => m.id)
      .sort();
    if (ids.length) discovered.groq = ids;
    return ids;
  },
  async chat({ system, user, search, json, model: wanted, signal, meta }) {
    const mode = await this.resolve();
    const provider = AI_CONFIG.provider;
    const model = wanted || activeModel();
    const body = provider === "groq"
      ? groqBody({ system, user, model, json, search })
      : anthropicBody({ system, user, model, search });

    const headers = { "Content-Type": "application/json" };
    let url = AI_CONFIG.aiRelayEndpoint;
    if (mode === "relay") {
      Object.assign(headers, relayAuthHeaders());
      /* The relay is provider-agnostic; it needs to be told which one. */
      headers["x-unison-provider"] = provider;
    } else {
      const key = activeKey();
      if (!key) throw Object.assign(new Error("No AI key configured. Add one under Settings → AI."), { code: "no-key" });
      if (provider === "groq") {
        url = `${PROVIDERS.groq.endpoint}/chat/completions`;
        headers.Authorization = `Bearer ${key}`;
      } else {
        url = PROVIDERS.anthropic.endpoint;
        headers["x-api-key"] = key;
        headers["anthropic-version"] = "2023-06-01";
        headers["anthropic-dangerous-direct-browser-access"] = "true";
      }
    }

    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e) { throw asNetworkError(e); }
    AI_STATUS.blocked = null;
    readQuota(res);
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) throw providerError(res.status, data, res);
    if (meta) {
      meta.model = model;
      meta.provider = provider;
      if (search) meta.searchedUrls = provider === "groq" ? searchedUrls(data) : [];
    }
    return provider === "groq" ? readGroq(data) : readAnthropic(data);
  },
};

/* One line for the UI: where hosted calls go and whether they can work. */
export async function describeAI() {
  const local = AI_CONFIG.useLocal ? await ollamaProvider.available() : false;
  const mode = await hostedProvider.resolve();
  const hosted = await hostedProvider.configured();
  const p = activeProvider();
  const where = mode === "relay" ? "via the deployed relay" : "directly from this browser";
  return {
    local, mode, hosted, provider: p.id, free: p.free,
    blocked: AI_STATUS.blocked,
    ready: local || hosted,
    summary: AI_STATUS.blocked && !local
      ? `This browser could not reach ${p.label}. Nothing was wrong with the key — see Settings → AI for the two ways round it.`
      : local ? `Local model (${AI_CONFIG.localModel}) with ${p.label} as fallback${hosted ? "" : ` — ${p.label} not configured`}`
      : hosted ? `${p.label} ${where} · ${activeModel()}${p.free ? " · free tier" : ""}`
      : mode === "relay" ? `The AI relay is deployed but has no ${p.label} key on the server`
      : `Not configured — add a free ${p.label} key under Settings → AI. Until then, engines return sample data.`,
  };
}

/* ---------- the router ---------- */

export const aiRouter = {
  /* Which model a capability should use right now, given its tier, whether
     the call searches, and whether that model's day is already spent. */
  plan(capability, search) {
    const entry = MODEL_REGISTRY[capability] || MODEL_REGISTRY.reasoning;
    if (search && AI_CONFIG.provider === "groq") return { model: AI_CONFIG.searchModel, tier: "search", entry };
    const tier = AI_CONFIG.useTiers ? (entry.tier || "standard") : "standard";
    return { model: modelForTier(tier), tier, entry };
  },

  /* When the day's allowance for a model is gone, the choice is a weaker
     model or sample data. A weaker real answer beats a placeholder, so step
     down the tiers rather than give up — once, and only downwards. */
  fallbackChain(tier) {
    if (!AI_CONFIG.autoDowngrade) return [];
    const order = { strong: ["standard", "fast"], standard: ["fast"], fast: [], search: ["standard", "fast"] };
    return (order[tier] || []).map((t) => modelForTier(t)).filter(Boolean);
  },

  async run({ capability = "reasoning", system, user, search, json, signal, timeoutMs = 90000, onNotice, meta }) {
    const { model, tier, entry } = this.plan(capability, search);
    AI_STATUS.calls += 1;

    /* Every call gets a ceiling, whether or not the caller passed a signal. */
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener("abort", onAbort, { once: true }); }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const sig = ctrl.signal;
    try {
      /* No local model can search the web, so a search call always goes
         hosted regardless of what the registry prefers. */
      if (entry.provider === "text" && !search && await ollamaProvider.available()) {
        try {
          const out = await ollamaProvider.chat({ model: AI_CONFIG.localModel, system, user, signal: sig });
          AI_STATUS.routed[capability] = `local · ${AI_CONFIG.localModel}`;
          return out;
        } catch (e) {
          if (e?.name === "AbortError") throw signal?.aborted ? e : Object.assign(new Error("The local model took too long."), { code: "timeout" });
          AI_STATUS.lastError = friendlyError(e);
        }
      }

      /* Skip a model already known to be out of allowance today rather than
         spending a round trip to be told again. */
      const chain = [model, ...this.fallbackChain(tier)].filter((m, i, a) => m && a.indexOf(m) === i);
      const usable = chain.filter((m) => !isSpent(m));
      const queue = usable.length ? usable : [chain[0]];

      let lastErr;
      for (let i = 0; i < queue.length; i++) {
        const m = queue[i];
        AI_STATUS.routed[capability] = `${AI_CONFIG.provider} · ${m}${search ? " + search" : ""}${i ? " (stepped down)" : ""}`;
        try {
          const out = await hostedProvider.chat({ system, user, search, json, model: m, signal: sig, meta });
          if (i > 0) onNotice?.({ kind: "downgraded", from: queue[0], to: m });
          return out;
        } catch (e) {
          if (e?.name === "AbortError" && !signal?.aborted) throw Object.assign(new Error("The AI service took too long."), { code: "timeout" });
          if (e?.name === "AbortError") throw e;
          lastErr = e;
          AI_STATUS.lastError = friendlyError(e);
          /* Only a spent daily allowance is worth retrying on another model.
             A bad key or a blocked browser fails the same way every time. */
          if (e?.code !== "daily-limit") throw e;
          markSpent(m, e.resetHint);
          onNotice?.({ kind: "spent", model: m });
        }
      }
      throw lastErr;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  },

  describe(capability) {
    const e = MODEL_REGISTRY[capability];
    if (!e) return "—";
    if (e.provider !== "text") return e.label;
    if (AI_CONFIG.useLocal) return `Local · ${AI_CONFIG.localModel}`;
    const { model, tier } = this.plan(capability, e.search);
    return `${model}${tier !== "standard" ? ` · ${tier}` : ""}`;
  },
};

/* ---------- JSON handling ---------- */

export function extractJSON(text) {
  let t = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("{");
  if (s === -1) throw new Error("No JSON found");
  const e = t.lastIndexOf("}");
  if (e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { /* repair below */ } }
  return repairJSON(t.slice(s));
}

/* A reply can be cut off mid-object when the model runs out of room —
   especially with web search, where results eat the same budget. Close what
   is open and keep the complete items rather than losing everything. */
export function repairJSON(t) {
  let inStr = false, esc = false;
  const stack = [];
  let cutIdx = -1, cutStack = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") stack.pop();
    else if (c === ",") { cutIdx = i; cutStack = stack.slice(); }
  }
  const tries = [];
  if (!inStr && stack.length) tries.push(t + stack.slice().reverse().join(""));
  if (cutIdx > 0) tries.push(t.slice(0, cutIdx) + cutStack.slice().reverse().join(""));
  for (const a of tries) { try { return JSON.parse(a); } catch (err) { /* next */ } }
  throw new Error("Response could not be parsed");
}

export async function askJSON({ capability = "reasoning", system, user, search, fallback, track, signal, onNotice, meta }) {
  const inChars = (system || "").length + (user || "").length;
  try {
    const text = await aiRouter.run({ capability, system, user, search, json: true, signal, onNotice, meta });
    track?.({ inChars, outChars: text.length, ok: true, searched: !!search });
    return extractJSON(text);
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.warn("[unison] engine fell back:", err?.message || err);
    AI_STATUS.lastError = friendlyError(err);
    track?.({ inChars, outChars: 0, ok: false, searched: !!search });
    if (fallback === undefined) throw err;
    const v = typeof fallback === "function" ? fallback() : fallback;
    /* Sample data is never allowed to pass as generated output. */
    if (v && typeof v === "object" && !Array.isArray(v)) { v.degraded = v.degraded || "sample"; v.degradedReason = friendlyError(err); }
    return v;
  }
}

export async function askText({ capability = "reasoning", system, user, signal, track, onNotice }) {
  const inChars = (system || "").length + (user || "").length;
  const text = await aiRouter.run({ capability, system, user, json: false, signal, onNotice });
  track?.({ inChars, outChars: text.length, ok: true, searched: false });
  return text;
}

/* Fallback rows are dated relative to today so they never read as real,
   stale sources. */
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export const JSON_RULE = "Reply with one raw JSON object and nothing else. No prose, no markdown fences, no preamble.";

/* ---------- fallbacks ---------- */

export const fb = {
  opportunities: () => ({
    items: [
      { headline: "Enterprise AI budgets shift from pilots to production", publisher: "Sample row", url: "", date: "", score: 82, whyNow: "Placeholder row so the flow stays usable — not a live story.", gap: "unknown", angle: "Contrarian" },
      { headline: "Buyers are asking vendors for evidence, not demos", publisher: "Sample row", url: "", date: "", score: 74, whyNow: "Placeholder row so the flow stays usable — not a live story.", gap: "unknown", angle: "Educational" },
    ], degraded: "sample",
  }),
  research: (topic) => ({
    sources: [
      { title: `Placeholder: an announcement about ${topic}`, publisher: "Not retrieved", date: daysAgo(18), tier: 1, note: "Example row — no source was fetched.", url: "" },
      { title: "Placeholder: an adoption report", publisher: "Not retrieved", date: daysAgo(25), tier: 2, note: "Example row — no source was fetched.", url: "" },
      { title: "Placeholder: a category analysis", publisher: "Not retrieved", date: daysAgo(40), tier: 3, note: "Example row — no source was fetched.", url: "" },
    ],
    claims: [
      { text: `${topic} is moving from pilot projects into production workloads.`, sourceIndex: 1 },
      { text: "Buyers cite measurable time savings as the main purchase trigger.", sourceIndex: 1 },
    ],
    insights: [
      "Most public commentary describes capability, not outcomes — an outcomes angle is open.",
      "Recent sources cluster in the last 30 days, so this reads as current rather than evergreen.",
      "Buyer language is more cautious than vendor language.",
    ],
    freshness: "Recent",
    risks: ["Placeholder sources — nothing here was retrieved from the web."],
    degraded: "sample",
  }),
  angles: (topic) => ({
    angles: [
      { type: "Contrarian", headline: `The hard part of ${topic} isn't the technology.`, rationale: "Differentiates from the capability-led commentary everyone else is publishing.", recommended: true },
      { type: "Educational", headline: `What actually changes when ${topic} reaches production.`, rationale: "Safe, useful, broad reach — lower differentiation." },
      { type: "Industry insight", headline: `Why the category is consolidating around ${topic}.`, rationale: "Positions the company as a category thinker." },
      { type: "Data-driven", headline: `Four numbers that explain ${topic} right now.`, rationale: "Strong evidence coverage, weaker originality." },
    ],
    reason: "Stronger differentiation than the alternatives, and opinion-led posts have historically outperformed on your Page.",
  }),
  draft: (topic) => ({
    hook: `The hard part of ${topic} was never the technology.`,
    body: `Every team we talk to can get a demo working in an afternoon.\n\nWhat stalls them is everything after that: who approves it, which source it drew from, what happens when it is wrong.\n\nThe teams that got past pilot did one unglamorous thing first. They made the output reviewable — evidence attached, one owner, one clear approval step.`,
    cta: "What stopped your last pilot from reaching production?",
    hashtags: ["#AIagents", "#EnterpriseAI"],
    claims: [
      { text: "Teams can get a demo working quickly.", sourceIndex: 2 },
      { text: "Approval and evidence gaps stall production rollout.", sourceIndex: 1 },
    ],
  }),
  verify: () => ({
    claims: [
      { claim: "Every team we talk to can get a demo working in an afternoon.", status: "green", source: "Industry Weekly", confidence: "High", note: "Directly supported by the cited analysis." },
      { claim: "The teams that got past pilot made the output reviewable.", status: "yellow", source: "Financial Times", confidence: "Medium", note: "Supported directionally, but the source does not use this framing." },
    ],
    unresolved: ["One claim needs a human decision before publishing."],
  }),
  quality: () => ({
    checks: [
      { label: "Evidence verified", pass: true }, { label: "Brand aligned", pass: true },
      { label: "Strong opening", pass: true }, { label: "No unsupported statistics", pass: true },
      { label: "No duplicate content", pass: true }, { label: "Low AI-style language", pass: true },
    ],
    slop: [], duplicate: { similar: false, days: 0, title: "" },
    detail: { hook: 82, readability: 79, brand: 88, originality: 74, evidence: 85 },
  }),
  media: () => ({
    format: "image",
    reason: "One clear argument with no list structure — a single strong visual carries it better than a document.",
    concept: "Split frame: a working demo on one side, an approval queue on the other, brand rule underneath.",
  }),
  performance: () => ({
    headline: "This post performed 28% above your Page average.",
    why: ["The opening line stated a position instead of describing a topic.", "Evidence-backed posts have been generating more comments than links.", "Length sat inside your high-performing range."],
    next: "Publish two more posts on this theme within the next ten days while interest is high.",
  }),
};

/* ---------- shape guards ----------
   The model's JSON is never trusted to have the right shape. These return
   something the UI can render no matter what came back. */
const str = (v, fb = "") => (typeof v === "string" ? v : v == null ? fb : String(v));
const arr = (v) => (Array.isArray(v) ? v : []);
const STATUSES = ["green", "yellow", "red"];

export function normalizeDraft(d, topic = "") {
  const o = d && typeof d === "object" ? d : {};
  const body = str(o.body);
  return {
    ...o,
    hook: str(o.hook, str(o.headline, topic)).trim(),
    body: body.trim(),
    cta: str(o.cta).trim(),
    hashtags: arr(o.hashtags).map((h) => str(h).trim()).filter(Boolean).map((h) => (h.startsWith("#") ? h : "#" + h.replace(/\s+/g, ""))).slice(0, 6),
    claims: arr(o.claims).map((c) => (typeof c === "string" ? { text: c, sourceIndex: 0 } : c && typeof c === "object" && c.text ? { text: str(c.text), sourceIndex: Number(c.sourceIndex) || 0 } : null)).filter(Boolean),
  };
}

export function normalizeVerification(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    ...o,
    claims: arr(o.claims).map((c) => (c && typeof c === "object" ? {
      claim: str(c.claim || c.text), status: STATUSES.includes(String(c.status).toLowerCase()) ? String(c.status).toLowerCase() : "yellow",
      /* This value is rendered into an href, and the trust check runs with web
         search on — so a fetched page can steer it. Only http(s) is allowed. */
      source: str(c.source), url: /^https?:\/\//.test(str(c.url)) ? str(c.url) : "", confidence: str(c.confidence, "Low"), note: str(c.note),
    } : null)).filter((c) => c && c.claim),
    unresolved: arr(o.unresolved).map((u) => str(u)).filter(Boolean),
  };
}

export function normalizeQuality(q) {
  const o = q && typeof q === "object" ? q : {};
  const detail = o.detail && typeof o.detail === "object" ? o.detail : {};
  const num = (x) => Math.max(0, Math.min(100, Number(x) || 0));
  return {
    ...o,
    checks: arr(o.checks).map((c) => (c && typeof c === "object" && c.label ? { label: str(c.label), pass: c.pass !== false && c.pass !== "false" } : null)).filter(Boolean),
    slop: arr(o.slop).map((x) => str(x)).filter(Boolean),
    duplicate: o.duplicate && typeof o.duplicate === "object" ? { similar: !!o.duplicate.similar, days: Number(o.duplicate.days) || 0, title: str(o.duplicate.title) } : { similar: false, days: 0, title: "" },
    detail: Object.fromEntries(["hook", "readability", "brand", "originality", "evidence"].map((k) => [k, num(detail[k])])),
  };
}

export function normalizeAngles(a, topic = "") {
  const o = a && typeof a === "object" ? a : {};
  const angles = arr(o.angles).map((x) => (x && typeof x === "object" && (x.headline || x.type) ? { type: str(x.type, "Educational"), headline: str(x.headline, topic), rationale: str(x.rationale), recommended: !!x.recommended } : null)).filter(Boolean);
  if (angles.length && !angles.some((x) => x.recommended)) angles[0].recommended = true;
  return { ...o, angles, reason: str(o.reason) };
}

export function normalizeResearch(r) {
  const o = r && typeof r === "object" ? r : {};
  return {
    ...o,
    sources: arr(o.sources).map((s) => (s && typeof s === "object" && (s.title || s.url) ? { title: str(s.title, s.url), publisher: str(s.publisher), date: str(s.date), tier: [1, 2, 3, 4].includes(Number(s.tier)) ? Number(s.tier) : 4, note: str(s.note), url: /^https?:\/\//.test(str(s.url)) ? str(s.url) : "", uploaded: !!s.uploaded, background: !!s.background } : null)).filter(Boolean),
    claims: arr(o.claims).map((c) => (typeof c === "string" ? { text: c, sourceIndex: 0 } : c && typeof c === "object" && c.text ? { text: str(c.text), sourceIndex: Number(c.sourceIndex) || 0 } : null)).filter(Boolean),
    insights: arr(o.insights).map((x) => str(x)).filter(Boolean),
    risks: arr(o.risks).map((x) => str(x)).filter(Boolean),
    freshness: str(o.freshness, "Recent"),
  };
}
