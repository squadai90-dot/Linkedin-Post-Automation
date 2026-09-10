/* The Groq adapter, exercised against a mocked fetch.
 *
 * These cover the wire format and every failure branch. What they cannot
 * cover is whether api.groq.com accepts the request from a browser origin —
 * that needs a real call, which is what Settings → AI → Test connection is
 * for. Everything below is the half that can be pinned down here. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AI_CONFIG, PROVIDERS, MODELS, modelsFor, groqBody, anthropicBody,
  readGroq, readAnthropic, providerError, friendlyError, hostedProvider,
  saveAISettings, loadAISettings, AI_STATUS, aiRouter, activeKey, activeModel,
} from "../src/lib/ai.js";

const headers = (o = {}) => ({ get: (k) => o[k.toLowerCase()] ?? null });
const okRes = (body, h) => ({ ok: true, status: 200, headers: headers(h), json: async () => body });
const errRes = (status, body) => ({ ok: false, status, headers: headers(), json: async () => body });

/* The relay probe runs before every hosted call. Pretend it is absent so the
   adapter takes the direct path, which is what a frontend-only build does. */
const noRelay = () => ({ ok: false, status: 404, headers: headers(), json: async () => ({}) });

/* A request that never answers on its own. fetch rejects immediately when the
   signal is already aborted, so the double has to as well — otherwise a test
   hangs where the real thing would have failed fast. */
const abortError = () => Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
const abortable = (url, init) => new Promise((_, reject) => {
  if (init.signal.aborted) return reject(abortError());
  init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
});

