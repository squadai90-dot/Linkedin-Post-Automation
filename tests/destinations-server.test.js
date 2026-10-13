import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readRegistry, resolveDestinations, jobKey } from "../api/_destinations.js";

/* The server half of multi-Page publishing: which Pages exist, which a
 * request may name, and exactly what reaches Make for each. Make is mocked —
 * these prove the request shape, not that LinkedIn accepts it. */

const REG = JSON.stringify([
  { id: "test-1", name: "Unison Content OS Test", organizationUrn: "urn:li:organization:146260120" },
  { id: "test-2", name: "Unison Content OS Test 2", organizationUrn: "urn:li:organization:145298202" },
  { id: "test-3", name: "Unison Content OS Test 3", organizationUrn: "urn:li:organization:145301196" },
  { id: "test-4", name: "Paused Page", organizationUrn: "urn:li:organization:1", enabled: false },
]);
const HOOK = "https://hook.eu1.make.com/test-multi-hook";

const res = () => {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
};
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

const POST = {
  source: "unison-content-os", postId: "p-w-abc", idempotencyKey: "p-w-abc", postType: "image",
  content: "Happy Navratri from all of us!", publishMode: "now", timezone: "Asia/Calcutta",
  company: "Browser said this", companyUrn: "urn:li:organization:999", linkedinAccessToken: "should-not-travel",
  media: [{ kind: "image", filename: "a.png", mimeType: "image/png", data: "iVBORw0KGgo=", altText: "" }], poll: null,
};

let fetchMock;
const load = async (path) => { vi.resetModules(); return (await import(path)).default; };
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("LINKEDIN_DESTINATIONS", REG);
  vi.stubEnv("MAKE_MULTI_WEBHOOK_URL", HOOK);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the Page registry", () => {
  it("keeps valid entries and says why it dropped the rest", () => {
    const { destinations, problems } = readRegistry(JSON.stringify([
      { id: "ok", name: "A", organizationUrn: "urn:li:organization:5" },
      { id: "Bad Id!", organizationUrn: "urn:li:organization:6" },
      { id: "no-urn", organizationUrn: "urn:li:person:7" },
      { id: "ok", name: "dup", organizationUrn: "urn:li:organization:8" },
    ]));
    expect(destinations.map((d) => d.id)).toEqual(["ok"]);
    expect(problems).toHaveLength(3);
  });
  it("treats an unset or broken list as no Pages, never a guess", () => {
    expect(readRegistry("").destinations).toEqual([]);
    expect(readRegistry("{not json").problems[0]).toMatch(/not valid JSON/);
  });
  it("resolves only known, available Pages", () => {
    const { destinations } = readRegistry(REG);
    const r = resolveDestinations(["test-1", "TEST-3", "test-1", "nope", "test-4"], destinations);
    expect(r.ok.map((d) => d.id)).toEqual(["test-1", "test-3"]);
    expect(r.refused).toEqual([{ id: "nope", reason: "unknown" }, { id: "test-4", reason: "unavailable" }]);
  });
  it("gives each Page its own job key only when a post goes to several", () => {
    expect(jobKey("p-1", "test-2", false)).toBe("p-1");
    expect(jobKey("p-1", "test-2", true)).toBe("p-1~test-2");
  });
});

describe("GET /api/destinations", () => {
  it("lists Pages without ever exposing the webhook", async () => {
    const h = await load("../api/destinations.js");
    const r = res();
    h({ method: "GET" }, r);
    expect(r.body.enabled).toBe(true);
    expect(r.body.destinations.map((d) => d.name)).toContain("Unison Content OS Test 3");
    expect(JSON.stringify(r.body)).not.toContain("hook.eu1.make.com");
  });
  it("is off unless both the list and the webhook are set", async () => {
    vi.stubEnv("MAKE_MULTI_WEBHOOK_URL", "");
    const h = await load("../api/destinations.js");
    const r = res();
    h({ method: "GET" }, r);
    expect(r.body.enabled).toBe(false);
  });
});

