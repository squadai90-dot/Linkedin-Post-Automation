import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import mammoth from "mammoth";

/* ============================================================
   UNISON CONTENT OS
   Discover → Research → Angle → Draft → Evidence → Health
   → Media → Approval → Schedule → Publish → Performance
   ============================================================ */

const TAU = Math.PI * 2;
const STORE_KEY = "unison:session:v1";

/* ---------- persistence backend ----------
   Inside a Claude artifact, window.storage is the sandbox's key-value store.
   Deployed, the same three calls run on localStorage. The value shape is kept
   identical ({ key, value }) so the app code doesn't care which one it got. */
const persistentStore = (typeof window !== "undefined" && window.storage) ? window.storage : {
  async get(k) { const v = typeof localStorage !== "undefined" ? localStorage.getItem(k) : null; return v == null ? null : { key: k, value: v }; },
  async set(k, v) { localStorage.setItem(k, v); return { key: k, value: v }; },
  async delete(k) { localStorage.removeItem(k); return { key: k, deleted: true }; },
};

const P = { x: 0.5, y: 0.5, px: 0, py: 0 };
const S = { y: 0, p: 0 };

/* ============================================================
   AI LAYER — router, registry, providers
   Nothing above this line knows a model name. Components ask the
   router for a capability; the router picks the provider.
   ============================================================ */

