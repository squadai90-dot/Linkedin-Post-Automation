import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hnStories, hnToOpportunities, wikiSearch, wikiToSources, grammarCheck,
  applyReplacement, holidayOn, pollinationsUrl,
} from "../src/lib/freeApis.js";

const jsonOnce = (body, ok = true, status = 200) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });

afterEach(() => vi.restoreAllMocks());

describe("Hacker News", () => {
  it("maps hits and prefers the busiest story", async () => {
    jsonOnce({ hits: [
      { objectID: "1", title: "Quiet story", url: "https://a.example.com/x", points: 30, num_comments: 2, created_at: "2026-09-01T00:00:00Z" },
      { objectID: "2", title: "Busy story", url: "https://b.example.com/y", points: 200, num_comments: 90, created_at: "2026-09-05T00:00:00Z" },
    ] });
    const rows = await hnStories("ai agents", { limit: 5 });
    expect(rows[0].title).toBe("Busy story");
    expect(rows[0].publisher).toBe("b.example.com");
    expect(rows[0].discussion).toContain("news.ycombinator.com");
  });

  it("falls back to the discussion link when a story has no url", async () => {
    jsonOnce({ hits: [{ objectID: "42", title: "Ask HN", points: 50, num_comments: 10, created_at: "2026-09-05T00:00:00Z" }] });
    const [row] = await hnStories("x");
    expect(row.url).toContain("item?id=42");
    expect(row.publisher).toBe("news.ycombinator.com");
  });

  it("reports a tagged error the caller can ignore", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    await expect(hnStories("x")).rejects.toMatchObject({ kind: "network" });
  });

  it("never claims to know whether the Page covered a story", () => {
    const opps = hnToOpportunities([{ title: "T", url: "https://e.com", publisher: "e.com", points: 100, comments: 20, date: "2026-09-08" }],
      { now: Date.parse("2026-09-09T00:00:00Z") });
    expect(opps[0].gap).toBe("unknown");
    expect(opps[0].via).toBe("hn");
    expect(opps[0].score).toBeGreaterThan(0);
    expect(opps[0].score).toBeLessThanOrEqual(99);
  });

  it("scores a fresh busy story above an old quiet one", () => {
    const now = Date.parse("2026-09-09T00:00:00Z");
    const [fresh] = hnToOpportunities([{ title: "a", points: 300, comments: 100, date: "2026-09-09" }], { now });
    const [old] = hnToOpportunities([{ title: "b", points: 25, comments: 1, date: "2026-08-01" }], { now });
    expect(fresh.score).toBeGreaterThan(old.score);
  });
});

describe("Wikipedia", () => {
  it("strips the html out of snippets and builds a real article url", async () => {
    jsonOnce({ query: { search: [{ title: "Machine learning", snippet: 'a <span class="s">field</span> of &quot;AI&quot;', timestamp: "2026-08-01T00:00:00Z" }] } });
    const [row] = await wikiSearch("machine learning");
    expect(row.snippet).toBe('a field of "AI"');
    expect(row.url).toBe("https://en.wikipedia.org/wiki/Machine_learning");
  });

  it("marks wikipedia rows as background, never as evidence", async () => {
    const sources = wikiToSources([{ title: "T", snippet: "s", url: "https://en.wikipedia.org/wiki/T", date: "2026-08-01" }]);
    expect(sources[0].background).toBe(true);
    expect(sources[0].tier).toBe(3);
  });
});

describe("LanguageTool", () => {
  it("returns the matched text and suggested replacements", async () => {
    jsonOnce({ matches: [{ offset: 4, length: 5, message: "Spelling mistake", shortMessage: "Spelling",
      replacements: [{ value: "there" }, { value: "their" }], rule: { id: "SPELL", category: { name: "Typos" } } }] });
    const [m] = await grammarCheck("The thier cat");
    expect(m.text).toBe("thier");
    expect(m.replacements).toEqual(["there", "their"]);
    expect(m.category).toBe("Typos");
  });

  it("skips the request for empty text", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await grammarCheck("   ")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("applies a replacement at the right offset", () => {
    const text = "The thier cat";
    expect(applyReplacement(text, { offset: 4, length: 5 }, "their")).toBe("The their cat");
  });
});

describe("public holidays", () => {
  it("finds a holiday on the exact date", async () => {
    jsonOnce([{ date: "2026-12-25", localName: "Christmas Day", name: "Christmas Day", global: true }]);
    const h = await holidayOn("2026-12-25", "GB");
    expect(h.name).toBe("Christmas Day");
  });

  it("returns nothing without a country", async () => {
    expect(await holidayOn("2026-12-25", null)).toBe(null);
  });
});

describe("Pollinations", () => {
  it("encodes the prompt and pins the size", () => {
    const url = pollinationsUrl("a clean office scene", { seed: 7 });
    expect(url).toContain("a%20clean%20office%20scene");
    expect(url).toContain("width=1200");
    expect(url).toContain("height=630");
    expect(url).toContain("seed=7");
  });
});
