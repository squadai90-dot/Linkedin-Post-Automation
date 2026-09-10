/* Model tiers, the daily-limit step-down, and link corroboration. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AI_CONFIG, MODEL_REGISTRY, TIER_DEFAULTS, modelForTier, aiRouter, saveAISettings,
  markSpent, isSpent, clearSpent, providerError, hostedProvider, AI_STATUS, resetDiscovered, loadAISettings,
  searchedUrls, sameTarget, isPlaceholderUrl, corroborateSources, blockedRemedy,
} from "../src/lib/ai.js";

const headers = (o = {}) => ({ get: (k) => o[k.toLowerCase()] ?? null });
const okRes = (body, h) => ({ ok: true, status: 200, headers: headers(h), json: async () => body });
const errRes = (status, body, h) => ({ ok: false, status, headers: headers(h), json: async () => body });
const noRelay = () => ({ ok: false, status: 404, headers: headers(), json: async () => ({}) });
const groqOk = (text) => okRes({ choices: [{ message: { content: text } }] });
const dailyLimit = (model) => errRes(429, { error: { message: `Rate limit reached for model \`${model}\`: tokens per day (TPD)` } }, { "retry-after": "3m20s" });

beforeEach(() => {
  localStorage.clear();
  clearSpent();
  resetDiscovered();
  saveAISettings({ provider: "groq", keys: { groq: "gsk_t" }, models: { groq: "llama-3.3-70b-versatile" }, useLocal: false, useTiers: true, autoDowngrade: true, tiers: { groq: { fast: "", strong: "" } } });
  hostedProvider.reset();
  AI_STATUS.blocked = null;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

describe("model tiers", () => {
  it("gives the draft the strongest model and a prompt the fastest", () => {
    // These are the two ends of the range: one is read by a human and carries
    // the brand, the other feeds a renderer.
    expect(MODEL_REGISTRY.writing.tier).toBe("strong");
    expect(MODEL_REGISTRY.imagePrompt.tier).toBe("fast");
    expect(modelForTier("strong")).toBe(TIER_DEFAULTS.groq.strong);
    expect(modelForTier("fast")).toBe(TIER_DEFAULTS.groq.fast);
  });

  it("keeps the visible Model picker meaning the standard tier", () => {
    saveAISettings({ models: { groq: "moonshotai/kimi-k2-instruct" } });
    expect(modelForTier("standard")).toBe("moonshotai/kimi-k2-instruct");
  });

  it("honours an explicit override over the default", () => {
    saveAISettings({ tiers: { groq: { strong: "qwen/qwen3-32b" } } });
    expect(modelForTier("strong")).toBe("qwen/qwen3-32b");
    expect(modelForTier("fast")).toBe(TIER_DEFAULTS.groq.fast); // untouched
  });

  it("survives a reload — a tier override is a setting, not a session", () => {
    saveAISettings({ tiers: { groq: { strong: "qwen/qwen3-32b" } } });
    // Wipe the in-memory config the way a page load does, then read it back.
    AI_CONFIG.tiers.groq.strong = "";
    loadAISettings();
    expect(AI_CONFIG.tiers.groq.strong).toBe("qwen/qwen3-32b");
    expect(modelForTier("strong")).toBe("qwen/qwen3-32b");
  });

  it("routes everything to one model when tiering is off", () => {
    saveAISettings({ useTiers: false });
    expect(aiRouter.plan("writing").model).toBe("llama-3.3-70b-versatile");
    expect(aiRouter.plan("imagePrompt").model).toBe("llama-3.3-70b-versatile");
  });

  it("sends a search call to the search model whatever the capability's tier", () => {
    expect(aiRouter.plan("research", true).model).toBe(AI_CONFIG.searchModel);
  });

  it("forgets the discovered model list when the key changes", async () => {
    // A list belongs to the account that produced it. Kept across a key
    // change, it silently vetoes models the new key is entitled to.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okRes({ data: [{ id: "llama-3.3-70b-versatile" }] })));
    await hostedProvider.listModels();
    expect(modelForTier("strong")).toBe("llama-3.3-70b-versatile");

    saveAISettings({ keys: { groq: "gsk_a_different_key" } });
    expect(modelForTier("strong")).toBe(TIER_DEFAULTS.groq.strong);
  });

  it("falls back to the standard model when the key cannot use the tier model", async () => {
    // A tier pointing at a model the account does not have is worse than no
    // tiering, so the discovered list gets a veto.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okRes({ data: [{ id: "llama-3.3-70b-versatile" }] })));
    await hostedProvider.listModels();
    expect(modelForTier("strong")).toBe("llama-3.3-70b-versatile");
  });
});

describe("the daily limit", () => {
  it("reads a per-day 429 as a spent allowance, not ordinary throttling", () => {
    expect(providerError(429, { error: { message: "tokens per day (TPD)" } }).code).toBe("daily-limit");
    expect(providerError(429, { error: { message: "requests per minute" } }).code).toBe("rate");
  });

  it("takes the reset time from the response instead of assuming a day", () => {
    const e = providerError(429, { error: { message: "try again in 3m20s" } }, { headers: headers({ "retry-after": "3m20s" }) });
    expect(e.resetHint).toBe("3m20s");

    /* Own the clock explicitly and hand it back in afterEach — a stray fake
       clock makes every later test's "is this model still spent?" answer
       nonsense. */
    vi.useFakeTimers();
    markSpent("m", e.resetHint);
    expect(isSpent("m")).toBe(true);
    // Not marked for 24 hours: a 3-minute wall must clear on its own.
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(isSpent("m")).toBe(false);
  });

  it("assumes a day when the provider gives no hint", () => {
    vi.useFakeTimers();
    markSpent("m", null);
    vi.advanceTimersByTime(23 * 3600 * 1000);
    expect(isSpent("m")).toBe(true);
    vi.advanceTimersByTime(2 * 3600 * 1000);
    expect(isSpent("m")).toBe(false);
  });

  it("steps down a tier rather than dropping to sample data", async () => {
    const notices = [];
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValueOnce(dailyLimit(TIER_DEFAULTS.groq.strong))   // strong is spent
      .mockResolvedValueOnce(groqOk("a real answer")));               // standard answers

    const out = await aiRouter.run({ capability: "writing", user: "draft this", onNotice: (n) => notices.push(n) });
    expect(out).toBe("a real answer");
    expect(notices.map((n) => n.kind)).toEqual(["spent", "downgraded"]);
    expect(notices[1].to).toBe("llama-3.3-70b-versatile");
    expect(AI_STATUS.routed.writing).toMatch(/stepped down/);
  });

  it("does not spend a round trip on a model already known to be out", async () => {
    markSpent(TIER_DEFAULTS.groq.strong);
    const fetchMock = vi.fn().mockResolvedValueOnce(noRelay()).mockResolvedValueOnce(groqOk("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await aiRouter.run({ capability: "writing", user: "x" });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe("llama-3.3-70b-versatile");
    expect(fetchMock).toHaveBeenCalledTimes(2); // probe + one call, no wasted 429
  });

  it("gives up when every tier is spent, rather than looping", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValue(dailyLimit("any")));
    await expect(aiRouter.run({ capability: "writing", user: "x" })).rejects.toMatchObject({ code: "daily-limit" });
  });

  it("never retries a bad key on another model", async () => {
    // A rejected key fails identically everywhere; retrying just burns time.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockResolvedValueOnce(errRes(401, { error: { message: "Invalid API Key" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiRouter.run({ capability: "writing", user: "x" })).rejects.toMatchObject({ code: "bad-key" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops stepping down when the team turns it off", async () => {
    saveAISettings({ autoDowngrade: false });
    hostedProvider.reset();
    const fetchMock = vi.fn().mockResolvedValueOnce(noRelay()).mockResolvedValueOnce(dailyLimit("x"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiRouter.run({ capability: "writing", user: "x" })).rejects.toMatchObject({ code: "daily-limit" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("link corroboration", () => {
  it("collects the URLs the model actually searched", () => {
    const data = { choices: [{ message: { content: '{"url":"https://invented.example/story"}', executed_tools: [{ type: "search", output: 'Result: https://real.news/a-story — headline' }] } }] };
    const urls = searchedUrls(data);
    expect(urls).toContain("https://real.news/a-story");
    // Never from the message content: that is the text we are checking.
    expect(urls.join(" ")).not.toContain("invented.example");
  });

  it("returns nothing when the model reported no searches", () => {
    expect(searchedUrls({ choices: [{ message: { content: "https://somewhere/x" } }] })).toEqual([]);
  });

  it("treats the same page written two ways as the same page", () => {
    expect(sameTarget("https://www.a.com/x/", "https://a.com/x")).toBe(true);
    expect(sameTarget("https://a.com/x", "https://a.com/y")).toBe(false);
    expect(sameTarget("not a url", "https://a.com/x")).toBe(false);
  });

  it("knows a placeholder domain on sight", () => {
    expect(isPlaceholderUrl("https://example.com/a")).toBe(true);
    expect(isPlaceholderUrl("https://reuters.com/a")).toBe(false);
    expect(isPlaceholderUrl("")).toBe(true);
  });

  it("marks retrieved links apart from ones the model only wrote down", () => {
    const out = corroborateSources(
      [{ title: "Real", url: "https://real.news/a-story" }, { title: "Invented", url: "https://plausible.co/nope" }],
      ["https://real.news/a-story"]
    );
    expect(out[0].link).toBe("retrieved");
    expect(out[1].link).toBe("unconfirmed");
  });

  it("says nothing rather than casting doubt when no search record exists", () => {
    // "unknown" must not render as a warning: absence of evidence about the
    // search is not evidence the link is fake.
    const out = corroborateSources([{ title: "A", url: "https://real.news/x" }], []);
    expect(out[0].link).toBe("unknown");
  });

  it("trusts an upload and background reading without a search record", () => {
    const out = corroborateSources([{ title: "Mine", url: "https://x.com/a", uploaded: true }], ["https://other/y"]);
    expect(out[0].link).toBe("retrieved");
  });

  it("flags a placeholder even when the model claims it searched", () => {
    const out = corroborateSources([{ title: "Fake", url: "https://example.com/a" }], ["https://example.com/a"]);
    expect(out[0].link).toBe("placeholder");
  });

  it("survives rows with no url and rows that are not objects", () => {
    const out = corroborateSources([{ title: "No link" }, null, "nonsense"], ["https://a/b"]);
    expect(out[0].link).toBe("none");
    expect(out[1]).toBeNull();
  });
});

describe("a blocked browser call", () => {
  it("records the block and offers remedies in order", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(noRelay())
      .mockRejectedValueOnce(new TypeError("Failed to fetch")));
    await hostedProvider.chat({ user: "hi" }).catch(() => {});
    expect(AI_STATUS.blocked?.provider).toBe("groq");
    const r = blockedRemedy();
    expect(r.provider).toBe("Groq");
    expect(r.steps.length).toBeGreaterThanOrEqual(3);
    expect(r.steps.join(" ")).toMatch(/api\/ai\.js/);
  });

  it("clears the block as soon as a call gets through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(noRelay()).mockRejectedValueOnce(new TypeError("Failed to fetch")));
    await hostedProvider.chat({ user: "hi" }).catch(() => {});
    expect(AI_STATUS.blocked).toBeTruthy();

    hostedProvider.reset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(noRelay()).mockResolvedValueOnce(groqOk("ok")));
    await hostedProvider.chat({ user: "hi" });
    expect(AI_STATUS.blocked).toBeNull();
  });
});
