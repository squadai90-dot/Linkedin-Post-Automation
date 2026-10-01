import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkDeployment, RELAYS } from "../src/lib/diagnostics.js";

/* The deployed app reported "missing Groq key" without saying which variable,
   where to set it, or that a redeploy is needed. These pin the fix. */

let fetchMock;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

const reply = (map) => fetchMock.mockImplementation(async (url) => {
  const key = Object.keys(map).find((k) => String(url).startsWith(k) && (k.includes("?") || !String(url).includes("?") || String(url).startsWith(k + "?")));
  const body = map[String(url)] ?? (key ? map[key] : undefined);
  if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => body };
});

describe("the deployment check", () => {
  it("names the exact variable that is missing, and the redeploy", async () => {
    reply({
      "/api/ai": { service: "unison-ai-relay", providers: { groq: false, anthropic: false } },
      "/api/image": { service: "unison-image-relay", configured: false },
      "/api/video": { service: "unison-video-relay", configured: false },
      "/api/canva": { service: "unison-canva-relay", configured: true, configSource: "env", clientId: "OC-AB…", hasSecret: true, redirectUri: "https://x.vercel.app/" },
      "/api/publish": { service: "unison-publish-relay", webhookConfigured: false },
      "/api/workspace?health": { service: "unison-workspace", configured: false },
    });
    const r = await checkDeployment();
    expect(r.deployed).toBe(true);
    const ai = r.rows.find((x) => x.id === "ai");
    expect(ai.state).toBe("missing");
    expect(ai.fix).toMatch(/GROQ_API_KEY/);
    expect(ai.fix).toMatch(/Redeploy/);
    expect(r.rows.find((x) => x.id === "canva").state).toBe("ok");
    expect(r.rows.find((x) => x.id === "image").fix).toMatch(/OPENAI_API_KEY/);
  });

  it("tells a set-but-invalid key apart from a missing one", async () => {
    reply({
      "/api/ai?models": { ok: false, reason: "Groq rejected GROQ_API_KEY — it is set, but invalid or revoked." },
      "/api/ai": { service: "unison-ai-relay", providers: { groq: true } },
    });
    const ai = (await checkDeployment()).rows.find((x) => x.id === "ai");
    expect(ai.state).toBe("invalid");
    expect(ai.detail).toMatch(/invalid or revoked/);
    expect(ai.fix).toMatch(/console\.groq\.com/);
  });

  it("confirms a working key by actually using it", async () => {
    reply({
      "/api/ai?models": { ok: true, models: ["llama-3.3-70b-versatile", "groq/compound"] },
      "/api/ai": { service: "unison-ai-relay", providers: { groq: true } },
    });
    const ai = (await checkDeployment()).rows.find((x) => x.id === "ai");
    expect(ai.state).toBe("ok");
    expect(ai.verified).toBe(true);
    expect(ai.detail).toMatch(/works — 2 models/);
  });

  it("says plainly when there is no backend at all", async () => {
    reply({});
    const r = await checkDeployment();
    expect(r.deployed).toBe(false);
    expect(r.rows.every((x) => x.state === "absent")).toBe(true);
  });

  it("never asks a relay for a value — only names", () => {
    for (const r of RELAYS) for (const v of r.vars) expect(v).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });
});

describe("the AI relay's model list", () => {
  const res = () => { const r = { code: 0, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
  const load = async (file) => { vi.resetModules(); return (await import(`../api/${file}?t=${Math.random()}`)).default; };

  it("reports a missing key by name without calling Groq", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const h = await load("ai.js");
    const r = res();
    await h({ method: "GET", query: { models: "" }, headers: {} }, r);
    expect(r.body.ok).toBe(false);
    expect(r.body.reason).toMatch(/GROQ_API_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("lists models with the server's key, and never returns the key", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_server_secret");
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "whisper-large-v3" }, { id: "groq/compound" }] }) });
    const h = await load("ai.js");
    const r = res();
    await h({ method: "GET", query: { models: "" }, headers: {} }, r);
    expect(r.body.models).toEqual(["groq/compound", "llama-3.3-70b-versatile"]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer gsk_server_secret");
    expect(JSON.stringify(r.body)).not.toContain("gsk_server_secret");
    vi.unstubAllEnvs();
  });

  it("calls a rejected key what it is", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_bad");
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: "Invalid API Key" } }) });
    const h = await load("ai.js");
    const r = res();
    await h({ method: "GET", query: { models: "" }, headers: {} }, r);
    expect(r.body.reason).toMatch(/rejected GROQ_API_KEY/);
    vi.unstubAllEnvs();
  });

  it("a completion with no server key names the variable and the redeploy", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const h = await load("ai.js");
    const r = res();
    await h({ method: "POST", headers: { "x-unison-provider": "groq" }, body: { messages: [{ role: "user", content: "hi" }] } }, r);
    expect(r.code).toBe(503);
    expect(r.body.error.code).toBe("no_server_key");
    expect(r.body.error.message).toMatch(/GROQ_API_KEY.*redeploy/i);
    vi.unstubAllEnvs();
  });
});
