

/* ============================================================
   AI LAYER — router, registry, providers
   Nothing above this line knows a model name. Components ask the
   router for a capability; the router picks the provider.
   ============================================================ */

export const AI_CONFIG = {
  ollamaEndpoint: "http://localhost:11434",
  /* Deployed, AI calls go through Unison's own API, which holds the key.
     Inside a Claude artifact there is no API behind the page, and the direct
     endpoint works without a key — the resolver below picks per environment. */
  aiRelayEndpoint: (typeof window !== "undefined" && window.UNISON_AI_API) || "/api/ai",
  directEndpoint: "https://api.anthropic.com/v1/messages",
  hostedModel: "claude-sonnet-4-6",
  probeTimeoutMs: 1500,
  maxTokens: 1000,
};

/* Intended model per capability. Swap a value here and the whole product
   follows — no component references a model name directly. */
export const MODEL_REGISTRY = {
  reasoning:             { provider: "ollama", model: "nemotron3", label: "Nemotron 3" },
  writing:               { provider: "ollama", model: "nemotron3", label: "Nemotron 3" },
  research:              { provider: "ollama", model: "nemotron3", label: "Nemotron 3" },
  verification:          { provider: "ollama", model: "nemotron3", label: "Nemotron 3" },
  quality:               { provider: "ollama", model: "nemotron3", label: "Nemotron 3" },
  documentUnderstanding: { provider: "ollama", model: "nemotron3", label: "Nemotron 3" },
  imagePrompt:           { provider: "ollama", model: "goonsai/qwen2.5-3B-goonsai-nsfw-100k", label: "Goonsai Qwen 2.5 3B" },
  videoPrompt:           { provider: "ollama", model: "goonsai/qwen2.5-3B-goonsai-nsfw-100k", label: "Goonsai Qwen 2.5 3B" },
  imageGeneration:       { provider: "image", model: null, label: "Image provider" },
  videoGeneration:       { provider: "video", model: null, label: "Video provider" },
};

/* Developer-facing only. Surfaced in Settings under Developer, never in the
   creation workflow. */
export const AI_STATUS = { local: "unknown", localModels: [], lastError: null, routed: {}, calls: 0, hostedVia: null };

export const friendlyError = (e) => {
  const m = String(e?.message || e || "");
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
  async resolve() {
    if (this._mode) return this._mode;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), AI_CONFIG.probeTimeoutMs);
      const res = await fetch(AI_CONFIG.aiRelayEndpoint, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: ctrl.signal });
      clearTimeout(t);
      const body = await res.json().catch(() => null);
      this._mode = res.ok && body?.service === "unison-ai-relay" ? "relay" : "direct";
      if (this._mode === "relay" && body.keyConfigured === false) console.warn("[unison] AI relay is deployed but ANTHROPIC_API_KEY is not set on the server.");
    } catch { this._mode = "direct"; }
    AI_STATUS.hostedVia = this._mode;
    return this._mode;
  },
  async chat({ system, user, tools, signal }) {
    const mode = await this.resolve();
    const body = { model: AI_CONFIG.hostedModel, max_tokens: AI_CONFIG.maxTokens, messages: [{ role: "user", content: user }] };
    if (system) body.system = system;
    if (tools) body.tools = tools;
    const res = await fetch(mode === "relay" ? AI_CONFIG.aiRelayEndpoint : AI_CONFIG.directEndpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
    });
    const data = await res.json();
    if (data?.error) throw new Error(data.error.message || data.error);
    if (!data || !Array.isArray(data.content)) throw new Error("empty response");
    return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  },
};

/* ---------- the router ---------- */

export const aiRouter = {
  async run({ capability = "reasoning", system, user, tools, signal }) {
    const entry = MODEL_REGISTRY[capability] || MODEL_REGISTRY.reasoning;
    AI_STATUS.calls += 1;

    // Web search is a hosted-only tool, so anything needing it routes hosted
    // regardless of what the registry prefers.
    if (entry.provider === "ollama" && !tools && await ollamaProvider.available()) {
      try {
        const out = await ollamaProvider.chat({ model: entry.model, system, user, signal });
        AI_STATUS.routed[capability] = `local · ${entry.model}`;
        return out;
      } catch (e) {
        if (e?.name === "AbortError") throw e;
        AI_STATUS.lastError = friendlyError(e);
      }
    }
    AI_STATUS.routed[capability] = `hosted · ${AI_CONFIG.hostedModel}${tools ? " + search" : ""}`;
    return hostedProvider.chat({ system, user, tools, signal });
  },
  describe(capability) {
    const e = MODEL_REGISTRY[capability];
    return e ? e.label : "—";
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
    console.warn("[unison] engine fell back:", err);
    track?.({ inChars, outChars: 0, ok: false, searched: !!tools });
    if (fallback === undefined) throw err;
    return typeof fallback === "function" ? fallback() : fallback;
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
