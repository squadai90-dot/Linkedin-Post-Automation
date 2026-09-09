import { relayAuthHeaders } from "./store.js";


/* ============================================================
   AI LAYER — router, registry, providers
   Nothing above this line knows a model name. Components ask the
   router for a capability; the router picks the provider.
   ============================================================ */

export const AI_CONFIG = {
  ollamaEndpoint: "http://localhost:11434",
  /* Deployed with the optional relay, AI calls go through Unison's own API,
     which holds the key. Frontend-only, the key lives in this browser's
     localStorage (Settings → AI) and the call goes straight to Anthropic with
     the browser-access header. */
  aiRelayEndpoint: (typeof window !== "undefined" && window.UNISON_AI_API) || "/api/ai",
  directEndpoint: "https://api.anthropic.com/v1/messages",
  apiKey: "",
  hostedModel: "claude-opus-5",
  effort: "medium",              // low | medium | high — thinking depth for hosted calls
  localModel: "nemotron3",       // the Ollama tag used for every text capability
  useLocal: true,                // probe Ollama at all
  probeTimeoutMs: 1500,
  maxTokens: 4000,
};

/* Hosted models the team can pick from, with first-party list prices per
   million tokens (input, output) for the running cost estimate. */
export const HOSTED_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5", rates: [5, 25], note: "Best quality — default" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", rates: [2, 10], note: "Fast and cheaper" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", rates: [1, 5], note: "Cheapest; simple tasks" },
];
export const rateFor = (model) => (HOSTED_MODELS.find((m) => m.id === model)?.rates || [5, 25]).map((r) => r / 1e6);

/* Current server-side web search tool. Anything needing it routes hosted. */
export const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 3 };

/* ---------- AI settings persisted on this device ----------
   Kept in its own key (never inside the session blob) so clearing a session
   does not wipe the key, and exporting a session never carries it. */
export const AI_SETTINGS_KEY = "unison:ai:v1";
export function loadAISettings() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(AI_SETTINGS_KEY) : null;
    const s = raw ? JSON.parse(raw) : {};
    if (typeof s.apiKey === "string") AI_CONFIG.apiKey = s.apiKey.trim();
    if (HOSTED_MODELS.some((m) => m.id === s.model)) AI_CONFIG.hostedModel = s.model;
    if (["low", "medium", "high"].includes(s.effort)) AI_CONFIG.effort = s.effort;
    if (typeof s.localModel === "string" && s.localModel.trim()) AI_CONFIG.localModel = s.localModel.trim();
    if (typeof s.ollamaEndpoint === "string" && s.ollamaEndpoint.trim()) AI_CONFIG.ollamaEndpoint = s.ollamaEndpoint.trim();
    if (typeof s.useLocal === "boolean") AI_CONFIG.useLocal = s.useLocal;
  } catch { /* first run */ }
  return snapshotAISettings();
}
export const snapshotAISettings = () => ({ apiKey: AI_CONFIG.apiKey, model: AI_CONFIG.hostedModel, effort: AI_CONFIG.effort, localModel: AI_CONFIG.localModel, ollamaEndpoint: AI_CONFIG.ollamaEndpoint, useLocal: AI_CONFIG.useLocal });
export function saveAISettings(patch) {
  const next = { ...snapshotAISettings(), ...patch };
  AI_CONFIG.apiKey = String(next.apiKey || "").trim();
  AI_CONFIG.hostedModel = HOSTED_MODELS.some((m) => m.id === next.model) ? next.model : "claude-opus-5";
  AI_CONFIG.effort = ["low", "medium", "high"].includes(next.effort) ? next.effort : "medium";
  AI_CONFIG.localModel = String(next.localModel || "nemotron3").trim();
  AI_CONFIG.ollamaEndpoint = String(next.ollamaEndpoint || "http://localhost:11434").trim();
  AI_CONFIG.useLocal = next.useLocal !== false;
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(snapshotAISettings())); } catch { /* private mode */ }
  ollamaProvider.reset(); hostedProvider.reset();
  return snapshotAISettings();
}

