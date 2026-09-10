import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toISODate, todayISO, addDays, startOfWeek, monthGrid, weekDays, sameMonth,
  greeting, nextSlot, zonedToUtc, isDue, relativeTime, countryForTimezone, fmtMonth,
} from "../src/lib/dates.js";

afterEach(() => vi.useRealTimers());

describe("local dates", () => {
  it("formats the local day, not the UTC day", () => {
    // 23:30 local on the 5th must stay the 5th, which toISOString() would not
    expect(toISODate(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
    expect(toISODate(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-09-09")).toBe("2026-09-07"); // a Wednesday
    expect(startOfWeek("2026-09-07")).toBe("2026-09-07"); // already Monday
    expect(startOfWeek("2026-09-13")).toBe("2026-09-07"); // Sunday belongs to the week before
  });

  it("builds a six-by-seven month grid that contains every day of the month", () => {
    const rows = monthGrid("2026-09-09");
    expect(rows).toHaveLength(6);
    rows.forEach((r) => expect(r).toHaveLength(7));
    const flat = rows.flat();
    expect(flat).toContain("2026-09-01");
    expect(flat).toContain("2026-09-30");
    expect(new Set(flat).size).toBe(42); // no duplicates
  });

  it("returns seven consecutive days for a week", () => {
    const days = weekDays("2026-09-09");
    expect(days).toEqual(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  });

  it("compares months", () => {
    expect(sameMonth("2026-09-01", "2026-09-30")).toBe(true);
    expect(sameMonth("2026-09-30", "2026-10-01")).toBe(false);
  });

  it("names the month", () => { expect(fmtMonth("2026-09-09")).toBe("September 2026"); });
});

describe("greeting", () => {
  it("changes with the hour", () => {
    expect(greeting(new Date(2026, 8, 9, 9))).toBe("Good morning");
    expect(greeting(new Date(2026, 8, 9, 13))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 8, 9, 20))).toBe("Good evening");
    expect(greeting(new Date(2026, 8, 9, 2))).toBe("Good evening");
  });
});

describe("nextSlot", () => {
  it("never suggests a slot in the past", () => {
    const from = new Date(2026, 8, 9, 14); // Wednesday afternoon
    const slot = nextSlot(from);
    expect(slot.date).toBe("2026-09-10");
    expect(slot.time).toBe("09:30");
  });

  it("keeps today when it is still early", () => {
    expect(nextSlot(new Date(2026, 8, 9, 7)).date).toBe("2026-09-09");
  });

  it("skips the weekend", () => {
    // Friday afternoon rolls to Monday, not Saturday
    expect(nextSlot(new Date(2026, 8, 11, 15)).date).toBe("2026-09-14");
  });
});

describe("timezones", () => {
  it("converts a wall-clock time in a zone to the right instant", () => {
    // 09:30 in Kolkata is UTC+05:30, so 04:00 UTC
    const utc = zonedToUtc("2026-09-09", "09:30", "Asia/Kolkata");
    expect(utc.toISOString()).toBe("2026-09-09T04:00:00.000Z");
  });

  it("handles a zone behind UTC", () => {
    // 09:00 New York in September is EDT (UTC-4) → 13:00 UTC
    expect(zonedToUtc("2026-09-09", "09:00", "America/New_York").toISOString()).toBe("2026-09-09T13:00:00.000Z");
  });

  it("decides whether a scheduled slot is due", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    expect(isDue("2026-09-09", "09:00", "UTC", now)).toBe(true);
    expect(isDue("2026-09-09", "15:00", "UTC", now)).toBe(false);
    // 15:00 in Kolkata is 09:30 UTC — already past
    expect(isDue("2026-09-09", "15:00", "Asia/Kolkata", now)).toBe(true);
  });

  it("maps timezones to holiday country codes", () => {
    expect(countryForTimezone("Asia/Kolkata")).toBe("IN");
    expect(countryForTimezone("America/New_York")).toBe("US");
    expect(countryForTimezone("Nowhere/Unknown")).toBe(null);
  });
});

describe("relativeTime", () => {
  it("describes the age of a timestamp", () => {
    const now = Date.parse("2026-09-09T12:00:00Z");
    expect(relativeTime("2026-09-09T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-09-09T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-09-09T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-09-07T12:00:00Z", now)).toBe("2 d ago");
    expect(relativeTime(null, now)).toBe("");
  });
});

describe("todayISO", () => {
  it("agrees with the system clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 9, 10));
    expect(todayISO()).toBe("2026-09-09");
  });
});
