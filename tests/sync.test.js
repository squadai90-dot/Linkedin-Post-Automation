/* The optional shared workspace: what it shares, what it refuses to share,
   and what happens when two people save at once. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sharedSlice, SHARED_KEYS, mergeShared, pull, push, workspaceHealth, resetWorkspaceProbe, SYNC, syncSummary } from "../src/lib/sync.js";

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const healthy = () => res(200, { service: "unison-workspace", version: 1, configured: true });

beforeEach(() => { localStorage.clear(); resetWorkspaceProbe(); SYNC.version = 0; SYNC.lastError = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe("what gets shared", () => {
  it("shares the team's half and nothing else", () => {
    const slice = sharedSlice({ posts: [1], team: [2], schedule: {}, audit: [], profile: {}, voice: {}, makeCompany: {}, draft: "mine", assets: { images: ["big"] }, usage: {} });
    expect(Object.keys(slice).sort()).toEqual([...SHARED_KEYS].sort());
  });

  it("never shares a key, a token, or the draft someone is mid-sentence in", () => {
    // Keys are per-person by design; a half-written draft would fight with
    // whoever else is typing; media is far too large for one document.
    const slice = sharedSlice({ posts: [], apiKey: "gsk_secret", linkedin: { accessToken: "tok" }, draft: { body: "half a sentence" }, assets: { images: ["data:..."] } });
    const json = JSON.stringify(slice);
    expect(json).not.toMatch(/gsk_secret|tok|half a sentence|data:/);
  });
});

describe("merging two people's work", () => {
  it("keeps both people's posts rather than letting the later save win", () => {
    const mine = { posts: [{ id: "a", title: "Mine" }] };
    const theirs = { posts: [{ id: "b", title: "Theirs" }] };
    const out = mergeShared(mine, theirs);
    expect(out.posts.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("prefers my edit to a row we both changed", () => {
    const out = mergeShared(
      { posts: [{ id: "a", state: "APPROVED" }] },
      { posts: [{ id: "a", state: "DRAFT", note: "theirs" }] }
    );
    expect(out.posts[0].state).toBe("APPROVED");
    expect(out.posts[0].note).toBe("theirs");   // their field survives too
  });

  it("merges the team list by email, not position", () => {
    const out = mergeShared({ team: [{ email: "a@x.com", role: "Creator" }] }, { team: [{ email: "b@x.com", role: "Approver" }] });
    expect(out.team).toHaveLength(2);
  });

  it("keeps every audit line, newest first, without duplicates", () => {
    const out = mergeShared(
      { audit: [{ t: "2026-01-02", text: "mine" }, { t: "2026-01-01", text: "both" }] },
      { audit: [{ t: "2026-01-03", text: "theirs" }, { t: "2026-01-01", text: "both" }] }
    );
    expect(out.audit.map((a) => a.text)).toEqual(["theirs", "mine", "both"]);
  });

  it("caps the audit trail so one document cannot grow without limit", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ t: `2026-01-${i}`, text: `line ${i}` }));
    expect(mergeShared({ audit: many }, { audit: [] }).audit).toHaveLength(200);
  });

  it("survives either side being empty or malformed", () => {
    expect(() => mergeShared(undefined, undefined)).not.toThrow();
    expect(mergeShared({}, { posts: "not an array" }).posts).toEqual([]);
  });
});

describe("talking to the workspace", () => {
  it("reports off, and stays off, when nothing is deployed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(404, {})));
    expect(await workspaceHealth()).toBe(false);
    expect(await pull()).toBeNull();
    expect(await push({ posts: [] })).toEqual({ ok: false, reason: "off" });
    expect(syncSummary()).toMatch(/Local to this browser/);
  });

  it("reports off when the endpoint exists but has no store behind it", async () => {
    // Answering "I am here but not configured" must not read as ready.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(200, { service: "unison-workspace", configured: false })));
    expect(await workspaceHealth()).toBe(false);
  });

  it("reads the shared document and remembers its version", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(res(200, { configured: true, version: 7, value: { posts: [{ id: "a" }] }, updatedBy: "Sam" })));
    const doc = await pull();
    expect(doc.posts).toEqual([{ id: "a" }]);
    expect(SYNC.version).toBe(7);
    expect(syncSummary()).toMatch(/Shared with your team/);
  });

  it("sends the version it started from, so a stale write can be caught", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(res(200, { ok: true, version: 8 }));
    vi.stubGlobal("fetch", fetchMock);
    SYNC.version = 7;

    const r = await push({ posts: [{ id: "a" }], draft: "not shared" }, "Sam");
    expect(r).toEqual({ ok: true, version: 8 });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.baseVersion).toBe(7);
    expect(body.by).toBe("Sam");
    expect(body.data.draft).toBeUndefined();
  });

  it("hands back the other version on a conflict instead of overwriting", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(res(409, { conflict: true, version: 9, data: { posts: [{ id: "theirs" }] }, updatedBy: "Alex" })));
    const r = await push({ posts: [{ id: "mine" }] }, "Sam");
    expect(r.reason).toBe("conflict");
    expect(r.theirs.posts).toEqual([{ id: "theirs" }]);
    expect(r.by).toBe("Alex");
    expect(SYNC.status).toBe("conflict");
    expect(syncSummary()).toMatch(/Someone else saved first/);
  });

  it("says the work is still safe locally when the store is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(healthy())
      .mockRejectedValueOnce(new TypeError("Failed to fetch")));
    const r = await push({ posts: [] }, "Sam");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("error");
    expect(syncSummary()).toMatch(/working locally/);
  });

  it("reports a full workspace as a size problem, not a mystery", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(healthy())
      .mockResolvedValueOnce(res(413, { error: "The workspace is 1200KB, over the 900KB limit. Remove some uploaded media and try again." })));
    const r = await push({ posts: [] }, "Sam");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Remove some uploaded media/);
  });
});