beforeEach(() => {
  localStorage.clear();
  saveAISettings({ provider: "groq", keys: { groq: "gsk_test", anthropic: "sk-ant-test" }, useLocal: false });
  hostedProvider.reset();
  AI_STATUS.quota = null;
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("groqBody", () => {
  it("speaks the OpenAI chat format", () => {
    const b = groqBody({ system: "sys", user: "hi", model: "llama-3.3-70b-versatile" });
    expect(b.model).toBe("llama-3.3-70b-versatile");
    expect(b.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
    expect(b.max_completion_tokens).toBe(AI_CONFIG.maxTokens);
  });

  it("omits the system message when there is none", () => {
    expect(groqBody({ user: "hi", model: "m" }).messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("asks for JSON mode only when the caller wants JSON", () => {
    expect(groqBody({ user: "give me json", model: "m", json: true }).response_format).toEqual({ type: "json_object" });
    expect(groqBody({ user: "give me json", model: "m" }).response_format).toBeUndefined();
  });

  it("adds the word JSON when the prompt lacks it, because the API rejects the request otherwise", () => {
    const b = groqBody({ system: "be terse", user: "list three things", model: "m", json: true });
    expect(b.messages.at(-1).content).toMatch(/JSON/i);
  });

  it("leaves a prompt that already says JSON alone", () => {
    const b = groqBody({ system: "Reply with one raw JSON object.", user: "go", model: "m", json: true });
    expect(b.messages.at(-1).content).toBe("go");
  });

  it("swaps in the search model rather than attaching a tool", () => {
    const b = groqBody({ user: "find news", model: "llama-3.3-70b-versatile", search: true });
    expect(b.model).toBe(AI_CONFIG.searchModel);
    expect(b.tools).toBeUndefined();
  });

  it("sends the compound models nothing they reject", () => {
    const b = groqBody({ user: "find news", model: "x", json: true, search: true });
    expect(Object.keys(b).sort()).toEqual(["messages", "model"]);
  });
});

describe("anthropicBody", () => {
  it("keeps the Messages format and attaches the search tool", () => {
    const b = anthropicBody({ system: "s", user: "u", model: "claude-opus-5", search: true });
    expect(b.system).toBe("s");
    expect(b.max_tokens).toBe(AI_CONFIG.maxTokens);
    expect(b.tools[0].name).toBe("web_search");
    expect(anthropicBody({ user: "u", model: "claude-opus-5" }).tools).toBeUndefined();
  });
});

describe("reading a reply", () => {
  it("pulls the text out of a Groq completion", () => {
    expect(readGroq({ choices: [{ message: { content: '{"a":1}' } }] })).toBe('{"a":1}');
  });

  it("strips the visible reasoning a thinking model emits before its answer", () => {
    // qwen3 and friends prepend <think>…</think>. Left in, extractJSON would
    // pick a brace out of the reasoning instead of the answer.
    const out = readGroq({ choices: [{ message: { content: '<think>Maybe {"wrong":1} is right?</think>\n{"right":1}' } }] });
    expect(JSON.parse(out)).toEqual({ right: 1 });
  });

  it("closes an unterminated think block rather than returning reasoning as the answer", () => {
    expect(readGroq({ choices: [{ message: { content: "answer<think>cut off mid-thought" } }] })).toBe("answer");
  });

  it("reports a content filter as a refusal", () => {
    expect(() => readGroq({ choices: [{ finish_reason: "content_filter", message: {} }] })).toThrow(/declined/);
  });

  it("returns empty rather than throwing on a reply with no content", () => {
    expect(readGroq({ choices: [] })).toBe("");
  });

  it("joins the text blocks of an Anthropic reply and ignores the rest", () => {
    expect(readAnthropic({ content: [{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }] })).toBe("a\nb");
  });
});

describe("provider errors", () => {
  it("names a rejected key so the message can point at Settings", () => {
    const e = providerError(401, { error: { message: "Invalid API Key" } });
    expect(e.code).toBe("bad-key");
    expect(friendlyError(e)).toMatch(/Settings/);
  });

  it("separates the daily free limit from ordinary throttling", () => {
    // These need different advice: one waits a moment, the other waits a day.
    const day = providerError(429, { error: { message: "Rate limit reached: tokens per day (TPD)" } });
    expect(day.code).toBe("daily-limit");
    expect(friendlyError(day)).toMatch(/24 hours/);

    const burst = providerError(429, { error: { message: "Rate limit reached for requests per minute" } });
    expect(burst.code).toBe("rate");
    expect(friendlyError(burst)).toMatch(/busy/);
  });

  it("tells the team to switch model when an id was retired", () => {
    const e = providerError(404, { error: { message: "The model `llama-3.1-70b` has been decommissioned" } });
    expect(e.code).toBe("no-model");
    expect(friendlyError(e)).toMatch(/no longer available/);
  });

  it("falls back to the status code when the body explains nothing", () => {
    expect(providerError(500, null).message).toBe("HTTP 500");
  });
});

describe("hostedProvider.chat", () => {
  it("posts to Groq with a bearer token and returns the text", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValueOnce(okRes({ choices: [{ message: { content: "OK" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await hostedProvider.chat({ user: "Say OK." })).toBe("OK");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer gsk_test");
    expect(init.headers["x-api-key"]).toBeUndefined();
  });

  it("switches wire format and headers with the provider", async () => {
    saveAISettings({ provider: "anthropic" });
    hostedProvider.reset();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValueOnce(okRes({ content: [{ type: "text", text: "OK" }] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await hostedProvider.chat({ user: "Say OK." })).toBe("OK");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("refuses to call out with no key instead of sending an empty credential", async () => {
    saveAISettings({ keys: { groq: "" } });
    hostedProvider.reset();
    const fetchMock = vi.fn().mockResolvedValueOnce(noRelay());
    vi.stubGlobal("fetch", fetchMock);

    await expect(hostedProvider.chat({ user: "hi" })).rejects.toMatchObject({ code: "no-key" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the probe only
  });

  it("records the daily allowance the response reports", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValueOnce(okRes({ choices: [{ message: { content: "OK" } }] }, {
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-reset-requests": "2h30m",
        "x-ratelimit-limit-tokens": "500000",
        "x-ratelimit-remaining-tokens": "12345",
      })));

    await hostedProvider.chat({ user: "hi" });
    // Zero remaining has to survive as zero, not become "unknown".
    expect(AI_STATUS.quota.requests).toEqual({ limit: 1000, remaining: 0, reset: "2h30m" });
    expect(AI_STATUS.quota.tokens.remaining).toBe(12345);
  });

  it("leaves the allowance unknown when the provider sends no headers", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValueOnce(okRes({ choices: [{ message: { content: "OK" } }] })));
    await hostedProvider.chat({ user: "hi" });
    expect(AI_STATUS.quota).toBeNull();
  });

  it("distinguishes a blocked browser call from a provider rejection", async () => {
    // fetch throws a bare TypeError for both a dead network and a CORS
    // refusal; the advice for either is the same and is not "check your key".
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockRejectedValueOnce(new TypeError("Failed to fetch")));

    const err = await hostedProvider.chat({ user: "hi" }).catch((e) => e);
    expect(err.code).toBe("blocked");
    expect(friendlyError(err)).toMatch(/relay/);
  });

  it("routes through the relay and names the provider when one is deployed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okRes({ service: "unison-ai-relay", version: 3, providers: { groq: true } }))
      .mockResolvedValueOnce(okRes({ choices: [{ message: { content: "OK" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await hostedProvider.chat({ user: "hi" })).toBe("OK");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(AI_CONFIG.aiRelayEndpoint);
    expect(init.headers["x-unison-provider"]).toBe("groq");
    expect(init.headers.Authorization).toBeUndefined(); // the key stays on the server
  });

  it("reports a relay with no key for the chosen provider as not configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okRes({ service: "unison-ai-relay", version: 3, providers: { groq: false, anthropic: true } })));
    expect(await hostedProvider.configured()).toBe(false);
  });
});

describe("hostedProvider.listModels", () => {
  it("keeps chat models and drops the ones no text feature can use", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okRes({ data: [
      { id: "llama-3.3-70b-versatile" },
      { id: "whisper-large-v3" },
      { id: "meta-llama/llama-guard-4-12b" },
      { id: "openai/gpt-oss-120b" },
    ] })));

    expect(await hostedProvider.listModels()).toEqual(["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]);
  });

  it("lets the discovered list drive the picker, keeping the notes we wrote", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okRes({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "brand-new-model" }] })));
    await hostedProvider.listModels();
    const list = modelsFor("groq");
    expect(list.map((m) => m.id)).toEqual(["brand-new-model", "llama-3.3-70b-versatile"]);
    expect(list.find((m) => m.id === "llama-3.3-70b-versatile").note).toMatch(/default/);
  });

  it("surfaces a rejected key rather than silently emptying the picker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errRes(401, { error: { message: "Invalid API Key" } })));
    await expect(hostedProvider.listModels()).rejects.toMatchObject({ code: "bad-key" });
  });
});

describe("settings", () => {
  it("keeps a key per provider, so switching does not lose the other one", () => {
    saveAISettings({ provider: "anthropic" });
    expect(activeKey()).toBe("sk-ant-test");
    expect(activeModel()).toBe("claude-opus-5");
    saveAISettings({ provider: "groq" });
    expect(activeKey()).toBe("gsk_test");
    expect(activeModel()).toBe("llama-3.3-70b-versatile");
  });

  it("merges a partial patch instead of dropping the untouched provider", () => {
    saveAISettings({ keys: { groq: "gsk_new" } });
    expect(AI_CONFIG.keys.groq).toBe("gsk_new");
    expect(AI_CONFIG.keys.anthropic).toBe("sk-ant-test");
  });

  it("survives a settings blob saved before Groq existed", () => {
    localStorage.setItem("unison:ai:v1", JSON.stringify({ apiKey: "sk-ant-old", model: "claude-sonnet-5", effort: "high" }));
    AI_CONFIG.keys.anthropic = "";
    loadAISettings();
    expect(AI_CONFIG.keys.anthropic).toBe("sk-ant-old");
    expect(AI_CONFIG.models.anthropic).toBe("claude-sonnet-5");
    expect(AI_CONFIG.provider).toBe("groq"); // free by default; the old key is still there to switch to
  });

  it("ships with local models off, so a machine without Ollama pays no probe", () => {
    // The probe costs 1.5s on the first call and almost no marketing laptop
    // runs Ollama, so the default has to be off.
    saveAISettings({ useLocal: false });
    localStorage.clear();
    loadAISettings();
    expect(AI_CONFIG.useLocal).toBe(false);
  });

  it("honours a stored preference for local models", () => {
    saveAISettings({ useLocal: true });
    AI_CONFIG.useLocal = false;
    loadAISettings();
    expect(AI_CONFIG.useLocal).toBe(true);
    saveAISettings({ useLocal: false });
  });

  it("never lets a key reach the exported session blob", () => {
    saveAISettings({ keys: { groq: "gsk_secret" } });
    expect(localStorage.getItem("unison:session:v1") || "").not.toMatch(/gsk_secret/);
  });
});

describe("aiRouter", () => {
  it("names the model it used, so the developer panel is not guessing", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValueOnce(okRes({ choices: [{ message: { content: "OK" } }] })));
    await aiRouter.run({ capability: "writing", user: "hi" });
    expect(AI_STATUS.routed.writing).toBe("groq · llama-3.3-70b-versatile");
  });

  it("reports the search model when the call searches", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValueOnce(okRes({ choices: [{ message: { content: "OK" } }] })));
    await aiRouter.run({ capability: "research", user: "hi", search: true });
    expect(AI_STATUS.routed.research).toBe("groq · groq/compound + search");
  });

  it("gives up rather than hanging when the model never answers", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockImplementationOnce(abortable));

    await expect(aiRouter.run({ user: "hi", timeoutMs: 30 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("passes the caller's cancellation through as a cancellation, not a timeout", async () => {
    // "Cancelled." and "The AI service took too long." are different messages
    // and the user must not see the second one for a Stop they pressed.
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(noRelay()).mockImplementationOnce(abortable));

    const p = aiRouter.run({ user: "hi", signal: ctrl.signal });
    ctrl.abort();
    const err = await p.catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect(err.code).toBeUndefined();
    expect(friendlyError(err)).toBe("Cancelled.");
  });
});

describe("the shipped model list", () => {
  it("defaults to a model that is on the list", () => {
    expect(MODELS.groq.some((m) => m.id === AI_CONFIG.models.groq)).toBe(true);
    expect(MODELS.anthropic.some((m) => m.id === AI_CONFIG.models.anthropic)).toBe(true);
  });

  it("defaults to a search model that can actually search", () => {
    expect(MODELS.groq.find((m) => m.id === AI_CONFIG.searchModel)?.search).toBe(true);
  });

  it("marks Groq free and Anthropic paid, which is what the UI promises", () => {
    expect(PROVIDERS.groq.free).toBe(true);
    expect(PROVIDERS.anthropic.free).toBe(false);
    expect(AI_CONFIG.provider).toBe("groq");
  });
});
