import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMake } from "./helpers/make-sim.js";
import { publishNowTo, scheduleTo, checkStatus, pendingFor, overall, restoreResults, markNotPublished, canonicalState } from "../src/lib/destinations.js";

/* The unified replacement scenarios, end to end, without Make or LinkedIn:
 *
 *   browser (src/lib/destinations.js) -> relay (api/publish-to.js, real)
 *     -> unified-immediate-publisher.json  (run by tests/helpers/make-sim.js)
 *     -> data store -> unified-scheduled-publisher.json (same simulator)
 *     -> a LinkedIn stand-in that records every call it gets
 *
 * Every post type, both modes, every one of the seven non-empty selections of
 * the three Pages: 56 combinations. Then the failure cases, and regression
 * checks that run the production blueprints (make/scenario-*.json, identical
 * to the live scenarios 7482325 and 7524924) beside the unified ones.
 *
 * What this proves: the blueprints route, store, claim and answer as designed,
 * and Unison reports each Page truthfully. What it cannot prove: that Make
 * imports and runs them identically, or that LinkedIn accepts the posts. */

const load = (p) => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf8"));
const UA = load("make/unified/unified-immediate-publisher.json");
const UB = load("make/unified/unified-scheduled-publisher.json");
const PA = load("make/scenario-a-linkedin-publisher.json");
const PB = load("make/scenario-b-scheduled-publisher.json");

const PAGES = [
  { id: "test-1", name: "Unison Content OS Test", organizationUrn: "urn:li:organization:146260120" },
  { id: "test-2", name: "Unison Content OS Test 2", organizationUrn: "urn:li:organization:145298202" },
  { id: "test-3", name: "Unison Content OS Test 3", organizationUrn: "urn:li:organization:145301196" },
];
const URN = Object.fromEntries(PAGES.map((p) => [p.id, p.organizationUrn]));
const SELECTIONS = [["test-1"], ["test-2"], ["test-3"], ["test-1", "test-2"], ["test-1", "test-3"], ["test-2", "test-3"], ["test-1", "test-2", "test-3"]];
const TYPES = ["text", "image", "video", "poll"];
const MODULE = { text: "CreateTextShare", image: "CreateCompanyImagePost", video: "createOrganizationVideoPost", poll: "MakeAPICall" };
const HOOK = "https://hook.eu1.make.com/unified-test-hook";
const T0 = Date.UTC(2026, 9, 13, 6, 0);           // 11:30 IST
const IMG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const VID = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=";

let seq = 0;
function post(type, { scheduled = false, at = "12:30" } = {}) {
  const postId = `p-w-${type}${scheduled ? "s" : "n"}${++seq}`;
  return {
    source: "unison-content-os", postId, idempotencyKey: postId, postType: type,
    content: `TEST — ${type} ${scheduled ? "scheduled" : "now"} multi-Page check, please ignore`,
    company: "Browser said this", companyUrn: "urn:li:organization:999",
    publishMode: scheduled ? "scheduled" : "now", scheduledDate: scheduled ? "2026-10-13" : null, scheduledTime: scheduled ? at : null,
    timezone: "Asia/Calcutta", submittedBy: { name: "Test", email: "test@example.com" },
    media: type === "image" ? [{ kind: "image", filename: "unison-image.png", mimeType: "image/png", data: IMG, altText: "alt" }]
      : type === "video" ? [{ kind: "video", filename: "unison-video.mp4", mimeType: "video/mp4", data: VID, altText: "" }, { kind: "image", role: "poster", filename: "p.png", mimeType: "image/png", data: IMG }]
      : [],
    poll: type === "poll" ? { question: "Which Page should see this first?", options: ["Test", "Test 2", "Test 3"], duration: "3 days" } : null,
  };
}

