import { describe, it, expect } from "vitest";
import { postTimeline, primaryStamp, scheduledInstant } from "../src/lib/posts.js";
import { fmtStamp, fmtGap, secondsApart, tzAbbrev } from "../src/lib/dates.js";

const IST = "Asia/Kolkata";
const at = (iso) => iso;

describe("reading a stamp", () => {
  it("renders the instant in the post's own timezone, not the reader's", () => {
    expect(fmtStamp("2026-09-25T05:00:00Z", IST)).toBe("25 Sep 2026 · 10:30 AM IST");
    expect(fmtStamp("2026-09-25T05:00:00Z", "America/New_York")).toBe("25 Sep 2026 · 1:00 AM EDT");
  });

  it("uses the abbreviation a zone is actually known by", () => {
    expect(tzAbbrev(new Date("2026-09-25T05:00:00Z"), IST)).toBe("IST");
    expect(tzAbbrev(new Date("2026-09-25T05:00:00Z"), "Europe/London")).toBe("BST");
    expect(tzAbbrev(new Date("2026-01-25T05:00:00Z"), "Europe/London")).toBe("GMT");
  });

  it("falls back to a readable zone rather than showing nothing", () => {
    expect(fmtStamp("2026-09-25T05:00:00Z", "Not/AZone")).toMatch(/25 Sep 2026/);
  });

  it("says nothing for a missing or unreadable time", () => {
    expect(fmtStamp(null, IST)).toBe("");
    expect(fmtStamp("not a date", IST)).toBe("");
  });

  it("describes the gap at the resolution that matters", () => {
    expect(fmtGap(0)).toBe("on time");
    expect(fmtGap(18)).toBe("on time");
    expect(fmtGap(45)).toBe("45s later");
    expect(fmtGap(120)).toBe("2 min later");
    expect(fmtGap(3900)).toBe("1 h 5 min later");
    expect(fmtGap(null)).toBe("");
  });

  it("measures the gap between the chosen minute and the real one", () => {
    expect(secondsApart("2026-09-25T05:00:00Z", "2026-09-25T05:00:42Z")).toBe(42);
    expect(secondsApart(null, "2026-09-25T05:00:42Z")).toBeNull();
  });
});

describe("what a post's history shows", () => {
  it("an immediate post has a published time and no scheduled line", () => {
    const { rows, gapSeconds } = postTimeline({
      state: "PUBLISHED", date: "2026-09-25", time: "09:30", tz: IST,
      publishedAt: at("2026-09-25T05:02:00Z"), viaMake: true, sentAt: at("2026-09-25T05:02:00Z"),
    });
    expect(rows.map((r) => r.key)).toEqual(["published"]);
    expect(fmtStamp(rows[0].at, rows[0].tz)).toBe("25 Sep 2026 · 10:32 AM IST");
    expect(gapSeconds).toBeNull();
  });

  it("a scheduled post that published shows both, and how far apart they were", () => {
    const { rows, gapSeconds } = postTimeline({
      state: "PUBLISHED", date: "2026-09-25", time: "10:30", tz: IST,
      scheduledDate: "2026-09-25", scheduledTime: "10:30", scheduledTz: IST,
      scheduledFor: at("2026-09-25T05:00:00Z"), publishedAt: at("2026-09-25T05:01:00Z"),
    });
    expect(rows.map((r) => r.key)).toEqual(["scheduled", "published"]);
    expect(fmtStamp(rows[0].at, rows[0].tz)).toBe("25 Sep 2026 · 10:30 AM IST");
    expect(fmtStamp(rows[1].at, rows[1].tz)).toBe("25 Sep 2026 · 10:31 AM IST");
    expect(gapSeconds).toBe(60);
    expect(fmtGap(gapSeconds)).toBe("1 min later");
  });

  it("a post Make is still holding has no published time at all", () => {
    const { rows } = postTimeline({
      state: "SENT", viaMake: true, scheduledHandoff: true,
      date: "2026-09-25", time: "10:30", tz: IST,
      scheduledFor: at("2026-09-25T05:00:00Z"), sentAt: at("2026-09-25T04:58:00Z"),
    });
    expect(rows.map((r) => r.key)).toEqual(["scheduled", "sent", "published"]);
    expect(rows[2].at).toBeNull();
    expect(rows[2].pending).toBe("Not yet confirmed");
  });

  it("does not repeat one instant as two events", () => {
    // Make took it and published it in the same round trip.
    const { rows } = postTimeline({
      state: "PUBLISHED", viaMake: true, date: "2026-09-25", tz: IST,
      sentAt: at("2026-09-25T05:02:00Z"), publishedAt: at("2026-09-25T05:02:00Z"),
    });
    expect(rows.map((r) => r.key)).toEqual(["published"]);
  });

  it("a held post says it was not published rather than leaving it blank", () => {
    const { rows } = postTimeline({ state: "HELD", viaMake: true, date: "2026-09-25", tz: IST, sentAt: at("2026-09-25T05:02:00Z") });
    expect(rows.find((r) => r.key === "published").pending).toMatch(/Not published/);
  });

  it("a row from an older save still reads, from its date, time and zone", () => {
    const post = { state: "SCHEDULED", date: "2026-09-25", time: "10:30", tz: IST };
    expect(scheduledInstant(post)).toBe("2026-09-25T05:00:00.000Z");
    expect(postTimeline(post).rows.map((r) => r.key)).toEqual(["scheduled"]);
  });

  it("never invents a scheduled time for a post that was published immediately", () => {
    // `time` is the scheduler's field and is present on every record.
    const post = { state: "PUBLISHED", date: "2026-09-25", time: "09:30", tz: IST, publishedAt: at("2026-09-25T05:02:00Z") };
    expect(scheduledInstant(post)).toBeNull();
    expect(postTimeline(post).rows.map((r) => r.key)).toEqual(["published"]);
  });

  it("a post with nothing recorded shows nothing rather than a guess", () => {
    expect(postTimeline({ state: "PUBLISHED", date: "2026-09-25" }).rows).toEqual([]);
    expect(primaryStamp({ state: "PUBLISHED", date: "2026-09-25" })).toBeNull();
  });

  it("the compact row prefers the real publication time", () => {
    const post = {
      state: "PUBLISHED", date: "2026-09-25", tz: IST,
      scheduledFor: at("2026-09-25T05:00:00Z"), publishedAt: at("2026-09-25T05:01:00Z"),
    };
    expect(primaryStamp(post).key).toBe("published");
    const queued = { state: "SCHEDULED", date: "2026-09-25", time: "10:30", tz: IST };
    expect(primaryStamp(queued).key).toBe("scheduled");
  });
});
