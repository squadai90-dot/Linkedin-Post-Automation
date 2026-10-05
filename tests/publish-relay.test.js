import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* The relay and the Make scenario have to agree on how the post is carried,
 * and nothing else in the test suite checked that they do.
 *
 * The scenario's first step is Parse JSON on {{1.value}} — the raw body Make
 * exposes for a text/plain request. The relay used to send application/json,
 * which Make splits into fields instead, leaving `value` empty: the parse
 * step failed validation ("Validation failed for 1 parameter(s)") and Make
 * answered 500 before any LinkedIn module ran. Every post published from the
 * deployed app through this relay failed that way; the browser path, which
 * already sent text/plain, worked. These tests pin the two together.
 *
 * Make itself is mocked. What this proves is the shape of the request the
 * relay sends; one live post from the deployed app proves Make accepts it. */

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

const res = () => {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
};

const load = async () => {
  vi.resetModules();
  return (await import("../api/publish.js")).default;
};

const PAYLOAD = {
  source: "unison-content-os",
  postId: "p-w-test1",
  idempotencyKey: "p-w-test1",
  postType: "image",
  content: "Happy Navratri from all of us!",
  company: "Unison",
  companyUrn: "urn:li:organization:146260120",
  publishMode: "scheduled",
  scheduledDate: "2026-10-06",
  scheduledTime: "09:30",
  timezone: "Asia/Calcutta",
  submittedBy: null,
  media: [{ kind: "image", filename: "unison-elegant-traditional.png", mimeType: "image/png", data: "iVBORw0KGgo=", altText: "" }],
  poll: null,
};

let fetchMock;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs?.(); });

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

describe("the publish relay speaks the scenario's language", () => {
  it("the scenario parses the raw text body, {{1.value}}", () => {
    const blueprint = JSON.parse(read("make/scenario-a-linkedin-publisher.json"));
    const parse = blueprint.flow.find((m) => m.module === "json:ParseJSON");
    expect(parse, "scenario A no longer starts with Parse JSON").toBeTruthy();
    expect(parse.mapper.json).toBe("{{1.value}}");
  });

  it("forwards the post as text/plain, so Make delivers it as `value`", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "queued", postId: PAYLOAD.postId, mode: "scheduled" }));
    const h = await load();
    await h({ method: "POST", headers: {}, body: PAYLOAD }, res());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("hook.eu1.make.com/mkm7o4tvytb4cgfs91se3qnjy5pvucge");
    expect(init.headers["Content-Type"]).toMatch(/^text\/plain/);
    expect(init.headers["Content-Type"]).not.toMatch(/json/i);
  });

  it("sends the whole payload, byte for byte, as the JSON text the parse step reads", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "queued" }));
    const h = await load();
    await h({ method: "POST", headers: {}, body: PAYLOAD }, res());
    const sent = fetchMock.mock.calls[0][1].body;
    expect(typeof sent).toBe("string");
    /* What {{1.value}} will hold, parsed the way Parse JSON parses it. */
    expect(JSON.parse(sent)).toEqual(PAYLOAD);
  });

  it("is the same transport the browser path already used successfully", () => {
    const client = read("src/lib/publish.js");
    expect(client).toMatch(/text:\s*\(json\)\s*=>\s*\(\{\s*headers:\s*\{\s*"Content-Type":\s*"text\/plain;charset=UTF-8"/);
    expect(read("api/publish.js")).toContain('"Content-Type": "text/plain;charset=UTF-8"');
  });

  it("passes a queued reply back unchanged", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "queued", postId: PAYLOAD.postId, mode: "scheduled", message: "Queued in Make. Nothing is on LinkedIn yet." }));
    const h = await load();
    const r = res();
    await h({ method: "POST", headers: {}, body: PAYLOAD }, r);
    expect(r.code).toBe(200);
    expect(r.body.state).toBe("queued");
    expect(r.body.published).toBe(false);
  });

  it("still reports Make's refusal as a refusal, with its status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "Scenario failed to complete." });
    const h = await load();
    const r = res();
    await h({ method: "POST", headers: {}, body: { ...PAYLOAD, postId: "p-w-test2", idempotencyKey: "p-w-test2" } }, r);
    expect(r.code).toBe(502);
    expect(r.body.delivered).toBe(false);
    expect(r.body.makeStatus).toBe(500);
  });
});