/* ---- the three layers, wired together ---- */
let sim, refuse, deliveries;
const orgOf = (call) => (call.module === "MakeAPICall" ? JSON.parse(call.args.body).author : call.args.organization);
function linkedin({ module, args }) {
  const org = module === "MakeAPICall" ? JSON.parse(args.body).author : args.organization;
  if (refuse(org, module)) return new Error(`LinkedIn refused: 403 for ${org}`);
  return { id: `urn:li:${module === "MakeAPICall" ? "ugcPost" : "share"}:${sim.calls.length}` };
}
const makeFetch = vi.fn(async (_url, init) => {
  deliveries.push(JSON.parse(init.body));
  const r = sim.deliver(UA, init.body);
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
});
let handler;
const relayFetch = async (_path, init) => {
  const r = { code: 0, body: null };
  const res = { status: (c) => { r.code = c; return res; }, json: (b) => { r.body = b; return res; }, setHeader: () => {} };
  await handler({ method: "POST", headers: {}, body: JSON.parse(init.body) }, res);
  return { ok: r.code >= 200 && r.code < 300, status: r.code, text: async () => JSON.stringify(r.body), json: async () => r.body };
};
const runScheduler = (bp = UB, max = 10) => { for (let k = 0; k < max; k++) { const before = sim.calls.length; sim.tick(bp); if (sim.calls.length === before && k > 0) break; } };