/* Intended model per capability. Swap a value here and the whole product
   follows — no component references a model name directly. */
export const MODEL_REGISTRY = {
  reasoning:             { provider: "ollama", label: "Local model" },
  writing:               { provider: "ollama", label: "Local model" },
  research:              { provider: "ollama", label: "Local model" },
  verification:          { provider: "ollama", label: "Local model" },
  quality:               { provider: "ollama", label: "Local model" },
  documentUnderstanding: { provider: "ollama", label: "Local model" },
  imagePrompt:           { provider: "ollama", label: "Local model" },
  videoPrompt:           { provider: "ollama", label: "Local model" },
  imageGeneration:       { provider: "image", model: null, label: "Image provider" },
  videoGeneration:       { provider: "video", model: null, label: "Video provider" },
};

/* Developer-facing only. Surfaced in Settings under Developer, never in the
   creation workflow. */
export const AI_STATUS = { local: "unknown", localModels: [], lastError: null, routed: {}, calls: 0, hostedVia: null };

export const friendlyError = (e) => {
  const m = String(e?.message || e || "");
  if (e?.code === "no-key" || /No AI key/i.test(m)) return "No AI key configured — add one under Settings → AI.";
  if (e?.code === "bad-key" || /invalid x-api-key|authentication/i.test(m)) return "The AI key was rejected. Check it under Settings → AI.";
  if (e?.code === "refusal") return "The model declined this request.";
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

/* ---------- provider: hosted ---------- */

export const hostedProvider = {
  _mode: null, // "relay" | "direct"
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
      this._relayKey = this._mode === "relay" ? body.keyConfigured !== false : null;
      if (this._mode === "relay" && body.keyConfigured === false) console.warn("[unison] AI relay is deployed but ANTHROPIC_API_KEY is not set on the server.");
    } catch { this._mode = "direct"; }
    AI_STATUS.hostedVia = this._mode;
    return this._mode;
  },
  /* Can a hosted call succeed right now? */
  async configured() {
    const mode = await this.resolve();
    if (mode === "relay") return this._relayKey !== false;
    return !!AI_CONFIG.apiKey;
  },
  async chat({ system, user, tools, signal }) {
    const mode = await this.resolve();
    const body = { model: AI_CONFIG.hostedModel, max_tokens: AI_CONFIG.maxTokens, messages: [{ role: "user", content: user }], output_config: { effort: AI_CONFIG.effort } };
    if (system) body.system = system;
    if (tools) body.tools = tools;
    const headers = { "Content-Type": "application/json", ...(mode === "relay" ? relayAuthHeaders() : {}) };
    let url = AI_CONFIG.aiRelayEndpoint;
    if (mode !== "relay") {
      if (!AI_CONFIG.apiKey) throw Object.assign(new Error("No AI key configured. Add one under Settings → AI."), { code: "no-key" });
      url = AI_CONFIG.directEndpoint;
      headers["x-api-key"] = AI_CONFIG.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) {
      const msg = data?.error?.message || data?.error || `HTTP ${res.status}`;
      throw Object.assign(new Error(String(msg)), { status: res.status, code: res.status === 401 ? "bad-key" : res.status === 429 ? "rate" : "api" });
    }
    if (!data || !Array.isArray(data.content)) throw new Error("empty response");
    if (data.stop_reason === "refusal") throw Object.assign(new Error("The model declined this request."), { code: "refusal" });
    return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  },
};

/* One line for the UI: where hosted calls go and whether they can work. */
export async function describeAI() {
  const local = AI_CONFIG.useLocal ? await ollamaProvider.available() : false;
  const mode = await hostedProvider.resolve();
  const hosted = await hostedProvider.configured();
  return {
    local, mode, hosted,
    ready: local || hosted,
    summary: local ? `Local model (${AI_CONFIG.localModel}) with hosted fallback${hosted ? "" : " — hosted not configured"}`
      : hosted ? (mode === "relay" ? `Hosted via the deployed AI relay · ${AI_CONFIG.hostedModel}` : `Hosted directly from this browser · ${AI_CONFIG.hostedModel}`)
      : mode === "relay" ? "AI relay is deployed but has no ANTHROPIC_API_KEY on the server"
      : "Not configured — add an AI key under Settings → AI. Until then, engines return sample data.",
  };
}

