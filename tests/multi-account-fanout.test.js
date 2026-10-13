import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publishNowTo, pendingFor, overall, restoreResults, markNotPublished, labelFor } from "../src/lib/destinations.js";
import { buildJob, classifyResponse } from "../api/publish-to.js";
import { readRegistry } from "../api/_destinations.js";

/* One image post to two and three Pages, followed through all three layers
 * this repository owns:
 *
 *   browser (src/lib/destinations.js)  ->  relay (api/publish-to.js)
 *     ->  the Make test scenario's router (make/multi-account/ blueprint)
 *
 * The relay handler runs for real; only its outbound fetch to Make is
 * replaced, by a stand-in that evaluates the scenario's own route filters
 * against each job and answers the way that route's modules answer. LinkedIn
 * is not called. What this proves: every Page gets its own correctly
 * identified job, each job reaches the image module for its own Page, and
 * every kind of answer lands as the right per-Page state. */

const REG = [
  { id: "test-1", name: "Unison Content OS Test", organizationUrn: "urn:li:organization:146260120" },
  { id: "test-2", name: "Unison Content OS Test 2", organizationUrn: "urn:li:organization:145298202" },
  { id: "test-3", name: "Unison Content OS Test 3", organizationUrn: "urn:li:organization:145301196" },
];
const HOOK = "https://hook.eu1.make.com/test-multi-hook";
const BLUEPRINT = JSON.parse(readFileSync(resolve(process.cwd(), "make/multi-account/scenario-a-multi-account-test.json"), "utf8"));
const ROUTES = BLUEPRINT.flow[2].routes;

const IMAGE_POST = {
  source: "unison-content-os", postId: "p-w-fanout", idempotencyKey: "p-w-fanout", postType: "image",
  content: "TEST — multi-Page image check, please ignore", publishMode: "now", scheduledDate: null, scheduledTime: null,
  timezone: "Asia/Calcutta", submittedBy: null, poll: null,
  company: "Unison", companyUrn: "urn:li:organization:146260120",
  media: [{ kind: "image", filename: "unison-image.png", mimeType: "image/png", data: "iVBORw0KGgo=", altText: "", width: 1200, height: 630 }],
};

/* ---- a small evaluator for the scenario's filters and mappings ---- */
const value = (expr, job) => {
  const m = /^\{\{(.*)\}\}$/.exec(String(expr).trim());
  if (!m) return String(expr);
  const inner = m[1].trim();
  const ifempty = /^ifempty\(2\.(\w+); "([^"]*)"\)$/.exec(inner);
  if (ifempty) return job[ifempty[1]] ? String(job[ifempty[1]]) : ifempty[2];
  const field = /^2\.(\w+)$/.exec(inner);
  if (field) return job[field[1]] == null ? "" : String(job[field[1]]);
  throw new Error(`The test evaluator does not understand ${expr}`);
};
const passes = (filter, job) => !filter || filter.conditions.some((group) => group.every((c) => {
  const a = value(c.a, job);
  if (c.o === "text:equal") return a === c.b;
  if (c.o === "text:notequal") return a !== c.b;
  throw new Error(`operator ${c.o}`);
}));
const routesFor = (job) => ROUTES.filter((r) => passes(r.flow[0].filter, job));

/* Answers the way the matched route's modules would, with a fake urn. */
let makeSays = () => null;
const makeStandIn = vi.fn(async (_url, init) => {
  const job = JSON.parse(init.body);
  const custom = makeSays(job);
  if (custom) return custom;
  const matched = routesFor(job);
  if (matched.length !== 1) return { ok: true, status: 200, text: async () => "Accepted" };
  const first = matched[0].flow[0];
  if (first.module === "gateway:WebhookRespond") return { ok: first.mapper.status < 300, status: first.mapper.status, text: async () => JSON.stringify({ status: "rejected", stage: "destination" }) };
  return { ok: true, status: 200, text: async () => JSON.stringify({ status: "published", urn: `urn:li:share:${job.destinationId}`, postId: job.postId, destinationId: job.destinationId, companyUrn: value(first.mapper.organization, job) }) };
});

/* The browser's fetch, pointed at the real relay handler. */
const relayFetch = async (_path, init) => {
  const handler = (await import("../api/publish-to.js")).default;
  const r = { code: 0, body: null };
  const res = { status: (c) => { r.code = c; return res; }, json: (b) => { r.body = b; return res; }, setHeader: () => {} };
  await handler({ method: "POST", headers: {}, body: JSON.parse(init.body) }, res);
  return { ok: r.code >= 200 && r.code < 300, status: r.code, text: async () => JSON.stringify(r.body) };
};

const jobs = () => makeStandIn.mock.calls.map(([, i]) => JSON.parse(i.body));