const AI_CONFIG = {
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
const MODEL_REGISTRY = {
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
const AI_STATUS = { local: "unknown", localModels: [], lastError: null, routed: {}, calls: 0, hostedVia: null };

const friendlyError = (e) => {
  const m = String(e?.message || e || "");
  if (/abort/i.test(m)) return "Cancelled.";
  if (/Failed to fetch|NetworkError|ECONNREFUSED|load failed/i.test(m)) return "The AI service is unreachable right now.";
  if (/401|403|credential|api key/i.test(m)) return "The AI service rejected the request.";
  if (/429|rate/i.test(m)) return "The AI service is busy. Try again in a moment.";
  if (/parse|JSON/i.test(m)) return "The AI service returned something unreadable.";
  return "The AI service didn't respond as expected.";
};

/* ---------- provider: local Ollama ---------- */

const ollamaProvider = {
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

const hostedProvider = {
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

const aiRouter = {
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

function extractJSON(text) {
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
function repairJSON(t) {
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

async function askJSON({ capability = "reasoning", system, user, tools, fallback, track, signal }) {
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

async function askText({ capability = "reasoning", system, user, signal, track }) {
  const inChars = (system || "").length + (user || "").length;
  const text = await aiRouter.run({ capability, system, user, signal });
  track?.({ inChars, outChars: text.length, ok: true, searched: false });
  return text;
}

const JSON_RULE = "Reply with one raw JSON object and nothing else. No prose, no markdown fences, no preamble.";

/* ---------- fallbacks ---------- */

const fb = {
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


/* ============================================================
   LINKEDIN — client service
   The browser talks to Unison's own API, never to LinkedIn and never to a
   secret. If that API isn't running, the app says so and stays in prototype
   mode rather than pretending a connection exists.
   ============================================================ */

const LI_API = (typeof window !== "undefined" && window.UNISON_API_BASE) || "/api/linkedin";

/* status is the whole truth about the connection; nothing else may set it */
const LI_STATES = ["disconnected", "connecting", "authorized", "connected", "expired", "revoked", "error", "simulated", "workflow"];
/* "workflow": publishing goes through a connected LinkedIn workflow that owns
   the Page authorization. Unison holds no credential and can't name the Page. */

const EMPTY_CONNECTION = {
  provider: "linkedin",
  status: "disconnected",
  mode: "unknown",              // real | simulation | misconfigured | unknown
  organizationId: null,
  organizationUrn: null,
  organizationName: null,
  organizationLogo: null,
  followers: null,
  roles: [],
  permissions: [],
  connectedAt: null,
  expiresAt: null,
  lastCheckedAt: null,
  error: null,
};

/* Compatibility shims so the rest of the app keeps reading the fields it
   already reads, while status stays the single source of truth. */
const withDerived = (c) => ({
  ...c,
  connected: c.status === "connected" || c.status === "simulated" || c.status === "workflow",
  simulated: c.status === "simulated",
  viaWorkflow: c.status === "workflow",
  needsAttention: c.status === "expired" || c.status === "revoked" || c.status === "error",
  canPublish: (c.permissions || []).includes("PUBLISH"),
  org: c.organizationName || "",
  role: (c.roles || [])[0] || null,
  expires: c.expiresAt ? String(c.expiresAt).slice(0, 10) : null,
});

async function liFetch(path, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 12000);
  try {
    const res = await fetch(`${LI_API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      ...opts,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.message || "Request failed"), { code: body.error, status: res.status, body });
    return body;
  } finally {
    clearTimeout(t);
  }
}

const linkedinService = {
  /* Is the Unison API there, and is real OAuth configured behind it? */
  async status() {
    try {
      const r = await liFetch("/status", { timeout: 4000 });
      return {
        reachable: true,
        mode: r.mode,
        apiVersion: r.apiVersion,
        scopes: r.scopes || [],
        connection: { ...EMPTY_CONNECTION, ...r.connection, mode: r.mode },
      };
    } catch (e) {
      /* No Unison API. If the LinkedIn publishing workflow is configured, that
         is the publishing path; otherwise fall back to the prototype. */
      if (makeLinkedInService.configured()) {
        return { reachable: false, mode: "workflow", scopes: [], connection: { ...EMPTY_CONNECTION, mode: "workflow", status: "workflow", permissions: ["PUBLISH"], connectedAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString() } };
      }
      return { reachable: false, mode: "simulation", scopes: [], connection: { ...EMPTY_CONNECTION, mode: "simulation" } };
    }
  },
  /* A full page navigation, not a fetch — the user must land on LinkedIn. */
  beginAuthorization() {
    window.location.href = `${LI_API}/connect`;
  },
  organizations() { return liFetch("/organizations"); },
  select(urn) { return liFetch("/select", { method: "POST", body: JSON.stringify({ urn }) }); },
  disconnect() { return liFetch("/disconnect", { method: "POST" }); },
  publish(payload) { return liFetch("/publish", { method: "POST", body: JSON.stringify(payload), timeout: 30000 }); },
};

/* What the callback told us, read once on load. */
function readCallbackParams() {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const v = q.get("linkedin");
  if (!v) return null;
  const reason = q.get("reason");
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("linkedin");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  } catch { /* ignore */ }
  return { result: v, reason };
}

/* ============================================================
   LINKEDIN PUBLISHING BRIDGE — makeLinkedInService
   For this prototype the approved post goes to a Make scenario that owns the
   LinkedIn connection and authorization. Unison never calls LinkedIn here and
   never holds a LinkedIn credential. This module is the only place that
   talks to that endpoint, and the URL lives in exactly one constant.
   ============================================================ */

const MAKE_LINKEDIN_WEBHOOK_URL = "https://hook.eu1.make.com/5sva21xc67b9vne5zovgbohnqgbll15k";

/* The relay is the production path: same-origin, so no CORS and no preflight,
   and the webhook URL stays on the server. The direct browser POST is kept
   only as a fallback for running this file standalone with no API behind it. */
const PUBLISH_RELAY_PATH = (typeof window !== "undefined" && window.UNISON_PUBLISH_API) || "/api/publish";

const MAKE_CONFIG = {
  relay: PUBLISH_RELAY_PATH,
  url: MAKE_LINKEDIN_WEBHOOK_URL,   // used by the relay; only used in the browser as a fallback
  source: "unison-content-os",
  timeoutMs: 45000,
  maxPayloadBytes: 4 * 1024 * 1024,
  /* Which Company Page the scenario posts to. Make owns the authorization, so
     Unison can't discover this — set it here (or in Settings) purely so the
     scenario receives it alongside the post. */
  company: { name: null, urn: null },
  /* Every post type is handed to Make; the scenario routes on postType. */
  supportedPostTypes: ["text", "image", "multi", "video", "document", "poll", "article", "carousel"],
  debug: typeof window !== "undefined" && (window.UNISON_DEBUG ?? true),
};

/* Direct-to-Make bodies. A browser POST with Content-Type: application/json
   is not a simple CORS request, so the browser preflights it and Make's
   webhook does not answer preflights. These keep the same JSON inside a
   safelisted content type. The relay has no such constraint. */
const MAKE_TRANSPORTS = {
  text: (json) => ({ headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: json }),
  form: (json) => ({ headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: "payload=" + encodeURIComponent(json) }),
  json: (json) => ({ headers: { "Content-Type": "application/json" }, body: json }),
};
const MAKE_TRANSPORT_ORDER = ["text", "form"];

const mkLog = (...a) => { if (MAKE_CONFIG.debug) console.log("[unison:publish]", ...a); };

/* Did something tell us LinkedIn actually published? Only an unambiguous
   reply counts. Make's default "Accepted" means delivered and nothing more. */
function readMakeReply(body) {
  if (!body || typeof body !== "object") return { published: false, urn: null, url: null, message: null };
  const inner = body.make && typeof body.make === "object" ? body.make : body;
  const urn = inner.urn || inner.postUrn || inner.linkedinUrn || inner.postId || inner.id || null;
  const url = inner.url || inner.postUrl || null;
  const st = String(inner.status || inner.result || "").toLowerCase();
  const published = st === "published" || st === "success" || (st === "ok" && !!urn) || (!!urn && /^urn:li:/.test(String(urn)));
  return { published: !!published, urn, url, message: inner.message || inner.error || null };
}

const makeLinkedInService = {
  configured: () => /^https:\/\/hook\.[a-z0-9.-]+\.make\.com\//.test(MAKE_CONFIG.url),
  supports: (postType) => MAKE_CONFIG.supportedPostTypes.includes(postType),

  /* ---- production path: Unison frontend → Unison API → Make → LinkedIn ----
     Same origin, so the request is never subject to CORS. The relay forwards
     the whole payload and reports back what Make said. */
  async viaRelay(payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MAKE_CONFIG.timeoutMs);
    const startedAt = Date.now();
    mkLog("sending via relay", { endpoint: MAKE_CONFIG.relay, postId: payload.postId, postType: payload.postType, idempotencyKey: payload.idempotencyKey, media: payload.media?.length || 0, poll: !!payload.poll });
    let res;
    try {
      res = await fetch(MAKE_CONFIG.relay, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": payload.idempotencyKey || payload.postId },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = e?.name === "AbortError";
      mkLog(timedOut ? "relay timed out" : "relay unreachable", { error: String(e?.message || e), ms: Date.now() - startedAt });
      throw Object.assign(new Error(timedOut ? "Timed out." : "Relay unreachable."), { kind: timedOut ? "timeout" : "relay-down", cause: e });
    }
    clearTimeout(timer);
    const raw = await res.text().catch(() => "");
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
    mkLog("relay response", { status: res.status, ok: res.ok, ms: Date.now() - startedAt, body: parsed ?? raw.slice(0, 300) });

    /* No API deployed behind this page: the request was answered by the static
       host, not by the relay. Distinguishable, and not a publishing failure. */
    if (res.status === 404 || res.status === 405 || (!parsed && /<!doctype html/i.test(raw))) {
      throw Object.assign(new Error("No publishing service at this address."), { kind: "relay-missing", status: res.status });
    }
    if (!res.ok) {
      throw Object.assign(new Error(parsed?.error || `Publishing service returned ${res.status}.`), { kind: "relay-error", status: res.status, body: parsed ?? raw });
    }
    if (parsed?.duplicate) mkLog("relay reported this post was already delivered — not sent again");
    return { ok: true, delivered: true, confirmed: true, status: res.status, transport: "relay", duplicate: !!parsed?.duplicate, raw: parsed ?? raw, ...readMakeReply(parsed), at: new Date().toISOString() };
  },

  /* ---- fallback: browser straight to Make ----
     Only reached when no relay is deployed. Tries the preflight-free
     transports in order; a transport is only retried with the next one when
     the browser refused the request outright, which means nothing was sent. */
  async viaBrowser(payload, { transport } = {}) {
    if (!makeLinkedInService.configured()) throw Object.assign(new Error("Publishing endpoint not configured."), { kind: "unconfigured" });
    const json = JSON.stringify(payload);
    if (json.length > MAKE_CONFIG.maxPayloadBytes) throw Object.assign(new Error("Payload too large."), { kind: "too-large", bytes: json.length });

    const order = transport ? [transport] : MAKE_TRANSPORT_ORDER;
    let lastErr = null;
    for (const name of order) {
      const { headers, body } = MAKE_TRANSPORTS[name](json);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), MAKE_CONFIG.timeoutMs);
      const startedAt = Date.now();
      mkLog("sending direct", { transport: name, postId: payload.postId, postType: payload.postType, bytes: json.length });
      let res;
      try {
        res = await fetch(MAKE_CONFIG.url, { method: "POST", mode: "cors", headers, body, signal: ctrl.signal });
      } catch (e) {
        clearTimeout(timer);
        if (e?.name === "AbortError") {
          mkLog("timed out", { transport: name, hint: "The post may already have reached Make. Check the scenario history before resending." });
          throw Object.assign(new Error("Timed out."), { kind: "timeout", transport: name, cause: e });
        }
        mkLog("browser refused the request", { transport: name, error: String(e?.message || e), ms: Date.now() - startedAt });
        lastErr = Object.assign(new Error("Request blocked."), { kind: "network", transport: name, cause: e });
        continue;
      }
      clearTimeout(timer);
      const raw = await res.text().catch(() => "");
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
      mkLog("response", { transport: name, status: res.status, ok: res.ok, ms: Date.now() - startedAt, body: parsed ?? raw.slice(0, 300) });
      if (!res.ok) throw Object.assign(new Error(`Make returned ${res.status}.`), { kind: "http", status: res.status, transport: name, body: parsed ?? raw });
      return { ok: true, delivered: true, confirmed: true, status: res.status, transport: name, raw: parsed ?? raw, ...readMakeReply(parsed), at: new Date().toISOString() };
    }
    throw lastErr || Object.assign(new Error("Request blocked."), { kind: "network" });
  },

  /* Relay first, browser second. One logical send: the fallback only runs
     when the relay was never there to receive the post. */
  async publish(payload, opts) {
    try {
      return await makeLinkedInService.viaRelay(payload);
    } catch (e) {
      if (e?.kind !== "relay-missing" && e?.kind !== "relay-down") throw e;
      mkLog("no relay available — falling back to a direct request", { reason: e.kind });
      const r = await makeLinkedInService.viaBrowser(payload, opts);
      return { ...r, fallback: true };
    }
  },

  /* Is a relay deployed, and can it reach Make? Cheap, no post involved. */
  async health() {
    try {
      const res = await fetch(MAKE_CONFIG.relay, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
      const raw = await res.text().catch(() => "");
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      if (!res.ok || !body?.service) return { relay: false };
      mkLog("relay health", body);
      return { relay: true, ...body };
    } catch { return { relay: false }; }
  },

  /* Tells apart "the environment allows outside requests but Make's reply is
     unreadable" from "this page cannot make outside requests at all". A GET
     to the host root, never the webhook path, so no scenario is triggered. */
  async diagnose() {
    let origin;
    try { origin = new URL(MAKE_CONFIG.url).origin; } catch { return { networkAllowed: false, reason: "bad-url" }; }
    const framed = typeof window !== "undefined" && window.self !== window.top;
    try {
      await fetch(origin + "/", { method: "GET", mode: "no-cors", cache: "no-store" });
      mkLog("diagnosis: outside requests are allowed — Make's reply was unreadable, the request itself was not blocked", { framed });
      return { networkAllowed: true, framed };
    } catch (e) {
      mkLog("diagnosis: this environment blocks outside requests", { framed, hint: framed ? "Running inside a sandboxed preview frame. Deploy Unison with its API to publish." : "Check the network, an extension, or the page's content security policy." });
      return { networkAllowed: false, framed };
    }
  },

  /* Last resort, only on an explicit user action. A no-cors POST does leave
     the browser, but the response is opaque, so delivery cannot be verified
     from here — the result says exactly that and never claims success. */
  async sendUnverified(payload) {
    const { headers, body } = MAKE_TRANSPORTS.text(JSON.stringify(payload));
    mkLog("sending without response access (no-cors)", { postId: payload.postId, idempotencyKey: payload.idempotencyKey });
    await fetch(MAKE_CONFIG.url, { method: "POST", mode: "no-cors", headers, body });
    mkLog("no-cors request completed — the response is opaque, so delivery is unverifiable from the browser");
    return { ok: true, delivered: null, confirmed: false, status: 0, transport: "no-cors", published: false, urn: null, url: null, at: new Date().toISOString() };
  },
};

/* ---------- formats ----------
   Each format declares which pipeline stages it needs, so the workspace
   only reveals what is relevant. The engines underneath are unchanged. */

const FORMATS = [
  { id: "text", label: "Text", hint: "A written post, nothing attached.", stages: ["research", "angle", "draft", "evidence", "health", "approval", "schedule"] },
  { id: "image", label: "Image", hint: "A post with one branded visual.", stages: ["research", "angle", "draft", "media", "evidence", "health", "approval", "schedule"] },
  { id: "video", label: "Video", hint: "A post with a short video.", stages: ["research", "angle", "draft", "media", "evidence", "health", "approval", "schedule"] },
  { id: "document", label: "Document", hint: "A multi-page PDF-style document.", stages: ["research", "angle", "draft", "media", "evidence", "health", "approval", "schedule"] },
  { id: "multi", label: "Multi-image", hint: "Two to four images as one set.", stages: ["research", "angle", "draft", "media", "evidence", "health", "approval", "schedule"] },
  { id: "poll", label: "Poll", hint: "A written post that carries a poll with up to four options.", stages: ["research", "angle", "draft", "poll", "health", "approval", "schedule"] },
  { id: "article", label: "Article", hint: "Long-form, no post character limit.", stages: ["research", "angle", "draft", "article", "evidence", "health", "approval", "schedule"] },
  { id: "carousel", label: "Carousel", hint: "Slide story. Export only — LinkedIn has no organic carousel API.", stages: ["research", "angle", "draft", "story", "slides", "health", "approval", "schedule"] },
];

const FORMAT_BY_ID = Object.fromEntries(FORMATS.map((f) => [f.id, f]));

/* ---------- combining formats ----------
   A post is written content plus any number of components. "text" is always
   present. LinkedIn accepts one attachment type per post, so the four visual
   formats are mutually exclusive; a poll, an article or a carousel can sit
   alongside any of them. */
const VISUAL_FORMATS = ["image", "multi", "video", "document"];
const STAGE_ORDER = ["research", "angle", "draft", "poll", "article", "story", "slides", "media", "evidence", "health", "approval", "schedule"];

const normalizeFormats = (v) => {
  const list = Array.isArray(v) ? v : [v];
  const out = ["text"];
  list.map(normalizeFormat).forEach((f) => { if (f !== "text" && !out.includes(f)) out.push(f); });
  return out;
};
const toggleFormat = (list, id) => {
  if (id === "text") return list;
  if (list.includes(id)) return list.filter((f) => f !== id);
  const next = VISUAL_FORMATS.includes(id) ? list.filter((f) => !VISUAL_FORMATS.includes(f)) : list;
  return [...next, id];
};
const stagesFor = (formats) => {
  const set = new Set();
  normalizeFormats(formats).forEach((f) => FORMAT_BY_ID[f].stages.forEach((s) => set.add(s)));
  return STAGE_ORDER.filter((s) => set.has(s));
};
const visualOf = (formats) => normalizeFormats(formats).find((f) => VISUAL_FORMATS.includes(f)) || null;
const labelFor = (formats) => {
  const list = normalizeFormats(formats);
  return list.length === 1 ? "Text" : list.filter((f) => f !== "text").map((f) => FORMAT_BY_ID[f].label).join(" + ");
};
/* The composite the rest of the app treats as "the format". */
const composeFormat = (formats) => ({ id: normalizeFormats(formats).join("+"), label: labelFor(formats), stages: stagesFor(formats), list: normalizeFormats(formats) });

/* Older sessions and the recommendation engine used display labels rather than
   ids. Anything unrecognised resolves to a real format instead of leaving the
   workspace with no media stage at all. */
const LEGACY_FORMAT = {
  "text": "text", "image + text": "image", "image": "image", "video + text": "video", "video": "video",
  "document + text": "document", "document": "document", "multi-image": "multi", "multi": "multi",
  "poll": "poll", "article": "article", "carousel": "carousel",
};
const normalizeFormat = (v) => FORMAT_BY_ID[v] ? v : (LEGACY_FORMAT[String(v || "").trim().toLowerCase()] || "text");

const STAGE_LABEL = {
  research: "Research", angle: "Angle", draft: "Draft", article: "Article",
  media: "Media", poll: "Poll", story: "Story", slides: "Slides",
  evidence: "Evidence", health: "Health", approval: "Approval", schedule: "Publish",
};

const EMPTY_ASSETS = { images: [], video: null, doc: null, carousel: [], poll: null, article: null, upload: null, sourceDoc: null };
/* what is safe to persist: blobs and object URLs don't survive a reload */
const compactAssets = (a) => ({ ...a, upload: null, video: a.video ? { ...a.video, url: null, blob: null } : null });

/* every generation task reports one of four states, never a silent failure */
const idle = () => ({ status: "idle", error: null, progress: 0 });

/* ---------- seed data ---------- */

const SEED_POSTS = [
  { id: "p-201", title: "Why procurement is the real AI bottleneck", state: "HUMAN_REVIEW", date: "2026-08-26" },
  { id: "p-202", title: "Three questions to ask before you buy an AI tool", state: "HUMAN_REVIEW", date: "2026-08-26" },
  { id: "p-203", title: "What our support team learned in 90 days", state: "HUMAN_REVIEW", date: "2026-08-25" },
  { id: "p-198", title: "AI agents in enterprise software", state: "PUBLISHED", date: "2026-08-19", metrics: { impressions: 14820, reactions: 386, comments: 74, shares: 41, clicks: 512 } },
  { id: "p-195", title: "The quiet cost of unverified content", state: "PUBLISHED", date: "2026-08-12", metrics: { impressions: 9110, reactions: 211, comments: 33, shares: 18, clicks: 274 } },
  { id: "p-207", title: "Q3 customer roundup", state: "SCHEDULED", date: "2026-09-02" },
];

/* Home holds the composer, so there is no separate "New". "Drafts" is the
   list of unfinished posts; the open workspace lives under it. */
const NAV = [["home", "Home"], ["discover", "Discover"], ["drafts", "Drafts"], ["content", "Content"], ["calendar", "Calendar"], ["insights", "Insights"]];
const navKey = (view) => (view === "workspace" ? "drafts" : view);

const RAIL = [
  { key: "idea", label: "Idea", engine: "Orchestrator" },
  { key: "research", label: "Research", engine: "Discovery" },
  { key: "angles", label: "Angles", engine: "Intelligence" },
  { key: "draft", label: "Draft", engine: "Brand writer" },
  { key: "evidence", label: "Evidence", engine: "Trust" },
  { key: "health", label: "Health", engine: "Trust" },
  { key: "media", label: "Media", engine: "Media" },
  { key: "approval", label: "Approval", engine: "Human" },
  { key: "schedule", label: "Schedule", engine: "Scheduler" },
  { key: "published", label: "Performance", engine: "Learning" },
];

const ENGINES = [
  { tag: "Discovery", title: "Finds the story, then proves it", body: "Scans the live web for what moved in your category, ranks each story by urgency and by whether your Page has covered it, and keeps every link attached." },
  { tag: "Intelligence", title: "Four angles, one recommendation", body: "Turns raw research into distinct positions — contrarian, educational, industry, data-led — and says which one fits your Page and why." },
  { tag: "Brand writer", title: "Your voice, expressed as numbers", body: "Drafts against a measured voice profile: formality, opinion strength, technical depth, banned vocabulary. Move a slider, get a different draft." },
  { tag: "Trust", title: "Every claim tied to a source", body: "Marks each factual statement green, amber or red, shows you exactly where it sits in the post, and blocks approval when it cannot be supported." },
  { tag: "Media", title: "Brand visuals written as code", body: "Generates a real branded SVG for the post — your palette, your type, LinkedIn's aspect ratio — that you can download and reuse." },
  { tag: "Learning", title: "Why it worked, not just how it did", body: "Reads performance against your history and returns likely reasons plus a next topic. Correlation stays labelled as correlation." },
];

const FAQ = [
  { q: "Does Unison publish on its own?", a: "No. Research, writing, verification, media and scheduling are automated, but a human approves before anything reaches LinkedIn. That rule sits in the state machine, not in a setting." },
  { q: "Where do trending stories come from?", a: "Live web search across news, company newsrooms, industry press and public pages. LinkedIn has no free public API for trending content and scraping it breaks their terms, so nothing here claims to read LinkedIn's feed." },
  { q: "What happens when a claim can't be verified?", a: "It turns amber or red in the evidence panel. Amber needs a human decision, red blocks approval. You can replace the source, rewrite the claim, drop it, or send it back for more research." },
  { q: "What if publishing fails?", a: "The draft is preserved, the attempt is logged with an idempotency key, and you get a plain explanation with retry, reconnect and edit as next steps." },
];

const REJECT_REASONS = ["Wrong tone", "Wrong angle", "Fact needs correction", "Too generic", "Too promotional", "Weak hook", "Needs stronger evidence", "Incorrect audience"];

const DEFAULT_VOICE = {
  professional: 78, conversational: 62, technical: 48, opinionated: 82, humour: 18, emoji: 8,
  cta: "Question-based", paragraphs: "Short", hashtags: "2–3",
  avoid: ["leverage", "synergy", "game-changer", "in today's fast-paced world"],
  prefer: ["operators", "evidence", "workflow", "shipped"],
};

const SEED_TEAM = [
  { name: "Jaynil A.", email: "jaynil@acme.systems", role: "Owner" },
  { name: "Krunal P.", email: "krunal@acme.systems", role: "Admin" },
  { name: "Priya S.", email: "priya@acme.systems", role: "Creator" },
  { name: "Daniel R.", email: "daniel@acme.systems", role: "Reviewer" },
];

const DEFAULT_PROFILE = { industry: "Enterprise software", audience: "Marketing and RevOps leaders", keywords: "AI agents, automation, buying process" };

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const pad = (n) => String(n).padStart(2, "0");
const tierLabel = (t) => ["", "Primary", "High-quality secondary", "Industry", "Discovery only"][t] || "Unclassified";
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const LI_LIMIT = 3000, LI_FOLD = 210;

/* ---------- branded media templates ----------
   Generative SVG is good for a one-off hero image but unreliable for anything
   that has to look consistent. So the model supplies the words and these
   deterministic templates draw them — same palette, same grid, every time. */

const BRAND = { bg: "#0A0F1A", panel: "#111A2B", acc: "#7C8CFF", acc2: "#39D3C7", ink: "#EEF2F8", mute: "#8B95AB", rule: "#26314A" };
const FONT = 'Inter, Helvetica, Arial, sans-serif';

const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrapText(str, max) {
  const words = String(str || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function tplCard(kicker, title, footer) {
  const lines = wrapText(title, 26).slice(0, 4);
  const fs = lines.length > 3 ? 58 : lines.length > 2 ? 66 : 74;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
<circle cx="1090" cy="70" r="240" fill="${BRAND.acc}" opacity="0.10"/>
<circle cx="150" cy="600" r="180" fill="${BRAND.acc2}" opacity="0.07"/>
<text x="80" y="98" fill="${BRAND.acc2}" font-family="${FONT}" font-size="21" letter-spacing="5">${esc(kicker).toUpperCase()}</text>
<rect x="80" y="120" width="72" height="5" fill="${BRAND.acc}"/>
${lines.map((l, i) => `<text x="80" y="${222 + i * (fs + 14)}" fill="${BRAND.ink}" font-family="${FONT}" font-size="${fs}" font-weight="700">${esc(l)}</text>`).join("")}
<rect x="80" y="524" width="1040" height="1" fill="${BRAND.rule}"/>
<text x="80" y="572" fill="${BRAND.mute}" font-family="${FONT}" font-size="20" letter-spacing="4">${esc(footer).toUpperCase()}</text>
</svg>`;
}

function tplPage(n, total, heading, body) {
  const h = wrapText(heading, 22).slice(0, 3);
  const b = wrapText(body, 40).slice(0, 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">
<rect width="1200" height="1200" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="1200" height="10" fill="${BRAND.acc}" opacity="0.9"/>
<text x="90" y="150" fill="${BRAND.acc2}" font-family="${FONT}" font-size="24" letter-spacing="5">${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}</text>
${h.map((l, i) => `<text x="90" y="${330 + i * 96}" fill="${BRAND.ink}" font-family="${FONT}" font-size="82" font-weight="700">${esc(l)}</text>`).join("")}
<rect x="90" y="${360 + h.length * 96}" width="90" height="5" fill="${BRAND.acc}"/>
${b.map((l, i) => `<text x="90" y="${450 + h.length * 96 + i * 54}" fill="${BRAND.mute}" font-family="${FONT}" font-size="38">${esc(l)}</text>`).join("")}
${Array.from({ length: total }).map((_, i) => `<rect x="${90 + i * 34}" y="1070" width="24" height="6" rx="3" fill="${i < n ? BRAND.acc : BRAND.rule}"/>`).join("")}
<text x="1110" y="1080" text-anchor="end" fill="${BRAND.mute}" font-family="${FONT}" font-size="22" letter-spacing="4">ACME SYSTEMS</text>
</svg>`;
}

function tplTile(label, stat) {
  const l = wrapText(label, 20).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200">
<rect width="1200" height="1200" fill="${BRAND.bg}"/>
<circle cx="1050" cy="1140" r="260" fill="${BRAND.acc}" opacity="0.09"/>
<text x="90" y="480" fill="${BRAND.acc}" font-family="${FONT}" font-size="190" font-weight="700">${esc(stat)}</text>
<rect x="90" y="540" width="110" height="6" fill="${BRAND.acc2}"/>
${l.map((x, i) => `<text x="90" y="${650 + i * 68}" fill="${BRAND.ink}" font-family="${FONT}" font-size="52" font-weight="500">${esc(x)}</text>`).join("")}
<text x="90" y="1110" fill="${BRAND.mute}" font-family="${FONT}" font-size="24" letter-spacing="4">ACME SYSTEMS</text>
</svg>`;
}

function tplPoster(title) {
  const lines = wrapText(title, 30).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
<circle cx="600" cy="240" r="300" fill="${BRAND.acc}" opacity="0.08"/>
<circle cx="600" cy="250" r="74" fill="none" stroke="${BRAND.acc}" stroke-width="5"/>
<path d="M580 218 L630 250 L580 282 Z" fill="${BRAND.acc}"/>
${lines.map((l, i) => `<text x="600" y="${406 + i * 52}" text-anchor="middle" fill="${BRAND.ink}" font-family="${FONT}" font-size="44" font-weight="600">${esc(l)}</text>`).join("")}
<text x="600" y="572" text-anchor="middle" fill="${BRAND.mute}" font-family="${FONT}" font-size="20" letter-spacing="4">ACME SYSTEMS</text>
</svg>`;
}

/* freeform SVG from the model gets cut off the same way JSON does */
function repairSVG(raw) {
  const t = String(raw || "").replace(/```svg/gi, "").replace(/```/g, "").trim();
  const i = t.indexOf("<svg");
  if (i === -1) return null;
  const j = t.lastIndexOf("</svg>");
  if (j > i) return t.slice(i, j + 6);
  const body = t.slice(i);
  const lastClose = body.lastIndexOf(">");
  if (lastClose < 4) return null;
  return body.slice(0, lastClose + 1) + "</svg>";
}

/* ============================================================
   MEDIA ENGINE
   The UI calls this. It never talks to a provider directly.
   Real providers plug into imageProvider / videoProvider without
   the engine or the UI changing.
   ============================================================ */

/* ---------- provider: image ----------
   No external image model is configured in this build. The prototype
   renderer draws a real, previewable, downloadable asset from the brief so
   the workflow is complete end to end. It does not pretend to be a model. */

const SCENE_SECONDS = 2.2;

const imageProvider = {
  id: "prototype-renderer",
  configured: false,
  label: "Local brand renderer (prototype)",
  async generate({ brief, variant = 0 }) {
    const svg = renderBrandImage(brief, variant);
    return { kind: "svg", svg, source: this.id, generated: false };
  },
};

/* ---------- provider: video ----------
   Renders the storyboard to a genuine playable WebM in the browser. It is a
   real video file you can play, scrub and download — it is not the output of
   a video model, and the UI says so. */

const videoProvider = {
  id: "prototype-renderer",
  configured: false,
  label: "Local storyboard renderer (prototype)",
  supported: () => typeof window !== "undefined" && !!window.MediaRecorder && !!document.createElement("canvas").captureStream,
  async generate({ storyboard, brief, onProgress }) {
    if (!this.supported()) throw new Error("recorder unavailable");
    const W = 1280, H = 720, FPS = 30, PER = SCENE_SECONDS;
    const scenes = (storyboard || []).slice(0, 5);
    if (!scenes.length) throw new Error("no scenes");

    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(FPS);
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const done = new Promise((res) => { rec.onstop = res; });

    // paint one frame before recording starts, otherwise the opening frames
    // are captured from a blank canvas and the video begins on black
    drawScene(ctx, W, H, scenes[0], 0, scenes.length, 0, brief);
    await new Promise((r) => requestAnimationFrame(r));

    // a timeslice makes the recorder emit chunks as it goes rather than one
    // blob at the end, which keeps memory flat on longer storyboards
    rec.start(250);

    const total = scenes.length * PER * 1000;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = () => {
        const t = performance.now() - t0;
        if (t >= total) return resolve();
        const i = Math.min(scenes.length - 1, Math.floor(t / (PER * 1000)));
        const local = (t % (PER * 1000)) / (PER * 1000);
        drawScene(ctx, W, H, scenes[i], i, scenes.length, local, brief);
        onProgress?.(t / total);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mime });
    if (!blob.size) throw new Error("empty recording");
    return {
      kind: "video",
      blob,                                   // kept so downloads get real bytes
      url: URL.createObjectURL(blob),
      mime,
      seconds: Math.round(scenes.length * PER),
      source: this.id,
      generated: false,
      poster: tplPoster(brief?.title || "Video"),
    };
  },
};

function drawScene(ctx, W, H, scene, i, total, t, brief) {
  const ease = t < 0.12 ? t / 0.12 : t > 0.88 ? (1 - t) / 0.12 : 1;
  ctx.fillStyle = BRAND.bg;
  ctx.fillRect(0, 0, W, H);

  // slow drift so it reads as motion rather than a slideshow
  const drift = (t - 0.5) * 40;
  const g = ctx.createRadialGradient(W * 0.78 + drift, H * 0.2, 40, W * 0.78 + drift, H * 0.2, 620);
  g.addColorStop(0, "rgba(124,140,255,0.30)");
  g.addColorStop(1, "rgba(124,140,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = ease;
  ctx.fillStyle = BRAND.acc2;
  ctx.font = "500 22px Inter, Helvetica, Arial, sans-serif";
  ctx.fillText(String(scene.label || `SCENE ${i + 1}`).toUpperCase(), 90, 120);
  ctx.fillStyle = BRAND.acc;
  ctx.fillRect(90, 140, 64, 5);

  ctx.fillStyle = BRAND.ink;
  ctx.font = "700 62px Inter, Helvetica, Arial, sans-serif";
  wrapText(scene.line || "", 28).slice(0, 4).forEach((l, k) => ctx.fillText(l, 90 + drift * 0.25, 300 + k * 76));

  if (scene.note) {
    ctx.fillStyle = BRAND.mute;
    ctx.font = "400 28px Inter, Helvetica, Arial, sans-serif";
    wrapText(scene.note, 52).slice(0, 2).forEach((l, k) => ctx.fillText(l, 90, 560 + k * 40));
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = BRAND.rule;
  ctx.fillRect(90, H - 60, W - 180, 3);
  ctx.fillStyle = BRAND.acc;
  ctx.fillRect(90, H - 60, (W - 180) * ((i + t) / total), 3);
  ctx.fillStyle = BRAND.mute;
  ctx.font = "500 20px Inter, Helvetica, Arial, sans-serif";
  ctx.fillText("ACME SYSTEMS", 90, H - 90);
}

/* ---------- image layouts ----------
   Four compositions, picked by variant, so regenerating visibly changes the
   result instead of returning the same card. */

function renderBrandImage(brief, variant = 0) {
  const b = brief || {};
  const title = b.headline || b.subject || "Acme Systems";
  const kicker = b.kicker || "Acme Systems";
  const support = b.support || "";
  const v = ((variant % 4) + 4) % 4;

  if (v === 1) {
    const lines = wrapText(title, 20).slice(0, 4);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
<rect x="0" y="0" width="470" height="630" fill="${BRAND.panel}"/>
<circle cx="470" cy="315" r="150" fill="none" stroke="${BRAND.acc}" stroke-width="4" opacity="0.55"/>
<circle cx="470" cy="315" r="230" fill="none" stroke="${BRAND.acc2}" stroke-width="2" opacity="0.35"/>
<text x="90" y="120" fill="${BRAND.acc2}" font-family="${FONT}" font-size="20" letter-spacing="5">${esc(kicker).toUpperCase()}</text>
${lines.map((l, i) => `<text x="90" y="${300 + i * 62}" fill="${BRAND.ink}" font-family="${FONT}" font-size="54" font-weight="700">${esc(l)}</text>`).join("")}
<text x="640" y="560" fill="${BRAND.mute}" font-family="${FONT}" font-size="22">${esc(wrapText(support, 44)[0] || "")}</text>
</svg>`;
  }
  if (v === 2) {
    const lines = wrapText(title, 24).slice(0, 3);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
${Array.from({ length: 14 }).map((_, i) => `<rect x="${60 + i * 80}" y="${430 - (i % 5) * 46}" width="34" height="${120 + (i % 5) * 46}" fill="${i % 5 === 3 ? BRAND.acc : BRAND.panel}" opacity="${i % 5 === 3 ? 0.95 : 0.7}"/>`).join("")}
<rect x="0" y="0" width="1200" height="330" fill="${BRAND.bg}" opacity="0.88"/>
<text x="80" y="96" fill="${BRAND.acc2}" font-family="${FONT}" font-size="20" letter-spacing="5">${esc(kicker).toUpperCase()}</text>
${lines.map((l, i) => `<text x="80" y="${186 + i * 66}" fill="${BRAND.ink}" font-family="${FONT}" font-size="58" font-weight="700">${esc(l)}</text>`).join("")}
</svg>`;
  }
  if (v === 3) {
    const lines = wrapText(title, 22).slice(0, 3);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="${BRAND.bg}"/>
<path d="M0 630 L420 180 L760 420 L1200 60 L1200 630 Z" fill="${BRAND.panel}" opacity="0.85"/>
<path d="M0 630 L420 180 L760 420 L1200 60" fill="none" stroke="${BRAND.acc}" stroke-width="5"/>
<circle cx="760" cy="420" r="14" fill="${BRAND.acc2}"/>
<text x="80" y="100" fill="${BRAND.acc2}" font-family="${FONT}" font-size="20" letter-spacing="5">${esc(kicker).toUpperCase()}</text>
${lines.map((l, i) => `<text x="80" y="${200 + i * 64}" fill="${BRAND.ink}" font-family="${FONT}" font-size="56" font-weight="700">${esc(l)}</text>`).join("")}
</svg>`;
  }
  return tplCard(kicker, title, support || "acme.systems");
}

/* ---------- rasterise so assets are LinkedIn-uploadable ---------- */

function svgToPng(svg, w = 1200, h = 630) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = BRAND.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("raster failed")); };
    img.src = url;
  });
}

function downloadBlob(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a");
  a.href = typeof data === "string" && data.startsWith("data:") ? data : URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  if (!a.href.startsWith("data:")) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- the engine ---------- */

function createMediaEngine({ track, log }) {
  const brief = async (kind, ctx, signal) => {
    // the reasoning capability writes the creative brief…
    const r = await askJSON({
      capability: "reasoning",
      system: `You write creative briefs for B2B brand media. ${JSON_RULE}`,
      user: kind === "video"
        ? `Write a video brief for this LinkedIn post.
Post: ${ctx.hook}
${ctx.body || ""}
{"title":"under 8 words","concept":"one line","audience":"one line","style":"one line","motion":"one line","aspect":"16:9","scenes":[{"label":"HOOK|PROBLEM|INSIGHT|PROOF|CTA","line":"under 9 words","note":"under 14 words"}],"avoid":"one line"}
Give 4 scenes.`
        : `Write an image brief for this LinkedIn post.
Post: ${ctx.hook}
${ctx.body || ""}
{"subject":"one line","headline":"under 9 words","message":"one line","audience":"one line","composition":"one line","kicker":"under 3 words","support":"under 10 words","aspect":"1.91:1","avoid":"one line"}`,
      fallback: () => (kind === "video"
        ? { title: ctx.hook?.slice(0, 60) || "Video", concept: "A short explainer built from the post.", audience: "Marketing leaders", style: "Dark, typographic, restrained", motion: "Slow drift between titles", aspect: "16:9", scenes: [{ label: "HOOK", line: ctx.hook || "", note: "" }, { label: "PROBLEM", line: "What actually slows teams down", note: "" }, { label: "INSIGHT", line: "The part nobody automates", note: "" }, { label: "CTA", line: "What would you fix first?", note: "" }], avoid: "stock footage clichés" }
        : { subject: ctx.hook || "", headline: (ctx.hook || "").slice(0, 60), message: "", audience: "Marketing leaders", composition: "Type-led with one geometric motif", kicker: "Acme Systems", support: "acme.systems", aspect: "1.91:1", avoid: "stock photography" }),
      track, signal,
    });
    return r;
  };

  /* …then the prompt model turns the brief into a generation prompt. */
  const enhance = async (kind, b, signal) => {
    try {
      const txt = await askText({
        capability: kind === "video" ? "videoPrompt" : "imagePrompt",
        system: "You turn a creative brief into a single detailed generation prompt. Output the prompt only — no preamble, no lists, no quotes. Professional B2B brand imagery only.",
        user: `Brief: ${JSON.stringify(b)}
Write one prompt of 40-70 words describing subject, composition, lighting, palette and mood for a ${kind === "video" ? "short brand video" : "brand image"}. Avoid: ${b.avoid || "clichés"}.`,
        track,
        signal,
      });
      return txt.trim().slice(0, 600);
    } catch (e) {
      return `${b.headline || b.title || ""} — ${b.composition || b.style || ""}. Palette: deep navy, periwinkle accent, off-white type. ${b.avoid ? "Avoid " + b.avoid : ""}`.trim();
    }
  };

  return {
    providers: { image: imageProvider, video: videoProvider },

    async image(ctx, { variant = 0, signal } = {}) {
      const b = await brief("image", ctx, signal);
      const prompt = await enhance("image", b, signal);
      const asset = await imageProvider.generate({ brief: b, prompt, variant });
      log?.(`Image rendered — ${imageProvider.id}`);
      return { ...asset, brief: b, prompt, id: "img-" + Math.random().toString(36).slice(2, 8) };
    },

    async imageSet(ctx, { count = 3, signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You plan branded image sets for LinkedIn. ${JSON_RULE}`,
        user: `Turn this post into ${count} image tiles that read as one set.
Post: ${ctx.hook} ${ctx.body || ""}
{"tiles":[{"stat":"a number or short figure, under 6 characters","label":"under 8 words"}]}`,
        fallback: () => ({ tiles: [{ stat: "01", label: "The problem" }, { stat: "02", label: "What changed" }, { stat: "03", label: "What to do" }] }),
        track, signal,
      });
      let tiles = (r.tiles || []).filter((t) => t && (t.label || t.stat)).slice(0, count);
      if (!tiles.length) tiles = [{ stat: "01", label: "The problem" }, { stat: "02", label: "What changed" }, { stat: "03", label: "What to do" }].slice(0, count);
      log?.(`Image set rendered — ${tiles.length} tiles`);
      return tiles.map((t, i) => ({
        kind: "svg", svg: tplTile(t.label, t.stat), source: imageProvider.id, generated: false,
        meta: t, id: "tile-" + i + "-" + Math.random().toString(36).slice(2, 6),
      }));
    },

    async retile(tile, ctx, { signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You rewrite one tile in a branded image set. ${JSON_RULE}`,
        user: `Post: ${ctx.hook}
Rewrite this single tile so it says something different but still fits the set. Current: ${JSON.stringify(tile.meta || {})}
{"stat":"under 6 characters","label":"under 8 words"}`,
        fallback: () => ({ stat: tile.meta?.stat || "02", label: "A different angle on the same point" }),
        track, signal,
      });
      return { ...tile, svg: tplTile(r.label, r.stat), meta: r, id: tile.id };
    },

    /* Building the storyboard is instant. Encoding a file is not, so that only
       happens when the user actually asks to export one. */
    async video(ctx, { signal } = {}) {
      const b = await brief("video", ctx, signal);
      const prompt = await enhance("video", b, signal);
      let storyboard = (b.scenes || []).filter((x) => x && x.line).slice(0, 5);
      if (!storyboard.length) storyboard = [
        { label: "HOOK", line: String(ctx.hook || "").slice(0, 60), note: "" },
        { label: "PROBLEM", line: "What actually slows teams down", note: "" },
        { label: "INSIGHT", line: "The part nobody automates", note: "" },
        { label: "CTA", line: "What would you fix first?", note: "" },
      ];
      log?.(`Storyboard built — ${storyboard.length} scenes`);
      return {
        kind: "storyboard",
        storyboard,
        brief: b,
        prompt,
        poster: tplPoster(b.title || ctx.hook),
        seconds: Math.round(storyboard.length * SCENE_SECONDS),
        source: videoProvider.id,
        generated: false,
      };
    },

    /* Encode the storyboard to a real WebM. Only called on export. */
    async encodeVideo(asset, { onProgress } = {}) {
      return videoProvider.generate({ storyboard: asset.storyboard, brief: asset.brief, onProgress });
    },

    async document(ctx, { pages = 5, signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You structure branded LinkedIn documents. ${JSON_RULE}`,
        user: `Break this into a ${pages}-page document. Page 1 is the cover, the last page is the takeaway.
Topic: ${ctx.hook}
${ctx.body || ""}
{"title":"under 8 words","pages":[{"heading":"under 6 words","body":"under 20 words"}]}`,
        fallback: () => ({
          title: ctx.hook?.slice(0, 50) || "Document",
          pages: [
            { heading: ctx.hook?.slice(0, 40) || "Overview", body: "" },
            { heading: "The problem", body: "What slows teams down today." },
            { heading: "What changed", body: "The shift worth paying attention to." },
            { heading: "What to do", body: "One concrete step you can take." },
            { heading: "The takeaway", body: "What this means for your team." },
          ],
        }),
        track, signal,
      });
      let pgs = (r.pages || []).filter((x) => x && x.heading).slice(0, 8);
      if (!pgs.length) pgs = [
        { heading: String(ctx.hook || "Overview").slice(0, 40), body: "" },
        { heading: "The problem", body: "What slows teams down today." },
        { heading: "What changed", body: "The shift worth paying attention to." },
        { heading: "What to do", body: "One concrete step you can take." },
        { heading: "The takeaway", body: "What this means for your team." },
      ];
      log?.(`Document rendered — ${pgs.length} pages`);
      return { title: r.title || ctx.hook, pages: pgs.map((pg, i) => ({ ...pg, svg: tplPage(i + 1, pgs.length, pg.heading, pg.body), id: "pg-" + i + "-" + Math.random().toString(36).slice(2, 6) })) };
    },

    async carousel(ctx, { slides = 6, signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You structure visual carousels. ${JSON_RULE}`,
        user: `Turn this into a ${slides}-slide carousel story.
Topic: ${ctx.hook}
${ctx.body || ""}
Use this arc: hook, problem, insight, framework, example, conclusion.
{"slides":[{"role":"Hook|Problem|Insight|Framework|Example|Conclusion","heading":"under 6 words","body":"under 18 words"}]}`,
        fallback: () => ({
          slides: [
            { role: "Hook", heading: ctx.hook?.slice(0, 40) || "Start here", body: "" },
            { role: "Problem", heading: "Where it breaks", body: "The step everyone skips." },
            { role: "Insight", heading: "What actually matters", body: "The part that changes the outcome." },
            { role: "Framework", heading: "How to think about it", body: "Three moves, in order." },
            { role: "Example", heading: "In practice", body: "What this looked like for one team." },
            { role: "Conclusion", heading: "The takeaway", body: "What to do on Monday." },
          ],
        }),
        track, signal,
      });
      let sl = (r.slides || []).filter((x) => x && x.heading).slice(0, 10);
      if (!sl.length) sl = [
        { role: "Hook", heading: String(ctx.hook || "Start here").slice(0, 40), body: "" },
        { role: "Problem", heading: "Where it breaks", body: "The step everyone skips." },
        { role: "Insight", heading: "What actually matters", body: "The part that changes the outcome." },
        { role: "Framework", heading: "How to think about it", body: "Three moves, in order." },
        { role: "Example", heading: "In practice", body: "What one team did." },
        { role: "Conclusion", heading: "The takeaway", body: "What to do on Monday." },
      ];
      log?.(`Carousel rendered — ${sl.length} slides`);
      return sl.map((s, i) => ({ ...s, svg: tplPage(i + 1, sl.length, s.heading, s.body), id: "sl-" + i + "-" + Math.random().toString(36).slice(2, 6) }));
    },

    async reslide(slide, index, total, ctx, { signal } = {}) {
      const r = await askJSON({
        capability: "reasoning",
        system: `You rewrite one carousel slide. ${JSON_RULE}`,
        user: `Post topic: ${ctx.hook}
Rewrite only this slide (${slide.role}), keeping its job in the story but changing the wording.
Current: ${JSON.stringify({ heading: slide.heading, body: slide.body })}
{"heading":"under 6 words","body":"under 18 words"}`,
        fallback: () => ({ heading: slide.heading, body: slide.body }),
        track, signal,
      });
      return { ...slide, ...r, svg: tplPage(index + 1, total, r.heading, r.body) };
    },

    /* renumber after a reorder / delete so page badges stay correct */
    renumber(items) {
      return items.map((it, i) => ({ ...it, svg: tplPage(i + 1, items.length, it.heading, it.body) }));
    },
  };
}


/* ---------- text helpers ---------- */

function locateClaim(full, claim) {
  if (!full || !claim) return null;
  const f = full.toLowerCase();
  const c = claim.toLowerCase().replace(/[.!?]+$/, "").trim();
  const i = f.indexOf(c);
  if (i >= 0) return [i, i + c.length];
  const words = c.split(/[^a-z0-9]+/).filter((w) => w.length > 4);
  if (words.length < 2) return null;
  const parts = full.split(/(?<=[.!?])\s+/);
  let cursor = 0, best = null, bestScore = 0;
  for (const s of parts) {
    const at = full.indexOf(s, cursor);
    if (at === -1) continue;
    cursor = at + s.length;
    const sl = s.toLowerCase();
    const score = words.filter((w) => sl.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = [at, at + s.length]; }
  }
  return bestScore >= Math.max(2, Math.ceil(words.length * 0.45)) ? best : null;
}

function segments(full, { bold, hl, fold }) {
  const pts = new Set([0, full.length]);
  [bold, hl].forEach((r) => { if (r) { pts.add(Math.max(0, r[0])); pts.add(Math.min(full.length, r[1])); } });
  if (fold > 0 && fold < full.length) pts.add(fold);
  const arr = [...pts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    const isBold = bold && a >= bold[0] && b <= bold[1];
    const isHl = hl && a >= hl[0] && b <= hl[1];
    out.push(
      <span key={a} className={isHl ? "hl" : undefined} style={isBold ? { fontWeight: 700 } : undefined}>
        {full.slice(a, b)}
      </span>
    );
    if (b === fold && b !== full.length) out.push(<span className="fold" key={"f" + b}><i />see more</span>);
  }
  return out;
}

function diffWords(a = "", b = "") {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: "same", w: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", w: A[i] }); i++; }
    else { out.push({ t: "add", w: B[j] }); j++; }
  }
  while (i < n) out.push({ t: "del", w: A[i++] });
  while (j < m) out.push({ t: "add", w: B[j++] });
  return out;
}

/* ---------- hooks ---------- */

function useNarrow(bp = 1120) {
  const [n, setN] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(max-width:${bp}px)`);
    const h = () => setN(m.matches);
    h();
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, [bp]);
  return n;
}

/* ============================================================
   AMBIENT
   ============================================================ */

function Glow({ style }) { return <div className="glow" style={style} />; }

function CursorField({ theme }) {
  const blob = useRef(null), ring = useRef(null);
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let bx = P.px, by = P.py, rx = P.px, ry = P.py, raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      bx += (P.px - bx) * 0.055; by += (P.py - by) * 0.055;
      rx += (P.px - rx) * 0.2; ry += (P.py - ry) * 0.2;
      if (blob.current) blob.current.style.transform = `translate3d(${bx - 220}px,${by - 220}px,0)`;
      if (ring.current) ring.current.style.transform = `translate3d(${rx - 13}px,${ry - 13}px,0)`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (<><div ref={blob} className="cursor-blob" data-t={theme} /><div ref={ring} className="cursor-ring" /></>);
}

/* ---------- scroll-driven 3D pipeline ----------
   Ten stages mapped to the content pipeline. Objects enter from depth,
   hold while their stage is active, then recede. Scroll drives everything;
   nothing spins on its own. Sits behind the UI and never takes pointer events. */

/* ---------- scroll-driven 3D object ----------
   One object, always on screen: a nested gimbal with a faceted core and ten
   markers around the outer ring — one per pipeline stage. Scroll turns the
   whole assembly a single slow 360 and lights the markers as you pass them. */

/* ---------- scroll-driven 3D object ----------
   One object, always on screen: a nested gimbal with a plated core and ten
   markers around the outer ring — one per pipeline stage. Scroll turns the
   whole assembly a single slow 360 and lights the markers as you pass them.
   On the landing it also comes apart: every piece is on its own spring, so
   scrolling down kicks them outward and scrolling up snaps them home with a
   short flare. State is a pure function of scroll position, so it can never
   end up stuck half-broken. */

function PipelineScene({ theme, level = 1, fragment = false }) {
  const host = useRef(null);
  useEffect(() => {
    const el = host.current;
    if (!el || !level) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) { return; }

    const low = window.innerWidth < 820;
    const dark = theme !== "light";
    const W = () => el.clientWidth || window.innerWidth;
    const H = () => el.clientHeight || window.innerHeight;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.25 : 1.75));
    renderer.setSize(W(), H());
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping !== undefined) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = dark ? 0.92 : 0.98;
    }
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(dark ? 0x04060a : 0xf1f4f9, 8, 28);
    const camera = new THREE.PerspectiveCamera(36, W() / H(), 0.1, 60);
    camera.position.set(0, 0.35, 8.4);

    const ACC = 0x7c8cff, ACC2 = 0x39d3c7;
    const METAL = dark ? 0x101724 : 0xd2d9e4;

    scene.add(new THREE.AmbientLight(dark ? 0x232c47 : 0xffffff, dark ? 0.4 : 0.8));
    const key = new THREE.DirectionalLight(0xffffff, dark ? 0.95 : 1.05);
    key.position.set(4.5, 7, 6);
    if (!low) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1; key.shadow.camera.far = 30;
      key.shadow.camera.left = -8; key.shadow.camera.right = 8;
      key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
      key.shadow.bias = -0.0009;
    }
    scene.add(key);
    const RIM = dark ? 2.0 : 1.2;
    const rim = new THREE.PointLight(ACC, RIM, 26); rim.position.set(-6, 2, -3.5); scene.add(rim);
    const fill = new THREE.PointLight(ACC2, dark ? 0.95 : 0.6, 22); fill.position.set(5.5, -2.5, 3); scene.add(fill);

    const geos = [], mats = [];
    const G = (g) => { geos.push(g); return g; };
    const M = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };

    const shellMat = M({ color: METAL, metalness: 0.8, roughness: 0.42 });
    const darkMat = M({ color: dark ? 0x0d1320 : 0xc3cbd9, metalness: 0.6, roughness: 0.45 });
    const CORE_EM = dark ? 0.4 : 0.2;
    const coreMat = M({ color: ACC, emissive: ACC, emissiveIntensity: CORE_EM, metalness: 0.45, roughness: 0.34, side: THREE.DoubleSide });
    const litMat = M({ color: ACC2, emissive: ACC2, emissiveIntensity: dark ? 1.15 : 0.4, metalness: 0.4, roughness: 0.25 });
    const dimMat = M({ color: dark ? 0x2b3550 : 0xb6bfd0, metalness: 0.4, roughness: 0.55 });
    const cageMat = M({ color: dark ? 0x8fa0d8 : 0x7d8aa8, wireframe: true, metalness: 0.2, roughness: 0.7, transparent: true, opacity: 0.2 });

    const BASE = low ? 0.66 : 0.9;
    const rig = new THREE.Group();
    rig.position.set(0, -0.85, -1.6);
    rig.scale.setScalar(BASE);
    scene.add(rig);

    const ringA = new THREE.Group(); rig.add(ringA);
    const ringB = new THREE.Group(); rig.add(ringB);
    const ringC = new THREE.Group(); rig.add(ringC);
    const coreG = new THREE.Group(); rig.add(coreG);
    ringB.rotation.set(0, Math.PI / 2, 0.35);
    ringC.rotation.set(1.05, 0, 0.4);

    /* deterministic jitter so the object looks the same on every load */
    let seed = 20260831;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

    const pieces = [];
    const addPiece = (m, dir, opts = {}) => {
      const p = {
        m, mat: opts.mat || null, fade: !!opts.fade,
        baseOpacity: opts.mat ? opts.mat.opacity : 1,
        hx: m.position.x, hy: m.position.y, hz: m.position.z,
        rx: m.rotation.x, ry: m.rotation.y, rz: m.rotation.z,
        dx: dir.x, dy: dir.y, dz: dir.z,
        dist: opts.dist ?? (1.8 + rnd() * 3.0),
        sx: (rnd() - 0.5) * 0.9, sy: (rnd() - 0.5) * 0.9, sz: (rnd() - 0.5) * 0.9,
        k: 0.075 + rnd() * 0.07,     // stiffness — varies so it comes apart in a wave
        damp: 0.80 + rnd() * 0.07,   // under-damped, which is where the overshoot comes from
        cur: 0, v: 0,
      };
      pieces.push(p);
      return p;
    };
    const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; };

    const mesh = (geo, mat, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = !low; m.receiveShadow = !low;
      (parent || rig).add(m);
      return m;
    };

    /* three gimbal rings, each broken into eight arcs */
    const SEG = 8, GAPF = 0.8;
    const ringSpec = [[1.5, 0.045, ringA, shellMat], [1.95, 0.032, ringB, shellMat], [2.45, 0.022, ringC, darkMat]];
    ringSpec.forEach(([R, tube, group, mat]) => {
      const arc = (Math.PI * 2 / SEG) * GAPF;
      const geo = G(new THREE.TorusGeometry(R, tube, low ? 6 : 12, low ? 10 : 22, arc));
      for (let i = 0; i < SEG; i++) {
        const start = (i / SEG) * Math.PI * 2;
        const m = mesh(geo, mat, group);
        m.rotation.z = start;
        const mid = start + arc / 2;
        addPiece(m, norm(Math.cos(mid), Math.sin(mid), (rnd() - 0.5) * 0.7), { dist: 1.7 + rnd() * 2.9 });
      }
    });

    /* shattered core — the twenty faces of an icosahedron, each extruded back to
       a shared inner apex. Assembled they form one solid with no seams; apart
       they are clean wedges rather than a pile of loose squares. */
    const srcIco = new THREE.IcosahedronGeometry(0.92, 0);
    const flat = srcIco.index ? srcIco.toNonIndexed() : srcIco;
    const pos = flat.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) {
      const a = [pos[i], pos[i + 1], pos[i + 2]];
      const b = [pos[i + 3], pos[i + 4], pos[i + 5]];
      const c = [pos[i + 6], pos[i + 7], pos[i + 8]];
      const o = [(a[0] + b[0] + c[0]) / 3 * 0.14, (a[1] + b[1] + c[1]) / 3 * 0.14, (a[2] + b[2] + c[2]) / 3 * 0.14];
      const v = [a, b, c, o];
      const tris = [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]];
      const verts = [];
      tris.forEach(([x, y, z]) => verts.push(...v[x], ...v[y], ...v[z]));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const cx = (a[0] + b[0] + c[0] + o[0]) / 4, cy = (a[1] + b[1] + c[1] + o[1]) / 4, cz = (a[2] + b[2] + c[2] + o[2]) / 4;
      g.translate(-cx, -cy, -cz);
      g.computeVertexNormals();
      const m = mesh(G(g), coreMat, coreG);
      m.position.set(cx, cy, cz);
      addPiece(m, norm(cx, cy, cz), { dist: 2.1 + rnd() * 3.0 });
    }
    srcIco.dispose();
    if (flat !== srcIco) flat.dispose();
    const cage = mesh(G(new THREE.IcosahedronGeometry(1.02, 0)), cageMat, coreG);
    addPiece(cage, norm(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5), { dist: 1.0, mat: cageMat, fade: true });

    /* ten stage markers riding the outer ring */
    const markerGeo = G(new THREE.BoxGeometry(0.16, 0.16, 0.16));
    const markers = [];
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const m = mesh(markerGeo, dimMat, ringC);
      m.position.set(Math.cos(ang) * 2.45, Math.sin(ang) * 2.45, 0);
      m.rotation.z = ang;
      markers.push(m);
      addPiece(m, norm(Math.cos(ang), Math.sin(ang), (rnd() - 0.5) * 0.5), { dist: 2.0 + rnd() * 2.6 });
    }

    if (!low) {
      const floorMat = new THREE.ShadowMaterial({ opacity: dark ? 0.4 : 0.16 });
      mats.push(floorMat);
      const floor = new THREE.Mesh(G(new THREE.PlaneGeometry(50, 50)), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -3.4;
      floor.receiveShadow = true;
      scene.add(floor);
    }

    /* ---- animation ---- */
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf, cur = 0, mx = 0, my = 0, t = 0, lastLit = -1, flare = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;

      cur += (S.p - cur) * (reduce ? 1 : 0.045);
      const tmx = P.x - 0.5, tmy = P.y - 0.5;
      mx += (tmx - mx) * 0.035;
      my += (tmy - my) * 0.035;
      t += reduce ? 0 : 1;

      const turn = cur * Math.PI * 2;
      const drift = t * 0.00035;
      const f = fragment ? cur : 0;

      /* every piece is a spring chasing its scattered position — the lag gives
         the outward kick going down and the magnetic snap coming back up */
      let vsum = 0;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        p.v += (f * p.dist - p.cur) * p.k;
        p.v *= p.damp;
        p.cur += p.v;
        vsum += p.v < 0 ? -p.v : p.v;
        const d = p.cur;
        p.m.position.set(p.hx + p.dx * d, p.hy + p.dy * d, p.hz + p.dz * d);
        p.m.rotation.set(p.rx + p.sx * d, p.ry + p.sy * d, p.rz + p.sz * d);
        p.m.scale.setScalar(1 - 0.2 * Math.min(1, d / 4.5));
        if (p.fade && p.mat) p.mat.opacity = p.baseOpacity * Math.max(0, 1 - d / 0.9);
      }

      /* pieces arriving home fast = impact */
      const avg = vsum / pieces.length;
      if (f < 0.1 && avg > 0.006) flare = Math.min(1, flare + avg * 5);
      flare *= 0.86;
      rim.intensity = RIM * (1 + flare * 1.8);
      coreMat.emissiveIntensity = CORE_EM * (1 + flare * 1.4);

      rig.rotation.y = turn + drift + mx * 0.32;
      rig.rotation.x = -0.12 + my * 0.16 + Math.sin(turn * 0.5) * 0.06;
      ringA.rotation.z = -turn * 0.55 + drift * 0.6;
      ringB.rotation.x = turn * 0.4 - drift * 0.4;
      ringC.rotation.z = 0.4 + turn * 0.22;
      coreG.rotation.y = -turn * 1.2;
      coreG.rotation.x = turn * 0.6;

      /* pull the cloud back as it opens so nothing sails off screen */
      rig.scale.setScalar(BASE * (1 + Math.sin(cur * Math.PI) * 0.06 - f * 0.2 + flare * 0.05));
      rig.position.set(mx * 0.7, -0.85 - my * 0.5 + Math.sin(cur * Math.PI * 2) * 0.12, -1.6 - f * 4.2);

      const lit = Math.min(9, Math.floor(cur * 10 + 0.0001));
      if (lit !== lastLit) {
        markers.forEach((m, i) => { m.material = i <= lit ? litMat : dimMat; });
        lastLit = lit;
      }

      camera.position.x = mx * 0.4;
      camera.position.y = 0.35 - my * 0.28;
      camera.lookAt(0, -0.6, -1.6);
      renderer.render(scene, camera);
    };
    tick();

    const resize = () => {
      renderer.setSize(W(), H());
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [theme, level, fragment]);

  if (!level) return null;
  return <div ref={host} className="scene3d" style={{ opacity: level }} aria-hidden="true" />;
}

function Mark({ size = 26 }) {
  const outer = useRef(null), inner = useRef(null), dot = useRef(null);
  useEffect(() => {
    let a = 0, b = 0, raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const target = S.p * 260 + (P.x - 0.5) * 26;
      a += (target - a) * 0.08; b += (-target * 0.7 - b) * 0.08;
      outer.current?.setAttribute("transform", `rotate(${a} 24 24)`);
      inner.current?.setAttribute("transform", `rotate(${b} 24 24)`);
      dot.current?.setAttribute("r", String(4 + Math.sin(a / 40) * 0.9));
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="mark-svg" aria-hidden="true">
      <defs>
        <linearGradient id="ug" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" /><stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <g ref={outer}>
        <path d="M24 4 A20 20 0 0 1 44 24" fill="none" stroke="url(#ug)" strokeWidth="4" strokeLinecap="round" />
        <path d="M24 44 A20 20 0 0 1 4 24" fill="none" stroke="url(#ug)" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g ref={inner}>
        <path d="M24 13 A11 11 0 0 1 35 24" fill="none" stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      </g>
      <circle ref={dot} cx="24" cy="24" r="4" fill="url(#ug)" />
    </svg>
  );
}

/* ============================================================
   ROOT
   ============================================================ */

export default function UnisonContentOS() {
  const [theme, setTheme] = useState("dark");
  const [view, setView] = useState("home");
  const [drawer, setDrawer] = useState(null);
  const [modal, setModal] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [liStart, setLiStart] = useState(0);          // which step the LinkedIn flow opens on
  const [settingsTab, setSettingsTab] = useState("models");
  const [restored, setRestored] = useState(false);
  const [bg3d, setBg3d] = useState(true);

  const [idea, setIdea] = useState("");
  const [stage, setStage] = useState("IDEA");
  const [steps, setSteps] = useState([]);
  const [opps, setOpps] = useState(null);
  const [oppBusy, setOppBusy] = useState(false);
  const [research, setResearch] = useState(null);
  const [angles, setAngles] = useState(null);
  const [angle, setAngle] = useState(null);
  const [draft, setDraft] = useState(null);
  const [verification, setVerification] = useState(null);
  const [quality, setQuality] = useState(null);
  const [dupDismissed, setDupDismissed] = useState(false);
  const [media, setMedia] = useState(null);
  const [formats, setFormats] = useState(["text"]);
  const fmt = useMemo(() => composeFormat(formats), [formats]);
  const format = visualOf(formats) || "text";          // the attachment type, for renderers that need one
  const [workId, setWorkId] = useState(null);           // identity of the post being worked on
  const [drafts, setDrafts] = useState([]);              // unfinished posts, auto-saved
  const [seedIdea, setSeedIdea] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [recFormat, setRecFormat] = useState(null);
  const [assets, setAssets] = useState(EMPTY_ASSETS);
  const [mstate, setMstate] = useState({});          // per-task idle/generating/success/error
  const [versions, setVersions] = useState([]);
  const [schedule, setSchedule] = useState({ date: "2026-09-02", time: "09:30", tz: "Asia/Kolkata" });
  const [publishState, setPublishState] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [publishError, setPublishError] = useState(null);
  const [publishVia, setPublishVia] = useState(null);      // "make" | "api" — which route the last publish took
  const [publishUnverified, setPublishUnverified] = useState(false);
  const [sentKeys, setSentKeys] = useState([]);            // idempotency: posts already handed to Make
  const [makeCompany, setMakeCompany] = useState({ name: "", urn: "" });
  const [relay, setRelay] = useState({ relay: false, checked: false });
  useEffect(() => { makeLinkedInService.health().then((r) => setRelay({ ...r, checked: true })); }, []);
  const [analytics, setAnalytics] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [openClaim, setOpenClaim] = useState(null);
  const [openPost, setOpenPost] = useState(null);
  const [undoStack, setUndoStack] = useState([]);

  const [tone, setTone] = useState("Confident");
  const [pov, setPov] = useState("Strong opinion");
  const [length, setLength] = useState("Medium");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);

  const [conn, setConn] = useState(EMPTY_CONNECTION);
  const [liMeta, setLiMeta] = useState({ reachable: false, mode: "unknown", apiVersion: null, scopes: [] });
  const linkedin = useMemo(() => withDerived(conn), [conn]);
  const [failMode, setFailMode] = useState(false);
  const [searchOn, setSearchOn] = useState(true);
  const [notes, setNotes] = useState([{ t: "09:14", text: "3 posts are waiting for your review." }]);
  const [audit, setAudit] = useState([]);
  const [posts, setPosts] = useState(SEED_POSTS);
  const [team, setTeam] = useState(SEED_TEAM);
  const [usage, setUsage] = useState({ calls: 0, fails: 0, searches: 0, inTok: 0, outTok: 0, byEngine: {} });

  const abortRef = useRef(null);
  const runRef = useRef(0);
  const cacheRef = useRef({});

  /* pointer + scroll, no re-render */
  useEffect(() => {
    const pm = (e) => { P.px = e.clientX; P.py = e.clientY; P.x = e.clientX / window.innerWidth; P.y = e.clientY / window.innerHeight; };
    const sc = () => {
      S.y = window.scrollY;
      const max = document.body.scrollHeight - window.innerHeight;
      S.p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    };
    window.addEventListener("pointermove", pm, { passive: true });
    window.addEventListener("scroll", sc, { passive: true });
    sc();
    return () => { window.removeEventListener("pointermove", pm); window.removeEventListener("scroll", sc); };
  }, []);

  /* ---------- persistence ---------- */
  useEffect(() => {
    (async () => {
      try {
        const r = await persistentStore.get(STORE_KEY);
        if (r?.value) {
          const d = JSON.parse(r.value);
          d.theme && setTheme(d.theme);
          d.idea && setIdea(d.idea);
          d.stage && setStage(d.stage);
          d.steps && setSteps(d.steps);
          d.research && setResearch(d.research);
          d.angles && setAngles(d.angles);
          d.angle && setAngle(d.angle);
          d.draft && setDraft(d.draft);
          d.verification && setVerification(d.verification);
          d.quality && setQuality(d.quality);
          d.media && setMedia(d.media);
          (d.formats || d.format) && setFormats(normalizeFormats(d.formats || d.format));
          d.workId && setWorkId(d.workId);
          d.drafts && setDrafts(d.drafts);
          d.sentKeys && setSentKeys(d.sentKeys);
          d.makeCompany && setMakeCompany(d.makeCompany);
          d.assets && setAssets({ ...EMPTY_ASSETS, ...d.assets });
          d.versions && setVersions(d.versions);
          d.schedule && setSchedule(d.schedule);
          d.analytics && setAnalytics(d.analytics);
          d.voice && setVoice(d.voice);
          d.profile && setProfile(d.profile);

          d.posts && setPosts(d.posts);
          d.team && setTeam(d.team);
          d.notes && setNotes(d.notes);
          d.audit && setAudit(d.audit);
          d.usage && setUsage(d.usage);
          d.opps && setOpps(d.opps);
          if (typeof d.searchOn === "boolean") setSearchOn(d.searchOn);
          if (typeof d.bg3d === "boolean") setBg3d(d.bg3d);
          if (d.idea) setView("workspace");
        }
      } catch (e) { /* first run */ }
      setRestored(true);
    })();
  }, []);

  const saveTimer = useRef(null);
  useEffect(() => {
    if (!restored) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await persistentStore.set(STORE_KEY, JSON.stringify({
          theme, idea, stage, steps, research, angles, angle, draft, verification, quality,
          media, formats, workId, drafts, versions, schedule, analytics, voice, profile, sentKeys, makeCompany,
          posts, team, notes, audit, usage, opps, searchOn, bg3d,
          assets: compactAssets(assets),
        }));
      } catch (e) { /* over quota or unavailable */ }
    }, 700);
  }, [restored, theme, idea, stage, steps, research, angles, angle, draft, verification, quality,
      media, formats, workId, drafts, versions, schedule, analytics, voice, profile, sentKeys, makeCompany, posts, team, notes, audit, usage, opps, searchOn, bg3d, assets]);

  /* ---------- drafts ----------
     Anything in progress is a draft until it is scheduled or published. The
     snapshot is written continuously, so leaving the workspace — to start a
     new post, open another one or visit any other tab — never loses work. */
  const FINISHED = ["SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"];
  const finishedNow = FINISHED.includes(stage) && publishState !== "FAILED";
  const snapshotWork = () => ({
    id: workId, title: idea, idea, formats, stage, steps, research, angles, angle, draft, verification, quality,
    media, assets: compactAssets(assets), versions, schedule, tone, pov, length, undoStack, savedAt: new Date().toISOString(),
  });
  useEffect(() => {
    if (!restored || !workId || !idea) return;
    if (finishedNow) { setDrafts((d) => d.filter((x) => x.id !== workId)); return; }
    const snap = snapshotWork();
    setDrafts((d) => {
      const i = d.findIndex((x) => x.id === workId);
      if (i < 0) return [snap, ...d];
      const next = [...d]; next[i] = snap; return next;
    });
  }, [restored, workId, idea, formats, stage, steps, research, angles, angle, draft, verification, quality, media, assets, versions, schedule, tone, pov, length]);

  /* Clears the workspace without touching the drafts list. */
  function clearWork() {
    abortRef.current?.abort(); runRef.current += 1;
    setWorkId(null); setIdea(""); setStage("IDEA"); setResearch(null); setAngles(null); setAngle(null);
    setDraft(null); setVerification(null); setQuality(null); setMedia(null); setFormats(["text"]);
    setAssets(EMPTY_ASSETS); setMstate({}); setVersions([]); setPublishState(null); setAttempts([]);
    setAnalytics(null); setSteps([]); setAudit([]); setUndoStack([]); setBusy(false);
    setDupDismissed(false); setOpenClaim(null); setPublishError(null); setPublishVia(null); setPublishLimits([]); setPublishKind(null); setPublishFramed(false); setPublishUnverified(false); lastPayloadRef.current = null; autoRef.current = "";
  }

  function openDraft(d) {
    abortRef.current?.abort(); runRef.current += 1;
    setWorkId(d.id); setIdea(d.idea); setFormats(normalizeFormats(d.formats || "text"));
    setSteps((d.steps || []).map((s) => ({ ...s, status: s.status === "active" ? "done" : s.status })));
    setResearch(d.research || null); setAngles(d.angles || null); setAngle(d.angle || null);
    setDraft(d.draft || null); setVerification(d.verification || null); setQuality(d.quality || null);
    setMedia(d.media || null); setAssets({ ...EMPTY_ASSETS, ...(d.assets || {}) }); setMstate({});
    setVersions(d.versions || []); if (d.schedule) setSchedule(d.schedule);
    d.tone && setTone(d.tone); d.pov && setPov(d.pov); d.length && setLength(d.length);
    setUndoStack(d.undoStack || []); setPublishState(null); setAttempts([]); setAnalytics(null);
    setBusy(false); setDupDismissed(false); setOpenClaim(null); autoRef.current = `${d.idea}|${normalizeFormats(d.formats || "text").join("+")}`;
    // a job that was mid-flight when the draft was parked settles to the last completed stage
    const s = d.stage || "IDEA";
    if (["RESEARCHING", "DRAFT", "AI_REVIEW"].includes(s)) setStage(d.draft ? "HUMAN_REVIEW" : d.angles ? "RESEARCH_COMPLETE" : "RESEARCHING");
    else setStage(s);
    setView("workspace"); setNavOpen(false); setModal(null); setOpenPost(null);
    window.scrollTo({ top: 0 });
    if (!d.research) runDiscovery(d.idea, d.formats || "text", d.id);
  }

  const removeDraft = (id) => {
    setDrafts((d) => d.filter((x) => x.id !== id));
    if (id === workId) { clearWork(); if (view === "workspace") setView("drafts"); }
  };

  /* "Cancel" on the post you're editing: the draft goes away with it. */
  function cancelWork() {
    const id = workId;
    clearWork();
    if (id) setDrafts((d) => d.filter((x) => x.id !== id));
    setView("drafts");
    notify("Draft discarded.");
  }

  /* Ask our own API what is true, and handle a return trip from LinkedIn. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await linkedinService.status();
      if (!alive) return;
      setLiMeta({ reachable: st.reachable, mode: st.mode, apiVersion: st.apiVersion, scopes: st.scopes });
      setConn(st.connection);

      const cb = readCallbackParams();
      if (!cb) return;
      if (cb.result === "authorized") {
        setModal("linkedin");                    // authorised — now choose a Page
        notify("LinkedIn authorised. Choose the Company Page to connect.");
      } else if (cb.result === "denied") {
        setConn((c) => ({ ...c, status: "disconnected", error: "Authorization was cancelled on LinkedIn." }));
        notify("LinkedIn authorization was cancelled.");
      } else if (cb.result === "unavailable") {
        notify("Real LinkedIn authorization isn't configured, so Unison stayed in prototype mode.");
      } else if (cb.result === "error") {
        const why = cb.reason === "invalid_state" ? "The authorization response failed a security check."
          : cb.reason === "exchange_failed" ? "LinkedIn rejected the authorization exchange."
          : "Authorization failed.";
        setConn((c) => ({ ...c, status: "error", error: why }));
        notify(why);
      }
    })();
    return () => { alive = false; };
  }, []);

  const logAudit = (text) => setAudit((l) => [...l, { t: now(), text }]);
  const notify = (text) => setNotes((n) => [{ t: now(), text }, ...n].slice(0, 10));

  const track = (name) => ({ inChars, outChars, ok, searched }) =>
    setUsage((u) => {
      const inTok = Math.round(inChars / 4), outTok = Math.round(outChars / 4);
      const e = u.byEngine[name] || { calls: 0, inTok: 0, outTok: 0 };
      return {
        calls: u.calls + 1, fails: u.fails + (ok ? 0 : 1), searches: u.searches + (searched ? 1 : 0),
        inTok: u.inTok + inTok, outTok: u.outTok + outTok,
        byEngine: { ...u.byEngine, [name]: { calls: e.calls + 1, inTok: e.inTok + inTok, outTok: e.outTok + outTok } },
      };
    });

  const railIndex = useMemo(() => {
    const stages = fmt.stages;
    let reached = "research";
    if (research) reached = "angle";
    if (angles) reached = "angle";
    if (draft) reached = "draft";
    if (assets.poll && stages.includes("poll")) reached = "poll";
    if (assets.article && stages.includes("article")) reached = "article";
    if (assets.images.length || assets.video || assets.doc || assets.carousel.length) reached = stages.includes("media") ? "media" : "slides";
    if (verification && stages.includes("evidence")) reached = "evidence";
    if (quality) reached = "health";
    if (["APPROVED", "SCHEDULED", "PUBLISHING", "FAILED", "PUBLISHED", "ANALYZING"].includes(stage)) reached = "schedule";
    const i = stages.indexOf(reached);
    return i < 0 ? 0 : i;
  }, [fmt, research, angles, draft, assets, verification, quality, stage]);

  const setStep = (key, status) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, status } : x)));

  const newRun = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    runRef.current += 1;
    return { id: runRef.current, signal: abortRef.current.signal };
  };

  const pushUndo = (label) => setUndoStack((s) => [...s.slice(-9), { label, at: now(), draft, verification }]);
  const undo = () => {
    setUndoStack((s) => {
      const last = s[s.length - 1];
      if (!last) return s;
      setDraft(last.draft); setVerification(last.verification);
      logAudit(`Undid — ${last.label}`);
      return s.slice(0, -1);
    });
  };

  /* ---------- engines ---------- */

  async function runOpportunities() {
    setView("discover"); setNavOpen(false); setOppBusy(true); setOpps(null);
    window.scrollTo({ top: 0 });
    const { id, signal } = newRun();
    logAudit("Opportunity scan started");

    const shape = `{"items":[{"headline":"under 11 words","summary":"under 16 words","publisher":"","url":"https://…","date":"YYYY-MM-DD","score":0,"whyNow":"under 16 words","gap":"open|adjacent|covered","angle":"Contrarian|Educational|Industry insight|Data-driven"}]}`;
    const brief = `Industry: ${profile.industry}. Audience: ${profile.audience}. Watch terms: ${profile.keywords}.
Already published: ${JSON.stringify(posts.slice(0, 6).map((x) => x.title))}
Score 0-100 for how worth posting each is this week. gap = "open" if the Page has not covered it, "adjacent" if loosely related, "covered" if already posted. Sort by score, highest first.`;

    try {
      // pass 1 — live search
      let r = searchOn ? await askJSON({
        system: `You are the content opportunity engine. ${JSON_RULE}`,
        user: `Find 4 real stories this company could post about this week. Search the web and return each real URL.
${brief}
${shape}
Be terse. The whole reply must fit in 400 words.`,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        fallback: () => null, track: track("Discovery"), signal,
      }) : null;
      if (id !== runRef.current) return;

      // pass 2 — no search, so nothing competes for the response budget
      if (!r || !(r.items || []).length) {
        r = await askJSON({
          system: `You are the content opportunity engine. ${JSON_RULE}`,
          user: `List 5 themes this company could post about this week, from what you already know. Leave url empty.
${brief}
${shape}
Be terse.`,
          fallback: () => fb.opportunities(), track: track("Discovery"), signal,
        });
        if (id !== runRef.current) return;
        if (!r.degraded) r.degraded = searchOn ? "no-search" : "off";
      }

      setOpps(r);
      logAudit(`Opportunity scan returned ${(r.items || []).length} stories`);
    } catch (e) { if (e?.name !== "AbortError") setOpps(fb.opportunities()); }
    setOppBusy(false);
  }

  async function runDiscovery(topic, chosenFormats, existingId) {
    const list = normalizeFormats(chosenFormats || formats);
    setFormats(list);
    setWorkId(existingId || "w-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    setView("workspace"); setNavOpen(false); setModal(null); setOpenPost(null);
    setIdea(topic); setStage("RESEARCHING"); setBusy(true);
    setResearch(null); setAngles(null); setAngle(null); setDraft(null); setVerification(null);
    setQuality(null); setMedia(null); setAssets(EMPTY_ASSETS); setMstate({});
    setAnalytics(null); setPublishState(null); setAttempts([]); setVersions([]); setAudit([]);
    setDupDismissed(false); setUndoStack([]); autoRef.current = "";
    logAudit("Research started");
    window.scrollTo({ top: 0 });

    const { id, signal } = newRun();
    const key = topic.trim().toLowerCase();
    const cached = cacheRef.current[key];

    setSteps([
      { key: "search", label: cached ? "Reusing research from this session" : searchOn ? "Searching the live web" : "Web search is off — using known context", status: "active" },
      { key: "company", label: "Checking company sources", status: "pending" },
      { key: "compare", label: "Comparing industry reports", status: "pending" },
      { key: "insight", label: "Identifying useful insights", status: "pending" },
      { key: "angles", label: "Building content angles", status: "pending" },
    ]);

    try {
      const shape = `{"sources":[{"title":"","publisher":"","date":"YYYY-MM-DD","tier":1,"note":"under 14 words","url":"https://…"}],
"claims":[{"text":"factual claim","sourceIndex":0}],
"insights":["under 18 words"],"freshness":"Breaking|Recent|Evergreen|Historical","risks":["under 14 words"]}
Tier 1 = official/primary, 2 = major publication, 3 = industry press, 4 = blogs/social (discovery only).`;

      let r = cached;
      if (!r && searchOn) {
        r = await askJSON({
          system: `You are the discovery engine of a B2B content platform. ${JSON_RULE}`,
          user: `Research this for a LinkedIn company page post: "${topic}".
Search the web and return the real URL of every source.
${shape}
Give 3 sources, 2 claims, 3 insights. Be terse — the whole reply must fit in 400 words.`,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          fallback: () => null, track: track("Discovery"), signal,
        });
        if (id !== runRef.current) return;
      }
      if (!r || !(r.sources || []).length) {
        r = await askJSON({
          system: `You are the discovery engine of a B2B content platform. ${JSON_RULE}`,
          user: `Research this for a LinkedIn company page post: "${topic}", from what you already know. Leave url empty.
${shape}
Give 3 sources, 2 claims, 3 insights. Be terse.`,
          fallback: () => fb.research(topic), track: track("Discovery"), signal,
        });
        if (id !== runRef.current) return;
        if (!r.degraded) r.degraded = searchOn ? "no-search" : "off";
      }
      if (!cached && !r.degraded) cacheRef.current[key] = r;

      setStep("search", "done"); setStep("company", "done"); setStep("compare", "done");
      setResearch(r);
      setStep("insight", "done"); setStep("angles", "active");
      logAudit(`Discovery returned ${(r.sources || []).length} sources${cached ? " (cached)" : ""}`);

      const a = await askJSON({
        system: `You are the content intelligence engine. ${JSON_RULE}`,
        user: `Topic: "${topic}".
Insights: ${JSON.stringify((r.insights || []).slice(0, 3))}
Produce 4 distinct LinkedIn content angles and recommend exactly one.
{"angles":[{"type":"Contrarian|Educational|Industry insight|Data-driven","headline":"under 14 words","rationale":"one line","recommended":false}],"reason":"why the recommended angle, 1-2 sentences"}`,
        fallback: () => fb.angles(topic), track: track("Intelligence"), signal,
      });
      if (id !== runRef.current) return;
      if (!(a.angles || []).some((x) => x.recommended) && a.angles?.length) a.angles[0].recommended = true;
      setAngles(a); setStep("angles", "done"); setStage("RESEARCH_COMPLETE");
    } catch (e) { if (e?.name !== "AbortError") console.warn(e); }
    if (id === runRef.current) setBusy(false);
  }

  async function runWriter(selected, feedback) {
    setAngle(selected); setStage("DRAFT"); setBusy(true); setOpenClaim(null);
    if (draft) pushUndo(feedback ? "rewrite" : "regenerate");
    logAudit(feedback ? `Rewrite requested — ${feedback}` : `Angle selected — ${selected.type}`);
    const { id, signal } = newRun();
    const keepMedia = !!media;   // only ask the media engine once per topic

    try {
      const d = await askJSON({
        system: `You are the brand writer engine. ${JSON_RULE}`,
        user: `Write a LinkedIn company page post.
Topic: ${idea}
Angle: ${selected.type} — ${selected.headline}
Claims available: ${JSON.stringify((research?.claims || []).map((c, i) => ({ i, text: c.text })))}
Voice profile (0-100): professional ${voice.professional}, conversational ${voice.conversational}, technical ${voice.technical}, opinionated ${voice.opinionated}, humour ${voice.humour}, emoji ${voice.emoji}.
CTA style: ${voice.cta}. Paragraphs: ${voice.paragraphs}. Hashtags: ${voice.hashtags}.
Never use: ${voice.avoid.join(", ")}. Prefer: ${voice.prefer.join(", ")}.
Controls: tone=${tone}, point of view=${pov}, length=${length}
${formats.includes("poll") ? "This post carries a LinkedIn poll. Set up the question in the body and make the CTA invite readers to vote — do not list the options in the text." : ""}
${formats.includes("article") ? "This post introduces a long-form article; the CTA should point readers to it." : ""}
${formats.includes("carousel") ? "This post introduces a slide carousel; the CTA should tell readers to swipe through." : ""}
${formats.includes("video") ? "This post has a short video attached; refer to it once." : ""}
${feedback ? `Reviewer feedback to fix: ${feedback}` : ""}
No corporate clichés, no motivational filler, no headings.
Claims must be quoted verbatim from the post text so they can be highlighted.
{"hook":"one line","body":"2-4 short paragraphs separated by \\n\\n","cta":"one line","hashtags":["#Tag"],"claims":[{"text":"sentence copied exactly from the post","sourceIndex":0}]}`,
        fallback: () => fb.draft(idea), track: track("Brand writer"), signal,
      });
      if (id !== runRef.current) return;

      setDraft(d);
      setVersions((v) => [...v, { n: v.length + 1, label: feedback ? "AI revised" : "AI generated", author: "Unison", at: now(), snapshot: d }]);
      setStage("AI_REVIEW");

      const jobs = [
        askJSON({
          system: `You are the trust engine. ${JSON_RULE}`,
          user: `Check each claim against the sources. Copy each claim exactly as it appears in the post.
Post claims: ${JSON.stringify(d.claims || [])}
Sources: ${JSON.stringify((research?.sources || []).map((s, i) => ({ i, title: s.title, publisher: s.publisher, tier: s.tier, url: s.url })))}
green = clearly supported, yellow = needs human review, red = unsupported or contradicted.
{"claims":[{"claim":"","status":"green","source":"publisher name","url":"source url or empty","confidence":"High|Medium|Low","note":"one line"}],"unresolved":["one line"]}`,
          fallback: fb.verify, track: track("Trust"), signal,
        }),
        askJSON({
          system: `You are the content quality engine. ${JSON_RULE}`,
          user: `Assess this LinkedIn post.
Hook: ${d.hook}
Body: ${d.body}
CTA: ${d.cta}
Previously published titles: ${JSON.stringify(posts.map((p) => p.title))}
{"checks":[{"label":"Evidence verified","pass":true},{"label":"Brand aligned","pass":true},{"label":"Strong opening","pass":true},{"label":"No unsupported statistics","pass":true},{"label":"No duplicate content","pass":true},{"label":"Low AI-style language","pass":true}],
"slop":["specific phrase to fix"],"duplicate":{"similar":false,"days":0,"title":""},
"detail":{"hook":0,"readability":0,"brand":0,"originality":0,"evidence":0}}
Scores 0-100. Only list slop phrases that are really present.`,
          fallback: fb.quality, track: track("Trust"), signal,
        }),
      ];
      if (!keepMedia) jobs.push(askJSON({
        system: `You are the media engine. ${JSON_RULE}`,
        user: `Suggest a format for this post. Answer with one id from: text, image, video, document, multi, poll, article, carousel.
Post: ${d.hook} ${d.body}
{"format":"","reason":"one sentence","concept":"one sentence describing the visual"}`,
        fallback: fb.media, track: track("Media"), signal,
      }));

      const [ver, q, m] = await Promise.all(jobs);
      if (id !== runRef.current) return;
      setVerification(ver); setQuality(q);
      if (m) setMedia(m);   // a suggestion only — the user's chosen format wins
      setStage("HUMAN_REVIEW");
      logAudit("Claims verified and quality check completed");
    } catch (e) { if (e?.name !== "AbortError") console.warn(e); }
    if (id === runRef.current) setBusy(false);
  }

  /* "Let Unison pick the format": the idea text goes to the reasoning model,
     which chooses the components that suit it (every post is written text;
     it may add one visual and/or a poll, article or carousel) and says why in
     one sentence. If the model is unreachable the answer is plain text. */
  async function recommendFormat(text, apply) {
    setRecBusy(true);
    const r = await askJSON({
      capability: "reasoning",
      system: `You choose the best LinkedIn post composition for an idea. ${JSON_RULE}`,
      user: `Idea: "${text}"
Every post is written text. Choose up to two extra components that genuinely help this idea, from: image, multi, video, document, poll, article, carousel.
At most one of image, multi, video, document. Prefer nothing extra over a weak fit.
Rules of thumb: a debatable question or a choice → poll; a number or a single claim → image; a step-by-step or a list → document or carousel; a deep explanation → article; a demo or a story → video.
{"formats":["poll"],"why":"one short sentence"}`,
      fallback: () => ({ formats: [], why: "A written post is the safest default." }),
      track: track("Intelligence"),
    });
    const picked = normalizeFormats((r.formats || (r.format ? [r.format] : [])).filter((f) => FORMAT_BY_ID[f]));
    setRecFormat(picked);
    apply?.(picked);
    notify(`Unison suggests ${labelFor(picked)} — ${r.why}`);
    setRecBusy(false);
  }

  /* ---------- media actions ----------
     Thin wrappers over the media engine. Each owns one slice of assets, so
     regenerating an image never touches the text and regenerating slide 3
     never touches slides 1, 2 or 4. */

  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = createMediaEngine({ track: track("Media"), log: logAudit });
  const engine = engineRef.current;

  const ctxOf = () => ({ hook: draft?.hook || idea, body: draft?.body || "" });
  const mset = (k, v) => setMstate((m) => ({ ...m, [k]: { ...idle(), ...v } }));
  const patchAssets = (patch) => setAssets((a) => ({ ...a, ...patch }));

  async function run(key, fn) {
    mset(key, { status: "generating" });
    try {
      await fn();
      mset(key, { status: "success" });
    } catch (e) {
      if (e?.name === "AbortError") return mset(key, { status: "idle" });
      console.warn("[unison] media task failed:", key, e);
      mset(key, { status: "error", error: friendlyError(e) });
    }
  }

  const makeImage = (variant = 0) => run("image", async () => {
    const a = await engine.image(ctxOf(), { variant });
    patchAssets({ images: [a], upload: null });
  });

  const makeImageSet = (count = 3) => run("multi", async () => {
    const set = await engine.imageSet(ctxOf(), { count });
    patchAssets({ images: set, upload: null });
  });

  const retile = (i) => run("tile-" + i, async () => {
    const next = await engine.retile(assets.images[i], ctxOf());
    setAssets((a) => ({ ...a, images: a.images.map((x, j) => (j === i ? next : x)) }));
  });

  const addTile = () => run("multi", async () => {
    const [t] = await engine.imageSet(ctxOf(), { count: 1 });
    setAssets((a) => ({ ...a, images: [...a.images, t].slice(0, 4) }));
  });

  const makeVideo = () => run("video", async () => {
    const previous = assets.video?.url;
    const a = await engine.video(ctxOf());
    if (previous) URL.revokeObjectURL(previous);       // the old encode is dead weight
    mset("encode", { status: "idle" });
    patchAssets({ video: a, upload: null });
  });

  /* Encoding is real-time capture, so it is a deliberate action rather than
     something that happens behind the Generate button. */
  const exportVideo = () => run("encode", async () => {
    const cur = assets.video;
    if (!cur?.storyboard?.length) throw new Error("Nothing to encode yet.");
    if (cur.url) URL.revokeObjectURL(cur.url);
    const file = await engine.encodeVideo(cur, { onProgress: (p) => mset("encode", { status: "generating", progress: p }) });
    setAssets((a) => ({ ...a, video: { ...a.video, blob: file.blob, url: file.url, mime: file.mime } }));
    logAudit("Video encoded to WebM");
  });

  const makeDocument = (pages = 5) => run("doc", async () => {
    const d = await engine.document(ctxOf(), { pages });
    patchAssets({ doc: d });
  });

  const makeCarousel = (slides = 6) => run("carousel", async () => {
    const c = await engine.carousel(ctxOf(), { slides });
    patchAssets({ carousel: c });
  });

  const reslide = (i) => run("slide-" + i, async () => {
    const next = await engine.reslide(assets.carousel[i], i, assets.carousel.length, ctxOf());
    setAssets((a) => ({ ...a, carousel: a.carousel.map((x, j) => (j === i ? next : x)) }));
  });

  const moveItem = (listKey, from, to) => setAssets((a) => {
    const list = [...a[listKey]];
    if (to < 0 || to >= list.length) return a;
    const [x] = list.splice(from, 1);
    list.splice(to, 0, x);
    return { ...a, [listKey]: listKey === "carousel" ? engine.renumber(list) : list };
  });

  const dropItem = (listKey, i) => setAssets((a) => {
    const list = a[listKey].filter((_, j) => j !== i);
    return { ...a, [listKey]: listKey === "carousel" ? engine.renumber(list) : list };
  });

  const editSlide = (i, patch) => setAssets((a) => {
    const list = a.carousel.map((s, j) => (j === i ? { ...s, ...patch } : s));
    return { ...a, carousel: engine.renumber(list) };
  });

  const editDocPage = (i, patch) => setAssets((a) => {
    const pages = a.doc.pages.map((s, j) => (j === i ? { ...s, ...patch } : s));
    return { ...a, doc: { ...a.doc, pages: pages.map((pg, k) => ({ ...pg, svg: tplPage(k + 1, pages.length, pg.heading, pg.body) })) } };
  });

  const makePoll = () => run("poll", async () => {
    const r = await askJSON({
      capability: "writing",
      system: `You write LinkedIn polls that sit underneath a written post. ${JSON_RULE}`,
      user: `Write the poll for this LinkedIn post. It is one component of the post, so the question must follow on from what the post says and ask the reader to take a position.
Topic: ${idea}
Post:
${draft ? `${draft.hook}\n${draft.body}\n${draft.cta}` : "(not written yet)"}
The question must be under 140 characters and read naturally. Give 3 or 4 options, each 30 characters or fewer. No "Other" and no "All of the above".
{"question":"","options":["",""]}`,
      fallback: () => ({ question: "What actually slows your content down?", options: ["Finding a topic", "Getting approval", "Checking the facts", "Finding the time"] }),
      track: track("Writing"),
    });
    const opts = (r.options || []).slice(0, 4).map((o) => String(o).slice(0, 30)).filter(Boolean);
    patchAssets({
      poll: {
        question: String(r.question || "").slice(0, 140) || "What is holding your team back?",
        options: opts.length >= 2 ? opts : ["Finding a topic", "Getting approval", "Checking the facts"],
        duration: assets.poll?.duration || "1 week",
      },
    });
  });

  const makeArticle = () => run("article", async () => {
    const r = await askJSON({
      capability: "writing",
      system: `You write long-form LinkedIn articles. ${JSON_RULE}`,
      user: `Write an article on: ${idea}
Angle: ${angle?.headline || "your choice"}
Voice (0-100): professional ${voice.professional}, conversational ${voice.conversational}, technical ${voice.technical}, opinionated ${voice.opinionated}.
Never use: ${voice.avoid.join(", ")}.
Four sections, each body 50-70 words. No headings inside the body text.
{"title":"under 12 words","standfirst":"one sentence","sections":[{"heading":"under 6 words","body":""}],"conclusion":"2 sentences","cta":"one line"}`,
      fallback: () => ({
        title: idea, standfirst: "Why this matters now.",
        sections: [{ heading: "The problem", body: "" }, { heading: "What changed", body: "" }, { heading: "How to think about it", body: "" }, { heading: "What to do", body: "" }],
        conclusion: "", cta: "",
      }),
      track: track("Writing"),
    });
    const sections = (r.sections || []).filter((x) => x && x.heading);
    patchAssets({ article: { ...r, title: r.title || idea, sections: sections.length ? sections : [{ heading: "The problem", body: "" }, { heading: "What changed", body: "" }] } });
  });

  const editArticle = (patch) => setAssets((a) => ({ ...a, article: { ...a.article, ...patch } }));

  /* Once the copy is ready, the asset the chosen format needs is produced
     automatically — picking "Image" should give you an image, not a button.
     Fires once per idea+format so a text rewrite never regenerates media, and
     removing an asset doesn't summon it back. */
  const autoRef = useRef("");
  useEffect(() => {
    if (!idea || stage !== "HUMAN_REVIEW") return;
    const key = `${idea}|${fmt.id}`;
    if (autoRef.current === key) return;
    autoRef.current = key;
    const starters = {
      image: [() => makeImage(0), () => assets.images.length || assets.upload],
      multi: [() => makeImageSet(3), () => assets.images.length || assets.upload],
      video: [makeVideo, () => assets.video || assets.upload],
      document: [() => makeDocument(5), () => assets.doc],
      carousel: [() => makeCarousel(6), () => assets.carousel.length],
      poll: [makePoll, () => assets.poll],
      article: [makeArticle, () => assets.article],
    };
    const todo = fmt.list.filter((f) => starters[f] && !starters[f][1]());
    if (!todo.length) return;
    logAudit(`Auto-generating ${todo.map((f) => FORMAT_BY_ID[f].label.toLowerCase()).join(", ")}`);
    todo.forEach((f) => starters[f][0]());
  }, [idea, fmt, stage]);

  /* ---------- document ingestion ---------- */

  async function readDocText(file) {
    if (/\.docx$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      const out = await mammoth.extractRawText({ arrayBuffer: buf });
      return out.value || "";
    }
    if (/\.(txt|md|csv|json)$/i.test(file.name)) return file.text();
    if (/\.pdf$/i.test(file.name)) {
      // best effort only: uncompressed text operators. Compressed PDFs need a
      // server-side parser, and we say so rather than returning nonsense.
      const buf = new Uint8Array(await file.arrayBuffer());
      let raw = "";
      for (let i = 0; i < buf.length; i++) raw += String.fromCharCode(buf[i]);
      const hits = [...raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1"));
      const text = hits.join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 120) throw new Error("pdf-compressed");
      return text;
    }
    throw new Error("unsupported");
  }

  const ingestDocument = (file) => run("sourceDoc", async () => {
    let text;
    try {
      text = await readDocText(file);
    } catch (e) {
      const why = e.message === "pdf-compressed"
        ? "This PDF stores its text compressed, which needs a server-side parser. Try a .docx or paste the text."
        : "That file type can't be read here. Use .docx, .txt, .md or .csv.";
      throw new Error(why);
    }
    const clipped = text.slice(0, 6000);
    const r = await askJSON({
      capability: "documentUnderstanding",
      system: `You extract usable material from a business document. ${JSON_RULE}`,
      user: `Document: ${file.name}
---
${clipped}
---
{"summary":"under 25 words","facts":["under 18 words"],"stats":["figure with context, under 14 words"],"insights":["under 18 words"],"claims":["a claim the document supports, under 18 words"]}
Give up to 4 of each. Only include what the document actually says.`,
      fallback: undefined,
      track: track("Document"),
    });
    const doc = { name: file.name, size: file.size, chars: text.length, ...r, at: now() };
    patchAssets({ sourceDoc: doc });
    setResearch((prev) => {
      const src = { title: file.name, publisher: "Uploaded document", date: new Date().toISOString().slice(0, 10), tier: 1, note: r.summary || "Uploaded by you.", url: "", uploaded: true };
      if (!prev) return { sources: [src], claims: (r.claims || []).map((c) => ({ text: c, sourceIndex: 0 })), insights: r.insights || [], freshness: "Primary", risks: [] };
      return { ...prev, sources: [src, ...(prev.sources || [])], claims: [...(r.claims || []).map((c) => ({ text: c, sourceIndex: 0 })), ...(prev.claims || [])] };
    });
    logAudit(`Document ingested — ${file.name}`);
    notify(`${file.name} added as a source.`);
  });

  const attachUpload = (file) => {
    const r = new FileReader();
    r.onload = () => patchAssets({ upload: { name: file.name, data: r.result, type: file.type }, images: [], video: null });
    r.readAsDataURL(file);
  };

  async function runLearning(metrics) {
    setStage("ANALYZING");
    const a = await askJSON({
      system: `You are the learning engine. Explain performance as likely reasons, never as proven cause. ${JSON_RULE}`,
      user: `Post: ${draft?.hook}
Metrics: ${JSON.stringify(metrics)}
Page average impressions: 9800, average reactions: 240.
{"headline":"one sentence with the comparison","why":["likely reason","likely reason","likely reason"],"next":"one recommendation"}`,
      fallback: fb.performance, track: track("Learning"),
    });
    setAnalytics({ ...a, metrics });
    logAudit("Performance summary generated");
  }

  /* ---------- actions ---------- */

  const claimsBlocking = (verification?.claims || []).some((c) => c.status === "red");

  function approve() {
    if (claimsBlocking) return;
    setVersions((v) => [...v, { n: v.length + 1, label: "Approved", author: "You", at: now(), snapshot: draft }]);
    setStage("APPROVED"); logAudit("Reviewer approved"); notify("Post approved. Choose a time to publish.");
  }
  function reject(reason) { logAudit(`Reviewer rejected — ${reason}`); runWriter(angle, reason); }

  /* Everything a post needs to be re-opened later, without the working state. */
  const postRecord = (extra) => ({
    title: draft?.hook?.slice(0, 60) || idea, topic: idea, workId, formats,
    content: draft ? { hook: draft.hook, body: draft.body, cta: draft.cta, hashtags: draft.hashtags || [] } : null,
    poll: assets.poll, image: assets.images[0]?.svg || null, images: assets.images.map((x) => x.svg),
    upload: assets.upload && !assets.upload.type.startsWith("video") ? assets.upload.data : null,
    pages: assets.doc?.pages?.map((x) => x.svg) || (assets.carousel.length ? assets.carousel.map((x) => x.svg) : null),
    time: schedule.time, tz: schedule.tz, ...extra,
  });

  function confirmSchedule() {
    setStage("SCHEDULED");
    setPosts((p) => [postRecord({ id: "p-" + Math.floor(Math.random() * 900 + 100), state: "SCHEDULED", date: schedule.date }), ...p]);
    logAudit(`Scheduled for ${schedule.date} ${schedule.time} ${schedule.tz}`);
    notify(`Scheduled for ${schedule.date} at ${schedule.time}.`);
  }

  /* Cancelling removes the publishing job. If that post is the one open in the
     workspace, it steps back to Approved so nothing goes out at the old time. */
  function cancelScheduled(post) {
    setPosts((p) => p.filter((x) => x.id !== post.id));
    if (post.workId && post.workId === workId && stage === "SCHEDULED") { setStage("APPROVED"); setAttempts([]); }
    setOpenPost(null);
    logAudit(`Schedule cancelled — ${post.title}`);
    notify(post.workId && post.workId === workId
      ? `"${post.title}" will not be published. It's back in Approved if you want to reschedule it.`
      : `"${post.title}" will not be published. Start it again from Home if you want to reschedule it.`);
  }

  /* The final post text exactly as it appears in the preview — hook, body,
     CTA and hashtags — assembled from the approved draft. */
  const finalPostText = () => draft
    ? `${draft.hook}\n\n${draft.body}\n\n${draft.cta}${(draft.hashtags || []).length ? "\n\n" + draft.hashtags.join(" ") : ""}`.trim()
    : idea;

  /* What this post is, for LinkedIn's purposes. A poll, article or carousel
     defines the post type; otherwise the attachment does; otherwise text. */
  const postTypeOf = () => {
    if (assets.poll || formats.includes("poll")) return "poll";
    if (assets.article || formats.includes("article")) return "article";
    if (assets.carousel.length || formats.includes("carousel")) return "carousel";
    if (assets.upload) return assets.upload.type.startsWith("video") ? "video" : "image";
    if (assets.video) return "video";
    if (assets.doc) return "document";
    if (assets.images.length > 1) return "multi";
    if (assets.images.length === 1) return "image";
    return "text";
  };

  const dataUrlParts = (u) => { const m = /^data:([^;]+);base64,(.*)$/.exec(u || ""); return m ? { mimeType: m[1], data: m[2] } : null; };
  const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

  /* Rasterises the media engine's assets into something a webhook can carry.
     Returns the media list plus any limitation that means the post should
     not be described as carrying that media. */
  async function collectMedia(postType) {
    const media = []; const limits = [];
    const png = async (svg, filename, altText, extra = {}) => {
      const parts = dataUrlParts(await svgToPng(svg, 1200, 630));
      media.push({ kind: "image", filename, mimeType: parts.mimeType, data: parts.data, altText: altText || "", width: 1200, height: 630, ...extra });
    };
    if (assets.upload) {
      const parts = dataUrlParts(assets.upload.data);
      if (parts) media.push({ kind: assets.upload.type.startsWith("video") ? "video" : "image", filename: assets.upload.name, mimeType: parts.mimeType, data: parts.data, altText: "" });
      else limits.push("The uploaded file couldn't be read for sending.");
      return { media, limits };
    }
    if (postType === "image" && assets.images[0]) await png(assets.images[0].svg, "unison-image.png", assets.images[0].brief?.subject);
    if (postType === "multi") for (let i = 0; i < assets.images.length; i++) await png(assets.images[i].svg, `unison-image-${i + 1}.png`, assets.images[i].brief?.subject, { index: i });
    if (postType === "video") {
      const v = assets.video;
      if (!v?.blob) limits.push("The video hasn't been encoded yet — use Export in the Media step first. Only the storyboard exists so far.");
      else if (v.blob.size > 6 * 1024 * 1024) limits.push(`The encoded video is ${(v.blob.size / 1048576).toFixed(1)} MB, more than can be sent from the browser in one request.`);
      else media.push({ kind: "video", filename: "unison-video.webm", mimeType: v.mime || v.blob.type || "video/webm", data: await blobToBase64(v.blob), altText: v.brief?.subject || "", seconds: v.seconds || null, sizeBytes: v.blob.size });
      if (v?.poster) await png(v.poster, "unison-video-poster.png", v.brief?.subject, { role: "poster" });
    }
    if (postType === "document" && assets.doc?.pages?.length) {
      for (let i = 0; i < assets.doc.pages.length; i++) await png(assets.doc.pages[i].svg, `unison-document-page-${i + 1}.png`, assets.doc.pages[i].heading, { kind: "document-page", index: i, of: assets.doc.pages.length });
      limits.push("LinkedIn document posts need a PDF. The pages are sent as images; the scenario has to assemble them into a PDF before LinkedIn will accept a document post.");
    }
    if (postType === "carousel" && assets.carousel.length) {
      for (let i = 0; i < assets.carousel.length; i++) await png(assets.carousel[i].svg, `unison-slide-${i + 1}.png`, assets.carousel[i].heading, { kind: "slide", index: i, of: assets.carousel.length });
    }
    return { media, limits };
  }

  /* Everything the scenario needs, from live state — nothing placeholder. */
  async function buildPublishPayload(postId) {
    const postType = postTypeOf();
    const { media, limits } = await collectMedia(postType);
    const payload = {
      source: MAKE_CONFIG.source,
      postId,
      idempotencyKey: postId,          // stable per post, so Make can drop a repeat
      postType,
      content: finalPostText(),
      company: linkedin.org || makeCompany.name || MAKE_CONFIG.company.name || null,
      companyUrn: linkedin.organizationUrn || makeCompany.urn || MAKE_CONFIG.company.urn || null,
      scheduledDate: stage === "SCHEDULED" || stage === "PUBLISHING" ? schedule.date : null,
      scheduledTime: stage === "SCHEDULED" || stage === "PUBLISHING" ? schedule.time : null,
      timezone: schedule.tz || "Asia/Kolkata",
      media,
      poll: postType === "poll" && assets.poll
        ? { question: assets.poll.question, options: (assets.poll.options || []).filter(Boolean), duration: assets.poll.duration }
        : null,
    };
    if (postType === "article" && assets.article) payload.article = assets.article;
    return { payload, limits };
  }

  const publishingRef = useRef(false);   // hard guard against a second click landing mid-request
  const lastPayloadRef = useRef(null);   // kept so a manual "send anyway" resends exactly the same body
  const [publishLimits, setPublishLimits] = useState([]);
  const [publishKind, setPublishKind] = useState(null);   // why the last send failed, for the recovery UI
  const [publishFramed, setPublishFramed] = useState(false);

  /* Sends this post once and once only, without a readable response. Offered
     only after the browser refused the normal request, and only on a click. */
  async function sendAnyway() {
    const payload = lastPayloadRef.current;
    if (!payload || publishingRef.current) return;
    publishingRef.current = true;
    setPublishState("SENDING"); setStage("PUBLISHING"); setPublishError(null); setPublishKind(null);
    setAttempts((a) => [...a, { label: "Sending without delivery confirmation", status: "ok" }]);
    try {
      const r = await makeLinkedInService.sendUnverified(payload);
      setSentKeys((k) => (k.includes(payload.postId) ? k : [...k, payload.postId]));
      setAttempts((a) => [...a, { label: "Sent — delivery not confirmable from the browser", status: "ok" }, { label: "Publishing through LinkedIn", status: "pending" }]);
      setPublishState("SENT"); setPublishUnverified(true);
      setPosts((p) => [postRecord({ id: payload.postId, state: "SENT", date: new Date().toISOString().slice(0, 10), viaMake: true, postType: payload.postType, mediaSent: payload.media.length, limits: publishLimits, sentAt: r.at, unverified: true }), ...p.filter((x) => x.id !== payload.postId)]);
      logAudit("Sent to Make without delivery confirmation");
      notify("Sent. The browser can't read Make's reply, so check the scenario to confirm it arrived.");
    } catch (e) {
      setAttempts((a) => [...a, { label: "This page can't make outside requests", status: "failed" }]);
      setPublishState("FAILED"); setStage("FAILED"); setPublishKind("sandbox");
      setPublishError("This preview can't make outside requests, so nothing was sent. Open Unison from its own address (your deployed version) and publish from there.");
    } finally {
      publishingRef.current = false;
    }
  }

  /* Sent in full, with a note where LinkedIn itself constrains what the
     scenario can do with it. These are notes, not blocks — nothing is
     downgraded to another format. */
  const TYPE_NOTES = {
    document: "LinkedIn document posts need a PDF. The pages are sent as images; the Make scenario has to assemble them into a PDF before LinkedIn will accept a document post.",
    carousel: "LinkedIn has no organic carousel API. The slides are sent as images for the scenario to post or export — LinkedIn will not render them as a swipeable carousel.",
    article: "LinkedIn Articles can't be created through the API. The article is sent with the post so the scenario can store or route it, but LinkedIn will only publish the written post.",
  };

  async function publishNow() {
    if (publishingRef.current || ["PREPARING", "SENDING"].includes(publishState) || stage === "PUBLISHED") return;
    const idem = "unison-" + Math.random().toString(36).slice(2, 10);
    setAttempts([]); setPublishError(null); setPublishLimits([]); setPublishKind(null); setPublishUnverified(false);
    const step = (label, status) => setAttempts((a) => [...a, { label, status, idem }]);
    const postId = workId || idem;

    /* ---- real publishing through Unison's own API (unchanged) ---- */
    if (liMeta.mode === "real" && conn.status === "connected") {
      setStage("PUBLISHING"); setPublishState("SENDING"); setPublishVia("api");
      step("Sending to Unison API", "ok");
      try {
        const body = finalPostText();
        const payload = { commentary: body, format: format === "image" && assets.images[0] ? "image" : "text" };
        if (payload.format === "image") {
          payload.image = await svgToPng(assets.images[0].svg, 1200, 630);
          payload.altText = assets.images[0].brief?.subject || "";
        }
        const r = await linkedinService.publish(payload);
        step("LinkedIn confirmed the post", "ok");
        setPublishState("PUBLISHED"); setStage("PUBLISHED");
        logAudit(`Published to LinkedIn — ${r.post.urn}`);
        notify("Published to LinkedIn.");
        setPosts((p) => [postRecord({ id: r.post.urn, url: r.post.url, state: "PUBLISHED", date: schedule.date, real: true }), ...p]);
        setTimeout(() => runLearning({ impressions: 0, reactions: 0, comments: 0, shares: 0, clicks: 0 }), 800);
      } catch (e) {
        step(e.code === "cannot_publish" ? "Page permission check" : "LinkedIn rejected the request", "failed");
        setPublishState("FAILED"); setStage("FAILED");
        setPublishError(e.message || "LinkedIn rejected the request.");
        if (e.code === "not_authorized") setConn((c) => ({ ...c, status: "expired" }));
        logAudit(`Publishing failed — ${e.code || e.status || "unknown"}`);
        notify("Publishing failed. Nothing was posted.");
      }
      return;
    }

    /* ---- publishing through Make ----
       Make delivers to LinkedIn. A 2xx from the webhook means Make has the
       post; only an explicit confirmation in Make's reply means LinkedIn has
       it. The stages are reported exactly as far as they are known. */
    const postType = postTypeOf();
    if (sentKeys.includes(postId)) {
      setPublishState("SENT");
      notify("This post has already been sent to Make. It won't be sent again.");
      return;
    }
    publishingRef.current = true;
    setStage("PUBLISHING"); setPublishState("PREPARING"); setPublishVia("make");
    step("Preparing", "ok");
    try {
      if (failMode) throw Object.assign(new Error("Simulated failure."), { kind: "simulated" });
      const { payload, limits } = await buildPublishPayload(postId);
      if (TYPE_NOTES[postType]) limits.push(TYPE_NOTES[postType]);
      setPublishLimits(limits);
      lastPayloadRef.current = payload;
      setPublishState("SENDING");
      step("Sending to Make", "ok");
      const r = await makeLinkedInService.publish(payload);
      setSentKeys((k) => (k.includes(postId) ? k : [...k, postId]));
      step(r.duplicate ? "Already delivered — not sent again" : r.fallback ? "Sent to Make" : "Sent to Make via the publishing service", "ok");
      const sentRecord = postRecord({
        id: postId, state: "SENT", date: new Date().toISOString().slice(0, 10), viaMake: true,
        postType, mediaSent: payload.media.length, limits, sentAt: r.at, reference: r.urn || null, url: r.url || null,
      });
      if (r.published) {
        step("Publishing through LinkedIn", "ok"); step("Published", "ok");
        setPublishState("PUBLISHED"); setStage("PUBLISHED");
        setPosts((p) => [{ ...sentRecord, state: "PUBLISHED", publishedAt: r.at }, ...p.filter((x) => x.id !== postId)]);
        logAudit(`Published to LinkedIn via Make${r.urn ? ` — ${r.urn}` : ""}`);
        notify("Published to LinkedIn.");
      } else {
        step("Publishing through LinkedIn", "pending");
        setPublishState("SENT");
        setPosts((p) => [sentRecord, ...p.filter((x) => x.id !== postId)]);
        logAudit(`Sent to Make — ${postType} post${payload.media.length ? `, ${payload.media.length} media file(s)` : ""}`);
        notify("Sent to Make — LinkedIn publishing is being processed.");
      }
    } catch (e) {
      let kind = e?.kind || null;
      let label = "Make did not accept the post";
      if (kind === "relay-error") label = "The publishing service rejected the post";
      if (kind === "network") {
        /* Work out which of the two blocks this actually is before saying
           anything about it. */
        const d = await makeLinkedInService.diagnose();
        kind = d.networkAllowed ? "cors" : "sandbox";
        label = d.networkAllowed ? "Make's reply couldn't be read" : "This page can't make outside requests";
        setPublishFramed(!!d.framed);
      } else if (kind === "timeout") label = "Make didn't respond in time";
      else if (kind === "too-large") label = "Post too large to send";
      step(label, "failed");
      setPublishState("FAILED"); setStage("FAILED");
      setPublishKind(kind);
      setPublishError(kind === "relay-error" ? (e?.message || "The publishing service couldn't pass the post on. Please try again.")
        : kind === "empty" ? "There is no post text to publish."
        : kind === "simulated" ? "Simulated failure (Settings → Simulate a publishing failure). Nothing was sent."
        : kind === "too-large" ? "The post and its media are too large to send in one request. Reduce the media and try again."
        : kind === "timeout" ? "Make didn't answer in time. The post may already have reached it — check the scenario before sending again."
        : kind === "cors" ? "Make received the request but didn't allow this page to read the reply, so Unison can't confirm what happened. Sending without confirmation will get the post through."
        : kind === "sandbox" ? "This preview can't reach the publishing service, so nothing was sent — LinkedIn and Make are fine, the preview just can't make outside requests. Publish from the deployed version and this post will go straight through."
        : "Unable to publish to LinkedIn. Please try again.");
      logAudit(kind === "sandbox" ? "Publishing paused — preview environment can't reach the publishing service" : `Publishing failed — ${kind || "unknown"}${e?.status ? " " + e.status : ""}`);
      notify(kind === "sandbox" ? "Not sent — this preview can't reach the publishing service. Your post is saved." : "Publishing failed. Nothing was posted.");
    } finally {
      publishingRef.current = false;
    }
  }

  /* LinkedIn success confirmed after the fact — either the scenario reported
     it, or the user checked the Company Page. Recorded with the reason. */
  function confirmPublished(post, how = "manual") {
    setPosts((p) => p.map((x) => (x.id === post.id ? { ...x, state: "PUBLISHED", publishedAt: new Date().toISOString(), confirmedBy: how } : x)));
    if (post.workId && post.workId === workId && publishState === "SENT") { setPublishState("PUBLISHED"); setStage("PUBLISHED"); setAttempts((a) => [...a.map((s) => (s.status === "pending" ? { ...s, status: "ok" } : s)), { label: "Published", status: "ok", idem: a[0]?.idem }]); }
    setOpenPost(null);
    logAudit(`Marked as published on LinkedIn (${how === "manual" ? "confirmed by you" : "reported by Make"}) — ${post.title}`);
  }

  /* Real mode: the server confirms the Page. Prototype mode: we mark the
     connection simulated and never call it connected. */
  async function finishConnect(org) {
    if (liMeta.mode === "real") {
      try {
        const r = await linkedinService.select(org.urn);
        setConn({ ...EMPTY_CONNECTION, ...r.connection, mode: "real" });
        logAudit(`LinkedIn Page connected — ${r.connection.organizationName}`);
        notify(`${r.connection.organizationName} connected.`);
      } catch (e) {
        setConn((c) => ({ ...c, status: "error", error: e.message }));
        notify(e.message || "Could not connect that Page.");
      }
      return;
    }
    setConn({
      ...EMPTY_CONNECTION,
      status: "simulated",
      mode: "simulation",
      organizationUrn: org.urn,
      organizationId: String(org.urn).split(":").pop(),
      organizationName: org.name,
      followers: org.followers,
      roles: [org.role],
      permissions: org.canPublish === false ? [] : ["PUBLISH", "READ_ANALYTICS"],
      connectedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
    });
    logAudit(`Prototype LinkedIn connection — ${org.name}`);
    notify(`${org.name} connected in prototype mode. Publishing is simulated.`);
  }

  const openLinkedIn = (startAt = 0) => { setLiStart(startAt); setModal("linkedin"); };
  const manageConnection = () => { setSettingsTab("connections"); setModal("settings"); };
  const disconnectLinkedIn = async () => {
    if (liMeta.mode === "real") { try { await linkedinService.disconnect(); } catch (e) { /* clear locally anyway */ } }
    setConn({ ...EMPTY_CONNECTION, mode: liMeta.mode });
    logAudit("LinkedIn disconnected");
    notify("LinkedIn disconnected. Publishing is locked until you reconnect.");
  };

  /* "New post": the current work is already saved as a draft, so just clear
     the workspace and go to the composer. */
  function reset() {
    clearWork();
    setView("home");
  }

  async function wipe() {
    try { await persistentStore.delete(STORE_KEY); } catch (e) {}
    cacheRef.current = {};
    reset(); setDrafts([]); setOpps(null); setPosts(SEED_POSTS); setTeam(SEED_TEAM); setNotes([]);
    setUsage({ calls: 0, fails: 0, searches: 0, inTok: 0, outTok: 0, byEngine: {} });
    setConn({ ...EMPTY_CONNECTION, mode: liMeta.mode });
    setModal(null); notify("Saved session cleared.");
  }

  const appProps = {
    idea, stage, steps, research, angles, angle, draft, setDraft, verification, setVerification,
    quality, dupDismissed, setDupDismissed, media, format, formats, fmt, versions, schedule, setSchedule, publishState, attempts, publishError, publishVia,
    assets, patchAssets, mstate, makeImage, makeImageSet, retile, addTile, makeVideo, makeDocument,
    makeCarousel, reslide, moveItem, dropItem, editSlide, editDocPage, makePoll, makeArticle, editArticle,
    ingestDocument, attachUpload, exportVideo,
    analytics, busy, tone, setTone, pov, setPov, length, setLength, showDetail, setShowDetail,
    openClaim, setOpenClaim, linkedin, claimsBlocking, runWriter, approve, reject, confirmSchedule,
    publishNow, runDiscovery, setDrawer, setModal, reset, cancelWork, setFailMode, undoStack, pushUndo, undo,
    publishLimits, publishKind, publishFramed, publishUnverified, sendAnyway, getLastPayload: () => lastPayloadRef.current, confirmPublished, workId, posts, relay,
  };

  return (
    <div className="unison" data-t={theme}>
      <style>{CSS}</style>
      <CursorField theme={theme} />

      <Header {...{ view, setView, setDrawer, setModal, notes, linkedin, liMeta, relay, theme, setTheme, navOpen, setNavOpen, openLinkedIn, manageConnection, disconnectLinkedIn, draftCount: drafts.length }} />

      {navOpen && (
        <div className="sheet">
          {NAV.map(([id, label]) => (
            <button key={id} onClick={() => { setNavOpen(false); setView(id); }}>{label}{id === "drafts" && drafts.length ? ` (${drafts.length})` : ""}</button>
          ))}
          <button onClick={() => { setNavOpen(false); openLinkedIn(linkedin.connected ? 1 : 0); }}>
            {linkedin.viaWorkflow ? "LinkedIn publishing ready" : linkedin.connected ? `LinkedIn · ${linkedin.org}` : "Connect LinkedIn"}
          </button>
          <button onClick={() => { setNavOpen(false); setModal("voice"); }}>Brand voice</button>
          <button onClick={() => { setNavOpen(false); setModal("settings"); }}>Settings</button>
        </div>
      )}

      <PipelineScene theme={theme} level={bg3d ? 0.16 : 0} />
      {idea && <MobileRail index={railIndex} stages={fmt.stages} />}
      <div className="wrap">
        <Rail index={railIndex} active={busy} started={!!idea} fmt={fmt} />
        <main>
          {view === "home" && (
            <Dashboard
              posts={posts} linkedin={linkedin} schedule={schedule} setModal={setModal}
              drafts={drafts} activeId={idea ? workId : null}
              onEditDraft={openDraft} onRemoveDraft={removeDraft}
              onDiscover={runOpportunities}
              setView={setView} open={setOpenPost}
              composer={
                <CreateFlow
                  onStart={(f, t) => runDiscovery(t, f)}
                  recommend={recommendFormat} recommending={recBusy} recommended={recFormat}
                  seed={seedIdea} clearSeed={() => setSeedIdea("")}
                />
              }
            />
          )}
          {view === "discover" && (
            <Discover opps={opps} busy={oppBusy} rerun={runOpportunities} start={(t) => { setSeedIdea(t); setView("home"); }} profile={profile} setProfile={setProfile} />
          )}
          {view === "drafts" && <DraftsList drafts={drafts} activeId={idea ? workId : null} onEdit={openDraft} onRemove={removeDraft} onResume={() => setView("workspace")} onCreate={() => setView("home")} />}
          {view === "workspace" && (idea ? <Workspace {...appProps} /> : <EmptyWorkspace onCreate={() => setView("home")} drafts={drafts.length} onDrafts={() => setView("drafts")} />)}
          {view === "content" && <ContentList posts={posts} open={setOpenPost} />}
          {view === "calendar" && <CalendarView posts={posts} open={setOpenPost} start={(t) => { setSeedIdea(t); setView("home"); }} />}
          {view === "insights" && <Insights posts={posts} analytics={analytics} discover={runOpportunities} />}
        </main>
      </div>

      {drawer && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <aside className="drawer">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
              <div className="disp" style={{ fontSize: 24 }}>
                {{ sources: "Sources", audit: "Activity", versions: "Versions", notes: "Notifications" }[drawer]}
              </div>
              <button className="btn sm" onClick={() => setDrawer(null)}>Close</button>
            </div>
            {drawer === "sources" && <SourcesPanel research={research} />}
            {drawer === "audit" && <AuditPanel log={audit} />}
            {drawer === "versions" && <VersionPanel versions={versions} setDraft={setDraft} pushUndo={pushUndo} />}
            {drawer === "notes" && <NotesPanel notes={notes} clear={() => setNotes([])} />}
          </aside>
        </>
      )}

      {modal === "settings" && (
        <Modal wide onClose={() => { setModal(null); setSettingsTab("models"); }} title="Settings">
          <Settings {...{ usage, linkedin, liMeta, relay, disconnectLinkedIn, openLinkedIn, setModal, searchOn, setSearchOn, failMode, setFailMode, makeCompany, setMakeCompany, team, setTeam, theme, setTheme, schedule, setSchedule, notes, setNotes, notify, profile, setProfile, wipe, bg3d, setBg3d, initialTab: settingsTab }} />
        </Modal>
      )}
      {modal === "voice" && (
        <Modal wide onClose={() => setModal(null)} title="Brand voice">
          <VoiceStudio voice={voice} setVoice={setVoice} track={track} />
        </Modal>
      )}
      {modal === "linkedin" && (
        <Modal onClose={() => setModal(null)} title={liStart === 1 ? "Switch Company Page" : "Connect LinkedIn"}>
          <LinkedInFlow startAt={liStart} mode={liMeta.mode} connection={conn} scopes={liMeta.scopes}
            onDone={(org) => { finishConnect(org); setModal(null); }} />
        </Modal>
      )}
      {modal === "diff" && (
        <Modal wide onClose={() => setModal(null)} title="What changed">
          <DiffView versions={versions} />
        </Modal>
      )}
      {openPost && (
        <Modal onClose={() => setOpenPost(null)} title={openPost.state === "SCHEDULED" ? "Scheduled post" : openPost.state === "PUBLISHED" ? "Published post" : "Post"}>
          <PostDetail post={openPost} linkedin={linkedin} cancel={cancelScheduled} confirm={confirmPublished} start={(t) => { setOpenPost(null); runDiscovery(t, "text"); }} />
        </Modal>
      )}
    </div>
  );
}

