import { describe, it, expect, vi } from "vitest";
import {
  reconcileSelection, defaultSelection, selectAll, toggle, publishLabel, pendingFor, overall,
  publishNowTo, scheduleTo, fetchDestinations,
} from "../src/lib/destinations.js";

const LIST = [
  { id: "test-1", name: "Unison Content OS Test", organizationUrn: "urn:li:organization:146260120", enabled: true },
  { id: "test-2", name: "Unison Content OS Test 2", organizationUrn: "urn:li:organization:145298202", enabled: true },
  { id: "test-3", name: "Unison Content OS Test 3", organizationUrn: "urn:li:organization:145301196", enabled: true },
];
const answer = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
const PAYLOAD = { postId: "p-1", postType: "text", content: "Test post — please ignore", publishMode: "now" };

describe("choosing Pages", () => {
  it("starts a new post on one Page, as before", () => {
    expect(defaultSelection(LIST)).toEqual(["test-1"]);
    expect(defaultSelection([])).toEqual([]);
  });
  it("selects all, clears and toggles", () => {
    expect(selectAll(LIST)).toEqual(["test-1", "test-2", "test-3"]);
    expect(toggle(["test-1"], "test-3")).toEqual(["test-1", "test-3"]);
    expect(toggle(["test-1", "test-3"], "test-1")).toEqual(["test-3"]);
  });
  it("says what Publish will do", () => {
    expect(publishLabel(0)).toBe("Choose a Page");
    expect(publishLabel(1)).toBe("Publish to 1 Page");
    expect(publishLabel(3)).toBe("Publish to 3 Pages");
  });
  it("reports a Page that has gone instead of swapping in another", () => {
    const r = reconcileSelection(["test-1", "old-page"], LIST);
    expect(r.valid).toEqual(["test-1"]);
    expect(r.missing).toEqual(["old-page"]);
    const off = reconcileSelection(["test-2"], [LIST[0], { ...LIST[1], enabled: false }]);
    expect(off.valid).toEqual([]);
    expect(off.unavailable).toEqual(["test-2"]);
  });
});

describe("results per Page", () => {
  it("never resends a Page that has the post, or may have it", () => {
    const res = { "test-1": { state: "published" }, "test-2": { state: "failed" }, "test-3": { state: "unknown" } };
    expect(pendingFor(["test-1", "test-2", "test-3"], res)).toEqual(["test-2"]);
  });
  it("sums up the post honestly", () => {
    const all = ["test-1", "test-2"];
    expect(overall(all, { "test-1": { state: "published" }, "test-2": { state: "published" } })).toBe("published");
    expect(overall(all, { "test-1": { state: "published" }, "test-2": { state: "failed" } })).toBe("partial");
    expect(overall(all, { "test-1": { state: "failed" }, "test-2": { state: "rejected" } })).toBe("failed");
    expect(overall(all, { "test-1": { state: "queued" }, "test-2": { state: "queued" } })).toBe("queued");
    expect(overall(all, { "test-1": { state: "published" }, "test-2": { state: "accepted" } })).toBe("sent");
  });
});

describe("sending", () => {
  it("publishes now with one request per chosen Page, and only to those", async () => {
    const fetchImpl = vi.fn(async (_u, init) => {
      const b = JSON.parse(init.body);
      return answer(200, { state: "published", urn: `urn:li:share:${b.destinationIds[0]}` });
    });
    const res = await publishNowTo({ payload: PAYLOAD, selected: ["test-1", "test-3"], fetchImpl });
    const sent = fetchImpl.mock.calls.map(([, i]) => JSON.parse(i.body));
    expect(sent.map((b) => b.destinationIds)).toEqual([["test-1"], ["test-3"]]);
    expect(sent.every((b) => b.fanout === true)).toBe(true);
    expect(Object.keys(res)).toEqual(["test-1", "test-3"]);
    expect(res["test-3"].urn).toBe("urn:li:share:test-3");
  });

  it("keeps a Page's success when another fails, and a retry sends only the failed one", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(answer(200, { state: "published", urn: "urn:li:share:a" }))
      .mockResolvedValueOnce(answer(502, { state: "failed", error: "LinkedIn refused the post for this Page" }))
      .mockResolvedValueOnce(answer(200, { state: "published", urn: "urn:li:share:a" }))
      .mockResolvedValueOnce(answer(200, { state: "published", urn: "urn:li:share:c" }));
    const sel = ["test-1", "test-2", "test-3"];
    const first = await publishNowTo({ payload: PAYLOAD, selected: sel, fetchImpl });
    expect(first["test-1"].state).toBe("published");
    expect(first["test-2"].state).toBe("failed");
    expect(first["test-3"].state).toBe("published");
    expect(overall(sel, first)).toBe("partial");

    const again = await publishNowTo({ payload: PAYLOAD, selected: sel, results: first, fetchImpl: vi.fn(async () => answer(200, { state: "published", urn: "urn:li:share:b" })) });
    expect(again["test-1"].urn).toBe("urn:li:share:a");
    expect(again["test-2"].urn).toBe("urn:li:share:b");
    expect(overall(sel, again)).toBe("published");
  });

  it("a retry of one Page keeps that Page's job key (fanout stays on)", async () => {
    const fetchImpl = vi.fn(async () => answer(200, { state: "published", urn: "urn:li:share:x" }));
    await publishNowTo({ payload: PAYLOAD, selected: ["test-1", "test-2"], results: { "test-1": { state: "published" } }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const b = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(b.destinationIds).toEqual(["test-2"]);
    expect(b.fanout).toBe(true);
  });

  it("treats no answer as unknown, so it is not resent blindly", async () => {
    const fetchImpl = vi.fn(async (_u, init) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const res = await publishNowTo({ payload: PAYLOAD, selected: ["test-1"], fetchImpl, timeoutMs: 10 });
    expect(res["test-1"].state).toBe("unknown");
    expect(pendingFor(["test-1"], res)).toEqual([]);
  });

  it("schedules every Page in one request", async () => {
    const fetchImpl = vi.fn(async () => answer(200, { state: "queued" }));
    const res = await scheduleTo({ payload: { ...PAYLOAD, publishMode: "scheduled" }, selected: ["test-1", "test-2", "test-3"], fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).destinationIds).toEqual(["test-1", "test-2", "test-3"]);
    expect(Object.values(res).every((r) => r.state === "queued")).toBe(true);
  });

  it("reports the feature off when no server list is deployed", async () => {
    const r = await fetchDestinations({ fetchImpl: async () => ({ ok: false, status: 404, text: async () => "<!doctype html>" }) });
    expect(r.enabled).toBe(false);
  });
});
