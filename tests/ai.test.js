import { describe, it, expect } from "vitest";
import {
  extractJSON, normalizeDraft, normalizeVerification, normalizeQuality,
  normalizeAngles, normalizeResearch, friendlyError, rateFor, MODELS,
} from "../src/lib/ai.js";

describe("extractJSON", () => {
  it("reads plain JSON", () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences and preamble", () => {
    expect(extractJSON('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("recovers what it can from a reply cut off mid-object", () => {
    // The model ran out of room. Losing the whole reply would be worse than
    // keeping the complete item plus whatever of the last one parsed.
    const truncated = '{"items":[{"headline":"One","score":80},{"headline":"Two","score":';
    const out = extractJSON(truncated);
    expect(out.items[0]).toEqual({ headline: "One", score: 80 });
    expect(out.items.length).toBeGreaterThanOrEqual(1);
    out.items.forEach((x) => expect(typeof x).toBe("object"));
  });

  it("drops a trailing fragment that parses to nothing usable", () => {
    const out = extractJSON('{"items":[{"a":1},');
    expect(out.items).toEqual([{ a: 1 }]);
  });

  it("closes unterminated arrays and objects", () => {
    expect(extractJSON('{"a":[1,2,3]')).toEqual({ a: [1, 2, 3] });
  });

  it("throws when there is no object at all", () => {
    expect(() => extractJSON("no json here")).toThrow();
  });
});

describe("normalizeDraft", () => {
  it("fills in missing fields rather than rendering undefined", () => {
    const d = normalizeDraft({}, "My topic");
    expect(d.hook).toBe("My topic");
    expect(d.body).toBe("");
    expect(d.cta).toBe("");
    expect(d.hashtags).toEqual([]);
    expect(d.claims).toEqual([]);
  });

  it("adds the # to hashtags and drops empties", () => {
    expect(normalizeDraft({ hashtags: ["AI", "#Ops", "", "two words"] }).hashtags)
      .toEqual(["#AI", "#Ops", "#twowords"]);
  });

  it("accepts claims as strings or objects", () => {
    const d = normalizeDraft({ claims: ["a claim", { text: "another", sourceIndex: 2 }, null, 7] });
    expect(d.claims).toEqual([
      { text: "a claim", sourceIndex: 0 },
      { text: "another", sourceIndex: 2 },
    ]);
  });

  it("survives a non-object", () => {
    expect(() => normalizeDraft(null, "t")).not.toThrow();
    expect(normalizeDraft("nonsense", "t").hook).toBe("t");
  });
});

describe("normalizeVerification", () => {
  it("keeps only claims with text and clamps the status", () => {
    const v = normalizeVerification({ claims: [
      { claim: "ok", status: "GREEN" },
      { claim: "unknown status", status: "purple" },
      { claim: "" },
      null,
    ] });
    expect(v.claims).toHaveLength(2);
    expect(v.claims[0].status).toBe("green");
    expect(v.claims[1].status).toBe("yellow"); // unknown becomes "needs review", never "supported"
  });

  it("defaults confidence rather than leaving it blank", () => {
    expect(normalizeVerification({ claims: [{ claim: "x" }] }).claims[0].confidence).toBe("Low");
  });
});

describe("normalizeQuality", () => {
  it("clamps scores into 0-100", () => {
    const q = normalizeQuality({ detail: { hook: 150, readability: -5, brand: "80" } });
    expect(q.detail.hook).toBe(100);
    expect(q.detail.readability).toBe(0);
    expect(q.detail.brand).toBe(80);
    expect(q.detail.evidence).toBe(0); // missing keys are present, not undefined
  });

  it("normalises the duplicate block", () => {
    expect(normalizeQuality({}).duplicate).toEqual({ similar: false, days: 0, title: "" });
  });
});

describe("normalizeAngles", () => {
  it("always recommends exactly one angle", () => {
    const a = normalizeAngles({ angles: [{ headline: "one" }, { headline: "two" }] }, "topic");
    expect(a.angles.filter((x) => x.recommended)).toHaveLength(1);
    expect(a.angles[0].recommended).toBe(true);
  });

  it("keeps an existing recommendation", () => {
    const a = normalizeAngles({ angles: [{ headline: "one" }, { headline: "two", recommended: true }] });
    expect(a.angles[1].recommended).toBe(true);
    expect(a.angles[0].recommended).toBe(false);
  });
});

describe("normalizeResearch", () => {
  it("rejects non-http urls so nothing renders a bogus link", () => {
    const r = normalizeResearch({ sources: [
      { title: "good", url: "https://example.com" },
      { title: "bad", url: "javascript:alert(1)" },
      { title: "empty", url: "…" },
    ] });
    expect(r.sources[0].url).toBe("https://example.com");
    expect(r.sources[1].url).toBe("");
    expect(r.sources[2].url).toBe("");
  });

  it("defaults an unknown tier to 4 (discovery only)", () => {
    expect(normalizeResearch({ sources: [{ title: "x", tier: 9 }] }).sources[0].tier).toBe(4);
    expect(normalizeResearch({ sources: [{ title: "x", tier: 2 }] }).sources[0].tier).toBe(2);
  });
});

describe("friendlyError", () => {
  it("explains a missing key in plain language", () => {
    expect(friendlyError({ code: "no-key" })).toMatch(/No AI key/);
    expect(friendlyError({ code: "bad-key" })).toMatch(/rejected/);
    expect(friendlyError(new Error("Failed to fetch"))).toMatch(/unreachable/);
    expect(friendlyError({ name: "AbortError", message: "abort" })).toBe("Cancelled.");
  });
});

describe("pricing", () => {
  it("prices every paid model, input below output", () => {
    MODELS.anthropic.forEach((m) => {
      const [inR, outR] = rateFor(m.id);
      expect(inR).toBeGreaterThan(0);
      expect(outR).toBeGreaterThan(inR);
    });
  });

  it("prices every Groq model at zero, so the cost line can say free", () => {
    MODELS.groq.forEach((m) => expect(rateFor(m.id)).toEqual([0, 0]));
  });

  it("treats a model id it has never seen as free", () => {
    // Groq adds ids between releases; the picker discovers them at runtime.
    // Guessing a price for one would put an invented number in front of the team.
    expect(rateFor("some-new-groq-model")).toEqual([0, 0]);
  });
});
