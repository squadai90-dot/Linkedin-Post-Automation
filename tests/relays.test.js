import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* The image and video relays, exercised with the upstream mocked.
 *
 * These are NOT live provider tests — no OpenAI, Google or Runway call is
 * made here, and this environment could not make one if it tried. What they
 * prove is everything this repository is responsible for: that keys stay on
 * the server, that a client cannot steer the request at an endpoint or
 * parameter the handler does not name, and that every failure comes back as
 * something the UI can explain.
 */

const res = () => {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
};

const load = async (file) => {
  vi.resetModules();
  return (await import(`../api/${file}?t=${Math.random()}`)).default;
};

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status, body) => ({ ok: false, status, json: async () => body });

let fetchMock;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllEnvs?.(); vi.unstubAllGlobals(); });

describe("the image relay", () => {
  it("reports itself unconfigured when no key is set, rather than failing later", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("GOOGLE_API_KEY", "");
    const h = await load("image.js");
    const r = res();
    await h({ method: "GET", headers: {} }, r);
    expect(r.body.configured).toBe(false);
    expect(r.body.defaultProvider).toBeNull();
  });

  it("refuses to generate with no key, and says what to do about it", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("GOOGLE_API_KEY", "");
    const h = await load("image.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here" } }, r);
    expect(r.code).toBe(503);
    expect(r.body.code).toBe("not_configured");
    expect(r.body.message).toMatch(/OPENAI_API_KEY|GOOGLE_API_KEY/);
  });

  it("publishes its pricing so the UI can show a cost before spending", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const h = await load("image.js");
    const r = res();
    await h({ method: "GET", headers: {} }, r);
    expect(r.body.configured).toBe(true);
    expect(r.body.pricing.openai.usdPerImage).toBeGreaterThan(0);
  });

  it("never returns the key, in any response", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-SECRET-VALUE");
    const h = await load("image.js");
    for (const req of [{ method: "GET", headers: {} }, { method: "POST", headers: {}, body: { prompt: "x" } }]) {
      const r = res();
      await h(req, r);
      expect(JSON.stringify(r.body)).not.toContain("sk-SECRET-VALUE");
    }
  });

  it("sends the key to the provider as a header, never in the body", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-SECRET-VALUE");
    fetchMock.mockResolvedValue(okJson({ data: [{ b64_json: "QUJD" }] }));
    const h = await load("image.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here", shape: "wide" } }, r);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(init.headers.Authorization).toContain("sk-SECRET-VALUE");
    expect(init.body).not.toContain("sk-SECRET-VALUE");
    expect(r.body.b64).toBe("QUJD");
    expect(r.body.usd).toBeGreaterThan(0);
  });

  it("rebuilds the upstream request, so a client cannot smuggle parameters", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    fetchMock.mockResolvedValue(okJson({ data: [{ b64_json: "QUJD" }] }));
    const h = await load("image.js");
    await h({ method: "POST", headers: {}, body: {
      prompt: "a long enough prompt here",
      model: "some-other-model", n: 50, endpoint: "https://evil.example/x", moderation: "off",
    } }, res());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("api.openai.com");
    const sent = JSON.parse(init.body);
    expect(sent.n).toBe(1);
    expect(sent.model).not.toBe("some-other-model");
    expect(sent.moderation).toBeUndefined();
  });

  it("rejects a prompt too short to mean anything", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const h = await load("image.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "hi" } }, r);
    expect(r.code).toBe(400);
    expect(r.body.code).toBe("bad_prompt");
  });

  it("turns an upstream refusal into a message, not a stack trace", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    fetchMock.mockResolvedValue(errJson(429, { error: { message: "Rate limit reached" } }));
    const h = await load("image.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here" } }, r);
    expect(r.code).toBe(502);
    expect(r.body.message).toContain("Rate limit reached");
  });

  it("enforces the relay token when one is set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test"); vi.stubEnv("UNISON_RELAY_TOKEN", "letmein");
    const h = await load("image.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here" } }, r);
    expect(r.code).toBe(401);
  });
});

describe("the video relay", () => {
  it("is unconfigured without a key and says so", async () => {
    vi.stubEnv("GOOGLE_API_KEY", ""); vi.stubEnv("RUNWAY_API_KEY", "");
    const h = await load("video.js");
    const r = res();
    await h({ method: "GET", headers: {} }, r);
    expect(r.body.configured).toBe(false);
  });

  it("prices per second and caps the duration the provider supports", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    fetchMock.mockResolvedValue(okJson({ name: "operations/abc" }));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here", seconds: 300 } }, r);
    expect(r.code).toBe(202);
    expect(r.body.seconds).toBeLessThanOrEqual(8);      // Veo's cap, not the client's number
    expect(r.body.usd).toBeCloseTo(0.05 * r.body.seconds, 3);
    expect(r.body.state).toBe("running");
  });

  it("reports a job still running without pretending it finished", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    fetchMock.mockResolvedValue(okJson({ done: false }));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "status", id: "operations/abc" } }, r);
    expect(r.body.state).toBe("running");
    expect(r.body.b64).toBeUndefined();
  });

  it("surfaces a provider-side failure instead of returning an empty video", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    fetchMock.mockResolvedValue(okJson({ done: true, error: { message: "Safety filter triggered" } }));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "status", id: "operations/abc" } }, r);
    expect(r.code).toBe(502);
    expect(r.body.message).toContain("Safety filter");
  });

  it("tells the user Runway needs a starting image rather than failing obscurely", async () => {
    vi.stubEnv("GOOGLE_API_KEY", ""); vi.stubEnv("RUNWAY_API_KEY", "rw-test");
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here" } }, r);
    expect(r.code).toBe(502);
    expect(r.body.message).toMatch(/starting image/i);
  });

  it("never returns the key", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-SECRET-VALUE");
    const h = await load("video.js");
    const r = res();
    await h({ method: "GET", headers: {} }, r);
    expect(JSON.stringify(r.body)).not.toContain("g-SECRET-VALUE");
  });
});
