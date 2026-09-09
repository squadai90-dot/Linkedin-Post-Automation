import { describe, it, expect } from "vitest";
import { sanitizeSession } from "../src/lib/store.js";

/* A saved session is data from outside the running code: an older build, a
   half-written save, or something hand-edited. None of it may crash the app. */

describe("sanitizeSession", () => {
  it("returns null for anything that is not an object", () => {
    expect(sanitizeSession("{not json")).toBe(null);
    expect(sanitizeSession("")).toBe(null);
    expect(sanitizeSession("[1,2,3]")).toBe(null);
    expect(sanitizeSession('"a string"')).toBe(null);
    expect(sanitizeSession(null)).toBe(null);
  });

  it("drops fields whose type is wrong instead of passing them through", () => {
    const out = sanitizeSession(JSON.stringify({
      posts: "not an array",
      drafts: 5,
      draft: "a string",
      schedule: 7,
      assets: null,
      idea: { nope: true },
      theme: "light",
    }));
    expect(out.posts).toBeUndefined();
    expect(out.drafts).toBeUndefined();
    expect(out.draft).toBeUndefined();
    expect(out.schedule).toBeUndefined();
    expect(out.assets).toBeUndefined();
    expect(out.idea).toBeUndefined();
    expect(out.theme).toBe("light"); // the one good field survives
  });

  it("keeps well-formed fields", () => {
    const session = {
      theme: "dark", idea: "a topic", stage: "HUMAN_REVIEW", workId: "w-1",
      posts: [{ id: "p1" }], drafts: [], searchOn: false, bg3d: true,
      draft: { hook: "h", body: "b", cta: "c" }, schedule: { date: "2026-09-09", time: "09:30", tz: "UTC" },
    };
    expect(sanitizeSession(JSON.stringify(session))).toMatchObject(session);
  });

  it("ignores unknown fields from a newer or older build", () => {
    const out = sanitizeSession(JSON.stringify({ version: 99, somethingNew: { a: 1 }, theme: "dark" }));
    expect(out.somethingNew).toBeUndefined();
    expect(out.version).toBeUndefined();
    expect(out.theme).toBe("dark");
  });

  it("accepts formats as an array or the older single string", () => {
    expect(sanitizeSession(JSON.stringify({ formats: ["text", "poll"] })).formats).toEqual(["text", "poll"]);
    expect(sanitizeSession(JSON.stringify({ formats: "image" })).formats).toBe("image");
    expect(sanitizeSession(JSON.stringify({ format: "video" })).formats).toBe("video"); // legacy key
    expect(sanitizeSession(JSON.stringify({ formats: 42 })).formats).toBeUndefined();
  });

  it("does not treat an array as an object field", () => {
    expect(sanitizeSession(JSON.stringify({ profile: ["not", "a", "profile"] })).profile).toBeUndefined();
  });

  it("survives a session that is entirely empty", () => {
    expect(sanitizeSession("{}")).toEqual({});
  });
});
