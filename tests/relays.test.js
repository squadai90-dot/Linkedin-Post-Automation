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
  const r = { code: 0, body: null, headers: {}, chunks: [], ended: false };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  /* streamed responses */
  Object.defineProperty(r, "statusCode", { set: (c) => { r.code = c; }, get: () => r.code });
  r.write = (b) => { r.chunks.push(Buffer.from(b)); return true; };
  r.end = () => { r.ended = true; return r; };
  r.bytes = () => Buffer.concat(r.chunks);
  return r;
};

/* A fetch Response whose body arrives in the given pieces, as a real one does. */
const streamed = (pieces, headers = {}) => ({
  ok: true, status: 200,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  body: {
    getReader() {
      const queue = pieces.map((p) => new Uint8Array(Buffer.from(p)));
      return { read: async () => (queue.length ? { done: false, value: queue.shift() } : { done: true }), cancel: async () => {} };
    },
  },
});
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(40, 7)]);
const googleDone = (uri) => okJson({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri } }] } } });

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

  it("asks gpt-image for a JPEG, so the answer fits under Vercel's 4.5 MB response cap", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    fetchMock.mockResolvedValue(okJson({ data: [{ b64_json: "QUJD" }] }));
    const h = await load("image.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here" } }, r);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.output_format).toBe("jpeg");
    expect(r.body.mime).toBe("image/jpeg");
  });

  it("explains an image too large to return, instead of letting the platform fail it", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    fetchMock.mockResolvedValue(okJson({ data: [{ b64_json: "A".repeat(4.5 * 1024 * 1024) }] }));
    const h = await load("image.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here" } }, r);
    expect(r.code).toBe(502);
    expect(r.body.code).toBe("too_large");
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

  it("never attaches the Google key to a download address that is not Google's", async () => {
    /* The address comes out of the provider's job response, and the relay adds
       an API key to it. If that address were ever not Google's, the key would
       be handed to whoever owned it. The host is checked before the key goes on. */
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    for (const action of ["status", "download"]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(googleDone("https://evil.test/steal.mp4"));
      const h = await load("video.js");
      const r = res();
      await h({ method: "POST", headers: {}, body: { action, id: "operations/abc" } }, r);
      expect(r.body.ok).not.toBe(true);
      expect(String(r.body.message)).toMatch(/unexpected address/i);
      /* one call to read the job, and no download attempt at all */
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(r.body)).not.toContain("g-test");
    }
  });

  it("refuses a look-alike host that merely ends in googleapis.com", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    fetchMock.mockResolvedValue(googleDone("https://evilgoogleapis.com/x.mp4"));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "download", id: "operations/abc" } }, r);
    expect(r.body.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a finished job without putting the video, or the key, in the status answer", async () => {
    /* A Vercel function response is capped at 4.5 MB unless streamed, and an
       8-second clip is often bigger, so status only says the job is done. */
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    fetchMock.mockResolvedValue(googleDone("https://generativelanguage.googleapis.com/v1beta/files/x:download"));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "status", id: "operations/abc" } }, r);
    expect(r.body.state).toBe("done");
    expect(r.body.b64).toBeUndefined();
    expect(r.body.uri).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain("g-test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("streams the finished video from Google's own host, with the key added server-side", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    fetchMock.mockResolvedValueOnce(googleDone("https://generativelanguage.googleapis.com/v1beta/files/x:download"));
    /* the signature arrives split across reads, as it can on a real network */
    fetchMock.mockResolvedValueOnce(streamed([MP4.subarray(0, 5), MP4.subarray(5, 9), MP4.subarray(9)], { "content-length": String(MP4.length) }));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "download", id: "operations/abc" } }, r);
    expect(r.code).toBe(200);
    expect(r.headers["Content-Type"]).toBe("video/mp4");
    expect(r.ended).toBe(true);
    expect(r.bytes().equals(MP4)).toBe(true);
    const dl = String(fetchMock.mock.calls[1][0]);
    expect(dl).toContain("generativelanguage.googleapis.com");
    expect(dl).toContain("key=g-test");
    /* the key went upstream, never back to the browser */
    expect(r.bytes().toString("latin1")).not.toContain("g-test");
  });

  it("refuses to pass on a 'video' whose bytes are not an MP4", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    fetchMock.mockResolvedValueOnce(googleDone("https://generativelanguage.googleapis.com/v1beta/files/x:download"));
    fetchMock.mockResolvedValueOnce(streamed(["<html>quota exceeded</html>"]));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "download", id: "operations/abc" } }, r);
    expect(r.code).toBe(502);
    expect(r.body.message).toMatch(/not an MP4/);
    expect(r.chunks.length).toBe(0);
  });

  it("will not download a job that has not finished", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    fetchMock.mockResolvedValue(okJson({ done: false }));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "download", id: "operations/abc" } }, r);
    expect(r.code).toBe(409);
    expect(r.body.code).toBe("not_ready");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("streams a Runway result and hands back its address for a Canva import", async () => {
    vi.stubEnv("GOOGLE_API_KEY", ""); vi.stubEnv("RUNWAY_API_KEY", "rw-test");
    const done = okJson({ status: "SUCCEEDED", output: ["https://dnznrvs05pmza.cloudfront.net/clip.mp4?sig=1"] });
    fetchMock.mockResolvedValueOnce(done);
    let h = await load("video.js");
    let r = res();
    await h({ method: "POST", headers: {}, body: { action: "status", id: "task-1" } }, r);
    expect(r.body.state).toBe("done");
    expect(r.body.sourceUrl).toMatch(/^https:\/\//);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(done);
    fetchMock.mockResolvedValueOnce(streamed([MP4]));
    h = await load("video.js");
    r = res();
    await h({ method: "POST", headers: {}, body: { action: "download", id: "task-1" } }, r);
    expect(r.bytes().equals(MP4)).toBe(true);
    /* the Runway key is a header on Runway's API, never sent to the file host */
    expect(fetchMock.mock.calls[1][1]?.headers?.Authorization).toBeUndefined();
  });

  it("refuses an insecure Runway video address", async () => {
    vi.stubEnv("GOOGLE_API_KEY", ""); vi.stubEnv("RUNWAY_API_KEY", "rw-test");
    fetchMock.mockResolvedValue(okJson({ status: "SUCCEEDED", output: ["http://example.test/clip.mp4"] }));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "download", id: "task-1" } }, r);
    expect(r.body.ok).toBe(false);
    expect(r.body.message).toMatch(/insecure/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends Runway a JPEG starting frame with the right type", async () => {
    vi.stubEnv("GOOGLE_API_KEY", ""); vi.stubEnv("RUNWAY_API_KEY", "rw-test");
    fetchMock.mockResolvedValue(okJson({ id: "task-1" }));
    const h = await load("video.js");
    const r = res();
    await h({ method: "POST", headers: {}, body: { prompt: "a long enough prompt here", imageB64: "QUJD", imageMime: "image/jpeg" } }, r);
    expect(r.code).toBe(202);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).promptImage).toBe("data:image/jpeg;base64,QUJD");
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