/* ---------- the router ---------- */

export const aiRouter = {
  async run({ capability = "reasoning", system, user, tools, signal, timeoutMs = 90000 }) {
    const entry = MODEL_REGISTRY[capability] || MODEL_REGISTRY.reasoning;
    AI_STATUS.calls += 1;

    /* Every call gets a ceiling, whether or not the caller passed a signal. */
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener("abort", onAbort, { once: true }); }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const sig = ctrl.signal;
    try {
      // Web search is a hosted-only tool, so anything needing it routes hosted
      // regardless of what the registry prefers.
      if (entry.provider === "ollama" && !tools && await ollamaProvider.available()) {
        try {
          const out = await ollamaProvider.chat({ model: AI_CONFIG.localModel, system, user, signal: sig });
          AI_STATUS.routed[capability] = `local · ${AI_CONFIG.localModel}`;
          return out;
        } catch (e) {
          if (e?.name === "AbortError") throw signal?.aborted ? e : Object.assign(new Error("The local model took too long."), { code: "timeout" });
          AI_STATUS.lastError = friendlyError(e);
        }
      }
      AI_STATUS.routed[capability] = `hosted · ${AI_CONFIG.hostedModel}${tools ? " + search" : ""}`;
      try {
        return await hostedProvider.chat({ system, user, tools, signal: sig });
      } catch (e) {
        if (e?.name === "AbortError" && !signal?.aborted) throw Object.assign(new Error("The AI service took too long."), { code: "timeout" });
        AI_STATUS.lastError = friendlyError(e);
        throw e;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  },
  describe(capability) {
    const e = MODEL_REGISTRY[capability];
    return e ? (e.provider === "ollama" ? `Local · ${AI_CONFIG.localModel}` : e.label) : "—";
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

export async function askJSON({ capability = "reasoning", system, user, tools, fallback, track, signal }) {
  const inChars = (system || "").length + (user || "").length;
  try {
    const text = await aiRouter.run({ capability, system, user, tools, signal });
    track?.({ inChars, outChars: text.length, ok: true, searched: !!tools });
    return extractJSON(text);
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.warn("[unison] engine fell back:", err?.message || err);
    AI_STATUS.lastError = friendlyError(err);
    track?.({ inChars, outChars: 0, ok: false, searched: !!tools });
    if (fallback === undefined) throw err;
    const v = typeof fallback === "function" ? fallback() : fallback;
    /* Sample data is never allowed to pass as generated output. */
    if (v && typeof v === "object" && !Array.isArray(v)) { v.degraded = v.degraded || "sample"; v.degradedReason = friendlyError(err); }
    return v;
  }
}

export async function askText({ capability = "reasoning", system, user, signal, track }) {
  const inChars = (system || "").length + (user || "").length;
  const text = await aiRouter.run({ capability, system, user, signal });
  track?.({ inChars, outChars: text.length, ok: true, searched: false });
  return text;
}

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
      { title: `Official announcement: ${topic}`, publisher: "Company newsroom", date: "2026-08-21", tier: 1, note: "First-party statement with product detail.", url: "" },
      { title: "Enterprise adoption report", publisher: "Financial Times", date: "2026-08-14", tier: 2, note: "Survey of 400 enterprise buyers.", url: "" },
      { title: "Category analysis", publisher: "Industry Weekly", date: "2026-07-30", tier: 3, note: "Practitioner view of the market shift.", url: "" },
      { title: "Practitioner thread", publisher: "Community forum", date: "2026-08-25", tier: 4, note: "Discovery only — not treated as evidence.", url: "" },
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
      source: str(c.source), url: str(c.url), confidence: str(c.confidence, "Low"), note: str(c.note),
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
