import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAKE_CONFIG, publishRoute, SCHEDULED_MEDIA_BUDGET } from "../src/lib/publish.js";
import { LIMITS as POLL_LIMITS } from "../src/lib/poll.js";

/* ============================================================
   THE PROTECTED PUBLISHING CONTRACT

   Everything Make and both scenarios depend on. This file exists to fail
   loudly if an upgrade elsewhere changes the shape of what leaves the
   browser. It is a baseline, recorded before the AI-provider work started,
   not a description of intent.

   If a test here fails, the publishing integration has been altered and the
   change must be deliberate, explained and re-tested end to end.
   ============================================================ */

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

const BASELINE_FIELDS = [
  "source", "postId", "idempotencyKey", "postType", "content",
  "company", "companyUrn", "publishMode", "scheduledDate", "scheduledTime",
  "timezone", "submittedBy", "linkedinAccessToken", "media", "poll",
];

describe("the publish payload contract", () => {
  it("still carries exactly the fields Make reads", () => {
    const src = read("src/App.jsx");
    const block = src.slice(src.indexOf("const payload = {"), src.indexOf("return { payload, limits };"));
    for (const f of BASELINE_FIELDS) {
      /* `postId,` and `media,` are shorthand, so match either form. */
      expect(block, `payload lost the "${f}" field`).toMatch(new RegExp(`\\b${f}\\s*[:,]`));
    }
  });

  it("sends a poll as question, options and duration — and nothing else", () => {
    const line = read("src/App.jsx").split("\n").find((l) => l.includes("? { question: assets.poll.question"));
    expect(line, "the poll payload line is gone").toBeTruthy();
    expect(line).toContain("options:");
    expect(line).toContain("duration:");
    /* Internal poll fields must never reach Make. */
    for (const leak of ["style", "check", "generic", "derived"]) {
      expect(line, `poll payload leaks "${leak}"`).not.toContain(`${leak}:`);
    }
  });

  it("keeps the post types Make has routes for, and the relay path", () => {
    expect(MAKE_CONFIG.supportedPostTypes).toEqual(["text", "image", "video", "poll"]);
    expect(MAKE_CONFIG.relay).toBe("/api/publish");
    expect(MAKE_CONFIG.source).toBe("unison-content-os");
  });

  it("keeps the webhook the two scenarios are bound to", () => {
    expect(String(MAKE_CONFIG.url)).toContain("hook.eu1.make.com");
    expect(String(MAKE_CONFIG.url)).toContain("mkm7o4tvytb4cgfs91se3qnjy5pvucge");
  });

  it("keeps the organisation the scenarios post to", () => {
    const api = read("api/publish.js");
    const blueprints = ["make/scenario-a-linkedin-publisher.json", "make/scenario-b-scheduled-publisher.json"]
      .map(read).join("");
    expect(blueprints).toContain("urn:li:organization:146260120");
    expect(api).toContain("mkm7o4tvytb4cgfs91se3qnjy5pvucge");
  });

  it("keeps the scheduled media budget inside Make's 1 MB data store", () => {
    expect(SCHEDULED_MEDIA_BUDGET).toBeGreaterThan(0);
    expect(SCHEDULED_MEDIA_BUDGET).toBeLessThanOrEqual(1048576 * 0.6);
  });

  it("keeps LinkedIn's poll limits as the publisher enforces them", () => {
    expect(POLL_LIMITS).toMatchObject({ question: 140, option: 30, minOptions: 2, maxOptions: 4 });
    expect(POLL_LIMITS.durations).toEqual(["1 day", "3 days", "1 week", "2 weeks"]);
  });

  it("still resolves a route for every supported post type", async () => {
    for (const postType of MAKE_CONFIG.supportedPostTypes) {
      const route = await publishRoute({ postType, media: [] });
      expect(["linkedin", "relay", "make", "none"], postType).toContain(route);
    }
  });
});