describe("POST /api/publish-to", () => {
  const send = async (body, headers = {}) => {
    const h = await load("../api/publish-to.js");
    const r = res();
    await h({ method: "POST", headers, body }, r);
    return r;
  };

  it("is refused, sending nothing, when the deployment has not opted in", async () => {
    vi.stubEnv("MAKE_MULTI_WEBHOOK_URL", "");
    const r = await send({ post: POST, destinationIds: ["test-1"] });
    expect(r.code).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes now to one Page with the URN from the server, not the browser", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "published", urn: "urn:li:share:1", url: "https://www.linkedin.com/feed/update/urn:li:share:1/" }));
    const r = await send({ post: POST, destinationIds: ["test-3"], fanout: false });
    expect(r.code).toBe(200);
    expect(r.body.state).toBe("published");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(HOOK);
    expect(init.headers["Content-Type"]).toMatch(/^text\/plain/);
    const job = JSON.parse(init.body);
    expect(job.companyUrn).toBe("urn:li:organization:145301196");
    expect(job.company).toBe("Unison Content OS Test 3");
    expect(job.destinationId).toBe("test-3");
    expect(job.postId).toBe("p-w-abc");                 // one Page: the post keeps its own id
    expect(job.linkedinAccessToken).toBeUndefined();     // a token never travels
    expect(job.media[0].data).toBe(POST.media[0].data);  // media untouched
  });

  it("gives each Page of a multi-Page post its own key", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "published", urn: "urn:li:share:2" }));
    await send({ post: POST, destinationIds: ["test-2"], fanout: true });
    const job = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(job.postId).toBe("p-w-abc~test-2");
    expect(job.idempotencyKey).toBe("p-w-abc~test-2");
    expect(job.parentPostId).toBe("p-w-abc");
  });

  it("refuses an unknown Page and sends nothing", async () => {
    const r = await send({ post: POST, destinationIds: ["urn:li:organization:999"] });
    expect(r.code).toBe(422);
    expect(r.body.stage).toBe("destination");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never drops one chosen Page and publishes to the rest", async () => {
    vi.stubEnv("LINKEDIN_DESTINATIONS", REG);
    const sched = { ...POST, publishMode: "scheduled", scheduledDate: "2026-10-20", scheduledTime: "09:30" };
    const r = await send({ post: sched, destinationIds: ["test-1", "gone"] });
    expect(r.code).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses no Page at all", async () => {
    const r = await send({ post: POST, destinationIds: [] });
    expect(r.code).toBe(422);
    expect(r.body.error).toMatch(/at least one Page/);
  });

  it("takes one Page per immediate request", async () => {
    const r = await send({ post: POST, destinationIds: ["test-1", "test-2"], fanout: true });
    expect(r.code).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("schedules all Pages in one request: content and media once, Pages listed", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "queued", destinations: 2 }));
    const sched = { ...POST, publishMode: "scheduled", scheduledDate: "2026-10-20", scheduledTime: "09:30" };
    const r = await send({ post: sched, destinationIds: ["test-1", "test-3"], fanout: true });
    expect(r.body.state).toBe("queued");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const job = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(job.publishMode).toBe("scheduled");
    expect(job.companyUrn).toBe("");
    expect(job.postId).toBe("p-w-abc");
    expect(job.destinations).toEqual([
      { id: "test-1", name: "Unison Content OS Test", organizationUrn: "urn:li:organization:146260120" },
      { id: "test-3", name: "Unison Content OS Test 3", organizationUrn: "urn:li:organization:145301196" },
    ]);
    expect(job.media).toHaveLength(1);
  });

  it("answers a repeat with the first answer instead of posting twice", async () => {
    vi.resetModules();
    const h = (await import("../api/publish-to.js")).default;
    fetchMock.mockResolvedValue(reply(200, { status: "published", urn: "urn:li:share:3" }));
    const b = { post: POST, destinationIds: ["test-1"], fanout: true };
    const r1 = res(); await h({ method: "POST", headers: {}, body: b }, r1);
    const r2 = res(); await h({ method: "POST", headers: {}, body: b }, r2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r2.body.duplicate).toBe(true);
    expect(r2.body.urn).toBe("urn:li:share:3");
  });

  it("does not remember a refusal, so a retry really retries", async () => {
    vi.resetModules();
    const h = (await import("../api/publish-to.js")).default;
    fetchMock.mockResolvedValueOnce(reply(200, { status: "failed", message: "LinkedIn refused the post for this Page: 403" }))
      .mockResolvedValueOnce(reply(200, { status: "published", urn: "urn:li:share:4" }));
    const b = { post: POST, destinationIds: ["test-2"], fanout: true };
    const r1 = res(); await h({ method: "POST", headers: {}, body: b }, r1);
    expect(r1.body.state).toBe("failed");
    const r2 = res(); await h({ method: "POST", headers: {}, body: b }, r2);
    expect(r2.body.state).toBe("published");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not call a post published without LinkedIn's urn", async () => {
    fetchMock.mockResolvedValue(reply(200, { status: "published" }));
    const r = await send({ post: POST, destinationIds: ["test-1"] });
    expect(r.body.published).toBe(false);
    expect(r.body.state).toBe("unknown");
  });

  it("reports a scenario's own refusal as a failure for that Page", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ status: "failed", stage: "linkedin", message: "LinkedIn refused the post for this Page: 403" }) });
    const r = await send({ post: POST, destinationIds: ["test-2"], fanout: true });
    expect(r.body.state).toBe("failed");
    expect(r.body.message).toMatch(/403/);
  });

  it("treats a Make error without a result as unknown — LinkedIn may have the post", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "Scenario failed to complete." });
    const r = await send({ post: POST, destinationIds: ["test-2"], fanout: true });
    expect(r.code).toBe(502);
    expect(r.body.state).toBe("unknown");
    expect(r.body.destinationIds).toEqual(["test-2"]);
  });

  it("knows Make's bare \"Accepted\" means the job is queued, not run", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "Accepted" });
    const r = await send({ post: POST, destinationIds: ["test-3"], fanout: true });
    expect(r.code).toBe(200);
    expect(r.body).toMatchObject({ state: "accepted", stage: "make-queue", published: false });
  });

  it("asks for the team token when one is set", async () => {
    vi.stubEnv("UNISON_RELAY_TOKEN", "t0k");
    const r = await send({ post: POST, destinationIds: ["test-1"] });
    expect(r.code).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