/* ============================================================
   CHROME
   ============================================================ */

function Header({ view, setView, setDrawer, setModal, notes, linkedin, liMeta, relay, theme, setTheme, navOpen, setNavOpen, openLinkedIn, manageConnection, disconnectLinkedIn, draftCount = 0 }) {
  const [liOpen, setLiOpen] = useState(false);
  return (
    <header className="hdr">
      <div className="hdr-in">
        <button className="mark" onClick={() => setView("home")}><Mark />Unison</button>
        <nav className="nav">
          {NAV.map(([v, label]) => (
            <button key={v} className={navKey(view) === v ? "on" : ""} onClick={() => setView(v)}>
              {label}{v === "drafts" && draftCount > 0 && <span className="navcount">{draftCount}</span>}
            </button>
          ))}
        </nav>
        <div className="hdr-right">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button className="btn sm hide-sm" onClick={() => setModal("voice")}>Brand voice</button>

          <LinkedInChip
            linkedin={linkedin} liMeta={liMeta} relay={relay} open={liOpen} setOpen={setLiOpen}
            openLinkedIn={openLinkedIn} manageConnection={manageConnection} disconnectLinkedIn={disconnectLinkedIn}
          />

          <button className="bell" onClick={() => setDrawer("notes")} aria-label="Notifications"><span>◔</span>{notes.length ? <b>{notes.length}</b> : null}</button>
          <button className="btn sm hide-sm" onClick={() => setModal("settings")}>Settings</button>
          <div className="avatar">JA</div>
          <button className="burger" onClick={() => setNavOpen(!navOpen)} aria-label="Menu">≡</button>
        </div>
      </div>
    </header>
  );
}