beforeEach(async () => {
  vi.stubEnv("LINKEDIN_DESTINATIONS", JSON.stringify(REG));
  vi.stubEnv("MAKE_MULTI_WEBHOOK_URL", HOOK);
  vi.stubGlobal("fetch", makeStandIn);
  makeStandIn.mockClear();
  makeSays = () => null;
  (await import("../api/publish-to.js")).forgetDeliveries();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("the Make test scenario's router", () => {
  for (const d of REG) {
    for (const type of ["text", "image", "video", "poll"]) {
      it(`sends a ${type} job for ${d.name} down exactly one route, posting to that Page`, () => {
        const job = buildJob({ ...IMAGE_POST, postType: type }, d, { fanout: true });
        const matched = routesFor(job);
        expect(matched).toHaveLength(1);
        const mod = matched[0].flow.find((m) => m.module.startsWith("linkedin:"));
        expect(mod.module).toBe({ text: "linkedin:CreateTextShare", image: "linkedin:CreateCompanyImagePost", video: "linkedin:createOrganizationVideoPost", poll: "linkedin:MakeAPICall" }[type]);
        const target = type === "poll" ? matched[0].flow.find((m) => m.module === "json:CreateJSON").mapper.author : mod.mapper.organization;
        expect(value(target, job)).toBe(d.organizationUrn);
      });
    }
  }

  it("refuses a Page outside the three, before any LinkedIn module", () => {
    const job = { ...buildJob(IMAGE_POST, REG[0], { fanout: true }), companyUrn: "urn:li:organization:1" };
    const matched = routesFor(job);
    expect(matched).toHaveLength(1);
    expect(matched[0].flow[0].module).toBe("gateway:WebhookRespond");
    expect(matched[0].flow[0].mapper.status).toBe(422);
  });

  it("produces, for Test 3, exactly the request Make received in the 13 October test", () => {
    /* Fields copied from the request found waiting in the test webhook's
       queue (media omitted). The browser and relay built it correctly. */
    const seen = { postId: "p-w-mv6b6w74uc7u~test-3", idempotencyKey: "p-w-mv6b6w74uc7u~test-3", postType: "image", publishMode: "now",
      parentPostId: "p-w-mv6b6w74uc7u", destinationId: "test-3", company: "Unison Content OS Test 3", companyUrn: "urn:li:organization:145301196" };
    const job = buildJob({ ...IMAGE_POST, postId: "p-w-mv6b6w74uc7u", idempotencyKey: "p-w-mv6b6w74uc7u" }, readRegistry(JSON.stringify(REG)).destinations[2], { fanout: true });
    for (const [k, v] of Object.entries(seen)) expect(job[k]).toBe(v);
    expect(routesFor(job)[0].flow[0].module).toBe("linkedin:CreateCompanyImagePost");
  });
});

describe("an image post fanned out to several Pages", () => {
  it("two Pages: one job each, each identified and routed to its own Page", async () => {
    const res = await publishNowTo({ payload: IMAGE_POST, selected: ["test-2", "test-3"], fetchImpl: relayFetch });
    const sent = jobs();
    expect(sent.map((j) => [j.destinationId, j.companyUrn, j.postId, j.idempotencyKey])).toEqual([
      ["test-2", "urn:li:organization:145298202", "p-w-fanout~test-2", "p-w-fanout~test-2"],
      ["test-3", "urn:li:organization:145301196", "p-w-fanout~test-3", "p-w-fanout~test-3"],
    ]);
    for (const j of sent) {
      expect(j.parentPostId).toBe("p-w-fanout");
      expect(j.media).toEqual(IMAGE_POST.media);
      expect(routesFor(j)[0].flow[0].module).toBe("linkedin:CreateCompanyImagePost");
    }
    expect(res["test-2"]).toMatchObject({ state: "published", urn: "urn:li:share:test-2" });
    expect(res["test-3"]).toMatchObject({ state: "published", urn: "urn:li:share:test-3" });
  });

  it("three Pages: three jobs, no Page twice, none missing", async () => {
    const res = await publishNowTo({ payload: IMAGE_POST, selected: ["test-1", "test-2", "test-3"], fetchImpl: relayFetch });
    expect(jobs().map((j) => j.destinationId)).toEqual(["test-1", "test-2", "test-3"]);
    expect(new Set(jobs().map((j) => j.idempotencyKey)).size).toBe(3);
    expect(overall(["test-1", "test-2", "test-3"], res)).toBe("published");
  });

  it("a scenario that is off: Make queues the job and answers \"Accepted\" — waiting, not confirmed, never resent", async () => {
    makeSays = (job) => (job.destinationId === "test-3" ? { ok: true, status: 200, text: async () => "Accepted" } : null);
    const sel = ["test-2", "test-3"];
    const res = await publishNowTo({ payload: IMAGE_POST, selected: sel, fetchImpl: relayFetch });
    expect(res["test-2"].state).toBe("published");
    expect(res["test-3"]).toMatchObject({ state: "accepted", stage: "make-queue" });
    expect(labelFor(res["test-3"])).toBe("Waiting in Make — not run yet");
    expect(res["test-3"].message).toMatch(/did not run it/);
    expect(overall(sel, res)).toBe("sent");
    expect(pendingFor(sel, res)).toEqual([]);                 // retry sends nothing
  });

  it("a LinkedIn refusal is a failure for that Page only, and retry resends only it", async () => {
    let refuse = true;
    makeSays = (job) => (job.destinationId === "test-2" && refuse
      ? { ok: true, status: 200, text: async () => JSON.stringify({ status: "failed", stage: "linkedin", message: "LinkedIn refused the post for this Page: 403" }) }
      : null);
    const sel = ["test-1", "test-2", "test-3"];
    const first = await publishNowTo({ payload: IMAGE_POST, selected: sel, fetchImpl: relayFetch });
    expect(first["test-2"]).toMatchObject({ state: "failed", message: "LinkedIn refused the post for this Page: 403" });
    expect(overall(sel, first)).toBe("partial");
    refuse = false;
    makeStandIn.mockClear();
    const again = await publishNowTo({ payload: IMAGE_POST, selected: sel, results: first, fetchImpl: relayFetch });
    expect(jobs().map((j) => j.idempotencyKey)).toEqual(["p-w-fanout~test-2"]);
    expect(overall(sel, again)).toBe("published");
  });

  it("an unstructured Make error is unknown, not failed, so it is not resent", async () => {
    makeSays = () => ({ ok: false, status: 500, text: async () => "Scenario failed to complete." });
    const res = await publishNowTo({ payload: IMAGE_POST, selected: ["test-1", "test-2"], fetchImpl: relayFetch });
    expect(res["test-1"].state).toBe("unknown");
    expect(pendingFor(["test-1", "test-2"], res)).toEqual([]);
  });

  it("a platform timeout page from the relay is unknown, not failed", async () => {
    const res = await publishNowTo({ payload: IMAGE_POST, selected: ["test-1"], fetchImpl: async () => ({ ok: false, status: 504, text: async () => "<html>FUNCTION_INVOCATION_TIMEOUT</html>" }) });
    expect(res["test-1"].state).toBe("unknown");
    expect(pendingFor(["test-1"], res)).toEqual([]);
  });

  it("no relay at all is a clean failure: nothing was sent", async () => {
    const res = await publishNowTo({ payload: IMAGE_POST, selected: ["test-1"], fetchImpl: async () => ({ ok: false, status: 404, text: async () => "<!doctype html>" }) });
    expect(res["test-1"].state).toBe("failed");
  });
});

describe("retry rules", () => {
  const sel = ["test-1", "test-2", "test-3"];
  it("resends only genuinely failed Pages — not unknown, waiting, unconfirmed or in-flight", () => {
    const res = {
      "test-1": { state: "published" }, "test-2": { state: "failed" }, "test-3": { state: "accepted", stage: "make-queue" },
    };
    expect(pendingFor(sel, res)).toEqual(["test-2"]);
    expect(pendingFor(sel, { ...res, "test-2": { state: "unknown" } })).toEqual([]);
    expect(pendingFor(sel, { ...res, "test-2": { state: "sending" } })).toEqual([]);
    expect(pendingFor(sel, { ...res, "test-2": { state: "rejected" } })).toEqual(["test-2"]);
  });

  it("a send cut off by closing the page comes back unknown", () => {
    const back = restoreResults({ "test-1": { state: "published" }, "test-2": { state: "sending" } });
    expect(back["test-2"].state).toBe("unknown");
    expect(pendingFor(["test-1", "test-2"], back)).toEqual([]);
  });

  it("an unconfirmed Page becomes resendable only when someone says it is not on LinkedIn", () => {
    const res = { "test-1": { state: "published" }, "test-3": { state: "accepted", stage: "make-queue" } };
    expect(pendingFor(["test-1", "test-3"], res)).toEqual([]);
    const checked = markNotPublished(res, "test-3");
    expect(pendingFor(["test-1", "test-3"], checked)).toEqual(["test-3"]);
    expect(checked["test-1"].state).toBe("published");
  });
});

describe("what Make's answer means", () => {
  const r = (ok, status, body) => ({ ok, status, parsed: typeof body === "object" ? body : null, raw: typeof body === "string" ? body : JSON.stringify(body) });
  it("reads each kind of answer by its evidence", () => {
    expect(classifyResponse(r(true, 200, { status: "published", urn: "urn:li:share:1" })).state).toBe("published");
    expect(classifyResponse(r(true, 200, { status: "published" })).state).toBe("unknown");
    expect(classifyResponse(r(true, 200, { status: "failed", message: "x" })).state).toBe("failed");
    expect(classifyResponse(r(false, 422, { status: "rejected" })).state).toBe("rejected");
    expect(classifyResponse(r(true, 200, "Accepted"))).toMatchObject({ state: "accepted", stage: "make-queue" });
    expect(classifyResponse(r(true, 200, "ok?")).state).toBe("unknown");
    expect(classifyResponse(r(false, 500, "Scenario failed to complete.")).state).toBe("unknown");
    expect(classifyResponse(r(false, 410, "There is no scenario listening for this webhook.")).state).toBe("failed");
  });
});