beforeEach(async () => {
  vi.stubEnv("LINKEDIN_DESTINATIONS", JSON.stringify(PAGES));
  vi.stubEnv("MAKE_MULTI_WEBHOOK_URL", HOOK);
  vi.stubGlobal("fetch", makeFetch);
  makeFetch.mockClear();
  deliveries = [];
  refuse = () => false;
  sim = createMake({ linkedin, now: T0 });
  const mod = await import("../api/publish-to.js");
  mod.forgetDeliveries();
  handler = mod.default;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/* The same call, whatever order a JSON body's keys came out in. */
const norm = (calls) => calls.map((c) => (c.module === "MakeAPICall" ? { ...c, args: { ...c.args, body: JSON.parse(c.args.body) } } : c));
const callsFor = (org) => sim.calls.filter((c) => orgOf(c) === org);
function expectPostedRight(call, type, p, pageId) {
  expect(call.module).toBe(MODULE[type]);
  expect(orgOf(call)).toBe(URN[pageId]);
  if (type === "poll") {
    const body = JSON.parse(call.args.body);
    expect(body.commentary).toBe(p.content);
    expect(body.content.poll).toEqual({ question: p.poll.question, options: p.poll.options.map((text) => ({ text })), settings: { duration: "THREE_DAYS", voteSelectionType: "SINGLE_VOTE" } });
  } else {
    expect(call.args.content).toBe(p.content);
  }
  if (type === "image") expect(call.args).toMatchObject({ data: { binary: IMG }, fileName: "unison-image.png", altText: "alt" });
  if (type === "video") expect(call.args).toMatchObject({ video: { binary: VID }, videoName: "unison-video.mp4" });
}

/* ===================================================================== */
describe("the 56 combinations: every post type, both modes, every selection of Pages", () => {
  for (const type of TYPES) {
    for (const sel of SELECTIONS) {
      it(`now · ${type} · ${sel.join(" + ")}`, async () => {
        const p = post(type);
        const results = await publishNowTo({ payload: p, selected: sel, fetchImpl: relayFetch });

        expect(deliveries.map((d) => d.destinationId)).toEqual(sel);          // one job per chosen Page, no other
        expect(sim.calls).toHaveLength(sel.length);                             // one LinkedIn post per Page
        for (const id of sel) {
          const [call] = callsFor(URN[id]);
          expectPostedRight(call, type, p, id);
          expect(results[id]).toMatchObject({ state: "published", postId: p.postId });
          expect(results[id].urn).toMatch(/^urn:li:/);
          const key = sel.length > 1 ? `${p.postId}~${id}` : p.postId;
          expect(sim.records()[key]).toMatchObject({ status: "published", companyUrn: URN[id], postId: p.postId, publishedUrn: results[id].urn });
        }
        expect(overall(sel, results)).toBe("published");
        /* no Page's job carried another Page's organization */
        for (const d of deliveries) expect(d.companyUrn).toBe(URN[d.destinationId]);
      });

      it(`scheduled · ${type} · ${sel.join(" + ")}`, async () => {
        const p = post(type, { scheduled: true });     // 12:30 IST = 07:00 UTC
        let results = await scheduleTo({ payload: p, selected: sel, fetchImpl: relayFetch });

        expect(deliveries).toHaveLength(1);                                     // the post once, its Pages listed
        expect(deliveries[0].destinations.map((d) => d.id)).toEqual(sel);
        for (const id of sel) expect(canonicalState(results[id])).toBe("scheduled");
        expect(sim.calls).toHaveLength(0);
        const recs = sim.records();
        expect(recs[p.postId]).toMatchObject({ status: "parent", content: p.content });
        for (const id of sel) expect(recs[`${p.postId}~${id}`]).toMatchObject({ status: "page-queued", companyUrn: URN[id], postId: p.postId });

        sim.now = Date.UTC(2026, 9, 13, 6, 59);                                // a minute early
        runScheduler();
        expect(sim.calls).toHaveLength(0);

        sim.now = Date.UTC(2026, 9, 13, 7, 0);                                 // due
        runScheduler();
        expect(sim.calls).toHaveLength(sel.length);
        for (const id of sel) expectPostedRight(callsFor(URN[id])[0], type, p, id);
        runScheduler();                                                          // later runs post nothing again
        expect(sim.calls).toHaveLength(sel.length);

        const st = await checkStatus({ postId: p.postId, selected: sel, results, fetchImpl: relayFetch });
        expect(st.ok).toBe(true);
        results = st.results;
        for (const id of sel) expect(results[id]).toMatchObject({ state: "published", makeStatus: "published" });
        expect(overall(sel, results)).toBe("published");

        sim.now = Date.UTC(2026, 9, 14, 7, 1);                                 // a day later the parent is freed
        sim.tick(UB);
        expect(sim.records()[p.postId]).toBeUndefined();
      });
    }
  }
});

/* ===================================================================== */
describe("failures", () => {
  it("one Page refused, the others published; retry resends only the refused Page", async () => {
    refuse = (org) => org === URN["test-2"];
    const p = post("image");
    const all = ["test-1", "test-2", "test-3"];
    let r = await publishNowTo({ payload: p, selected: all, fetchImpl: relayFetch });
    expect(r["test-1"].state).toBe("published");
    expect(r["test-2"]).toMatchObject({ state: "failed" });
    expect(r["test-2"].message).toMatch(/LinkedIn refused/);
    expect(r["test-3"].state).toBe("published");
    expect(overall(all, r)).toBe("partial");
    expect(pendingFor(all, r)).toEqual(["test-2"]);

    refuse = () => false;
    r = await publishNowTo({ payload: p, selected: all, results: r, fetchImpl: relayFetch });
    expect(deliveries.map((d) => d.destinationId)).toEqual(["test-1", "test-2", "test-3", "test-2"]);
    expect(callsFor(URN["test-1"])).toHaveLength(1);
    expect(callsFor(URN["test-3"])).toHaveLength(1);
    expect(r["test-2"].state).toBe("published");
    expect(overall(all, r)).toBe("published");
  });

  it("every Page refused: all failed, nothing published, all retryable", async () => {
    refuse = () => true;
    const r = await publishNowTo({ payload: post("text"), selected: ["test-1", "test-2", "test-3"], fetchImpl: relayFetch });
    expect(overall(["test-1", "test-2", "test-3"], r)).toBe("failed");
    expect(pendingFor(["test-1", "test-2", "test-3"], r)).toHaveLength(3);
  });

  it("an unknown Page id is refused by the server; Make is never called", async () => {
    const r = await publishNowTo({ payload: post("text"), selected: ["test-9"], fetchImpl: relayFetch });
    expect(r["test-9"]).toMatchObject({ state: "rejected" });
    expect(deliveries).toHaveLength(0);
  });

  it("a Page the server lists but the scenario's allow-list does not is refused by Make before LinkedIn", async () => {
    vi.stubEnv("LINKEDIN_DESTINATIONS", JSON.stringify([...PAGES, { id: "other", name: "Not ours", organizationUrn: "urn:li:organization:42" }]));
    const r = await publishNowTo({ payload: post("text"), selected: ["other"], fetchImpl: relayFetch });
    expect(r.other.state).toBe("rejected");
    expect(deliveries).toHaveLength(1);
    expect(sim.calls).toHaveLength(0);
    const s = await scheduleTo({ payload: post("text", { scheduled: true }), selected: ["test-1", "other"], fetchImpl: relayFetch });
    expect(s["test-1"].state).toBe("failed");                       // the mismatch is reported, not hidden
    expect(s["test-1"].message).toMatch(/allow-list/);
    expect(sim.records()[`${deliveries[1].postId}~other`]).toBeUndefined();
  });

  const refused = async (p) => {
    const r = await publishNowTo({ payload: p, selected: ["test-1"], fetchImpl: relayFetch });
    expect(deliveries).toHaveLength(0);
    expect(r["test-1"].state).toBe("failed");
    return r["test-1"].message;
  };
  it("missing media is refused before Make", async () => {
    expect(await refused({ ...post("image"), media: [] })).toMatch(/needs its image file/);
    expect(await refused({ ...post("video"), media: [{ kind: "video", filename: "v.mp4", url: "https://example.com/v.mp4" }] })).toMatch(/arrived as a link/);
  });
  it("an invalid image or video payload is refused before Make", async () => {
    expect(await refused({ ...post("image"), media: [{ ...post("image").media[0], data: "not base64!" }] })).toMatch(/not valid base64/);
    expect(await refused({ ...post("image"), media: [{ ...post("image").media[0], mimeType: "image/webp" }] })).toMatch(/JPG, PNG or GIF/);
    expect(await refused({ ...post("video"), media: [post("video").media[1], post("video").media[0]] })).toMatch(/first media item must be the video/);
  });
  it("invalid poll fields are refused before Make", async () => {
    const poll = (x) => ({ ...post("poll"), poll: { ...post("poll").poll, ...x } });
    expect(await refused(poll({ options: ["a"] }))).toMatch(/2 to 4 options/);
    expect(await refused(poll({ options: ["a", "b", "c", "d", "e"] }))).toMatch(/2 to 4 options/);
    expect(await refused(poll({ options: ["a", "x".repeat(31)] }))).toMatch(/LinkedIn allows 30/);
    expect(await refused(poll({ question: "q".repeat(141) }))).toMatch(/LinkedIn allows 140/);
    expect(await refused(poll({ duration: "5 days" }))).toMatch(/not a poll duration/);
    expect(await refused(poll({ options: ["a", " "] }))).toMatch(/option is empty/);
  });

  it("a duplicate submission does not post twice — in the browser, the relay, and Make", async () => {
    const p = post("text");
    const r1 = await publishNowTo({ payload: p, selected: ["test-1", "test-2"], fetchImpl: relayFetch });
    const r2 = await publishNowTo({ payload: p, selected: ["test-1", "test-2"], results: r1, fetchImpl: relayFetch });
    expect(r2).toEqual(r1);                                               // the browser sends nothing for published Pages
    (await import("../api/publish-to.js")).forgetDeliveries();          // another serverless instance, no cache
    await publishNowTo({ payload: p, selected: ["test-1", "test-2"], fetchImpl: relayFetch });
    expect(deliveries).toHaveLength(4);                                   // it reached Make again…
    expect(sim.calls).toHaveLength(2);                                    // …and Make answered from its record
  });

  it("a repeated webhook delivery of the same job posts once and answers with the first urn", () => {
    const job = JSON.stringify({ ...post("video"), postId: "p-w-x~test-3", idempotencyKey: "p-w-x~test-3", parentPostId: "p-w-x", destinationId: "test-3", companyUrn: URN["test-3"], company: "T3" });
    const a = JSON.parse(sim.deliver(UA, job).body);
    const b = JSON.parse(sim.deliver(UA, job).body);
    expect(sim.calls).toHaveLength(1);
    expect(b).toMatchObject({ status: "published", duplicate: true, urn: a.urn });
  });

  it("an inactive scenario: Make queues the job and answers Accepted — waiting, never resent", async () => {
    sim.active = false;
    const r = await publishNowTo({ payload: post("image"), selected: ["test-2", "test-3"], fetchImpl: relayFetch });
    expect(r["test-2"]).toMatchObject({ state: "accepted", stage: "make-queue" });
    expect(canonicalState(r["test-2"])).toBe("queued");
    expect(pendingFor(["test-2", "test-3"], r)).toEqual([]);
    expect(sim.queue).toHaveLength(2);
    expect(sim.calls).toHaveLength(0);
  });

  it("a timeout between the relay and Make is unknown, not failed", async () => {
    vi.resetModules();
    vi.stubEnv("PUBLISH_TIMEOUT_MS", "20");
    handler = (await import("../api/publish-to.js")).default;
    vi.stubGlobal("fetch", (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const r = await publishNowTo({ payload: post("text"), selected: ["test-1"], fetchImpl: relayFetch });
    expect(r["test-1"].state).toBe("unknown");
    expect(pendingFor(["test-1"], r)).toEqual([]);
  });

  it("LinkedIn posts, then the run dies before answering: unknown, and a resend is held back by Make's claim", async () => {
    sim.crashAfterLinkedIn = true;
    const p = post("text");
    const r = await publishNowTo({ payload: p, selected: ["test-1", "test-2"], fetchImpl: relayFetch });
    expect(r["test-1"].state).toBe("unknown");                            // a bare 500 from Make
    expect(sim.records()[`${p.postId}~test-1`].status).toBe("publishing");
    sim.crashAfterLinkedIn = false;
    (await import("../api/publish-to.js")).forgetDeliveries();
    /* even if something resends the same job, Make will not publish it again */
    const again = await relayFetch("", { body: JSON.stringify({ post: p, destinationIds: ["test-1"], fanout: true }) });
    expect((await again.json()).state).toBe("unknown");
    expect(callsFor(URN["test-1"])).toHaveLength(1);
    /* after a person checks LinkedIn and clears it, the resend gets its own key */
    const cleared = markNotPublished(r, "test-1");
    const r2 = await publishNowTo({ payload: p, selected: ["test-1", "test-2"], results: { ...cleared, "test-2": r["test-2"] }, fetchImpl: relayFetch });
    expect(deliveries.at(-1).postId).toBe(`${p.postId}~test-1~r1`);
    expect(r2["test-1"].state).toBe("published");
  });

  it("LinkedIn posts but the result cannot be stored: Unison still gets the urn, and a repeat is not republished", async () => {
    sim.failWrites = (m, key) => m.mapper.data.status === "published" && key.endsWith("~test-2");
    const p = post("image");
    const r = await publishNowTo({ payload: p, selected: ["test-2", "test-3"], fetchImpl: relayFetch });
    expect(r["test-2"].state).toBe("published");
    expect(sim.records()[`${p.postId}~test-2`].status).toBe("publishing");
    (await import("../api/publish-to.js")).forgetDeliveries();
    const again = await relayFetch("", { body: JSON.stringify({ post: p, destinationIds: ["test-2"], fanout: true }) });
    expect((await again.json()).state).toBe("unknown");
    expect(callsFor(URN["test-2"])).toHaveLength(1);
  });

  it("a full data store: nothing is sent to LinkedIn, and Unison is told plainly", async () => {
    sim.storeLimit = 10;
    const now = await publishNowTo({ payload: post("text"), selected: ["test-1"], fetchImpl: relayFetch });
    expect(now["test-1"]).toMatchObject({ state: "failed", stage: "make-store" });
    const later = await scheduleTo({ payload: post("image", { scheduled: true }), selected: ["test-1", "test-2"], fetchImpl: relayFetch });
    expect(later["test-1"]).toMatchObject({ state: "failed", stage: "make-store" });
    expect(sim.calls).toHaveLength(0);
  });

  it("a reload while a Page was sending brings it back as unknown, never resent by itself", () => {
    const back = restoreResults({ "test-1": { state: "published", urn: "urn:li:share:1" }, "test-2": { state: "sending" } });
    expect(back["test-2"].state).toBe("unknown");
    expect(pendingFor(["test-1", "test-2"], back)).toEqual([]);
  });

  it("the scheduler restarts mid-publish: the job is reported stuck, not posted again", async () => {
    const p = post("video", { scheduled: true });
    const results = await scheduleTo({ payload: p, selected: ["test-1", "test-3"], fetchImpl: relayFetch });
    sim.now = Date.UTC(2026, 9, 13, 7, 5);
    sim.crashAfterLinkedIn = true;
    sim.tick(UB);                                                         // first job: LinkedIn posted, run died
    sim.crashAfterLinkedIn = false;
    expect(sim.calls).toHaveLength(1);
    const first = orgOf(sim.calls[0]) === URN["test-1"] ? "test-1" : "test-3";
    expect(sim.records()[`${p.postId}~${first}`].status).toBe("page-publishing");
    sim.now = Date.UTC(2026, 9, 13, 7, 30);
    runScheduler();                                                       // the other job posts; the claimed one waits
    expect(sim.calls).toHaveLength(2);
    sim.now = Date.UTC(2026, 9, 13, 7, 51);                               // claim now stale
    runScheduler();
    expect(sim.calls).toHaveLength(2);
    expect(sim.records()[`${p.postId}~${first}`].status).toBe("stuck");
    const st = await checkStatus({ postId: p.postId, selected: ["test-1", "test-3"], results, fetchImpl: relayFetch });
    expect(st.results[first].state).toBe("unknown");
    expect(pendingFor(["test-1", "test-3"], st.results)).toEqual([]);
  });

  it("a scheduled Page LinkedIn refused shows as failed after a status check, and a retry re-queues only that Page", async () => {
    refuse = (org) => org === URN["test-2"];
    const p = post("poll", { scheduled: true });
    let results = await scheduleTo({ payload: p, selected: ["test-1", "test-2"], fetchImpl: relayFetch });
    sim.now = Date.UTC(2026, 9, 13, 7, 0);
    runScheduler();
    results = (await checkStatus({ postId: p.postId, selected: ["test-1", "test-2"], results, fetchImpl: relayFetch })).results;
    expect(results["test-1"].state).toBe("published");
    expect(results["test-2"].state).toBe("failed");
    refuse = () => false;
    results = await scheduleTo({ payload: p, selected: ["test-1", "test-2"], results, fetchImpl: relayFetch });
    expect(deliveries.at(-1).destinations.map((d) => d.id)).toEqual(["test-2"]);
    runScheduler();
    expect(callsFor(URN["test-1"])).toHaveLength(1);
    expect(callsFor(URN["test-2"])).toHaveLength(2);
    results = (await checkStatus({ postId: p.postId, selected: ["test-1", "test-2"], results, fetchImpl: relayFetch })).results;
    expect(overall(["test-1", "test-2"], results)).toBe("published");
  });

  it("a scheduled request sent twice, and two scheduler runs back to back, post each Page once", async () => {
    const p = post("text", { scheduled: true });
    await scheduleTo({ payload: p, selected: ["test-2", "test-3"], fetchImpl: relayFetch });
    (await import("../api/publish-to.js")).forgetDeliveries();
    await scheduleTo({ payload: p, selected: ["test-2", "test-3"], fetchImpl: relayFetch });
    expect(deliveries).toHaveLength(2);
    sim.now = Date.UTC(2026, 9, 13, 7, 0);
    sim.tick(UB); sim.tick(UB); sim.tick(UB);
    expect(sim.calls).toHaveLength(2);
  });

  it("the production scheduler never touches a Page job, so old and new can share the store during cutover", async () => {
    const p = post("image", { scheduled: true });
    await scheduleTo({ payload: p, selected: ["test-1", "test-2", "test-3"], fetchImpl: relayFetch });
    const before = sim.records();
    sim.now = Date.UTC(2026, 9, 13, 9, 0);
    sim.tick(PB); sim.tick(PB);
    expect(sim.calls).toHaveLength(0);
    expect(sim.records()).toEqual(before);
  });

  it("old and new schedulers taking turns on a single-Page job publish it once", () => {
    const p = { ...post("text", { scheduled: true }), companyUrn: "" };
    sim.deliver(PA, JSON.stringify(p));                                  // queued by the production scenario
    sim.now = Date.UTC(2026, 9, 13, 7, 0);
    sim.tick(PB); sim.tick(UB); sim.tick(PB); sim.tick(UB);
    expect(sim.calls).toHaveLength(1);
  });
});

/* ===================================================================== */
describe("regression: single-Page publishing keeps the production behaviour", () => {
  const legacy = (type, scheduled) => {
    const p = post(type, { scheduled });
    delete p.company;
    return { ...p, company: "Unison Content OS Test", companyUrn: "urn:li:organization:146260120" };
  };
  for (const type of TYPES) {
    it(`now · ${type}: the unified scenario answers and records what production does`, () => {
      const p = legacy(type, false);
      const a = createMake({ linkedin: () => ({ id: "urn:li:share:7" }), now: T0 });
      const b = createMake({ linkedin: () => ({ id: "urn:li:share:7" }), now: T0 });
      const ra = JSON.parse(a.deliver(PA, JSON.stringify(p)).body);
      const rb = JSON.parse(b.deliver(UA, JSON.stringify(p)).body);
      expect(rb).toMatchObject(ra);                                       // same fields, a few added
      expect(b.records()).toEqual(a.records());
      expect(norm(b.calls)).toEqual(norm(a.calls));
    });
    it(`scheduled · ${type}: the same record, and a production-queued job is published by the unified scheduler as production would`, () => {
      const p = legacy(type, true);
      const a = createMake({ linkedin: () => ({ id: "urn:li:share:8" }), now: T0 });
      const b = createMake({ linkedin: () => ({ id: "urn:li:share:8" }), now: T0 });
      expect(JSON.parse(b.deliver(UA, JSON.stringify(p)).body)).toMatchObject({ status: "queued", postId: p.postId });
      a.deliver(PA, JSON.stringify(p));
      expect(b.records()).toEqual(a.records());
      /* a job already waiting at cutover: written by production, run by unified */
      const c = createMake({ linkedin: () => ({ id: "urn:li:share:8" }), now: T0 });
      c.deliver(PA, JSON.stringify(p));
      for (const s of [a, c]) s.now = Date.UTC(2026, 9, 13, 7, 0);
      a.tick(PB); c.tick(UB);
      expect(norm(c.calls)).toEqual(norm(a.calls));
      const [ra, rc] = [a.records()[p.postId], c.records()[p.postId]];
      expect(rc).toMatchObject({ status: "published", publishedUrn: "urn:li:share:8", companyUrn: ra.companyUrn, content: ra.content });
      expect(rc.media).toEqual(type === "image" || type === "video" ? undefined : ra.media);
    });
  }
  it("a post type Unison withdrew is held, not posted, exactly as production holds it", () => {
    const p = { ...legacy("text", false), postType: "carousel" };
    const a = createMake({ linkedin: () => ({ id: "x" }), now: T0 });
    const b = createMake({ linkedin: () => ({ id: "x" }), now: T0 });
    expect(b.deliver(UA, JSON.stringify(p))).toEqual(a.deliver(PA, JSON.stringify(p)));
    expect(b.records()).toEqual(a.records());
    expect(b.calls).toHaveLength(0);
  });
});

/* ===================================================================== */
describe("operations each run costs (Make bills one per module run)", () => {
  const cost = (fn) => { sim.ops = 0; fn(); return sim.ops; };
  it("matches the production scenarios where they overlap, and is what the docs quote", () => {
    const one = { ...post("text"), companyUrn: URN["test-1"] };
    expect(cost(() => sim.deliver(PA, JSON.stringify(one)))).toBe(5);    // production today: 5 (seen in Make's history)
    for (const type of TYPES) {
      const p = { ...post(type), companyUrn: URN["test-2"] };
      expect(cost(() => sim.deliver(UA, JSON.stringify(p)))).toBe(type === "poll" ? 10 : 7);
    }
    const s1 = { ...post("image", { scheduled: true }), destinations: [PAGES[0]], companyUrn: "" };
    const s3 = { ...post("image", { scheduled: true }), destinations: PAGES, companyUrn: "" };
    expect(cost(() => sim.deliver(UA, JSON.stringify(s1)))).toBe(7);
    expect(cost(() => sim.deliver(UA, JSON.stringify(s3)))).toBe(9);
    expect(cost(() => sim.deliver(UA, JSON.stringify({ publishMode: "status", postId: s3.postId })))).toBe(6);
    sim.now = Date.UTC(2026, 9, 13, 7, 0);
    expect(cost(() => sim.tick(UB))).toBe(1 + 4 * 4);                     // one search, then 4 per Page job (5-job limit)
    sim.store.clear();
    expect(cost(() => sim.tick(UB))).toBe(1);                             // an idle run, every hour
    expect(cost(() => sim.tick(PB))).toBe(1);
  });
});