/* The company chip is the LinkedIn context, not a shortcut into Settings.
   Clicking it opens a compact popover; the full connection flow and the
   detailed configuration still live where they always did. */
function LinkedInChip({ linkedin, liMeta, relay, open, setOpen, openLinkedIn, manageConnection, disconnectLinkedIn }) {
  const wrap = useRef(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) { setOpen(false); setConfirm(false); } };
    const esc = (e) => e.key === "Escape" && (setOpen(false), setConfirm(false));
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open, setOpen]);

  const st = linkedin.status;
  const tone = st === "connected" ? "g" : st === "simulated" ? "y" : linkedin.needsAttention ? "r" : "r";
  const label = linkedin.viaWorkflow ? (relay?.relay ? "LinkedIn publishing ready" : "LinkedIn · preview") : linkedin.connected ? linkedin.org : st === "authorized" ? "Choose a Page" : "Connect LinkedIn";
  const headline = { connected: "Connected", simulated: "Prototype connection", workflow: "Publishing connected", authorized: "Authorized — no Page chosen",
    expired: "Needs attention", revoked: "Access revoked", error: "Connection error", connecting: "Connecting…",
    disconnected: "Not connected" }[st] || "Not connected";

  return (
    <div className="pop-wrap" ref={wrap}>
      <button className={"btn sm chip-li " + (linkedin.connected ? "" : "acc")} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={"dot " + tone} />{label}<span className="caret">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="pop">
          <div className="row" style={{ gap: 10, marginBottom: 12 }}>
            <span className="li-chip">in</span>
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow">LinkedIn</div>
              <div style={{ fontWeight: 600 }}>{headline}</div>
            </div>
            <span className={"dot " + tone} style={{ marginLeft: "auto" }} />
          </div>

          {linkedin.viaWorkflow ? (
            <>
              <div className="pop-row"><span className="u-muted">Publishing</span><span style={{ fontWeight: 600 }}>{relay?.relay ? "✓ Ready" : relay?.checked ? "Preview — not connected here" : "Checking…"}</span></div>
              <div className="pop-row"><span className="u-muted">Post types</span><span>{MAKE_CONFIG.supportedPostTypes.map((t) => FORMAT_BY_ID[t]?.label || t).join(", ")}</span></div>
              <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>
                {relay?.relay
                  ? "Your Company Page is authorised inside the LinkedIn workflow, so there's nothing to set up here."
                  : "This preview can't reach the publishing service. Everything else works — posts you create here are saved and can be published from the deployed version."}
              </div>
            </>
          ) : linkedin.connected ? (
            <>
              <div className="pop-row"><span className="u-muted">Company Page</span><span style={{ fontWeight: 600 }}>{linkedin.org}</span></div>
              {linkedin.followers != null && <div className="pop-row"><span className="u-muted">Followers</span><span>{Number(linkedin.followers).toLocaleString()}</span></div>}
              <div className="pop-row"><span className="u-muted">Publishing access</span><span>{linkedin.canPublish ? "✓ Available" : "Not available"}</span></div>
              {linkedin.expires && <div className="pop-row"><span className="u-muted">Access</span><span>Active until {linkedin.expires}</span></div>}
              {confirm ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 600 }}>Disconnect LinkedIn?</div>
                  <div className="u-muted" style={{ fontSize: 13, marginTop: 4 }}>
                    Unison will no longer be able to publish to this Page.
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
                    <button className="btn sm" onClick={() => { setConfirm(false); setOpen(false); disconnectLinkedIn(); }}>Disconnect</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="row" style={{ marginTop: 14 }}>
                    <button className="btn sm" onClick={() => { setOpen(false); manageConnection(); }}>Manage connection</button>
                    <button className="btn sm" onClick={() => { setOpen(false); openLinkedIn(1); }}>Switch Page</button>
                  </div>
                  <button className="btn sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setConfirm(true)}>Disconnect</button>
                </>
              )}
            </>
          ) : linkedin.needsAttention ? (
            <>
              <div className="u-muted" style={{ fontSize: 13.5 }}>
                {linkedin.error || "The LinkedIn connection needs attention. Please reconnect."}
              </div>
              <button className="btn acc sm" style={{ width: "100%", marginTop: 14 }} onClick={() => { setOpen(false); openLinkedIn(0); }}>Reconnect LinkedIn</button>
            </>
          ) : (
            <>
              <div className="u-muted" style={{ fontSize: 13.5 }}>
                Connect your LinkedIn Page to publish content directly from Unison.
              </div>
              <button className="btn acc sm" style={{ width: "100%", marginTop: 14 }} onClick={() => { setOpen(false); openLinkedIn(st === "authorized" ? 1 : 0); }}>
                {st === "authorized" ? "Choose a Page" : "Connect LinkedIn"}
              </button>
            </>
          )}

          <div className="u-muted" style={{ fontSize: 11.5, marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            {liMeta.mode === "real"
              ? `Real LinkedIn authorization${liMeta.apiVersion ? " · API " + liMeta.apiVersion : ""}`
              : linkedin.viaWorkflow ? "Publishing via Make → LinkedIn. Unison never holds a LinkedIn credential on this route."
              : "Prototype connection — publishing is simulated until real LinkedIn authorization is configured."}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, setTheme }) {
  return (
    <button className={"tt " + (theme === "light" ? "on" : "")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
      <span className="tt-i">{theme === "dark" ? "☾" : "☀"}</span>
    </button>
  );
}

function Rail({ index, active, started, fmt }) {
  const stages = fmt.stages;
  const pct = started ? ((index + 0.5) / stages.length) * 100 : 0;
  return (
    <div className="rail">
      <div className="eyebrow" style={{ marginBottom: 16 }}>{fmt.label}</div>
      <div className="rail-line">
        <div className="rail-fill" style={{ height: `calc(${pct}% - 12px)` }} />
        {stages.map((k, i) => (
          <div key={k} className={"rstep " + (i < index ? "done" : i === index && started ? "on" : "")}>
            <div className="rdot" />
            <div className="rl"><span className="rn">{pad(i + 1)}</span>{STAGE_LABEL[k]}</div>
            <div className="re">{i === index && active ? "running" : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileRail({ index, stages }) {
  const list = stages || FORMAT_BY_ID.text.stages;
  return (
    <div className="mrail"><div className="mrail-in">
      {list.map((k, i) => <div key={k} className={"mdot " + (i < index ? "done" : i === index ? "on" : "")} title={STAGE_LABEL[k]} />)}
      <span className="eyebrow" style={{ marginLeft: 10 }}>{STAGE_LABEL[list[Math.min(index, list.length - 1)]]}</span>
    </div></div>
  );
}

/* ============================================================
   DASHBOARD — the first screen. A command centre, not a pitch.
   ============================================================ */

function Dashboard({ posts, linkedin, schedule, drafts, activeId, onEditDraft, onRemoveDraft, onDiscover, setView, open, setModal, composer }) {
  const review = posts.filter((p) => p.state === "HUMAN_REVIEW");
  const scheduled = posts.filter((p) => p.state === "SCHEDULED");
  const recent = posts.filter((p) => p.state === "PUBLISHED").slice(0, 3);

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <div className="eyebrow">Acme Systems</div>
          <h1 className="disp">Good morning, Jaynil.</h1>
        </div>
      </div>

      {composer}

      {drafts.length > 0 && (
        <div className="card dash-resume">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <span className="eyebrow">Drafts</span>
            <button className="btn sm" onClick={() => setView("drafts")}>All drafts ({drafts.length})</button>
          </div>
          {drafts.slice(0, 3).map((d) => <DraftRow key={d.id} d={d} active={d.id === activeId} onEdit={onEditDraft} onRemove={onRemoveDraft} />)}
        </div>
      )}

      <div className="dash-grid">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="eyebrow">Waiting for review</span>
            <span className="mono u-muted">{review.length}</span>
          </div>
          {review.length === 0 && <div className="u-muted" style={{ fontSize: 13.5 }}>Nothing waiting.</div>}
          {review.slice(0, 4).map((p) => (
            <button className="dash-row" key={p.id} onClick={() => open(p)}>
              <span className="dot y" />
              <span style={{ minWidth: 0 }}>{p.title}</span>
              <span className="mono u-muted">{p.date.slice(5)}</span>
            </button>
          ))}
          {review.length > 0 && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setView("content")}>Open review queue</button>}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <span className="eyebrow">Recent content</span>
            <span className="mono u-muted">{recent.length}</span>
          </div>
          {recent.length === 0 && <div className="u-muted" style={{ fontSize: 13.5 }}>Nothing published yet.</div>}
          {recent.map((p) => (
            <button className="dash-row" key={p.id} onClick={() => open(p)}>
              <span className="dot g" />
              <span style={{ minWidth: 0 }}>{p.title}</span>
              <span className="mono u-muted">{p.metrics ? `${(p.metrics.impressions / 1000).toFixed(1)}k` : p.date.slice(5)}</span>
            </button>
          ))}
          {recent.length > 0 && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setView("insights")}>See performance</button>}
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Status</div>
          <div className="dash-stat">
            <span className={"dot " + (linkedin.connected ? "g" : "r")} />
            <span>{linkedin.viaWorkflow ? "LinkedIn publishing connected" : linkedin.connected ? `${linkedin.org} connected` : "No Company Page connected"}</span>
            {!linkedin.connected && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setModal("linkedin")}>Connect</button>}
          </div>
          {posts.some((p) => p.state === "SENT") && (
            <div className="dash-stat">
              <span className="dot y" />
              <span>{posts.filter((p) => p.state === "SENT").length} sent to Make, awaiting LinkedIn</span>
            </div>
          )}
          <div className="dash-stat">
            <span className="dot b" />
            <span>{scheduled.length} scheduled</span>
            {scheduled.length > 0 && <span className="mono u-muted" style={{ marginLeft: "auto" }}>next {scheduled[0].date.slice(5)}</span>}
          </div>
          <div className="dash-stat">
            <span className="dot b" />
            <span>Publishing timezone {schedule.tz}</span>
          </div>
          <button className="btn sm" style={{ marginTop: 12 }} onClick={onDiscover}>Find something to post</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- drafts ---------- */

const stageWord = (s) => ({
  IDEA: "not started", RESEARCHING: "researching", RESEARCH_COMPLETE: "angle to pick", DRAFT: "writing",
  AI_REVIEW: "checking", HUMAN_REVIEW: "ready to review", APPROVED: "approved, not scheduled", FAILED: "publish failed",
}[s] || String(s || "").toLowerCase().replace(/_/g, " "));

const ago = (iso) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function DraftRow({ d, active, onEdit, onRemove }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="draftrow">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="draft-title">{d.title || d.idea}{active && <span className="badge" style={{ marginLeft: 8 }}>Open now</span>}</div>
        <div className="u-muted" style={{ fontSize: 12.5 }}>
          {labelFor(d.formats || "text")} · {stageWord(d.stage)}{d.draft?.hook ? ` · "${d.draft.hook.slice(0, 70)}${d.draft.hook.length > 70 ? "…" : ""}"` : ""} · saved {ago(d.savedAt)}
        </div>
      </div>
      <div className="row" style={{ flex: "none" }}>
        {confirm ? (
          <>
            <button className="btn sm" onClick={() => { setConfirm(false); onRemove(d.id); }}>Yes, remove</button>
            <button className="btn sm" onClick={() => setConfirm(false)}>Keep</button>
          </>
        ) : (
          <>
            <button className="btn sm acc" onClick={() => onEdit(d)}>{active ? "Resume" : "Edit"}</button>
            <button className="btn sm" onClick={() => setConfirm(true)}>Remove</button>
          </>
        )}
      </div>
    </div>
  );
}

function DraftsList({ drafts, activeId, onEdit, onRemove, onResume, onCreate }) {
  const sorted = [...drafts].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : String(b.savedAt).localeCompare(String(a.savedAt))));
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Drafts</h2><span className="eyebrow">{drafts.length} unfinished</span></div>
      {drafts.length === 0 ? (
        <div className="card">
          <div style={{ fontWeight: 600 }}>No drafts.</div>
          <div className="u-muted" style={{ fontSize: 13.5, marginTop: 6, maxWidth: 520 }}>
            Anything you start and leave unfinished is saved here automatically — when you begin another post, open an old one, or move to another tab.
          </div>
          <button className="btn acc" style={{ marginTop: 14 }} onClick={onCreate}>+ Create new content</button>
        </div>
      ) : (
        <div className="card">
          {sorted.map((d) => <DraftRow key={d.id} d={d} active={d.id === activeId} onEdit={d.id === activeId ? onResume : onEdit} onRemove={onRemove} />)}
        </div>
      )}
    </div>
  );
}

/* ---------- composer ---------- */

/* Starters put an opening phrase into the box so the user only has to finish
   the sentence. */
const STARTERS = [
  { label: "Idea", text: "I want to create a post about " },
  { label: "Announcement", text: "We're announcing " },
  { label: "Lesson learned", text: "Something we learned recently: " },
  { label: "Ask the audience", text: "A question for our audience: " },
  { label: "Data point", text: "A number worth talking about: " },
];

function CreateFlow({ onStart, recommend, recommending, recommended, seed, clearSeed }) {
  const [formats, setFormats] = useState(["text"]);
  const [text, setText] = useState(seed || "");
  const inputRef = useRef(null);
  useEffect(() => { if (seed) { setText(seed); inputRef.current?.focus(); clearSeed?.(); } }, [seed]);
  const go = () => text.trim() && onStart(formats, text.trim());
  const pick = (id) => setFormats((f) => toggleFormat(f, id));
  const starter = (t) => {
    setText((cur) => (!cur.trim() || STARTERS.some((s) => cur === s.text) ? t : t + cur.trimStart()));
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };
  const recList = Array.isArray(recommended) ? recommended : recommended ? [recommended] : [];

  return (
    <div className="create">
      <div className="composer">
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="What is this post about?" />
        <button className="btn pri" onClick={go} disabled={!text.trim()}>Start</button>
      </div>

      <div className="chips" style={{ marginTop: 12 }}>
        {STARTERS.map((s) => <button key={s.label} className="chip" onClick={() => starter(s.text)}>{s.label}</button>)}
        <button className="chip" disabled={!text.trim() || recommending} onClick={() => recommend(text, setFormats)}>
          {recommending ? "Thinking…" : "Let Unison pick the format"}
        </button>
      </div>

      <div className="row" style={{ justifyContent: "space-between", margin: "22px 0 10px" }}>
        <span className="eyebrow">Components · {labelFor(formats)}</span>
        <span className="u-muted" style={{ fontSize: 12.5 }}>Pick as many as the post needs. One visual per post.</span>
      </div>
      <div className="fmt-grid">
        {FORMATS.map((f) => {
          const on = formats.includes(f.id);
          const base = f.id === "text";
          return (
            <button key={f.id} className={"fmt " + (on ? "on" : "") + (base ? " base" : "") + (recList.includes(f.id) && !base ? " rec" : "")}
              onClick={() => pick(f.id)} aria-pressed={on}>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <span className="fmt-label">{f.label}</span>
                <span className={"fmt-check " + (on ? "on" : "")}>{on ? "✓" : ""}</span>
              </span>
              <span className="u-muted">{base ? "Always included — the written post." : f.hint}</span>
              {recList.includes(f.id) && !base && <span className="eyebrow" style={{ marginTop: 6 }}>Recommended</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   MEDIA UI — one panel per format, all driven by the media engine
   ============================================================ */

function TaskState({ state, idleLabel, busyLabel, onRun, disabled, extra }) {
  const st = state?.status || "idle";
  return (
    <div>
      <div className="row">
        <button className="btn acc sm" disabled={st === "generating" || disabled} onClick={onRun}>
          {st === "generating" ? busyLabel : st === "success" ? `Re${idleLabel[0].toLowerCase()}${idleLabel.slice(1)}` : idleLabel}
        </button>
        {extra}
      </div>
      {st === "generating" && (
        <div className="u-muted" style={{ marginTop: 12 }}>
          <span className="pulse" /> {busyLabel}
          {state.progress > 0 && <span className="mono" style={{ marginLeft: 8 }}>{Math.round(state.progress * 100)}%</span>}
          {state.progress > 0 && <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${state.progress * 100}%` }} /></div>}
        </div>
      )}
      {st === "error" && (
        <div className="badge bad" style={{ marginTop: 12 }}>
          {state.error || "Generation failed."}
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={onRun}>Try again</button>
        </div>
      )}
    </div>
  );
}

/* The preview draws the storyboard on a canvas on its own clock.
   Duration is known exactly, play and scrub always work, and it survives a
   refresh because it replays data rather than a blob. The exported .webm is a
   separate concern. */
function StoryboardPlayer({ storyboard, brief, seconds }) {
  const cv = useRef(null), bar = useRef(null), lab = useRef(null);
  const at = useRef(0);
  const [playing, setPlaying] = useState(false);
  const total = (seconds || (storyboard?.length || 1) * SCENE_SECONDS) * 1000;
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

  const paint = (ms) => {
    const c = cv.current;
    if (!c || !storyboard?.length) return;
    const ctx = c.getContext("2d");
    const per = total / storyboard.length;
    const i = Math.min(storyboard.length - 1, Math.floor(ms / per));
    drawScene(ctx, c.width, c.height, storyboard[i], i, storyboard.length, (ms % per) / per, brief);
    if (bar.current) bar.current.value = String(ms);
    if (lab.current) lab.current.textContent = `${fmt(ms)} / ${fmt(total)}`;
  };

  useEffect(() => { at.current = 0; paint(0); }, [storyboard]);

  useEffect(() => {
    if (!playing) return;
    let raf, last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      at.current = Math.min(total, at.current + (now - last));
      last = now;
      paint(at.current);
      if (at.current >= total) setPlaying(false);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, storyboard]);

  const toggle = () => {
    if (!playing && at.current >= total) { at.current = 0; paint(0); }
    setPlaying((p) => !p);
  };

  return (
    <div className="sbplayer">
      <canvas ref={cv} width={1280} height={720} onClick={toggle} />
      {!playing && (
        <button className="sb-play" onClick={toggle} aria-label="Play">
          <svg viewBox="0 0 64 64" width="58" height="58"><circle cx="32" cy="32" r="30" fill="rgba(10,15,26,.6)" stroke="#7C8CFF" strokeWidth="2.5" /><path d="M26 20 L46 32 L26 44 Z" fill="#7C8CFF" /></svg>
        </button>
      )}
      <div className="sb-bar">
        <button onClick={toggle}>{playing ? "❚❚" : "▶"}</button>
        <input ref={bar} type="range" min="0" max={total} defaultValue="0" step="50"
          onInput={(e) => { at.current = +e.target.value; paint(at.current); }} />
        <span className="mono" ref={lab}>0:00 / {fmt(total)}</span>
        <button onClick={() => { at.current = 0; paint(0); setPlaying(false); }} title="Restart">⟲</button>
      </div>
    </div>
  );
}

/* A WebM from MediaRecorder has no duration in its header — it was written as a
   live stream, so browsers report Infinity and the controls show 0:00 with a
   dead scrubber. Seeking to a huge timestamp forces the browser to scan to the
   end and compute the real duration, after which we rewind. */
function VideoPlayer({ src, poster, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    let fixing = false;
    const onMeta = () => {
      if (v.duration === Infinity || Number.isNaN(v.duration)) {
        fixing = true;
        v.currentTime = 1e101;
      }
    };
    const onTime = () => {
      if (fixing && v.duration !== Infinity && !Number.isNaN(v.duration)) {
        fixing = false;
        v.currentTime = 0;
      }
    };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    return () => { v.removeEventListener("loadedmetadata", onMeta); v.removeEventListener("timeupdate", onTime); };
  }, [src]);
  return <video ref={ref} src={src} poster={poster} controls playsInline preload="metadata" className={className} />;
}

const svgDataUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

function SvgFrame({ svg, ratio = "1200 / 630" }) {
  return <div className="svgframe" style={{ aspectRatio: ratio }}><img src={svgDataUrl(svg)} alt="" /></div>;
}

async function saveAsset(svg, name, w, h) {
  try {
    const png = await svgToPng(svg, w, h);
    downloadBlob(png, name + ".png");
  } catch (e) {
    downloadBlob(svg, name + ".svg", "image/svg+xml");
  }
}

/* ---------- image ---------- */

function ImagePanel({ assets, mstate, makeImage, patchAssets, attachUpload, prototypeNote }) {
  const [variant, setVariant] = useState(0);
  const img = assets.images[0];
  const fileRef = useRef(null);
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Post image</div>
      <TaskState
        state={mstate.image} idleLabel="Generate image" busyLabel="Generating image…"
        onRun={() => { const v = variant + 1; setVariant(v); makeImage(v); }}
        extra={<>
          {img && <button className="btn sm" onClick={() => makeImage(variant + 2)}>Another variation</button>}
          <button className="btn sm" onClick={() => fileRef.current?.click()}>Upload your own</button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attachUpload(f); e.target.value = ""; }} />
          {img && <button className="btn sm" onClick={() => saveAsset(img.svg, "unison-image", 1200, 630)}>Download</button>}
          {(img || assets.upload) && <button className="btn sm" onClick={() => patchAssets({ images: [], upload: null })}>Remove</button>}
        </>}
      />
      {img && <><SvgFrame svg={img.svg} />{prototypeNote}</>}
      {assets.upload && !img && (
        <div className="svgframe" style={{ aspectRatio: "1200 / 630" }}><img src={assets.upload.data} alt={assets.upload.name} /></div>
      )}
      {img?.brief && (
        <details className="brief">
          <summary>Creative brief</summary>
          {Object.entries(img.brief).filter(([k]) => k !== "scenes").map(([k, v]) => (
            <div key={k}><span className="eyebrow">{k}</span> {String(v)}</div>
          ))}
          {img.prompt && <div style={{ marginTop: 8 }}><span className="eyebrow">generation prompt</span> {img.prompt}</div>}
        </details>
      )}
    </div>
  );
}

/* ---------- multi-image ---------- */

function MultiPanel({ assets, mstate, makeImageSet, retile, addTile, moveItem, dropItem, prototypeNote }) {
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Image set · {assets.images.length} of 4</div>
      <TaskState
        state={mstate.multi} idleLabel="Generate set" busyLabel="Generating set…"
        onRun={() => makeImageSet(3)}
        extra={assets.images.length > 0 && assets.images.length < 4 && <button className="btn sm" onClick={addTile}>Add image</button>}
      />
      {assets.images.length > 0 && (
        <>
          <div className="tilegrid">
            {assets.images.map((t, i) => (
              <div className="tile" key={t.id}>
                <SvgFrame svg={t.svg} ratio="1 / 1" />
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="eyebrow">{pad(i + 1)}</span>
                  <button className="btn sm" disabled={mstate["tile-" + i]?.status === "generating"} onClick={() => retile(i)}>
                    {mstate["tile-" + i]?.status === "generating" ? "…" : "Regenerate"}
                  </button>
                  <button className="btn sm" onClick={() => moveItem("images", i, i - 1)} disabled={i === 0}>←</button>
                  <button className="btn sm" onClick={() => moveItem("images", i, i + 1)} disabled={i === assets.images.length - 1}>→</button>
                  <button className="btn sm" onClick={() => dropItem("images", i)}>Remove</button>
                </div>
                {mstate["tile-" + i]?.status === "error" && <div className="badge bad" style={{ marginTop: 8 }}>{mstate["tile-" + i].error}</div>}
              </div>
            ))}
          </div>
          {prototypeNote}
        </>
      )}
    </div>
  );
}

/* ---------- video ---------- */

function VideoPanel({ assets, mstate, makeVideo, exportVideo, patchAssets, attachUpload, prototypeNote }) {
  const v = assets.video;
  const fileRef = useRef(null);
  const enc = mstate.encode || {};
  const canEncode = videoProvider.supported();

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Video</div>
      <TaskState
        state={mstate.video} idleLabel="Generate video" busyLabel="Building storyboard…"
        onRun={makeVideo}
        extra={<>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>Upload your own</button>
          <input ref={fileRef} type="file" accept="video/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) attachUpload(f); e.target.value = ""; }} />
          {(v || assets.upload) && (
            <button className="btn sm" onClick={() => { if (v?.url) URL.revokeObjectURL(v.url); patchAssets({ video: null, upload: null }); }}>Remove</button>
          )}
        </>}
      />

      {v?.storyboard?.length > 0 && (
        <>
          <StoryboardPlayer storyboard={v.storyboard} brief={v.brief} seconds={v.seconds} />
          <div className="badge warn" style={{ marginTop: 10 }}>
            Rendered locally from the storyboard — {v.seconds}s. No video model produced this.
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            {!v.url && (
              <button className="btn sm" disabled={!canEncode || enc.status === "generating"} onClick={exportVideo}>
                {enc.status === "generating" ? `Encoding… ${Math.round((enc.progress || 0) * 100)}%` : "Export .webm"}
              </button>
            )}
            {v.url && (
              <button className="btn sm" onClick={async () => {
                const bytes = v.blob || await fetch(v.url).then((r) => r.blob());
                downloadBlob(bytes, "unison-video.webm");
              }}>Download .webm</button>
            )}
            {v.url && <button className="btn sm" onClick={exportVideo}>Re-encode</button>}
          </div>
          {enc.status === "generating" && (
            <div style={{ marginTop: 10 }}>
              <div className="bar"><i style={{ width: `${(enc.progress || 0) * 100}%` }} /></div>
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                Encoding runs in real time — about {v.seconds} seconds. Keep this tab in front.
              </div>
            </div>
          )}
          {enc.status === "error" && <div className="badge bad" style={{ marginTop: 10 }}>{enc.error}</div>}
          {v.url && enc.status !== "generating" && (
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              File ready · {v.mime?.replace("video/", "").split(";")[0].toUpperCase()} · {v.seconds}s
            </div>
          )}
          {!canEncode && (
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              This browser can't record a file, so the storyboard preview is the only output here.
            </div>
          )}
        </>
      )}

      {assets.upload?.type?.startsWith("video") && !v && (
        <div className="visual-frame" style={{ marginTop: 14 }}>
          <VideoPlayer src={assets.upload.data} />
        </div>
      )}

      {v?.storyboard?.length > 0 && (
        <details className="brief" open>
          <summary>Storyboard · {v.storyboard.length} scenes</summary>
          {v.storyboard.map((sc, i) => (
            <div key={i} style={{ padding: "6px 0" }}>
              <span className="eyebrow">{pad(i + 1)} {sc.label}</span> {sc.line}
              {sc.note && <div className="u-muted" style={{ fontSize: 13 }}>{sc.note}</div>}
            </div>
          ))}
          {v.prompt && <div style={{ marginTop: 8 }}><span className="eyebrow">generation prompt</span> {v.prompt}</div>}
        </details>
      )}
    </div>
  );
}

/* ---------- document ---------- */

function DocumentPanel({ assets, mstate, makeDocument, editDocPage, ingestDocument, prototypeNote }) {
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(5);
  const fileRef = useRef(null);
  const doc = assets.doc;
  const idx = Math.min(page, (doc?.pages.length || 1) - 1);
  const cur = doc?.pages[idx];
  const ing = mstate.sourceDoc;

  return (
    <>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Work from a document you already have</div>
        <TaskState
          state={ing} idleLabel="Upload a document" busyLabel="Reading document…"
          onRun={() => fileRef.current?.click()}
          extra={<input ref={fileRef} type="file" accept=".docx,.txt,.md,.csv,.json,.pdf" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) ingestDocument(f); e.target.value = ""; }} />}
        />
        <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          .docx, .txt, .md and .csv are read in full. PDFs only work if their text is uncompressed.
        </div>
        {assets.sourceDoc && (
          <div className="srcdoc">
            <div style={{ fontWeight: 600 }}>{assets.sourceDoc.name}</div>
            <div className="u-muted" style={{ fontSize: 13 }}>{assets.sourceDoc.summary}</div>
            {["facts", "stats", "insights"].map((k) => (assets.sourceDoc[k] || []).length > 0 && (
              <div key={k} style={{ marginTop: 8 }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>{k}</div>
                {assets.sourceDoc[k].map((x, i) => <div key={i} style={{ fontSize: 13.5, padding: "2px 0" }}>— {x}</div>)}
              </div>
            ))}
            <div className="badge" style={{ marginTop: 10 }}>Added to sources as a primary document</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <span className="eyebrow">Or have Unison build one</span>
          <select className="ta" style={{ width: 110 }} value={pages} onChange={(e) => setPages(+e.target.value)}>
            {[4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} pages</option>)}
          </select>
        </div>
        <TaskState
          state={mstate.doc} idleLabel="Generate document" busyLabel="Building document…"
          onRun={() => { setPage(0); makeDocument(pages); }}
          extra={doc && <>
            <button className="btn sm" onClick={() => saveAsset(cur.svg, `unison-page-${idx + 1}`, 1200, 1200)}>Download page</button>
            <button className="btn sm" onClick={() => doc.pages.forEach((pg, i) => setTimeout(() => saveAsset(pg.svg, `unison-page-${i + 1}`, 1200, 1200), i * 350))}>Download all</button>
          </>}
        />
        {doc && cur && (
          <>
            <div className="pager">
              <button className="btn sm" onClick={() => setPage(Math.max(0, idx - 1))} disabled={idx === 0}>←</button>
              <span className="mono">{idx + 1} / {doc.pages.length}</span>
              <button className="btn sm" onClick={() => setPage(Math.min(doc.pages.length - 1, idx + 1))} disabled={idx === doc.pages.length - 1}>→</button>
            </div>
            <SvgFrame svg={cur.svg} ratio="1 / 1" />
            <div style={{ marginTop: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Edit this page</div>
              <input className="ta" value={cur.heading} onChange={(e) => editDocPage(idx, { heading: e.target.value })} />
              <textarea className="ta" style={{ marginTop: 8 }} rows={3} value={cur.body} onChange={(e) => editDocPage(idx, { body: e.target.value })} />
            </div>
            {prototypeNote}
          </>
        )}
      </div>
    </>
  );
}

/* ---------- carousel ---------- */

function CarouselPanel({ assets, mstate, makeCarousel, reslide, editSlide, moveItem, dropItem, prototypeNote }) {
  const [i, setI] = useState(0);
  const list = assets.carousel;
  const idx = Math.min(i, Math.max(0, list.length - 1));
  const s = list[idx];
  return (
    <div className="card">
      <div className="badge warn" style={{ marginBottom: 12 }}>
        LinkedIn has no organic carousel API. This exports as slides or a document — it is never published as a native carousel.
      </div>
      <TaskState
        state={mstate.carousel} idleLabel="Generate carousel" busyLabel="Building slides…"
        onRun={() => { setI(0); makeCarousel(6); }}
        extra={list.length > 0 && <>
          <button className="btn sm" onClick={() => saveAsset(s.svg, `unison-slide-${idx + 1}`, 1200, 1200)}>Export slide</button>
          <button className="btn sm" onClick={() => list.forEach((sl, k) => setTimeout(() => saveAsset(sl.svg, `unison-slide-${k + 1}`, 1200, 1200), k * 350))}>Export all</button>
        </>}
      />
      {list.length > 0 && s && (
        <>
          <div className="strip-thumbs">
            {list.map((sl, k) => (
              <button key={sl.id} className={"thumb " + (k === idx ? "on" : "")} onClick={() => setI(k)}>
                <img src={svgDataUrl(sl.svg)} alt="" />
                <span className="mono">{k + 1}</span>
              </button>
            ))}
          </div>
          <div className="pager">
            <button className="btn sm" onClick={() => setI(Math.max(0, idx - 1))} disabled={idx === 0}>←</button>
            <span className="mono">{s.role} · {idx + 1} / {list.length}</span>
            <button className="btn sm" onClick={() => setI(Math.min(list.length - 1, idx + 1))} disabled={idx === list.length - 1}>→</button>
          </div>
          <SvgFrame svg={s.svg} ratio="1 / 1" />
          <div style={{ marginTop: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Edit slide {idx + 1}</div>
            <input className="ta" value={s.heading} onChange={(e) => editSlide(idx, { heading: e.target.value })} />
            <textarea className="ta" style={{ marginTop: 8 }} rows={3} value={s.body} onChange={(e) => editSlide(idx, { body: e.target.value })} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" disabled={mstate["slide-" + idx]?.status === "generating"} onClick={() => reslide(idx)}>
                {mstate["slide-" + idx]?.status === "generating" ? "Rewriting…" : "Regenerate this slide only"}
              </button>
              <button className="btn sm" onClick={() => { moveItem("carousel", idx, idx - 1); setI(Math.max(0, idx - 1)); }} disabled={idx === 0}>Move left</button>
              <button className="btn sm" onClick={() => { moveItem("carousel", idx, idx + 1); setI(Math.min(list.length - 1, idx + 1)); }} disabled={idx === list.length - 1}>Move right</button>
              <button className="btn sm" onClick={() => { dropItem("carousel", idx); setI(Math.max(0, idx - 1)); }} disabled={list.length <= 2}>Delete</button>
            </div>
            {mstate["slide-" + idx]?.status === "error" && <div className="badge bad" style={{ marginTop: 10 }}>{mstate["slide-" + idx].error}</div>}
          </div>
          {prototypeNote}
        </>
      )}
    </div>
  );
}

/* ---------- poll ---------- */

function PollPanel({ assets, mstate, makePoll, patchAssets }) {
  const poll = assets.poll;
  const set = (patch) => patchAssets({ poll: { ...poll, ...patch } });
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Poll</div>
      <TaskState state={mstate.poll} idleLabel="Generate poll" busyLabel="Writing poll…" onRun={makePoll} />
      {poll && (
        <div style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Question · {poll.question.length}/140</div>
          <input className="ta" maxLength={140} value={poll.question} onChange={(e) => set({ question: e.target.value })} />
          <div className="eyebrow" style={{ margin: "14px 0 6px" }}>Options · max 4, 30 characters each</div>
          {poll.options.map((o, i) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <span className="mono u-muted" style={{ width: 18 }}>{i + 1}</span>
              <input className="ta" style={{ flex: 1 }} maxLength={30} value={o}
                onChange={(e) => set({ options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })} />
              <button className="btn sm" disabled={poll.options.length <= 2} onClick={() => set({ options: poll.options.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" disabled={poll.options.length >= 4} onClick={() => set({ options: [...poll.options, ""] })}>Add option</button>
            <select className="ta" style={{ width: 140 }} value={poll.duration} onChange={(e) => set({ duration: e.target.value })}>
              {["1 day", "3 days", "1 week", "2 weeks"].map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- article ---------- */

function ArticlePanel({ assets, mstate, makeArticle, editArticle }) {
  const a = assets.article;
  const words = a ? [a.standfirst, ...(a.sections || []).map((s) => s.body), a.conclusion].join(" ").split(/\s+/).filter(Boolean).length : 0;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <span className="eyebrow">Article</span>
        {a && <span className="u-muted" style={{ fontSize: 12.5 }}>{words} words · no post character limit applies</span>}
      </div>
      <TaskState state={mstate.article} idleLabel="Generate article" busyLabel="Writing article…" onRun={makeArticle} />
      {a && (
        <div className="article-edit">
          <div className="eyebrow" style={{ margin: "14px 0 6px" }}>Title</div>
          <input className="ta" value={a.title || ""} onChange={(e) => editArticle({ title: e.target.value })} />
          <div className="eyebrow" style={{ margin: "12px 0 6px" }}>Standfirst</div>
          <textarea className="ta" rows={2} value={a.standfirst || ""} onChange={(e) => editArticle({ standfirst: e.target.value })} />
          {(a.sections || []).map((s, i) => (
            <div key={i} style={{ marginTop: 14 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="eyebrow">Section {i + 1}</span>
                <button className="btn sm" onClick={() => editArticle({ sections: a.sections.filter((_, j) => j !== i) })}>Remove</button>
              </div>
              <input className="ta" style={{ marginTop: 6 }} value={s.heading}
                onChange={(e) => editArticle({ sections: a.sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} />
              <textarea className="ta" style={{ marginTop: 6 }} rows={5} value={s.body}
                onChange={(e) => editArticle({ sections: a.sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
            </div>
          ))}
          <button className="btn sm" style={{ marginTop: 10 }} onClick={() => editArticle({ sections: [...(a.sections || []), { heading: "New section", body: "" }] })}>Add section</button>
          <div className="eyebrow" style={{ margin: "16px 0 6px" }}>Conclusion</div>
          <textarea className="ta" rows={3} value={a.conclusion || ""} onChange={(e) => editArticle({ conclusion: e.target.value })} />
          <div className="eyebrow" style={{ margin: "12px 0 6px" }}>Call to action</div>
          <input className="ta" value={a.cta || ""} onChange={(e) => editArticle({ cta: e.target.value })} />
        </div>
      )}
    </div>
  );
}

/* ---------- what shows inside the LinkedIn preview ---------- */

function AssetPreview({ format: rawFormat, formats, assets, media }) {
  const [i, setI] = useState(0);
  const list = normalizeFormats(formats || rawFormat);
  const visual = visualOf(list);

  /* the one attachment LinkedIn shows: an upload, a video, pages, or images */
  let attachment = null;
  if (assets.upload) {
    attachment = <div className="li-visual">{assets.upload.type.startsWith("video")
      ? <video src={assets.upload.data} controls playsInline />
      : <img src={assets.upload.data} alt={assets.upload.name} />}</div>;
  } else if (visual === "video" && assets.video) {
    attachment = (
      <div className="li-visual">
        {assets.video.storyboard?.length
          ? <StoryboardPlayer storyboard={assets.video.storyboard} brief={assets.video.brief} seconds={assets.video.seconds} />
          : <img src={svgDataUrl(assets.video.poster)} alt="" />}
      </div>
    );
  } else if (visual === "document" && assets.doc?.pages?.length) {
    const pages = assets.doc.pages;
    const idx = Math.min(i, pages.length - 1);
    attachment = (
      <div className="li-visual li-doc">
        <img src={svgDataUrl(pages[idx].svg)} alt="" />
        <div className="li-pager">
          <button onClick={() => setI(Math.max(0, idx - 1))} disabled={idx === 0}>←</button>
          <span>{idx + 1} / {pages.length}</span>
          <button onClick={() => setI(Math.min(pages.length - 1, idx + 1))} disabled={idx === pages.length - 1}>→</button>
        </div>
      </div>
    );
  } else if (assets.images.length === 1) {
    attachment = <div className="li-visual"><img src={svgDataUrl(assets.images[0].svg)} alt="" /></div>;
  } else if (assets.images.length > 1) {
    attachment = (
      <div className={"li-mosaic n" + Math.min(4, assets.images.length)}>
        {assets.images.slice(0, 4).map((t) => <img key={t.id} src={svgDataUrl(t.svg)} alt="" />)}
      </div>
    );
  } else if (visual) {
    attachment = (
      <div className="li-media">
        <div>
          <div className="eyebrow">{FORMAT_BY_ID[visual].label} · nothing attached yet</div>
          <div style={{ fontSize: 13, maxWidth: 360, marginTop: 8, color: "#5E6A80" }}>Generate it in the Media step below.</div>
          {media?.concept && <div style={{ fontSize: 12.5, maxWidth: 360, marginTop: 8, color: "#8894A8" }}>{media.concept}</div>}
        </div>
      </div>
    );
  }

  const poll = list.includes("poll") ? (assets.poll ? (
    <div className="li-poll">
      <div style={{ fontWeight: 600, marginBottom: 10 }}>{assets.poll.question || "Your question"}</div>
      {assets.poll.options.filter(Boolean).map((o, k) => <div className="li-opt" key={k}>{o}</div>)}
      <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>0 votes · {assets.poll.duration} left</div>
    </div>
  ) : <div className="li-poll u-muted" style={{ fontSize: 13 }}>Poll · not written yet</div>) : null;

  /* carousel slides are exported, not attached — shown as a strip so the post reads as one thing */
  const slides = list.includes("carousel") && assets.carousel.length ? (
    <div className="li-strip">{assets.carousel.slice(0, 6).map((sl) => <img key={sl.id || sl.n} src={svgDataUrl(sl.svg)} alt="" />)}</div>
  ) : null;

  const article = list.includes("article") && assets.article ? (
    <div className="li-article">
      <div className="eyebrow">Article</div>
      <div style={{ fontWeight: 700, marginTop: 4 }}>{assets.article.title}</div>
      <div className="u-muted" style={{ fontSize: 13 }}>{assets.article.standfirst}</div>
    </div>
  ) : null;

  if (!attachment && !poll && !slides && !article) return null;
  return <>{attachment}{poll}{slides}{article}</>;
}

/* ---------- the section that switches on format ---------- */

function MediaSection(p) {
  const { format } = p;
  const note = (
    <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
      Rendered by Unison's brand renderer. No external image model is connected in this build.
    </div>
  );
  const shared = { ...p, prototypeNote: note };
  if (format === "image") return <ImagePanel {...shared} />;
  if (format === "multi") return <MultiPanel {...shared} />;
  if (format === "video") return <VideoPanel {...shared} />;
  if (format === "document") return <DocumentPanel {...shared} />;
  if (format === "carousel") return <CarouselPanel {...shared} />;
  if (format === "poll") return <PollPanel {...shared} />;
  if (format === "article") return <ArticlePanel {...shared} />;
  return null;
}

const GAP = { open: ["Not covered", "gap-open"], adjacent: ["Loosely covered", "gap-adj"], covered: ["Already covered", "gap-cov"] };

function Discover({ opps, busy, rerun, start, profile, setProfile }) {
  const [editing, setEditing] = useState(false);
  const items = (opps?.items || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  return (
    <div style={{ paddingTop: 48 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Discover</h2><span className="eyebrow">Opportunity engine</span></div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Watching</div>
            <div style={{ fontWeight: 600 }}>{profile.industry} · {profile.audience}</div>
            <div className="u-muted" style={{ fontSize: 13.5 }}>{profile.keywords}</div>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</button>
            <button className="btn acc sm" disabled={busy} onClick={rerun}>{busy ? "Scanning…" : opps?.degraded ? "Try again" : "Rescan"}</button>
          </div>
        </div>
        {editing && (
          <div style={{ marginTop: 14 }}>
            {[["industry", "Industry"], ["audience", "Audience"], ["keywords", "Watch terms"]].map(([k, l]) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>{l}</div>
                <input className="ta" value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
              </div>
            ))}
          </div>
        )}
      </div>

      {busy && !opps && (
        <div className="card">
          <div className="pstep active"><span className="tick"><span className="pulse" /></span>Scanning the live web for this week's stories</div>
          <div className="pstep"><span className="tick">○</span>Scoring each one for urgency</div>
          <div className="pstep"><span className="tick">○</span>Checking them against what you've already posted</div>
        </div>
      )}

      {opps?.degraded && (
        <div className="badge warn" style={{ marginBottom: 12 }}>
          {opps.degraded === "sample" ? "The engine didn't respond — these rows are placeholders."
            : opps.degraded === "off" ? "Web search is off, so these come from the model's own knowledge and have no links."
            : "Live search didn't return usable results, so these come from the model's own knowledge and have no links."}
        </div>
      )}

      {items.map((o, i) => (
        <div className="opp" key={i}>
          <div className="opp-score">
            <b>{o.score}</b><span className="eyebrow">score</span>
            <div className="scorebar"><i style={{ height: `${o.score}%` }} /></div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className={"gap " + (GAP[o.gap]?.[1] || "gap-adj")}>{GAP[o.gap]?.[0] || "Unclear"}</span>
              <span className="eyebrow">{o.angle}</span>
              {o.date && <span className="eyebrow">{o.date}</span>}
            </div>
            <div className="opp-h">{o.headline}</div>
            {o.summary && <div className="u-muted" style={{ fontSize: 14, marginTop: 6 }}>{o.summary}</div>}
            <div style={{ marginTop: 10, fontSize: 13.5 }}><span className="eyebrow">Why now</span> {o.whyNow}</div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn acc sm" onClick={() => start(o.headline)}>Create from this</button>
              {o.url && <a className="btn sm" href={o.url} target="_blank" rel="noreferrer">{o.publisher || host(o.url)} ↗</a>}
              {!o.url && <span className="u-muted" style={{ fontSize: 12.5 }}>{o.publisher || "no link"}</span>}
            </div>
          </div>
        </div>
      ))}

      {!busy && !opps && (
        <div className="card">
          <div className="u-muted">Nothing scanned yet.</div>
          <button className="btn acc" style={{ marginTop: 12 }} onClick={rerun}>Find something to post</button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   WORKSPACE — only the stages the chosen format needs
   ============================================================ */

function Workspace(p) {
  const {
    idea, stage, steps, research, angles, angle, draft, setDraft, verification, setVerification,
    quality, dupDismissed, setDupDismissed, media, format, formats, fmt, versions, schedule, setSchedule,
    publishState, attempts, publishError, publishVia, publishLimits, publishKind, publishFramed, publishUnverified, sendAnyway, getLastPayload, confirmPublished, workId, posts, relay, analytics, busy, tone, setTone, pov, setPov, length, setLength,
    showDetail, setShowDetail, openClaim, setOpenClaim, linkedin, claimsBlocking, runWriter,
    approve, reject, confirmSchedule, publishNow, runDiscovery, setDrawer, setModal, reset, cancelWork,
    setFailMode, undoStack, undo, pushUndo, assets, patchAssets, mstate, makeImage, makeImageSet,
    retile, addTile, makeVideo, makeDocument, makeCarousel, reslide, moveItem, dropItem, editSlide,
    editDocPage, makePoll, makeArticle, editArticle, ingestDocument, attachUpload, exportVideo,
  } = p;

  const [rejecting, setRejecting] = useState(false);
  const [tab, setTab] = useState("post");
  const narrow = useNarrow(1120);
  const editRef = useRef(null);

  const shows = (s) => fmt.stages.includes(s);
  const n = (s) => fmt.stages.indexOf(s) + 1;

  const full = draft ? `${draft.hook}\n\n${draft.body}\n\n${draft.cta}` : "";
  const activeClaim = openClaim != null ? verification?.claims?.[openClaim] : null;
  const hl = useMemo(() => (activeClaim ? locateClaim(full, activeClaim.claim) : null), [activeClaim, full]);
  const over = shows("draft") && full.length > LI_LIMIT;   // never applied to articles or documents

  const assetSummary = [
    assets.images.length > 1 ? `${assets.images.length} images` : assets.images.length === 1 ? "1 image" : null,
    assets.video ? (assets.video.url ? "video" : "storyboard") : null,
    assets.doc ? `${assets.doc.pages.length}-page document` : null,
    assets.carousel.length ? `${assets.carousel.length} slides` : null,
    assets.poll ? "poll" : null, assets.article ? "article" : null, assets.upload ? "uploaded file" : null,
  ].filter(Boolean).join(", ");
  const missing = fmt.list.filter((f) => ({
    image: !assets.images.length && !assets.upload, multi: assets.images.length < 2 && !assets.upload, video: !assets.video && !assets.upload,
    document: !assets.doc, carousel: !assets.carousel.length, poll: !assets.poll, article: !assets.article,
  })[f]);

  const mediaProps = {
    format, formats, assets, patchAssets, mstate, makeImage, makeImageSet, retile, addTile, makeVideo,
    makeDocument, makeCarousel, reslide, moveItem, dropItem, editSlide, editDocPage, makePoll,
    makeArticle, editArticle, ingestDocument, attachUpload, exportVideo,
  };

  const evidencePanel = !draft ? null : (
    <div className="paper" style={{ padding: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="eyebrow">Evidence</span>
        {undoStack.length > 0 && <button className="btn sm" onClick={undo}>Undo</button>}
      </div>
      {!verification && <div className="u-muted" style={{ fontSize: 13 }}>Checking claims…</div>}
      {(verification?.claims || []).map((c, i) => (
        <div key={i}>
          <div className={"ev " + (openClaim === i ? "on" : "")} onClick={() => setOpenClaim(openClaim === i ? null : i)}>
            <span className={"dot " + c.status[0]} /><span style={{ fontSize: 13.5 }}>{c.claim}</span>
          </div>
          {openClaim === i && (
            <div className="evdetail">
              <div><b>Status</b> {c.status === "green" ? "Supported" : c.status === "yellow" ? "Needs review" : "Unsupported"}</div>
              <div><b>Source</b> {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.source} ↗</a> : c.source}</div>
              <div><b>Confidence</b> {c.confidence}</div>
              <div style={{ marginTop: 6 }}>{c.note}</div>
              {!locateClaim(full, c.claim) && <div className="u-muted" style={{ marginTop: 6, fontSize: 12.5 }}>Couldn't match this claim to a sentence in the post.</div>}
              <div className="row" style={{ marginTop: 11 }}>
                <button className="btn sm" onClick={() => {
                  pushUndo("replace source");
                  const src = research?.sources?.[0];
                  setVerification({ ...verification, claims: verification.claims.map((x, j) => j === i ? { ...x, status: "green", source: src?.publisher || "Company newsroom", url: src?.url || "", confidence: "High", note: "Source replaced with the highest-tier source available." } : x) });
                }}>Replace source</button>
                <button className="btn sm" onClick={() => {
                  pushUndo("remove claim");
                  setVerification({ ...verification, claims: verification.claims.filter((_, j) => j !== i) });
                  setOpenClaim(null);
                }}>Remove claim</button>
                <button className="btn sm" onClick={() => runWriter(angle, `Rewrite so this claim is safer: "${c.claim}"`)}>Rewrite claim</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {(verification?.unresolved || []).map((u, i) => <div key={i} className="badge warn" style={{ marginTop: 12 }}>{u}</div>)}
    </div>
  );

  const postPanel = !draft ? null : (
    <div>
      <div className="paper li">
        <div className="li-top">
          <div className="li-av">A</div>
          <div>
            <div style={{ fontWeight: 700 }}>{linkedin.connected ? linkedin.org : "Acme Systems"}</div>
            <div className="u-muted" style={{ fontSize: 12.5 }}>12,480 followers</div>
            <div className="u-muted" style={{ fontSize: 12.5 }}>Now · 🌐</div>
          </div>
        </div>
        <div className="li-body">
          {segments(full, { bold: [0, draft.hook.length], hl, fold: LI_FOLD })}
          {(draft.hashtags || []).length > 0 && <div style={{ color: "#3E63DD", marginTop: 10 }}>{draft.hashtags.join("  ")}</div>}
        </div>
        <AssetPreview format={format} formats={formats} assets={assets} media={media} />
        <div className="li-bar"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
      </div>

      <div className="paper" style={{ marginTop: 13, padding: 20 }} ref={editRef}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <span className="eyebrow">Edit</span>
          {versions.length > 1 && <button className="btn sm" onClick={() => setModal("diff")}>Compare versions</button>}
        </div>
        <input className="ta" value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} />
        <textarea className="ta" style={{ marginTop: 9 }} rows={7} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        <input className="ta" style={{ marginTop: 9 }} value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} />
        <div className={"u-muted " + (over ? "over" : "")} style={{ fontSize: 12.5, marginTop: 9 }}>
          {full.length.toLocaleString()} / {LI_LIMIT.toLocaleString()} characters{over ? " — over LinkedIn's limit" : ""} · the dashed line marks where "see more" cuts it off
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ paddingTop: 34 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="eyebrow">Working on</span>
            {fmt.list.map((f) => <span key={f} className="chipflat">{FORMAT_BY_ID[f].label}</span>)}
          </div>
          <div className="disp" style={{ fontSize: 30, marginTop: 8, maxWidth: 680 }}>{idea}</div>
        </div>
        <div className="row">
          {undoStack.length > 0 && <button className="btn sm" onClick={undo}>Undo</button>}
          <button className="btn sm" onClick={() => setDrawer("audit")}>Activity</button>
          {!["SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"].includes(stage) && (
            <button className="btn sm" onClick={cancelWork} title="Discard this draft">Cancel</button>
          )}
          <button className="btn sm" onClick={reset} title={["SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"].includes(stage) ? "Start another post" : "Saves this as a draft and starts another"}>New post</button>
        </div>
      </div>

      {steps.length > 0 && (
        <Section n={n("research")} title="Research" engine="Discovery engine">
          <div className="card">
            {steps.map((s) => (
              <div key={s.key} className={"pstep " + s.status}>
                <span className="tick">{s.status === "done" ? "✓" : s.status === "active" ? <span className="pulse" /> : "○"}</span>{s.label}
              </div>
            ))}
          </div>
          {research && (
            <>
              <div className="card">
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <div className="eyebrow">Sources</div><span className="badge">{research.freshness || "Recent"}</span>
                </div>
                {(research.sources || []).map((s, i) => (
                  <div className="src" key={i}>
                    <span className={"tier t" + (s.tier || 4)}>T{s.tier} · {tierLabel(s.tier)}</span>
                    <div style={{ minWidth: 0 }}>
                      {s.url ? <a className="srclink" href={s.url} target="_blank" rel="noreferrer">{s.title} <span className="ext">↗</span></a> : <div style={{ fontWeight: 600 }}>{s.title}</div>}
                      <div className="u-muted" style={{ fontSize: 13 }}>{s.publisher} · {s.date}{s.uploaded ? " · your upload" : s.url ? ` · ${host(s.url)}` : " · no link available"}</div>
                      <div className="u-muted" style={{ fontSize: 13, marginTop: 3 }}>{s.note}</div>
                    </div>
                  </div>
                ))}
                {research.degraded && (
                  <div className="badge warn" style={{ marginTop: 12 }}>
                    {research.degraded === "sample" ? "The engine didn't respond — these are placeholders, not real sources."
                      : research.degraded === "off" ? "Web search is off, so these are recalled rather than retrieved. Verify before publishing."
                      : "Live search didn't return usable results, so these are recalled rather than retrieved. Verify before publishing."}
                  </div>
                )}
              </div>
              <div className="card">
                <div className="eyebrow" style={{ marginBottom: 10 }}>What stood out</div>
                {(research.insights || []).map((x, i) => <div key={i} style={{ padding: "5px 0" }}>— {x}</div>)}
                {(research.risks || []).length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="eyebrow" style={{ marginBottom: 7 }}>Watch out for</div>
                    {research.risks.map((x, i) => <div key={i} className="u-muted" style={{ padding: "3px 0" }}>⚠ {x}</div>)}
                  </div>
                )}
              </div>
            </>
          )}
        </Section>
      )}

      {angles && shows("angle") && (
        <Section n={n("angle")} title="Content angles" engine="Content intelligence">
          <div className="angles">
            {(angles.angles || []).map((a, i) => (
              <button key={i} className={"angle " + (angle?.headline === a.headline ? "sel" : a.recommended ? "rec" : "")} onClick={() => runWriter(a)}>
                <div className="eyebrow">{a.recommended ? "Recommended · " : ""}{a.type}</div>
                <h4>{a.headline}</h4>
                <div className="u-muted" style={{ fontSize: 13 }}>{a.rationale}</div>
              </button>
            ))}
          </div>
          {angles.reason && <div className="card tight" style={{ marginTop: 13 }}><span className="eyebrow">Recommended because</span> <span style={{ fontSize: 14 }}>{angles.reason}</span></div>}
        </Section>
      )}


      {draft && shows("draft") && (
        <Section n={n("draft")} title="Content" engine="Brand writer">
          {narrow && (
            <div className="tabs" style={{ marginBottom: 14 }}>
              <button className={tab === "post" ? "on" : ""} onClick={() => setTab("post")}>Post</button>
              <button className={tab === "evidence" ? "on" : ""} onClick={() => setTab("evidence")}>
                Evidence{verification?.claims ? ` (${verification.claims.length})` : ""}
              </button>
              <button className={tab === "controls" ? "on" : ""} onClick={() => setTab("controls")}>Controls</button>
            </div>
          )}
          <div className="editor">
            {(!narrow || tab === "controls") && (
              <div>
                <Control label="Tone" value={tone} setValue={setTone} options={["Confident", "Conversational", "Technical", "Educational", "Opinionated"]} />
                <Control label="Point of view" value={pov} setValue={setPov} options={["Strong opinion", "Balanced", "Educational", "Storytelling"]} />
                <Control label="Length" value={length} setValue={setLength} options={["Short", "Medium", "Long"]} />
                <button className="btn" style={{ width: "100%" }} disabled={busy} onClick={() => runWriter(angle)}>{busy ? "Rewriting…" : "Rewrite text only"}</button>
                <button className="btn sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setModal("voice")}>Brand voice</button>
                <button className="btn sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setDrawer("versions")}>Versions ({versions.length})</button>
              </div>
            )}
            {(!narrow || tab === "post") && postPanel}
            {(!narrow || tab === "evidence") && shows("evidence") && evidencePanel}
          </div>
        </Section>
      )}

      {shows("poll") && draft && (
        <Section n={n("poll")} title="Poll" engine="Writer">
          <MediaSection {...mediaProps} format="poll" />
        </Section>
      )}

      {shows("article") && draft && (
        <Section n={n("article")} title="Article" engine="Writer">
          <MediaSection {...mediaProps} format="article" />
        </Section>
      )}

      {shows("slides") && draft && (
        <Section n={n("slides")} title="Slides" engine="Media engine">
          <MediaSection {...mediaProps} format="carousel" />
        </Section>
      )}

      {shows("media") && draft && format !== "text" && (
        <Section n={n("media")} title="Media" engine="Media engine">
          <MediaSection {...mediaProps} format={format} />
        </Section>
      )}

      {quality && shows("health") && (
        <Section n={n("health")} title="Content health" engine="Trust engine">
          <div className="card">
            {(quality.checks || []).map((c, i) => (
              <div key={i} className="chk"><span style={{ color: c.pass ? "var(--ok)" : "var(--bad)" }}>{c.pass ? "✓" : "✕"}</span><span>{c.label}</span></div>
            ))}
            <button className="btn sm" style={{ marginTop: 14 }} onClick={() => setShowDetail(!showDetail)}>{showDetail ? "Hide details" : "View details"}</button>
            {showDetail && quality.detail && (
              <div style={{ marginTop: 16 }}>
                {Object.entries(quality.detail).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 11 }}>
                    <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span style={{ textTransform: "capitalize" }}>{k}</span><span className="mono">{v}</span></div>
                    <div className="bar"><i style={{ width: `${v}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {(quality.slop || []).length > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 9 }}>Language to fix</div>
              {quality.slop.map((s, i) => <div key={i} style={{ padding: "3px 0" }}>— {s}</div>)}
              <button className="btn sm" style={{ marginTop: 11 }} onClick={() => runWriter(angle, `Remove this AI-sounding language: ${quality.slop.join("; ")}`)}>Rewrite more naturally</button>
            </div>
          )}
          {quality.duplicate?.similar && !dupDismissed && (
            <div className="card">
              <div className="badge warn">Similar to a post published {quality.duplicate.days} days ago</div>
              <div className="u-muted" style={{ marginTop: 7, fontSize: 13.5 }}>{quality.duplicate.title}</div>
              <div className="row" style={{ marginTop: 11 }}>
                <button className="btn sm" onClick={() => runWriter(angle, "Take a clearly different angle from previous posts")}>Create a new angle</button>
                <button className="btn sm" onClick={() => setDupDismissed(true)}>Continue anyway</button>
              </div>
            </div>
          )}
        </Section>
      )}

      {(quality || assets.article || assets.poll || assets.carousel.length > 0) && !["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING", "FAILED"].includes(stage) && (
        <Section n={n("approval")} title="Approval" engine="Human in the loop">
          <div className="card">
            <div className="eyebrow">Content status</div>
            <div style={{ margin: "12px 0 16px" }}>
              {claimsBlocking ? <span className="badge bad">Blocked — an unsupported claim needs fixing</span>
                : over ? <span className="badge bad">Blocked — the post is over LinkedIn's character limit</span>
                : <span className="badge">Ready for approval</span>}
            </div>
            <div className="chk"><span style={{ color: "var(--ok)" }}>✓</span> {(verification?.claims || []).length} claims checked</div>
            <div className="chk"><span style={{ color: "var(--ok)" }}>✓</span> {(research?.sources || []).filter((s) => s.tier <= 2).length} strong sources</div>
            <div className="chk"><span style={{ color: "var(--ok)" }}>✓</span> Brand voice applied</div>
            <div className="chk"><span style={{ color: missing.length ? "var(--bad)" : "var(--ok)" }}>{missing.length ? "✕" : "✓"}</span> {fmt.label}{assetSummary ? ` · ${assetSummary}` : ""}{missing.length ? ` — still missing: ${missing.map((f) => FORMAT_BY_ID[f].label.toLowerCase()).join(", ")}` : " ready"}</div>
            {formats.includes("carousel") && <div className="badge warn" style={{ marginTop: 12 }}>Carousel exports as slides — LinkedIn has no organic carousel API.</div>}
            {formats.includes("poll") && (assets.images.length || assets.video || assets.doc || assets.upload) ? <div className="badge warn" style={{ marginTop: 12 }}>LinkedIn shows a poll instead of an attached visual on the same post. Unison keeps both; check how it lands on the Page.</div> : null}
            {!linkedin.connected && (
              <div className="row" style={{ marginTop: 14 }}>
                <span className="badge warn">No Company Page connected</span>
                <button className="btn sm" onClick={() => setModal("linkedin")}>Connect now</button>
              </div>
            )}
            <div className="row" style={{ marginTop: 20 }}>
              <button className="btn" onClick={() => { setTab("post"); editRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Edit</button>
              {shows("draft") && <button className="btn" disabled={busy} onClick={() => runWriter(angle)}>Regenerate text</button>}
              <button className="btn" onClick={() => setRejecting(!rejecting)}>Reject</button>
              <button className="btn acc" disabled={claimsBlocking || over || busy} onClick={approve}>Approve &amp; schedule</button>
            </div>
            {rejecting && (
              <div style={{ marginTop: 16 }}>
                <div className="eyebrow" style={{ marginBottom: 9 }}>Why is this not right?</div>
                <div className="chips">{REJECT_REASONS.map((r) => <button key={r} className="chip" onClick={() => { setRejecting(false); reject(r); }}>{r}</button>)}</div>
              </div>
            )}
          </div>
        </Section>
      )}

      {["APPROVED", "SCHEDULED", "PUBLISHING", "FAILED"].includes(stage) && (
        <Section n={n("schedule")} title="Schedule" engine="Scheduler">
          <div className="card">
            {stage === "APPROVED" ? (
              <>
                <div className="row" style={{ gap: 16 }}>
                  <div><div className="eyebrow">Date</div><input className="ta" style={{ width: 170 }} type="date" value={schedule.date} onChange={(e) => setSchedule({ ...schedule, date: e.target.value })} /></div>
                  <div><div className="eyebrow">Time</div><input className="ta" style={{ width: 130 }} type="time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} /></div>
                  <div><div className="eyebrow">Timezone</div>
                    <select className="ta" style={{ width: 180 }} value={schedule.tz} onChange={(e) => setSchedule({ ...schedule, tz: e.target.value })}>
                      <option>Asia/Kolkata</option><option>America/New_York</option><option>Europe/London</option><option>Asia/Dubai</option>
                    </select>
                  </div>
                </div>
                <div className="card tight" style={{ marginTop: 16 }}>
                  <span className="eyebrow">Recommended · Tuesday 9:30 AM</span>
                  <div className="u-muted" style={{ fontSize: 13.5, marginTop: 5 }}>Your Page has historically seen more early-week engagement. You can override this.</div>
                </div>
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn acc" disabled={!linkedin.connected} onClick={confirmSchedule}>Schedule post</button>
                  {!linkedin.connected && <button className="btn sm" onClick={() => setModal("linkedin")}>Connect a Page first</button>}
                </div>
              </>
            ) : (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="mono" style={{ fontSize: 13 }}>{schedule.date} {schedule.time}</div>
                    <div className="u-muted" style={{ fontSize: 13 }}>{schedule.tz} · queued as a publishing job</div>
                  </div>
                  {stage === "SCHEDULED" && <button className="btn acc" onClick={publishNow}>Publish now</button>}
                  {stage === "PUBLISHING" && publishState !== "SENT" && (
                    <button className="btn acc" disabled><span className="pulse" style={{ marginRight: 8 }} />{publishState === "PREPARING" ? "Preparing…" : "Sending to Make…"}</button>
                  )}
                  {stage === "PUBLISHING" && publishState === "SENT" && <span className="badge">Sent to Make</span>}
                </div>

                {publishState === "SENT" && (
                  <div className="card tight" style={{ marginTop: 16 }}>
                    <b>Sent to Make — LinkedIn publishing is being processed.</b>
                    <div className="u-muted" style={{ marginTop: 5, fontSize: 13.5 }}>
                      {publishUnverified
                        ? "The post was sent, but this page can't read Make's reply, so Unison can't confirm it arrived. Check the scenario history before sending anything again."
                        : "Make has the post and is passing it to LinkedIn. Unison will only mark it Published when that is confirmed — either by Make's reply or by you after checking the Company Page."}
                    </div>
                    {publishLimits.length > 0 && publishLimits.map((l, i) => <div key={i} className="badge warn" style={{ marginTop: 10 }}>{l}</div>)}
                    <div className="row" style={{ marginTop: 12 }}>
                      {(() => { const rec = posts.find((x) => x.workId === workId && x.state === "SENT"); return rec ? <button className="btn sm" onClick={() => confirmPublished(rec, "manual")}>I've checked — it's live on LinkedIn</button> : null; })()}
                    </div>
                  </div>
                )}
                {attempts.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    {attempts.map((a, i) => (
                      <div key={i} className={"pstep " + (a.status === "pending" ? "active" : "done")}>
                        <span className="tick" style={{ color: a.status === "ok" ? "var(--accent)" : a.status === "pending" ? "var(--muted)" : "var(--bad)" }}>{a.status === "ok" ? "✓" : a.status === "pending" ? <span className="pulse" /> : "✕"}</span>{a.label}
                      </div>
                    ))}
                    <div className="u-muted mono" style={{ fontSize: 11.5, marginTop: 8 }}>idempotency key {attempts[0]?.idem}</div>
                  </div>
                )}
                {publishState === "FAILED" && (
                  <div className="card tight" style={{ marginTop: 16, borderColor: "rgba(255,122,102,.45)" }}>
                    <b>{publishKind === "sandbox" ? "Not sent from this preview." : publishVia === "make" ? "Unable to publish to LinkedIn." : "Publishing failed."}</b>
                    <div className="u-muted" style={{ marginTop: 5 }}>{publishError || "LinkedIn rejected the request."} Your draft and media are safe.</div>
                    {publishLimits.length > 0 && publishLimits.map((l, i) => <div key={i} className="badge warn" style={{ marginTop: 10 }}>{l}</div>)}
                    {publishKind === "sandbox" && (
                      <div className="u-muted" style={{ fontSize: 13, marginTop: 10 }}>
                        {publishFramed
                          ? "Unison is running inside a preview frame that only allows requests to its own host, and no publishing service is deployed behind it. Nothing reached Make, so no post was created and nothing is duplicated."
                          : "Something on this page or in the browser is blocking outside requests — a content security policy, an extension, or the network."}
                        {" Your draft, media and schedule are saved: reopen this post from Drafts on the deployed version and press Publish now."}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 12 }}>
                      {publishKind === "cors" ? (
                        <>
                          <button className="btn acc sm" onClick={sendAnyway} title="Sends this post once. The reply can't be read, so delivery is confirmed in Make, not here.">Send without confirmation</button>
                          <button className="btn sm" onClick={() => { setFailMode(false); publishNow(); }}>Retry</button>
                        </>
                      ) : (
                        <button className="btn sm" onClick={() => { setFailMode(false); publishNow(); }}>Retry</button>
                      )}
                      {publishKind === "sandbox" && (
                        <button className="btn sm" onClick={() => { const pl = getLastPayload(); if (pl) navigator.clipboard?.writeText(JSON.stringify(pl, null, 2)); }}>Copy payload for testing</button>
                      )}
                      {publishVia !== "make" && <button className="btn sm" onClick={() => setModal("linkedin")}>Reconnect LinkedIn</button>}
                      <button className="btn sm" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Edit draft</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>
      )}

      {["PUBLISHED", "ANALYZING"].includes(stage) && (
        <Section n={fmt.stages.length} title="Performance" engine="Learning engine">
          <div className="card">
            {publishState === "SIMULATED"
              ? <span className="badge warn">Simulated publish — nothing was sent to LinkedIn</span>
              : <span className="badge">Published to LinkedIn{linkedin.org ? ` · ${linkedin.org}` : ""}</span>}
            {publishVia === "make" && !analytics && (
              <div className="u-muted" style={{ marginTop: 14, fontSize: 13.5 }}>Performance figures aren't collected through the Make route. Check the post on your Company Page.</div>
            )}
            {publishVia !== "make" && !analytics && <div className="u-muted" style={{ marginTop: 14 }}><span className="pulse" /> Collecting analytics from LinkedIn…</div>}
            {analytics && (
              <>
                <div className="disp" style={{ fontSize: 30, margin: "18px 0 4px", maxWidth: 640 }}>{analytics.headline}</div>
                <div className="kpi">{Object.entries(analytics.metrics).map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{v.toLocaleString()}</b></div>)}</div>
                <div style={{ marginTop: 22 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Likely reasons</div>
                  {(analytics.why || []).map((w, i) => <div key={i} style={{ padding: "3px 0" }}>— {w}</div>)}
                </div>
                <div className="card tight" style={{ marginTop: 16 }}>
                  <div className="eyebrow" style={{ marginBottom: 5 }}>What next</div>
                  <div>{analytics.next}</div>
                  <button className="btn acc sm" style={{ marginTop: 12 }} onClick={() => runDiscovery(analytics.next, formats)}>Research this</button>
                </div>
              </>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

function EmptyWorkspace({ onCreate, drafts = 0, onDrafts }) {
  return (
    <div className="start">
      <div className="eyebrow">Nothing in progress</div>
      <h1 className="disp">No post open.</h1>
      <p className="u-muted" style={{ maxWidth: 460 }}>Start something new, pick a story from Discover{drafts ? `, or continue one of your ${drafts} drafts` : ""}.</p>
      <div className="row">
        <button className="btn acc" onClick={onCreate}>+ Create new content</button>
        {drafts > 0 && <button className="btn" onClick={onDrafts}>Open drafts</button>}
      </div>
    </div>
  );
}

function Section({ n, title, engine, children }) {
  return (
    <section className="sec">
      <div className="sec-h"><span className="num">{pad(n)}</span><h2 className="disp">{title}</h2><span className="eyebrow">{engine}</span></div>
      {children}
    </section>
  );
}

function Control({ label, value, setValue, options }) {
  return (
    <div className="ctrl">
      <span className="eyebrow">{label}</span>
      {options.map((o) => <button key={o} className={"opt " + (value === o ? "on" : "")} onClick={() => setValue(o)}>{o}</button>)}
    </div>
  );
}

/* ============================================================
   SECONDARY VIEWS
   ============================================================ */

const stateClass = (s) => (s === "PUBLISHED" ? "pub" : s === "HUMAN_REVIEW" ? "rev" : s === "SCHEDULED" || s === "SENT" ? "sch" : s === "FAILED" ? "fail" : "");
const stateLabel = (s) => (s === "SENT" ? "SENT TO MAKE" : s);

function ContentList({ posts, open }) {
  const [filter, setFilter] = useState("All");
  const shown = posts.filter((p) => filter === "All" || p.state === filter);
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Content</h2><span className="eyebrow">{shown.length} items</span></div>
      <div className="chips" style={{ marginBottom: 18 }}>
        {["All", "HUMAN_REVIEW", "SCHEDULED", "SENT", "PUBLISHED"].map((s) => (
          <button key={s} className={"chip " + (filter === s ? "on" : "")} onClick={() => setFilter(s)}>{s === "All" ? "All" : s === "SENT" ? "sent to make" : s.replace("_", " ").toLowerCase()}</button>
        ))}
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Post</th><th>State</th><th>Date</th><th></th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.title}<div className="u-muted mono" style={{ fontSize: 11, fontWeight: 400 }}>{p.id}</div></td>
                <td><span className={"state " + stateClass(p.state)}>{stateLabel(p.state)}</span></td>
                <td className="mono" style={{ fontSize: 13 }}>{p.date}</td>
                <td><button className="btn sm" onClick={() => open(p)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CalendarView({ posts, open, start }) {
  const days = [["Mon", "31 Aug", "2026-08-31"], ["Tue", "1 Sep", "2026-09-01"], ["Wed", "2 Sep", "2026-09-02"], ["Thu", "3 Sep", "2026-09-03"], ["Fri", "4 Sep", "2026-09-04"], ["Sat", "5 Sep", "2026-09-05"], ["Sun", "6 Sep", "2026-09-06"]];
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Calendar</h2><span className="eyebrow">Week of 31 August 2026</span></div>
      <div className="cal">
        {days.map(([d, label, iso]) => {
          const items = posts.filter((p) => p.date === iso);
          return (
            <div className="cell" key={iso}>
              <div className="d">{d} · {label}</div>
              {items.map((p) => <button className={"pill " + stateClass(p.state)} key={p.id} onClick={() => open(p)}>{p.title.slice(0, 40)}</button>)}
              {items.length > 1 && <div className="u-muted" style={{ fontSize: 11 }}>Two posts on one day</div>}
              <button className="addslot" onClick={() => start(`A post to publish on ${label}`)}>+ Add</button>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Click any post to open it, or use Add to start a new one for that day.</div>
        <div className="row">{["Draft", "Review", "Approved", "Scheduled", "Published", "Failed"].map((s) => <span key={s} className="state">{s}</span>)}</div>
      </div>
    </div>
  );
}

function Insights({ posts, analytics, discover }) {
  const top = posts.filter((p) => p.metrics)[0];
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Insights</h2><span className="eyebrow">Last 30 days</span></div>
      <div className="card">
        <span className="eyebrow">Engagement vs previous period</span>
        <div className="disp" style={{ fontSize: 62, marginTop: 10 }}>+24%</div>
        {top && (
          <>
            <div className="eyebrow" style={{ margin: "26px 0 6px" }}>Top post</div>
            <div style={{ fontWeight: 600 }}>{top.title}</div>
            <div className="kpi">{Object.entries(top.metrics).map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{v.toLocaleString()}</b></div>)}</div>
          </>
        )}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 7 }}>What the learning engine sees</div>
        <div>{analytics?.why?.[0] || "Evidence-led posts are outperforming your average. Treat this as a likely pattern, not a proven cause."}</div>
        <div className="eyebrow" style={{ margin: "16px 0 7px" }}>Next recommendation</div>
        <div>{analytics?.next || "Scan for this week's stories and pick one with an open content gap."}</div>
        <button className="btn acc" style={{ marginTop: 14 }} onClick={discover}>Find this week's opportunities</button>
      </div>
    </div>
  );
}

function PostDetail({ post, linkedin, cancel, confirm: confirmLive, start }) {
  const [confirm, setConfirm] = useState(false);
  const c = post.content;
  const full = c ? [c.hook, c.body, c.cta].filter(Boolean).join("\n\n") : "";
  const pages = post.pages || null;
  const [pi, setPi] = useState(0);
  const when = post.state === "SCHEDULED" ? `${post.date}${post.time ? ` at ${post.time}` : ""}${post.tz ? ` ${post.tz}` : ""}` : post.date;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span className={"state " + stateClass(post.state)}>{stateLabel(post.state)}</span>
        <span className="u-muted mono" style={{ fontSize: 12 }}>{post.reference ? `${post.reference}` : post.id} · {when}</span>
      </div>
      {post.topic && <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>Topic: {post.topic}{post.formats ? ` · ${labelFor(post.formats)}` : ""}</div>}

      {c ? (
        <div className="paper li" style={{ marginTop: 14 }}>
          <div className="li-top">
            <div className="li-av">A</div>
            <div>
              <div style={{ fontWeight: 700 }}>{linkedin?.connected ? linkedin.org : "Acme Systems"}</div>
              <div className="u-muted" style={{ fontSize: 12.5 }}>{post.state === "SCHEDULED" ? "Scheduled" : post.date} · 🌐</div>
            </div>
          </div>
          <div className="li-body">
            {segments(full, { bold: [0, (c.hook || "").length], hl: null, fold: 0 })}
            {(c.hashtags || []).length > 0 && <div style={{ color: "#3E63DD", marginTop: 10 }}>{c.hashtags.join("  ")}</div>}
          </div>
          {post.upload ? <div className="li-visual"><img src={post.upload} alt="" /></div>
            : post.images?.length > 1 ? <div className={"li-mosaic n" + Math.min(4, post.images.length)}>{post.images.slice(0, 4).map((sv, k) => <img key={k} src={svgDataUrl(sv)} alt="" />)}</div>
            : post.image ? <div className="li-visual"><img src={svgDataUrl(post.image)} alt="" /></div>
            : pages?.length ? (
              <div className="li-visual li-doc">
                <img src={svgDataUrl(pages[Math.min(pi, pages.length - 1)])} alt="" />
                <div className="li-pager">
                  <button onClick={() => setPi(Math.max(0, pi - 1))} disabled={pi === 0}>←</button>
                  <span>{Math.min(pi, pages.length - 1) + 1} / {pages.length}</span>
                  <button onClick={() => setPi(Math.min(pages.length - 1, pi + 1))} disabled={pi >= pages.length - 1}>→</button>
                </div>
              </div>
            ) : null}
          {post.poll && (
            <div className="li-poll">
              <div style={{ fontWeight: 600, marginBottom: 10 }}>{post.poll.question}</div>
              {(post.poll.options || []).filter(Boolean).map((o, k) => <div className="li-opt" key={k}>{o}</div>)}
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>{post.poll.duration}</div>
            </div>
          )}
          <div className="li-bar"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
        </div>
      ) : (
        <>
          <div className="disp" style={{ fontSize: 26, margin: "14px 0 6px" }}>{post.title}</div>
          <div className="u-muted" style={{ marginTop: 10, fontSize: 13.5 }}>
            {post.state === "HUMAN_REVIEW" ? "Waiting on a reviewer."
              : "The full text of this post wasn't stored — it was created before Unison kept post content."}
          </div>
        </>
      )}

      {post.metrics && (
        <div className="kpi">{Object.entries(post.metrics).map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{v.toLocaleString()}</b></div>)}</div>
      )}
      {post.url && <a className="srclink" href={post.url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 14 }}>View on LinkedIn <span className="ext">↗</span></a>}
      {post.viaMake && (
        <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>
          {post.state === "SENT" ? (post.unverified ? "Sent to Make, but delivery couldn't be confirmed from the browser. Check the scenario history." : "Sent to Make — LinkedIn publishing is being processed. Not yet confirmed as published.") : `Published via Make${post.confirmedBy === "manual" ? " (confirmed by you)" : ""}.`}
          {` Sent as ${post.postType}${post.mediaSent ? ` with ${post.mediaSent} media file(s)` : ""}.`}
          {(post.limits || []).map((l, i) => <div key={i} className="badge warn" style={{ marginTop: 8 }}>{l}</div>)}
        </div>
      )}
      {post.simulated && <div className="badge warn" style={{ marginTop: 14 }}>Simulated publish — nothing was sent to LinkedIn</div>}

      <div className="row" style={{ marginTop: 20, flexWrap: "wrap" }}>
        {post.state === "SCHEDULED" && !confirm && <button className="btn" onClick={() => setConfirm(true)}>Cancel scheduled post</button>}
        {post.state === "SCHEDULED" && confirm && (
          <>
            <span className="u-muted" style={{ fontSize: 13.5 }}>It won't be published at {post.time || "the scheduled time"}.</span>
            <button className="btn bad" onClick={() => cancel(post)}>Yes, cancel it</button>
            <button className="btn sm" onClick={() => setConfirm(false)}>Keep it scheduled</button>
          </>
        )}
        {post.state === "SENT" && <button className="btn acc" onClick={() => confirmLive(post, "manual")}>I've checked — it's live on LinkedIn</button>}
        {post.state === "HUMAN_REVIEW" && <button className="btn acc" onClick={() => start(post.title)}>Work on this topic</button>}
        {post.state === "PUBLISHED" && c && <button className="btn sm" onClick={() => navigator.clipboard?.writeText(full + ((c.hashtags || []).length ? "\n\n" + c.hashtags.join(" ") : ""))}>Copy text</button>}
      </div>
    </div>
  );
}

/* ============================================================
   MODALS
   ============================================================ */

function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={"modal " + (wide ? "wide" : "")}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
          <div className="disp" style={{ fontSize: 25 }}>{title}</div>
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </>
  );
}

function DiffView({ versions }) {
  const [a, setA] = useState(Math.max(0, versions.length - 2));
  const [b, setB] = useState(versions.length - 1);
  const va = versions[a]?.snapshot, vb = versions[b]?.snapshot;
  const parts = useMemo(() => (va && vb ? diffWords(`${va.hook}\n\n${va.body}\n\n${va.cta}`, `${vb.hook}\n\n${vb.body}\n\n${vb.cta}`) : []), [va, vb]);
  const changed = parts.filter((p) => p.t !== "same").length;
  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <select className="ta" style={{ width: 190 }} value={a} onChange={(e) => setA(+e.target.value)}>
          {versions.map((v, i) => <option key={i} value={i}>Version {v.n} — {v.label}</option>)}
        </select>
        <span className="u-muted">compared with</span>
        <select className="ta" style={{ width: 190 }} value={b} onChange={(e) => setB(+e.target.value)}>
          {versions.map((v, i) => <option key={i} value={i}>Version {v.n} — {v.label}</option>)}
        </select>
      </div>
      <div className="u-muted" style={{ fontSize: 13, marginBottom: 12 }}>{changed} word{changed === 1 ? "" : "s"} changed.</div>
      <div className="diff">
        {parts.map((p, i) => <span key={i} className={p.t}>{p.w}</span>)}
      </div>
    </div>
  );
}

/* Prototype-only Pages. Real mode never renders these — organizations come
   from LinkedIn via the Unison API. */
const PROTOTYPE_ORGS = [
  { urn: "urn:li:organization:2841193", name: "Acme Systems", role: "ADMINISTRATOR", followers: 12480, canPublish: true },
  { urn: "urn:li:organization:9920117", name: "Acme Labs", role: "CONTENT_ADMIN", followers: 3204, canPublish: true },
  { urn: "urn:li:organization:5510882", name: "Acme Ventures", role: "ANALYST", followers: 890, canPublish: false },
];

/* One component, two truths: a real OAuth handoff when the integration is
   configured, and a clearly-labelled prototype path when it is not. */
function LinkedInFlow({ onDone, startAt = 0, mode, connection, scopes }) {
  const real = mode === "real";
  const authorized = connection?.status === "authorized" || connection?.status === "connected";
  const [step, setStep] = useState(real && authorized ? 1 : startAt);
  const [pick, setPick] = useState(null);
  const [orgs, setOrgs] = useState(real ? null : PROTOTYPE_ORGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scan, setScan] = useState(false);

  /* Real Pages are fetched, never assumed. */
  useEffect(() => {
    if (!real || step !== 1 || orgs) return;
    let alive = true;
    setBusy(true); setError(null);
    linkedinService.organizations()
      .then((r) => { if (alive) setOrgs(r.organizations || []); })
      .catch((e) => { if (alive) setError(e.status === 403
        ? "LinkedIn refused the organization lookup. The app may not have Community Management API access yet."
        : e.message || "Could not load your Pages."); })
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [real, step, orgs]);

  useEffect(() => {
    if (!real && step === 2) { setScan(true); const t = setTimeout(() => setScan(false), 1100); return () => clearTimeout(t); }
  }, [step, real]);

  const banner = real
    ? <div className="badge" style={{ marginBottom: 18 }}>Real LinkedIn authorization</div>
    : <div className="badge warn" style={{ marginBottom: 18 }}>
        Prototype connection — publishing is simulated until real LinkedIn authorization is configured
      </div>;

  /* ---- step 0: start ---- */
  if (step === 0) {
    return (
      <div>
        {banner}
        {real ? (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Connect your LinkedIn Company Page</div>
            <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
              You'll be taken to LinkedIn to sign in and approve access. Unison never sees your LinkedIn password.
            </div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Unison will ask for</div>
            {[["Publish to your Page", "Create and manage organic posts on Pages you administer"],
              ["Read your Page content", "Show published posts and their performance in Unison"],
              ["See which Pages you manage", "List the Pages you can choose from"]].map(([t, d]) => (
              <div className="scope" key={t}><span style={{ fontWeight: 600 }}>{t}</span><span className="u-muted">{d}</span></div>
            ))}
            {scopes?.length > 0 && <div className="u-muted mono" style={{ fontSize: 11, marginTop: 10 }}>{scopes.join("  ")}</div>}
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn acc" onClick={() => { setStep(-2); linkedinService.beginAuthorization(); }}>Continue to LinkedIn</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Real authorization isn't configured</div>
            <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
              The Unison API isn't running with LinkedIn credentials, so this connects a prototype Page.
              Nothing is sent to LinkedIn and no post will appear there.
            </div>
            <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 16 }}>
              To enable real publishing: create a LinkedIn developer app, request Community Management API access,
              add the credentials to the server environment, then reconnect. See docs/linkedin-integration.md.
            </div>
            <div className="row">
              <button className="btn" onClick={() => setStep(1)}>Continue in prototype mode</button>
            </div>
          </>
        )}
      </div>
    );
  }

  /* ---- leaving for LinkedIn ---- */
  if (step === -2) {
    return <div>{banner}<div className="pstep active"><span className="tick"><span className="pulse" /></span>Redirecting you to LinkedIn…</div></div>;
  }

  /* ---- step 1: choose a Page ---- */
  if (step === 1) {
    return (
      <div>
        {banner}
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          {real ? "Pages you can publish to" : "Prototype Pages"}
        </div>
        {busy && <div className="pstep active"><span className="tick"><span className="pulse" /></span>Loading your Pages from LinkedIn…</div>}
        {error && (
          <div className="badge bad" style={{ marginBottom: 12 }}>
            {error}
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setOrgs(null)}>Retry</button>
          </div>
        )}
        {orgs?.length === 0 && !busy && (
          <div className="u-muted" style={{ fontSize: 13.5 }}>
            LinkedIn returned no Pages for this account. You need an admin role on a Company Page.
          </div>
        )}
        {(orgs || []).map((o) => (
          <button key={o.urn} className={"orgrow " + (pick?.urn === o.urn ? "on" : "")} onClick={() => setPick(o)} disabled={!o.canPublish}>
            <span className="li-chip">in</span>
            <span style={{ textAlign: "left", minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{o.name}</div>
              <div className="u-muted mono" style={{ fontSize: 11 }}>{o.urn}</div>
            </span>
            <span className="u-muted" style={{ fontSize: 12.5, marginLeft: "auto", textAlign: "right" }}>
              {o.followers != null && <div>{Number(o.followers).toLocaleString()} followers</div>}
              <div>{o.canPublish ? "✓ Can publish" : "Cannot publish"}</div>
            </span>
          </button>
        ))}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn acc" disabled={!pick || busy} onClick={() => (real ? onDone(pick) : setStep(2))}>Continue</button>
          {!real && <button className="btn" onClick={() => setStep(0)}>Back</button>}
        </div>
      </div>
    );
  }

  /* ---- step 2: prototype confirmation only ---- */
  return (
    <div>
      {banner}
      <div className="eyebrow" style={{ marginBottom: 12 }}>Preparing {pick?.name}</div>
      {[["Page role", pick?.role], ["Publishing", pick?.canPublish ? "allowed" : "not allowed"], ["Credentials", "none — nothing was sent to LinkedIn"]].map(([k, v]) => (
        <div className="pstep done" key={k} style={{ opacity: scan ? .4 : 1 }}>
          <span className="tick">{scan ? <span className="pulse" /> : "✓"}</span>{k} — <span className="u-muted">&nbsp;{v}</span>
        </div>
      ))}
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn acc" disabled={scan} onClick={() => onDone(pick)}>Finish</button>
      </div>
    </div>
  );
}

/* ---------- brand voice ---------- */

const VOICE_DIMS = [
  ["professional", "Professional", "Casual", "Formal"],
  ["conversational", "Conversational", "Distant", "Direct address"],
  ["technical", "Technical depth", "Plain", "Specialist"],
  ["opinionated", "Opinion strength", "Neutral", "Takes a side"],
  ["humour", "Humour", "None", "Dry wit"],
  ["emoji", "Emoji", "Never", "Frequent"],
];

function VoiceStudio({ voice, setVoice, track }) {
  const [tab, setTab] = useState("dimensions");
  const [newAvoid, setNewAvoid] = useState("");
  const [newPrefer, setNewPrefer] = useState("");
  const [sample, setSample] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setVoice({ ...voice, [k]: v });

  const summary = useMemo(() => {
    const b = [];
    b.push(voice.professional > 65 ? "Formal register" : voice.professional < 35 ? "Casual register" : "Neutral register");
    b.push(voice.opinionated > 65 ? "takes a clear position" : voice.opinionated < 35 ? "stays neutral" : "argues carefully");
    b.push(voice.technical > 60 ? "assumes domain knowledge" : "explains in plain terms");
    b.push(voice.emoji < 20 ? "no emoji" : "occasional emoji");
    return b.join(", ") + ".";
  }, [voice]);

  async function draftSample() {
    setBusy(true);
    const r = await askJSON({
      system: `You write brand voice samples. ${JSON_RULE}`,
      user: `Write two opening lines for a LinkedIn post about improving a support workflow, in this voice:
professional ${voice.professional}, conversational ${voice.conversational}, technical ${voice.technical}, opinionated ${voice.opinionated}, humour ${voice.humour}, emoji ${voice.emoji}.
Never use: ${voice.avoid.join(", ")}. Prefer: ${voice.prefer.join(", ")}.
{"lines":["",""]}`,
      fallback: () => ({ lines: ["Most support backlogs are not a staffing problem.", "We cut first-response time by rewriting one workflow, not by hiring."] }),
      track: track("Brand writer"),
    });
    setSample(r.lines); setBusy(false);
  }

  async function learnFrom(source) {
    setBusy(true);
    const r = await askJSON({
      system: `You infer a brand voice profile. ${JSON_RULE}`,
      user: `Infer a voice profile for a B2B enterprise software company from its ${source}. Return 0-100 scores.
{"professional":0,"conversational":0,"technical":0,"opinionated":0,"humour":0,"emoji":0,"avoid":["word"],"prefer":["word"]}`,
      fallback: () => ({ professional: 74, conversational: 58, technical: 62, opinionated: 70, humour: 14, emoji: 5, avoid: ["revolutionary", "seamless"], prefer: ["measurable", "workflow"] }),
      track: track("Brand writer"),
    });
    setVoice({ ...voice, ...r, avoid: [...new Set([...voice.avoid, ...(r.avoid || [])])], prefer: [...new Set([...voice.prefer, ...(r.prefer || [])])] });
    setBusy(false);
  }

  return (
    <div>
      <div className="tabs">
        {[["dimensions", "Dimensions"], ["vocabulary", "Vocabulary"], ["format", "Format"], ["learn", "Learn"]].map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="vgrid">
        <div>
          {tab === "dimensions" && VOICE_DIMS.map(([k, label, lo, hi]) => (
            <div className="dim" key={k}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
                <span className="mono u-muted" style={{ fontSize: 12 }}>{voice[k]}</span>
              </div>
              <input type="range" min="0" max="100" value={voice[k]} onChange={(e) => set(k, +e.target.value)} />
              <div className="row" style={{ justifyContent: "space-between" }}><span className="eyebrow">{lo}</span><span className="eyebrow">{hi}</span></div>
            </div>
          ))}
          {tab === "vocabulary" && (
            <>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Never use</div>
              <div className="tagrow">
                {voice.avoid.map((w) => <span className="tag" key={w}>{w}<button onClick={() => set("avoid", voice.avoid.filter((x) => x !== w))}>×</button></span>)}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <input className="ta" style={{ flex: 1 }} placeholder="Add a word or phrase" value={newAvoid} onChange={(e) => setNewAvoid(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newAvoid.trim()) { set("avoid", [...voice.avoid, newAvoid.trim()]); setNewAvoid(""); } }} />
                <button className="btn sm" onClick={() => { if (newAvoid.trim()) { set("avoid", [...voice.avoid, newAvoid.trim()]); setNewAvoid(""); } }}>Add</button>
              </div>
              <div className="eyebrow" style={{ margin: "24px 0 8px" }}>Prefer</div>
              <div className="tagrow">
                {voice.prefer.map((w) => <span className="tag ok" key={w}>{w}<button onClick={() => set("prefer", voice.prefer.filter((x) => x !== w))}>×</button></span>)}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <input className="ta" style={{ flex: 1 }} placeholder="Add a preferred term" value={newPrefer} onChange={(e) => setNewPrefer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newPrefer.trim()) { set("prefer", [...voice.prefer, newPrefer.trim()]); setNewPrefer(""); } }} />
                <button className="btn sm" onClick={() => { if (newPrefer.trim()) { set("prefer", [...voice.prefer, newPrefer.trim()]); setNewPrefer(""); } }}>Add</button>
              </div>
            </>
          )}
          {tab === "format" && [["cta", "Call to action", ["Question-based", "Direct", "Soft", "None"]],
            ["paragraphs", "Paragraph length", ["Short", "Medium", "Long"]],
            ["hashtags", "Hashtags", ["None", "1–2", "2–3", "4+"]]].map(([k, label, opts]) => (
            <div key={k} style={{ marginBottom: 22 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
              <div className="row">{opts.map((o) => <button key={o} className={"chip " + (voice[k] === o ? "on" : "")} onClick={() => set(k, o)}>{o}</button>)}</div>
            </div>
          ))}
          {tab === "learn" && (
            <>
              <div className="u-muted" style={{ fontSize: 14, marginBottom: 16 }}>Infer the profile instead of setting it by hand. Each option runs the writer engine and overwrites the sliders.</div>
              {[["approved posts", "Your last 20 approved posts"], ["brand guidelines document", "An uploaded brand guidelines PDF"], ["public website copy", "Your website and product pages"]].map(([src, label]) => (
                <button key={src} className="opt" disabled={busy} onClick={() => learnFrom(src)}>{busy ? "Reading…" : label}</button>
              ))}
            </>
          )}
        </div>
        <div className="vpreview">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Profile summary</div>
          <div style={{ fontSize: 14.5, marginBottom: 18 }}>{summary}</div>
          <div className="vbars">
            {VOICE_DIMS.map(([k, label]) => (
              <div key={k}>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}><span className="u-muted">{label}</span><span className="mono">{voice[k]}</span></div>
                <div className="bar"><i style={{ width: `${voice[k]}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="eyebrow" style={{ margin: "22px 0 8px" }}>Sounds like</div>
          {sample ? sample.map((l, i) => <div key={i} className="samp">{l}</div>) : <div className="u-muted" style={{ fontSize: 13.5 }}>Draft a sample to hear it.</div>}
          <button className="btn sm" style={{ marginTop: 12 }} disabled={busy} onClick={draftSample}>{busy ? "Writing…" : "Draft a sample line"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- settings ---------- */

const IN_RATE = 3 / 1e6, OUT_RATE = 15 / 1e6;
const CALL_QUOTA = 60, SEARCH_QUOTA = 25;

function Settings({ usage, linkedin, liMeta, relay, disconnectLinkedIn, openLinkedIn, setModal, searchOn, setSearchOn, failMode, setFailMode, makeCompany, setMakeCompany, team, setTeam, theme, setTheme, schedule, setSchedule, notes, setNotes, notify, profile, setProfile, wipe, bg3d, setBg3d, initialTab }) {
  const [tab, setTab] = useState(initialTab || "models");
  const [invite, setInvite] = useState({ email: "", role: "Creator" });
  const cost = usage.inTok * IN_RATE + usage.outTok * OUT_RATE;
  return (
    <div>
      <div className="tabs">
        {[["models", "AI & usage"], ["connections", "Connections"], ["workspace", "Workspace"], ["publishing", "Publishing"], ["dev", "Developer"]].map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "models" && (
        <>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Routing</div><div className="u-muted" style={{ fontSize: 13 }}>Chosen automatically per task. Details under Developer.</div></div>
            <span className="chipflat">{AI_STATUS.local === "reachable" ? "Local models" : "Hosted fallback"}</span>
          </div>
          <div className="quads">
            {[["Calls", usage.calls], ["Searches", usage.searches], ["Input tokens", usage.inTok.toLocaleString()], ["Output tokens", usage.outTok.toLocaleString()]].map(([l, v]) => (
              <div key={l}><span className="eyebrow">{l}</span><b>{v}</b></div>
            ))}
          </div>
          <div style={{ marginTop: 22 }}>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>Session call quota</span><span className="mono">{usage.calls} / {CALL_QUOTA}</span></div>
            <div className="bar"><i style={{ width: `${Math.min(100, (usage.calls / CALL_QUOTA) * 100)}%` }} /></div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginTop: 14 }}><span>Web search quota</span><span className="mono">{usage.searches} / {SEARCH_QUOTA}</span></div>
            <div className="bar"><i style={{ width: `${Math.min(100, (usage.searches / SEARCH_QUOTA) * 100)}%` }} /></div>
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Estimated spend: ${cost.toFixed(4)} · {usage.fails} call{usage.fails === 1 ? "" : "s"} fell back to sample data · research is cached per topic, so repeating one is free.
            </div>
          </div>
          <div className="eyebrow" style={{ margin: "26px 0 10px" }}>By engine</div>
          <table className="tbl">
            <thead><tr><th>Engine</th><th>Calls</th><th>In</th><th>Out</th><th>Cost</th></tr></thead>
            <tbody>
              {Object.keys(usage.byEngine).length === 0 && <tr><td colSpan={5} className="u-muted">No calls yet.</td></tr>}
              {Object.entries(usage.byEngine).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td><td className="mono">{v.calls}</td><td className="mono">{v.inTok.toLocaleString()}</td>
                  <td className="mono">{v.outTok.toLocaleString()}</td><td className="mono">${(v.inTok * IN_RATE + v.outTok * OUT_RATE).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === "connections" && (
        <>
          <div className="conn">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 11 }}>
                <span className="li-chip">in</span>
                <div>
                  <div style={{ fontWeight: 600 }}>LinkedIn Company Page</div>
                  <div className="u-muted" style={{ fontSize: 13 }}>
                    {linkedin.viaWorkflow ? `LinkedIn publishing ready via Make · ${MAKE_CONFIG.supportedPostTypes.join(", ")}`
                      : linkedin.connected
                      ? `${linkedin.org}${linkedin.role ? " · " + linkedin.role : ""}${linkedin.expires ? " · access to " + linkedin.expires : ""}`
                      : "Not connected — publishing is blocked"}
                  </div>
                </div>
              </div>
              {linkedin.viaWorkflow ? null
                : linkedin.connected
                ? <button className="btn sm" onClick={disconnectLinkedIn}>Disconnect</button>
                : <button className="btn acc sm" onClick={() => openLinkedIn(0)}>Connect</button>}
            </div>
            <div className="setrow">
              <span className="u-muted">Authorization</span>
              <span className={"state " + (liMeta.mode === "real" || linkedin.viaWorkflow ? "pub" : "rev")}>
                {liMeta.mode === "real" ? "REAL OAUTH" : linkedin.viaWorkflow ? "MAKE WEBHOOK" : liMeta.mode === "misconfigured" ? "MISCONFIGURED" : "PROTOTYPE"}
              </span>
            </div>
            {linkedin.viaWorkflow && (
              <>
                <div className="setrow"><span className="u-muted">Publishing via</span><span>Unison API → LinkedIn workflow → Company Page</span></div>
                <div className="setrow">
                  <span className="u-muted">Publishing service</span>
                  <span>{relay?.relay ? `Connected${relay.webhookConfigured === false ? " · webhook not set on the server" : ""}` : relay?.checked ? "Not reachable from this preview" : "Checking…"}</span>
                </div>
                <div className="setrow"><span className="u-muted">Endpoint</span><span className="mono" style={{ fontSize: 11.5 }}>{PUBLISH_RELAY_PATH}</span></div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600 }}>Company Page details</div>
                  <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Sent with every post. Make still decides which Page it publishes to.</div>
                  <div className="row">
                    <input className="ta" style={{ flex: 1 }} placeholder="Page name" value={makeCompany.name} onChange={(e) => setMakeCompany({ ...makeCompany, name: e.target.value })} />
                    <input className="ta mono" style={{ flex: 1 }} placeholder="urn:li:organization:…" value={makeCompany.urn} onChange={(e) => setMakeCompany({ ...makeCompany, urn: e.target.value })} />
                  </div>
                </div>
              </>
            )}
            <div className="setrow">
              <span className="u-muted">Unison API</span>
              <span>{liMeta.reachable ? "Reachable" : "Not running"}</span>
            </div>
            {liMeta.apiVersion && (
              <div className="setrow"><span className="u-muted">LinkedIn API version</span><span className="mono">{liMeta.apiVersion}</span></div>
            )}
            {liMeta.scopes?.length > 0 && (
              <div className="u-muted mono" style={{ fontSize: 11.5, marginTop: 8 }}>{liMeta.scopes.join("   ")}</div>
            )}
            {liMeta.mode !== "real" && !linkedin.viaWorkflow && (
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                Real authorization needs the Unison API running with LinkedIn credentials and Community Management API access. See docs/linkedin-integration.md.
              </div>
            )}
          </div>

          <div className="conn">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Web search</div>
                <div className="u-muted" style={{ fontSize: 13 }}>Powers discovery and every source link. {usage.searches} used.</div>
              </div>
              <button className={"toggle " + (searchOn ? "on" : "")} onClick={() => setSearchOn(!searchOn)}><i /></button>
            </div>
          </div>
          <div className="conn">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Typefaces</div>
            <div className="u-muted" style={{ fontSize: 13, marginBottom: 10 }}>Google Fonts. Free, no key, falls back to system faces offline.</div>
            {[["Sora", "Display and headings"], ["Inter Tight", "Interface and body"], ["IBM Plex Mono", "Labels, numbers, identifiers"]].map(([f, use]) => (
              <div className="setrow" key={f}><div><span style={{ fontWeight: 600 }}>{f}</span><div className="u-muted" style={{ fontSize: 12.5 }}>{use}</div></div><span className="chipflat">loaded</span></div>
            ))}
          </div>
          <div className="conn">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Not connected here</div>
            <div className="u-muted" style={{ fontSize: 13 }}>
              No database, object store, job queue or image model. LinkedIn has no free public API for trending content and scraping breaks their terms, so discovery uses public web search instead. Publishing and analytics are simulated in the browser.
            </div>
          </div>
        </>
      )}

      {tab === "workspace" && (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>What discovery watches</div>
          {[["industry", "Industry"], ["audience", "Audience"], ["keywords", "Watch terms"]].map(([k, l]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{l}</div>
              <input className="ta" value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
            </div>
          ))}
          <table className="tbl" style={{ marginTop: 20 }}>
            <thead><tr><th>Member</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {team.map((m, i) => (
                <tr key={m.email}>
                  <td><div style={{ fontWeight: 600 }}>{m.name}</div><div className="u-muted" style={{ fontSize: 12.5 }}>{m.email}</div></td>
                  <td>
                    <select className="ta" style={{ width: 130 }} value={m.role} disabled={m.role === "Owner"}
                      onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                      {["Owner", "Admin", "Creator", "Reviewer"].map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>{m.role !== "Owner" && <button className="btn sm" onClick={() => setTeam(team.filter((_, j) => j !== i))}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="eyebrow" style={{ margin: "22px 0 8px" }}>Invite someone</div>
          <div className="row">
            <input className="ta" style={{ flex: 1, minWidth: 200 }} placeholder="name@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            <select className="ta" style={{ width: 130 }} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              {["Admin", "Creator", "Reviewer"].map((r) => <option key={r}>{r}</option>)}
            </select>
            <button className="btn acc sm" disabled={!invite.email.includes("@")} onClick={() => {
              setTeam([...team, { name: invite.email.split("@")[0], email: invite.email, role: invite.role }]);
              notify(`Invite sent to ${invite.email}.`); setInvite({ email: "", role: "Creator" });
            }}>Send invite</button>
          </div>
          <div className="conn" style={{ marginTop: 22 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>What each role can do</div>
            {[["Owner", "Everything, including billing"], ["Admin", "Settings, connections, team"], ["Creator", "Create and edit, cannot approve"], ["Reviewer", "Approve, reject, schedule"]].map(([r, d]) => (
              <div className="setrow" key={r}><span style={{ fontWeight: 600 }}>{r}</span><span className="u-muted" style={{ fontSize: 13 }}>{d}</span></div>
            ))}
          </div>
        </>
      )}

      {tab === "dev" && (
        <>
          <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
            Nothing on this tab appears in the creation workflow. Users never pick a model.
          </div>
          <div className="conn">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Local model endpoint</div>
                <div className="u-muted" style={{ fontSize: 13 }}>Ollama. Probed once per session.</div>
              </div>
              <span className={"chipflat " + (AI_STATUS.local === "reachable" ? "" : "")}>{AI_STATUS.local}</span>
            </div>
            <input className="ta" style={{ marginTop: 10 }} defaultValue={AI_CONFIG.ollamaEndpoint}
              onChange={(e) => { AI_CONFIG.ollamaEndpoint = e.target.value; ollamaProvider.reset(); }} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={async () => { ollamaProvider.reset(); const ok = await ollamaProvider.available(); notify(ok ? "Local models reachable." : "Local models unreachable — using the hosted fallback."); }}>
                Re-probe
              </button>
              {AI_STATUS.localModels.length > 0 && <span className="u-muted mono" style={{ fontSize: 11.5 }}>{AI_STATUS.localModels.slice(0, 4).join("  ")}</span>}
            </div>
            {AI_STATUS.local === "unreachable" && (
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                Browser sandboxes can't reach localhost. Run this build from your own machine to use the local models.
              </div>
            )}
          </div>

          <div className="eyebrow" style={{ margin: "20px 0 10px" }}>Capability routing</div>
          <table className="tbl">
            <thead><tr><th>Capability</th><th>Intended</th><th>Actually used</th></tr></thead>
            <tbody>
              {Object.entries(MODEL_REGISTRY).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="u-muted">{v.label}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{AI_STATUS.routed[k] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="conn" style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Media providers</div>
            {[["Image", imageProvider], ["Video", videoProvider]].map(([n, pv]) => (
              <div className="setrow" key={n}>
                <div><span style={{ fontWeight: 600 }}>{n}</span><div className="u-muted" style={{ fontSize: 12.5 }}>{pv.label}</div></div>
                <span className="chipflat">{pv.configured ? "provider" : "prototype"}</span>
              </div>
            ))}
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              No external image or video model is configured. Assets are rendered locally and labelled as such.
            </div>
          </div>
        </>
      )}

      {tab === "publishing" && (
        <>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Default timezone</div><div className="u-muted" style={{ fontSize: 13 }}>Stored with every scheduled post.</div></div>
            <select className="ta" style={{ width: 180 }} value={schedule.tz} onChange={(e) => setSchedule({ ...schedule, tz: e.target.value })}>
              <option>Asia/Kolkata</option><option>America/New_York</option><option>Europe/London</option><option>Asia/Dubai</option>
            </select>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Retry policy</div><div className="u-muted" style={{ fontSize: 13 }}>Applied to failed publishing jobs.</div></div>
            <span className="chipflat">manual retry only · nothing is resent automatically</span>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Approval required before publishing</div><div className="u-muted" style={{ fontSize: 13 }}>Locked on in the MVP.</div></div>
            <button className="toggle on" disabled><i /></button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Simulate a publishing failure</div><div className="u-muted" style={{ fontSize: 13 }}>The next publish fails before anything is sent to Make. For testing the failure UI.</div></div>
            <button className={"toggle " + (failMode ? "on" : "")} onClick={() => setFailMode(!failMode)}><i /></button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Appearance</div><div className="u-muted" style={{ fontSize: 13 }}>Currently {theme}.</div></div>
            <button className="btn sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Switch to {theme === "dark" ? "light" : "dark"}</button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Notifications</div><div className="u-muted" style={{ fontSize: 13 }}>{notes.length} unread.</div></div>
            <button className="btn sm" onClick={() => setNotes([])}>Clear all</button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Background 3D</div><div className="u-muted" style={{ fontSize: 13 }}>The scroll-driven pipeline scene. Turn it off on slower machines.</div></div>
            <button className={"toggle " + (bg3d ? "on" : "")} onClick={() => setBg3d(!bg3d)}><i /></button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Saved session</div><div className="u-muted" style={{ fontSize: 13 }}>Your draft, sources and settings are saved and survive a refresh.</div></div>
            <button className="btn sm" onClick={wipe}>Clear saved data</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- drawers ---------- */

function SourcesPanel({ research }) {
  if (!research) return <p className="u-muted">No research yet. Start a post and sources will collect here.</p>;
  return (
    <div>
      {(research.sources || []).map((s, i) => (
        <div className="src" key={i}>
          <span className={"tier t" + (s.tier || 4)}>T{s.tier}</span>
          <div style={{ minWidth: 0 }}>
            {s.url ? <a className="srclink" href={s.url} target="_blank" rel="noreferrer">{s.title} <span className="ext">↗</span></a> : <div style={{ fontWeight: 600 }}>{s.title}</div>}
            <div className="u-muted" style={{ fontSize: 13 }}>{s.publisher} · {s.date} · {tierLabel(s.tier)}</div>
            <div className="u-muted" style={{ fontSize: 13, marginTop: 3 }}>{s.note}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditPanel({ log }) {
  if (!log.length) return <p className="u-muted">Nothing has happened yet.</p>;
  return (
    <div>{log.map((l, i) => (
      <div key={i} className="row" style={{ gap: 13, padding: "8px 0", borderTop: i ? "1px solid var(--line)" : 0 }}>
        <span className="mono u-muted" style={{ fontSize: 12 }}>{l.t}</span><span style={{ fontSize: 14 }}>{l.text}</span>
      </div>
    ))}</div>
  );
}

function VersionPanel({ versions, setDraft, pushUndo }) {
  if (!versions.length) return <p className="u-muted">No versions yet.</p>;
  return (
    <div>
      <p className="u-muted" style={{ fontSize: 13.5, marginTop: 0 }}>Approved versions are never overwritten.</p>
      {versions.map((v) => (
        <div className="card tight" key={v.n} style={{ marginBottom: 11 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <span className="num">{pad(v.n)}</span>
              <div style={{ fontWeight: 600 }}>{v.label}</div>
              <div className="u-muted" style={{ fontSize: 13 }}>{v.author} · {v.at}</div>
            </div>
            <button className="btn sm" onClick={() => { pushUndo("restore version"); setDraft(v.snapshot); }}>Restore</button>
          </div>
          <div className="u-muted" style={{ fontSize: 13, marginTop: 9 }}>{v.snapshot?.hook}</div>
        </div>
      ))}
    </div>
  );
}

function NotesPanel({ notes, clear }) {
  if (!notes.length) return <p className="u-muted">You're all caught up.</p>;
  return (
    <div>
      <button className="btn sm" style={{ marginBottom: 14 }} onClick={clear}>Clear all</button>
      {notes.map((n, i) => (
        <div key={i} className="row" style={{ gap: 13, padding: "10px 0", borderTop: i ? "1px solid var(--line)" : 0 }}>
          <span className="mono u-muted" style={{ fontSize: 12 }}>{n.t}</span><span style={{ fontSize: 14 }}>{n.text}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=Inter+Tight:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.unison{
  --accent:#7C8CFF; --accent-2:#39D3C7;
  --ok:#4FD69C; --warn:#F3B44C; --bad:#FF7A66;
  min-height:100vh; position:relative; overflow-x:hidden;
  font-family:'Inter Tight',ui-sans-serif,system-ui,sans-serif; font-size:15px; line-height:1.55; font-weight:500;
  -webkit-font-smoothing:antialiased; transition:background .4s ease, color .4s ease;
}
.unison[data-t="dark"]{
  --bg:#04060A; --panel:rgba(255,255,255,.045); --panel-2:rgba(255,255,255,.09);
  --ink:#FFFFFF; --muted:#9FA9BF; --line:rgba(255,255,255,.13); --accent-soft:rgba(124,140,255,.2);
  --solid:rgba(9,13,22,.86); --solid-2:rgba(9,13,22,.72);
  --veil:rgba(4,6,11,.82); --veil-2:rgba(4,6,11,.55);
  background:var(--bg); color:var(--ink);
}
.unison[data-t="light"]{
  --bg:#F1F4F9; --panel:#FFFFFF; --panel-2:#E9EDF5;
  --ink:#04070D; --muted:#4B5769; --line:#DBE1EB; --accent-soft:#E8EBFF;
  --solid:rgba(255,255,255,.93); --solid-2:rgba(255,255,255,.82);
  --veil:rgba(241,244,249,.86); --veil-2:rgba(241,244,249,.6);
  background:var(--bg); color:var(--ink);
}
.unison *{box-sizing:border-box;}
.unison ::selection{background:var(--accent); color:#fff;}
.mono{font-family:'IBM Plex Mono',ui-monospace,monospace;}
.disp{font-family:'Sora',ui-sans-serif,sans-serif; font-weight:400; letter-spacing:-.035em; line-height:1.06;}
.disp b{font-weight:700; letter-spacing:-.045em;}
.eyebrow{font-family:'IBM Plex Mono',monospace; font-size:10.5px; font-weight:600; letter-spacing:.18em; text-transform:uppercase; color:var(--muted);}
.u-muted{color:var(--muted);}
.num{font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:600; color:var(--accent); letter-spacing:.1em;}
a{color:var(--accent);}
.over{color:var(--bad) !important;}

.cursor-blob{position:fixed; top:0; left:0; width:440px; height:440px; border-radius:50%; pointer-events:none; z-index:1;
  background:radial-gradient(circle, rgba(124,140,255,.16), rgba(57,211,199,.05) 42%, transparent 68%); filter:blur(24px);}
.cursor-blob[data-t="light"]{background:radial-gradient(circle, rgba(124,140,255,.2), transparent 62%);}
.cursor-ring{position:fixed; top:0; left:0; width:26px; height:26px; border-radius:50%; border:1.5px solid var(--accent); opacity:.55; pointer-events:none; z-index:80;}
@media (pointer:coarse){ .cursor-blob,.cursor-ring{display:none;} }

.glow{position:absolute; border-radius:50%; filter:blur(90px); pointer-events:none; z-index:0; opacity:.55;
  background:radial-gradient(circle at 50% 50%, rgba(108,92,255,.55), rgba(30,107,255,.2) 45%, transparent 70%);
  animation:float 24s ease-in-out infinite;}
.unison[data-t="light"] .glow{opacity:.32;}
@keyframes float{0%,100%{transform:translate3d(0,0,0) scale(1);} 50%{transform:translate3d(3%,-4%,0) scale(1.12);}}
@media (prefers-reduced-motion:reduce){ .glow{animation:none;} }
.scene3d{position:fixed; inset:0; z-index:1; pointer-events:none; transition:opacity .5s ease;}
.scene3d canvas{display:block; width:100% !important; height:100% !important;}
.stage-cap{position:fixed; left:26px; bottom:22px; z-index:3; display:flex; gap:12px; align-items:center; pointer-events:none;}
.stage-cap .bar{width:64px; height:2px; background:var(--line); position:relative; display:block;}
.stage-cap .bar i{position:absolute; left:0; top:0; bottom:0; background:linear-gradient(90deg,var(--accent),var(--accent-2)); transition:width .45s ease;}
@media (max-width:820px){ .stage-cap{left:20px; bottom:16px;} .stage-cap .bar{width:40px;} }
.loop{border-bottom:1px solid var(--line);}
.loop-row{display:flex; align-items:center; gap:20px; min-height:26vh; border-top:1px solid var(--line); opacity:.28; transition:opacity .45s ease, padding-left .45s ease;}
.loop-row.on{opacity:1; padding-left:10px;}
.loop-row h3{font-family:'Sora',sans-serif; font-weight:500; font-size:clamp(22px,3vw,34px); letter-spacing:-.03em; margin:0;}
.loop-row .eyebrow{margin-left:auto;}
@media (max-width:700px){ .loop-row{min-height:17vh; gap:12px;} }

.hdr{position:sticky; top:0; z-index:60; backdrop-filter:blur(14px); border-bottom:1px solid var(--line);}
.unison[data-t="dark"] .hdr{background:rgba(4,6,10,.78);}
.unison[data-t="light"] .hdr{background:rgba(241,244,249,.86);}
.hdr-in{max-width:1280px; margin:0 auto; padding:12px 26px; display:flex; align-items:center; gap:16px;}
.mark{font-family:'Sora',sans-serif; font-weight:700; font-size:17px; letter-spacing:-.03em; cursor:pointer; display:flex; align-items:center; gap:9px; background:none; border:0; color:inherit; padding:0;}
.mark-svg{display:block; overflow:visible;}
.nav{display:flex; gap:2px; margin-left:8px;}
.nav button{background:none; border:0; padding:7px 12px; border-radius:999px; cursor:pointer; color:var(--muted); font:inherit; font-size:13.5px; font-weight:500; transition:.15s;}
.nav button:hover{color:var(--ink); background:var(--panel-2);}
.nav button.on{color:var(--ink); background:var(--panel-2); font-weight:600;}
.hdr-right{margin-left:auto; display:flex; align-items:center; gap:8px;}
.sel,.chipflat{border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:6px 10px; font-size:12.5px; color:var(--ink);}
.avatar{width:30px;height:30px;border-radius:999px;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;display:grid;place-items:center;font-size:11.5px;font-weight:700;}
.bell{position:relative; border:1px solid var(--line); background:var(--panel); border-radius:9px; width:33px; height:33px; cursor:pointer; color:var(--ink);}
.bell b{position:absolute; top:-6px; right:-6px; background:var(--accent); color:#fff; border-radius:999px; font-size:10px; padding:1px 5px;}
.burger{display:none; border:1px solid var(--line); background:var(--panel); color:var(--ink); border-radius:9px; width:33px; height:33px; font-size:16px; cursor:pointer;}
.tt{border:1px solid var(--line); background:var(--panel); border-radius:999px; width:46px; height:26px; position:relative; cursor:pointer; padding:0;}
.tt-i{position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:999px; background:linear-gradient(140deg,var(--accent),var(--accent-2)); color:#fff; font-size:11px; display:grid; place-items:center; transition:.22s;}
.tt.on .tt-i{left:22px;}
@media (max-width:1180px){ .hide-sm{display:none;} }
@media (max-width:940px){ .nav{display:none;} .burger{display:block;} }
.sheet{position:sticky; top:57px; z-index:59; background:var(--bg); border-bottom:1px solid var(--line); padding:10px 20px; display:flex; flex-direction:column;}
.sheet button{background:none; border:0; color:var(--ink); font:inherit; font-weight:500; text-align:left; padding:12px 4px; border-bottom:1px solid var(--line); cursor:pointer;}
.sheet button:last-child{border-bottom:0;}

.btn{border:1px solid var(--line); background:var(--solid-2); color:var(--ink); border-radius:999px; padding:10px 18px; font:inherit; font-size:13.5px; font-weight:600; cursor:pointer; transition:.18s; text-decoration:none; display:inline-block;}
.btn:hover{border-color:var(--accent); background:var(--panel-2);}
.btn:focus-visible{outline:2px solid var(--accent); outline-offset:2px;}
.btn.pri{background:var(--ink); border-color:var(--ink); color:var(--bg);}
.btn.pri:hover{opacity:.88;}
.btn.acc{background:linear-gradient(120deg,var(--accent),#5C6DF0); border-color:transparent; color:#fff;}
.btn.acc:hover{filter:brightness(1.12);}
.btn:disabled{opacity:.35; cursor:not-allowed;}
.btn.sm{padding:6px 13px; font-size:12.5px;}
.row{display:flex; gap:9px; flex-wrap:wrap; align-items:center;}

.site{position:relative; z-index:2;}
.shell{max-width:1280px; margin:0 auto; padding:0 26px;}
.hero{position:relative; min-height:92vh; display:grid; place-items:center; text-align:center;}
.hero-in{position:relative; z-index:3; padding:90px 0 60px; max-width:860px;}
.hero-in:before{content:''; position:absolute; left:50%; top:8%; width:120%; height:84%; transform:translateX(-50%);
  background:radial-gradient(ellipse at center, var(--veil) 0%, var(--veil-2) 42%, transparent 72%); filter:blur(22px); z-index:-1; pointer-events:none;}
.hero h1{font-size:clamp(40px,7vw,82px); margin:20px 0 20px;}
.hero p{font-size:16.5px; color:var(--muted); max-width:520px; margin:0 auto 30px;}
.scroll-hint{position:absolute; bottom:28px; left:50%; transform:translateX(-50%); animation:bob 2.6s ease-in-out infinite;}
@keyframes bob{0%,100%{transform:translate(-50%,0); opacity:.5;} 50%{transform:translate(-50%,7px); opacity:1;}}
.strip{border-top:1px solid var(--line); border-bottom:1px solid var(--line); position:relative; z-index:2;}
.unison[data-t="dark"] .strip{background:rgba(255,255,255,.025);}
.unison[data-t="light"] .strip{background:#fff;}
.strip-in{max-width:1280px; margin:0 auto; padding:0 26px; display:grid; grid-template-columns:repeat(3,1fr);}
.stat{padding:34px 0 34px 26px; border-left:1px solid var(--line);}
.stat:first-child{border-left:0; padding-left:0;}
.stat b{display:block; font-family:'Sora',sans-serif; font-weight:400; font-size:clamp(32px,4.2vw,54px); letter-spacing:-.045em; line-height:1; margin-top:12px;}
@media (max-width:760px){ .strip-in{grid-template-columns:1fr;} .stat{border-left:0; border-top:1px solid var(--line); padding-left:0;} .stat:first-child{border-top:0;} }

.band{position:relative; padding:96px 0; z-index:2;}
.band-h{max-width:620px; margin-bottom:42px;}
.band-h h2{font-size:clamp(28px,3.8vw,44px); margin:14px 0 0;}
.acc{border-top:1px solid var(--line);}
.acc-item{border-bottom:1px solid var(--line);}
.acc-btn{width:100%; background:none; border:0; color:inherit; font:inherit; text-align:left; cursor:pointer; padding:24px 0; display:grid; grid-template-columns:56px 1fr 30px; gap:18px; align-items:start; transition:.2s;}
.acc-btn:hover{padding-left:8px;}
.acc-btn h3{font-family:'Sora',sans-serif; font-weight:500; font-size:clamp(20px,2.4vw,28px); letter-spacing:-.03em; margin:8px 0 0; line-height:1.2;}
.acc-body{overflow:hidden; max-height:0; opacity:0; transition:max-height .4s ease, opacity .3s;}
.acc-item.open .acc-body{max-height:320px; opacity:1; padding-bottom:24px;}
.acc-body div{max-width:640px; margin-left:74px; color:var(--muted);}
.plus{font-size:22px; color:var(--muted); line-height:1; transition:.3s;}
.acc-item.open .plus{transform:rotate(45deg); color:var(--accent);}
@media (max-width:640px){ .acc-body div{margin-left:0;} .acc-btn{grid-template-columns:38px 1fr 20px; gap:12px;} }
.cta-band{text-align:center; padding:110px 0; position:relative; z-index:2;}
.cta-band h2{font-size:clamp(30px,5vw,58px); margin-bottom:28px;}
.foot{border-top:1px solid var(--line); padding:34px 26px; color:var(--muted); font-size:13.5px; position:relative; z-index:2;}

.wrap{max-width:1280px; margin:0 auto; padding:0 26px 130px; display:grid; grid-template-columns:186px 1fr; gap:40px; position:relative; z-index:2;}
@media (max-width:960px){ .wrap{grid-template-columns:1fr; gap:0;} .rail{display:none;} }
.rail{position:sticky; top:80px; align-self:start; padding-top:46px;}
.rail-line{position:relative; padding-left:22px;}
.rail-line:before{content:''; position:absolute; left:5px; top:6px; bottom:6px; width:1px; background:var(--line);}
.rail-fill{position:absolute; left:5px; top:6px; width:1px; background:linear-gradient(180deg,var(--accent),var(--accent-2)); transition:height .5s ease;}
.rstep{position:relative; padding:0 0 19px;}
.rdot{position:absolute; left:-22px; top:5px; width:11px; height:11px; border-radius:999px; border:1px solid var(--line); background:var(--bg);}
.rstep.done .rdot{background:var(--accent); border-color:var(--accent);}
.rstep.on .rdot{border-color:var(--accent); box-shadow:0 0 0 4px var(--accent-soft);}
.rstep .rl{font-size:13px; color:var(--muted); line-height:1.2;}
.rstep.done .rl,.rstep.on .rl{color:var(--ink); font-weight:600;}
.rstep .re{font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); opacity:0; transition:.2s;}
.rstep.on .re{opacity:1; color:var(--accent);}
.rstep .rn{font-family:'IBM Plex Mono',monospace; font-size:9.5px; color:var(--muted); opacity:.55; margin-right:6px;}
.mrail{display:none;}
@media (max-width:960px){
  .mrail{display:block; position:sticky; top:57px; z-index:55; background:var(--bg); border-bottom:1px solid var(--line);}
  .mrail-in{display:flex; align-items:center; gap:6px; padding:11px 20px; max-width:1280px; margin:0 auto;}
  .mdot{width:8px; height:8px; border-radius:999px; border:1px solid var(--line);}
  .mdot.done{background:var(--accent); border-color:var(--accent);}
  .mdot.on{border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft);}
}

.sec{margin-top:52px; animation:rise .5s ease both;}
@keyframes rise{from{opacity:0; transform:translateY(12px);} to{opacity:1; transform:none;}}
@media (prefers-reduced-motion:reduce){ .sec{animation:none;} }
.sec-h{display:flex; align-items:center; gap:14px; margin-bottom:18px; padding-bottom:14px; border-bottom:1px solid var(--line); flex-wrap:wrap;}
.sec-h h2{font-family:'Sora',sans-serif; font-weight:400; font-size:29px; letter-spacing:-.035em; margin:0;}
.sec-h .eyebrow{margin-left:auto;}
.card{background:var(--solid); backdrop-filter:blur(12px); border:1px solid var(--line); border-radius:16px; padding:22px;}
.card+.card{margin-top:12px;}
.tight{padding:16px;}
.paper{--panel:#FFFFFF; --panel-2:#F1F4F9; --solid:#FFFFFF; --solid-2:#F7F9FC; --ink:#04070D; --muted:#4B5769; --line:#E2E7EF; --accent-soft:#EEF0FF;
  background:#fff; color:var(--ink); border:1px solid #E2E7EF; border-radius:16px;}
.paper .btn{background:#fff; border-color:#DDE3EC; color:#04070D;}

.start{padding:70px 0 0; max-width:760px; position:relative; z-index:2;}
.start h1{font-size:clamp(32px,4.6vw,52px); margin:10px 0 26px;}
.composer{background:var(--solid); backdrop-filter:blur(12px); border:1px solid var(--line); border-radius:999px; padding:6px 6px 6px 22px; display:flex; align-items:center; gap:10px;}
.composer.big{max-width:620px; margin:0 auto;}
.composer:focus-within{border-color:var(--accent); box-shadow:0 0 0 4px var(--accent-soft);}
.composer input{flex:1; min-width:60px; border:0; outline:0; font:inherit; font-size:16px; padding:13px 0; background:transparent; color:var(--ink);}
.composer input::placeholder{color:var(--muted); font-weight:400;}
.chips{display:flex; gap:8px; flex-wrap:wrap; margin-top:16px;}
.chip{border:1px solid var(--line); background:var(--solid-2); border-radius:999px; padding:8px 14px; font:inherit; font-size:13px; font-weight:600; cursor:pointer; color:var(--muted); transition:.15s;}
.chip:hover{color:var(--ink); border-color:var(--accent);}
.chip.on{background:var(--accent-soft); border-color:var(--accent); color:var(--ink);}

.pstep{display:flex; gap:11px; align-items:center; padding:6px 0; font-size:14px; color:var(--muted);}
.pstep.done,.pstep.active{color:var(--ink);}
.tick{width:16px; text-align:center; color:var(--accent);}
.pulse{display:inline-block; width:7px; height:7px; border-radius:999px; background:var(--accent); animation:bp 1.1s infinite ease-in-out;}
@keyframes bp{0%,100%{opacity:.2;} 50%{opacity:1;}}

.src{display:flex; gap:13px; padding:13px 0; border-top:1px solid var(--line);}
.src:first-child{border-top:0;}
.srclink{font-weight:600; text-decoration:none;}
.srclink:hover{text-decoration:underline;}
.ext{font-size:11px; opacity:.7;}
.tier{font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:600; letter-spacing:.08em; padding:4px 8px; border-radius:6px; white-space:nowrap; height:fit-content; border:1px solid var(--line);}
.t1{background:rgba(79,214,156,.16); color:#1F7A55;} .t2{background:rgba(124,140,255,.18); color:#4453CC;}
.t3{background:rgba(243,180,76,.16); color:#8A6410;} .t4{background:rgba(130,140,160,.16); color:var(--muted);}
.unison[data-t="dark"] .t1{color:#8CEFC4;} .unison[data-t="dark"] .t2{color:#B6C0FF;} .unison[data-t="dark"] .t3{color:#F5CC85;}

/* discover */
.opp{display:grid; grid-template-columns:74px 1fr; gap:18px; background:var(--solid); backdrop-filter:blur(12px); border:1px solid var(--line); border-radius:16px; padding:20px; margin-bottom:12px;}
.opp-score{text-align:center; position:relative;}
.opp-score b{font-family:'Sora',sans-serif; font-weight:400; font-size:30px; letter-spacing:-.04em; display:block; line-height:1;}
.opp-score .eyebrow{font-size:9px;}
.scorebar{height:44px; width:5px; background:var(--line); border-radius:999px; margin:10px auto 0; display:flex; align-items:flex-end; overflow:hidden;}
.scorebar i{display:block; width:100%; background:linear-gradient(180deg,var(--accent),var(--accent-2)); border-radius:999px;}
.opp-h{font-family:'Sora',sans-serif; font-weight:500; font-size:21px; letter-spacing:-.03em; line-height:1.22;}
.gap{font-family:'IBM Plex Mono',monospace; font-size:9.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; padding:4px 8px; border-radius:6px; border:1px solid var(--line);}
.gap-open{background:rgba(79,214,156,.16); color:#1F7A55;} .gap-adj{background:rgba(243,180,76,.16); color:#8A6410;} .gap-cov{background:rgba(130,140,160,.16); color:var(--muted);}
.unison[data-t="dark"] .gap-open{color:#8CEFC4;} .unison[data-t="dark"] .gap-adj{color:#F5CC85;}
@media (max-width:620px){ .opp{grid-template-columns:1fr;} .scorebar{display:none;} }

.angles{display:grid; grid-template-columns:repeat(auto-fit,minmax(248px,1fr)); gap:13px;}
.angle{background:var(--solid); backdrop-filter:blur(12px); border:1px solid var(--line); border-radius:18px; padding:20px; cursor:pointer; transition:.2s; text-align:left; font:inherit; color:inherit;}
.angle:hover{transform:translateY(-3px); border-color:var(--accent);}
.angle.rec{border-color:var(--accent); box-shadow:0 0 0 4px var(--accent-soft);}
.angle.sel{background:linear-gradient(150deg,rgba(124,140,255,.22),rgba(57,211,199,.09)); border-color:var(--accent);}
.angle h4{font-family:'Sora',sans-serif; font-weight:500; font-size:20px; letter-spacing:-.025em; margin:10px 0 9px; line-height:1.2;}

.editor{display:grid; grid-template-columns:196px 1fr 280px; gap:14px; align-items:start;}
@media (max-width:1120px){ .editor{grid-template-columns:1fr;} }
.ctrl{margin-bottom:18px;}
.ctrl .eyebrow{display:block; margin-bottom:8px;}
.opt{display:block; width:100%; text-align:left; border:1px solid var(--line); background:var(--solid-2); color:var(--ink); border-radius:9px; padding:9px 11px; font:inherit; font-size:13px; font-weight:500; margin-bottom:6px; cursor:pointer; transition:.15s;}
.opt:hover{border-color:var(--accent);}
.opt.on{background:var(--ink); color:var(--bg); border-color:var(--ink); font-weight:600;}

.li{overflow:hidden;}
.li-top{display:flex; gap:11px; padding:16px 18px 8px;}
.li-av{width:46px;height:46px;border-radius:999px;background:linear-gradient(140deg,var(--accent),#5C6DF0); color:#fff; display:grid; place-items:center; font-weight:700;}
.li-body{padding:4px 18px 14px; white-space:pre-wrap; font-size:14.5px; line-height:1.55; font-weight:400;}
.li-body .hl{background:rgba(243,180,76,.32); border-radius:3px; box-shadow:0 0 0 2px rgba(243,180,76,.32);}
.fold{display:flex; align-items:center; gap:8px; font-family:'IBM Plex Mono',monospace; font-size:9.5px; letter-spacing:.16em; text-transform:uppercase; color:#8794AB; margin:10px 0 4px;}
.fold i{flex:1; height:0; border-top:1px dashed #C7D0DE; display:block;}
.li-media{margin-top:8px; background:linear-gradient(140deg,#E9EDF6,#F7F9FC); border-top:1px solid #E2E7EF; border-bottom:1px solid #E2E7EF; height:186px; display:grid; place-items:center; text-align:center; padding:22px;}
.li-visual{border-top:1px solid #E2E7EF; border-bottom:1px solid #E2E7EF; line-height:0;}
.li-visual svg,.li-visual img,.li-visual video{width:100%; height:auto; display:block;}
.li-bar{display:flex; gap:20px; padding:11px 18px; border-top:1px solid #EDF0F5; color:#4B5769; font-size:13px;}
.visual-frame{margin-top:16px; border:1px solid var(--line); border-radius:14px; overflow:hidden; line-height:0; background:var(--panel);}
.visual-frame svg,.visual-frame img,.visual-frame video{width:100%; height:auto; display:block;}
.ta{width:100%; border:1px solid var(--line); border-radius:10px; padding:11px; font:inherit; font-size:14px; font-weight:500; color:var(--ink); background:var(--panel); resize:vertical;}
.paper .ta{background:#FBFCFE; border-color:#DDE3EC;}
.ta:focus{outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft);}
select.ta{cursor:pointer;} select.ta option{background:var(--bg); color:var(--ink);}

.ev{border-top:1px solid var(--line); padding:11px 0; cursor:pointer; border-radius:6px;}
.ev:first-of-type{border-top:0;}
.ev.on{background:var(--accent-soft); padding-left:8px; padding-right:8px;}
.dot{width:8px;height:8px;border-radius:999px;display:inline-block;margin-right:9px;}
.g{background:var(--ok);} .y{background:var(--warn);} .r{background:var(--bad);}
.evdetail{background:var(--accent-soft); border-radius:11px; padding:12px; margin-top:8px; font-size:13px;}
.chk{display:flex; gap:10px; padding:5px 0; font-size:14px;}
.bar{height:4px; background:var(--line); border-radius:999px; overflow:hidden; margin-top:6px;}
.bar i{display:block; height:100%; background:linear-gradient(90deg,var(--accent),var(--accent-2));}
.badge{display:inline-flex; align-items:center; gap:7px; font-size:13px; font-weight:600; padding:6px 13px; border-radius:999px; backdrop-filter:blur(8px); background:rgba(79,214,156,.16); color:#1F7A55; border:1px solid rgba(79,214,156,.3);}
.badge.warn{background:rgba(243,180,76,.16); color:#7C5507; border-color:rgba(243,180,76,.32);}
.badge.bad{background:rgba(255,122,102,.15); color:#A63722; border-color:rgba(255,122,102,.34);}
.unison[data-t="dark"] .badge{color:#8CEFC4;} .unison[data-t="dark"] .badge.warn{color:#F5CC85;} .unison[data-t="dark"] .badge.bad{color:#FFA595;}

.kpi{display:grid; grid-template-columns:repeat(auto-fit,minmax(132px,1fr)); border-top:1px solid var(--line); margin-top:20px;}
.kpi div{padding:20px 18px 20px 0; border-right:1px solid var(--line);}
.kpi div:last-child{border-right:0;}
.kpi b{display:block; font-family:'Sora',sans-serif; font-weight:400; font-size:clamp(26px,3.2vw,40px); letter-spacing:-.045em; line-height:1; margin-top:10px;}

.scrim{position:fixed; inset:0; background:rgba(2,4,8,.66); backdrop-filter:blur(3px); z-index:70;}
.drawer{position:fixed; top:0; right:0; bottom:0; width:min(440px,94vw); background:var(--bg); z-index:71; border-left:1px solid var(--line); overflow:auto; padding:24px; animation:slide .28s ease;}
@keyframes slide{from{transform:translateX(24px); opacity:.3;} to{transform:none; opacity:1;}}
.modal{position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); width:min(560px,94vw); max-height:88vh; overflow:auto;
  background:var(--bg); border:1px solid var(--line); border-radius:20px; z-index:71; padding:26px; animation:pop .25s ease;}
.modal.wide{width:min(900px,95vw);}
@keyframes pop{from{opacity:0; transform:translate(-50%,-46%) scale(.98);} to{opacity:1; transform:translate(-50%,-50%) scale(1);}}

.tabs{display:flex; gap:4px; border-bottom:1px solid var(--line); margin-bottom:22px; overflow-x:auto;}
.tabs button{background:none; border:0; border-bottom:2px solid transparent; color:var(--muted); font:inherit; font-size:13.5px; font-weight:600; padding:10px 14px; cursor:pointer; white-space:nowrap;}
.tabs button.on{color:var(--ink); border-bottom-color:var(--accent);}

.diff{font-size:14.5px; line-height:1.7; white-space:pre-wrap; border:1px solid var(--line); border-radius:14px; padding:18px; background:var(--panel);}
.diff .same{opacity:.55;}
.diff .add{background:rgba(79,214,156,.2); border-radius:3px;}
.diff .del{background:rgba(255,122,102,.18); border-radius:3px; text-decoration:line-through; opacity:.8;}

.vgrid{display:grid; grid-template-columns:1fr 300px; gap:26px;}
@media (max-width:760px){ .vgrid{grid-template-columns:1fr;} }
.dim{margin-bottom:20px;}
.dim input[type=range]{width:100%; margin:8px 0 2px; accent-color:var(--accent);}
.tagrow{display:flex; flex-wrap:wrap; gap:7px;}
.tag{display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; padding:5px 8px 5px 11px; border-radius:999px; background:rgba(255,122,102,.14); color:var(--ink); border:1px solid rgba(255,122,102,.32);}
.tag.ok{background:rgba(79,214,156,.15); border-color:rgba(79,214,156,.32);}
.tag button{background:none; border:0; color:var(--muted); cursor:pointer; font-size:14px; line-height:1; padding:0;}
.vpreview{background:var(--solid); border:1px solid var(--line); border-radius:16px; padding:20px; align-self:start;}
.vbars>div{margin-bottom:11px;}
.samp{font-size:14px; padding:9px 0; border-top:1px solid var(--line);}

.setrow{display:flex; justify-content:space-between; align-items:center; gap:16px; padding:14px 0; border-bottom:1px solid var(--line);}
.quads{display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); border-top:1px solid var(--line); margin-top:18px;}
.quads div{padding:16px 14px 16px 0; border-right:1px solid var(--line);}
.quads div:last-child{border-right:0;}
.quads b{display:block; font-family:'Sora',sans-serif; font-weight:400; font-size:26px; letter-spacing:-.04em; margin-top:8px;}
.conn{border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:12px; background:var(--solid-2);}
.conn .setrow{border-bottom:0; padding:8px 0;}
.li-chip{background:#0A66C2; color:#fff; font-weight:700; font-size:12px; border-radius:4px; padding:2px 5px; display:inline-block;}
.oauth{border:1px solid var(--line); border-radius:14px; overflow:hidden;}
.oauth-bar{display:flex; align-items:center; gap:9px; padding:11px 14px; background:var(--panel-2); border-bottom:1px solid var(--line); font-family:'IBM Plex Mono',monospace; font-size:12px; color:var(--muted);}
.scope{display:flex; gap:12px; padding:8px 0; font-size:13px; border-top:1px solid var(--line); flex-wrap:wrap;}
.orgrow{display:flex; align-items:center; gap:12px; width:100%; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:13px; margin-bottom:8px; cursor:pointer; color:inherit; font:inherit;}
.orgrow.on{border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft);}
.orgrow:disabled{opacity:.45; cursor:not-allowed;}

.tbl{width:100%; border-collapse:collapse; font-size:14px;}
.tbl th{text-align:left; font-weight:600; color:var(--muted); font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; padding:0 12px 10px 0; font-family:'IBM Plex Mono',monospace;}
.tbl td{padding:12px 12px 12px 0; border-top:1px solid var(--line); vertical-align:middle;}
.state{font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:600; letter-spacing:.08em; padding:4px 8px; border-radius:6px; background:var(--panel-2); color:var(--muted); border:1px solid var(--line); display:inline-block;}
.state.pub{background:rgba(79,214,156,.16); color:#1F7A55;} .state.rev{background:rgba(243,180,76,.16); color:#8A6410;}
.state.sch{background:rgba(124,140,255,.18); color:#4453CC;} .state.fail{background:rgba(255,122,102,.15); color:#A63722;}
.unison[data-t="dark"] .state.pub{color:#8CEFC4;} .unison[data-t="dark"] .state.rev{color:#F5CC85;}
.unison[data-t="dark"] .state.sch{color:#B6C0FF;} .unison[data-t="dark"] .state.fail{color:#FFA595;}
.cal{display:grid; grid-template-columns:repeat(7,1fr); gap:9px;}
.cell{border:1px solid var(--line); background:var(--solid-2); backdrop-filter:blur(10px); border-radius:12px; min-height:120px; padding:10px; display:flex; flex-direction:column; gap:6px;}
.cell .d{font-family:'IBM Plex Mono',monospace; font-size:11px; color:var(--muted);}
.pill{font-size:11.5px; font-weight:600; padding:6px 8px; border-radius:8px; background:var(--accent-soft); color:var(--ink); line-height:1.25; text-align:left; border:1px solid var(--line); cursor:pointer; font-family:inherit;}
.pill:hover{border-color:var(--accent);}
.addslot{margin-top:auto; background:none; border:1px dashed var(--line); color:var(--muted); border-radius:8px; padding:6px; font:inherit; font-size:11.5px; cursor:pointer;}
.addslot:hover{border-color:var(--accent); color:var(--ink);}
@media (max-width:860px){ .cal{grid-template-columns:repeat(2,1fr);} }

/* ---------- storyboard player ---------- */
.sbplayer{position:relative; margin-top:14px; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#0A0F1A;}
.sbplayer canvas{display:block; width:100%; height:auto; cursor:pointer;}
.sb-play{position:absolute; inset:0; margin:auto; width:58px; height:58px; background:none; border:0; cursor:pointer; display:grid; place-items:center;}
.sb-bar{display:flex; align-items:center; gap:10px; padding:9px 12px; border-top:1px solid var(--line); background:rgba(4,7,13,.55);}
.sb-bar button{background:none; border:0; color:#EEF2F8; cursor:pointer; font-size:13px; width:22px;}
.sb-bar input[type=range]{flex:1; accent-color:var(--accent); height:3px;}
.sb-bar span{font-size:11.5px; color:#9FA9BF; white-space:nowrap;}
.li-visual .sbplayer{margin-top:0; border:0; border-radius:0;}

/* ---------- linkedin chip + popover ---------- */
.pop-wrap{position:relative;}
.chip-li{display:inline-flex; align-items:center; gap:7px;}
.chip-li .caret{font-size:9px; opacity:.6;}
.pop{position:absolute; top:calc(100% + 9px); right:0; width:290px; z-index:65;
  background:var(--bg); border:1px solid var(--line); border-radius:14px; padding:16px;
  box-shadow:0 18px 44px rgba(2,4,9,.42); animation:pop-in .16s ease;}
@keyframes pop-in{from{opacity:0; transform:translateY(-6px);} to{opacity:1; transform:none;}}
.pop-row{display:flex; justify-content:space-between; gap:12px; font-size:13.5px; padding:7px 0; border-top:1px solid var(--line);}
.pop-row:first-of-type{border-top:0;}
.dot.r{background:var(--bad);}
@media (max-width:520px){ .pop{position:fixed; left:12px; right:12px; width:auto; top:64px;} }

/* ---------- dashboard ---------- */
.dash{padding:56px 0 0; position:relative; z-index:2;}
.dash-head{display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; margin-bottom:28px;}
.dash-head h1{font-size:clamp(30px,4vw,46px); margin:8px 0 0;}
.btn.big{padding:14px 24px; font-size:15px;}
.dash-resume{margin-bottom:14px;}
.dash-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:14px;}
.dash-row{display:flex; align-items:center; gap:10px; width:100%; background:none; border:0; border-top:1px solid var(--line); padding:11px 0; color:inherit; font:inherit; font-size:13.5px; text-align:left; cursor:pointer;}
.dash-row:first-of-type{border-top:0;}
.dash-row:hover{color:var(--accent);}
.dash-row span:nth-child(2){flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.dash-stat{display:flex; align-items:center; gap:10px; padding:9px 0; font-size:13.5px; border-top:1px solid var(--line);}
.dash-stat:first-of-type{border-top:0;}
.dot.b{background:var(--accent);}

/* ---------- create ---------- */
.create{padding:56px 0 0; max-width:900px; position:relative; z-index:2;}
.dash .create{padding:0; max-width:none; margin-bottom:22px;}
.create h1{font-size:clamp(28px,3.6vw,44px); margin:8px 0 26px;}
.chip:disabled{opacity:.45; cursor:not-allowed;}
.fmt.base{border-style:solid; border-color:var(--accent); background:var(--accent-soft); cursor:default;}
.fmt-check{width:18px; height:18px; border-radius:999px; border:1px solid var(--line); font-size:11px; line-height:16px; text-align:center; color:#fff; flex:none;}
.fmt-check.on{background:var(--accent); border-color:var(--accent);}
.navcount{display:inline-block; margin-left:6px; min-width:16px; padding:0 5px; border-radius:999px; background:var(--accent); color:#fff; font-size:10.5px; line-height:16px; text-align:center;}

/* ---------- drafts ---------- */
.draftrow{display:flex; align-items:center; gap:14px; padding:12px 0; border-top:1px solid var(--line);}
.draftrow:first-of-type{border-top:0;}
.draft-title{font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.btn.bad{background:rgba(255,122,102,.16); border-color:rgba(255,122,102,.5);}
.li-strip{display:flex; gap:4px; overflow-x:auto; padding:10px 18px; border-top:1px solid #E2E7EF;}
.li-strip img{height:88px; width:auto; border-radius:6px; flex:none; display:block;}
.li-article{margin:4px 18px 14px; border:1px solid #E2E7EF; border-radius:10px; padding:12px 14px;}
@media (max-width:620px){ .draftrow{flex-direction:column; align-items:stretch;} }
.fmt-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px;}
.fmt{display:flex; flex-direction:column; gap:4px; text-align:left; border:1px solid var(--line); background:var(--solid-2); border-radius:14px; padding:16px; cursor:pointer; font:inherit; color:inherit; transition:.16s;}
.fmt:hover{border-color:var(--accent);}
.fmt.on{border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft);}
.fmt.rec{border-style:dashed;}
.fmt-label{font-weight:600; font-size:15px;}
.fmt .u-muted{font-size:12.5px; line-height:1.35;}

/* ---------- media panels ---------- */
.svgframe{width:100%; margin-top:14px; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#0A0F1A;}
.svgframe img{width:100%; height:100%; object-fit:cover; display:block;}
.tilegrid{display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; margin-top:6px;}
.tile .svgframe{margin-top:0;}
.pager{display:flex; align-items:center; gap:12px; margin-top:14px;}
.strip-thumbs{display:flex; gap:8px; overflow-x:auto; padding:12px 0 4px;}
.thumb{position:relative; flex:none; width:72px; height:72px; border-radius:10px; overflow:hidden; border:1px solid var(--line); background:#0A0F1A; cursor:pointer; padding:0;}
.thumb.on{border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft);}
.thumb img{width:100%; height:100%; object-fit:cover; display:block;}
.thumb span{position:absolute; left:5px; bottom:4px; font-size:10px; color:#fff; text-shadow:0 1px 3px #000;}
.brief{margin-top:14px; border-top:1px solid var(--line); padding-top:10px; font-size:13px;}
.brief summary{cursor:pointer; color:var(--muted); font-family:'IBM Plex Mono',monospace; font-size:10.5px; letter-spacing:.16em; text-transform:uppercase;}
.brief div{padding:3px 0;}
.brief .eyebrow{margin-right:8px;}
.srcdoc{margin-top:14px; border:1px solid var(--line); border-radius:12px; padding:16px; background:var(--solid-2);}
.article-edit{margin-top:6px;}

/* ---------- preview extras ---------- */
.li-poll{margin:4px 18px 14px; border:1px solid #E2E7EF; border-radius:10px; padding:14px;}
.li-opt{border:1px solid #0A66C2; color:#0A66C2; border-radius:999px; padding:8px 14px; margin-bottom:8px; font-size:13.5px; font-weight:600; text-align:center;}
.li-doc{position:relative;}
.li-pager{position:absolute; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; gap:14px; padding:8px; background:rgba(4,7,13,.72); color:#fff; font-size:12px;}
.li-pager button{background:none; border:0; color:#fff; cursor:pointer; font-size:14px;}
.li-pager button:disabled{opacity:.35;}
.li-mosaic{display:grid; gap:2px; border-top:1px solid #E2E7EF; border-bottom:1px solid #E2E7EF;}
.li-mosaic img{width:100%; height:100%; object-fit:cover; display:block;}
.li-mosaic.n2{grid-template-columns:1fr 1fr; aspect-ratio:2/1;}
.li-mosaic.n3{grid-template-columns:2fr 1fr; grid-template-rows:1fr 1fr; aspect-ratio:3/2;}
.li-mosaic.n3 img:first-child{grid-row:1 / span 2;}
.li-mosaic.n4{grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; aspect-ratio:1/1;}
@media (max-width:620px){ .tilegrid{grid-template-columns:1fr;} .dash-head{align-items:stretch;} .btn.big{width:100%;} }

.toggle{width:40px; height:23px; border-radius:999px; background:var(--line); border:0; position:relative; cursor:pointer; flex:none;}
.toggle i{position:absolute; top:2.5px; left:2.5px; width:18px; height:18px; border-radius:999px; background:#fff; transition:.18s;}
.toggle.on{background:var(--accent);} .toggle.on i{left:19px;}
.toggle:disabled{opacity:.6; cursor:not-allowed;}
`;
