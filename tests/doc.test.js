import { describe, it, expect } from "vitest";
import { digestDocument, sentences } from "../src/lib/doc.js";

const SAMPLE = `Quarterly operations review for the outsourcing practice.
Average turnaround on a statutory audit fell from 14 days to 9 days this quarter.
The team closed 42 engagements, up 18% on the same quarter last year.
Clients repeatedly asked for a single point of contact rather than a shared inbox.
Hiring remains the constraint on how many engagements the practice can take on.`;

describe("reading a document without a model", () => {
  it("keeps only sentences that say something", () => {
    const s = sentences("Hi. " + SAMPLE);
    expect(s.every((x) => x.length >= 40)).toBe(true);
    expect(s.some((x) => x === "Hi.")).toBe(false);
  });

  it("quotes the document rather than inventing a summary", () => {
    const d = digestDocument(SAMPLE, "review.docx");
    expect(SAMPLE.replace(/\s+/g, " ")).toContain(d.summary.replace(/…$/, "").trim());
  });

  it("puts the sentences carrying figures under stats", () => {
    const d = digestDocument(SAMPLE);
    expect(d.stats.join(" ")).toMatch(/18%|42 engagements|14 days/);
    expect(d.facts.join(" ")).not.toMatch(/18%/);
  });

  it("offers claims the writer can use, figures first", () => {
    const d = digestDocument(SAMPLE);
    expect(d.claims.length).toBeGreaterThan(0);
    expect(d.claims[0]).toMatch(/\d/);
  });

  it("says it is a degraded read so the panel can be honest about it", () => {
    expect(digestDocument(SAMPLE).degraded).toBe(true);
  });

  it("does not pretend to have insights it cannot have", () => {
    expect(digestDocument(SAMPLE).insights).toEqual([]);
  });

  it("survives a file with nothing readable in it", () => {
    const d = digestDocument("\u0000\u0001 ??? ", "binary.pdf");
    expect(d.summary).toContain("binary.pdf");
    expect(d.claims).toEqual([]);
  });
});

import { addDocToResearch } from "../src/lib/doc.js";

const DOC = { name: "review.docx", summary: "A quarterly review.", claims: ["Turnaround fell to 9 days", "42 engagements closed"], insights: [] };

describe("folding an uploaded document into research", () => {
  it("becomes the whole of research when there is none yet", () => {
    const r = addDocToResearch(null, DOC);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0].tier).toBe(1);
    expect(r.claims.map((c) => c.text)).toEqual(DOC.claims);
    expect(r.claims.every((c) => c.sourceIndex === 0)).toBe(true);
  });

  it("goes in front of the researched sources", () => {
    const prev = { sources: [{ title: "A report", publisher: "Someone" }], claims: [{ text: "Something else", sourceIndex: 0 }], insights: [] };
    const r = addDocToResearch(prev, DOC);
    expect(r.sources[0].title).toBe("review.docx");
    expect(r.sources[1].title).toBe("A report");
  });

  it("keeps the other claims pointing at the right source", () => {
    const prev = { sources: [{ title: "A report" }, { title: "Another" }], claims: [{ text: "From the second", sourceIndex: 1 }], insights: [] };
    const r = addDocToResearch(prev, DOC);
    const moved = r.claims.find((c) => c.text === "From the second");
    expect(r.sources[moved.sourceIndex].title).toBe("Another");
  });

  it("does not stack the same document up twice", () => {
    const once = addDocToResearch({ sources: [{ title: "A report" }], claims: [], insights: [] }, DOC);
    const twice = addDocToResearch(once, DOC);
    expect(twice.sources.filter((s) => s.uploaded)).toHaveLength(1);
    expect(twice.claims.filter((c) => c.fromDocument)).toHaveLength(2);
    expect(twice.sources[twice.sources.length - 1].title).toBe("A report");
  });

  it("leaves research alone when there is no document", () => {
    const prev = { sources: [], claims: [], insights: [] };
    expect(addDocToResearch(prev, null)).toBe(prev);
  });
});

describe("what the document adds to the research panel", () => {
  it("keeps the document's insights beside the engine's, not mixed in", () => {
    const prev = { sources: [], claims: [], insights: ["Engine said this"] };
    const r = addDocToResearch(prev, { ...DOC, insights: ["The document said this"] });
    expect(r.insights).toEqual(["Engine said this"]);
    expect(r.docInsights).toEqual(["The document said this"]);
  });

  it("replaces a previous document's insights instead of piling them up", () => {
    let r = addDocToResearch({ sources: [], claims: [], insights: [] }, { ...DOC, insights: ["First file"] });
    r = addDocToResearch(r, { name: "second.docx", claims: [], insights: ["Second file"] });
    expect(r.docInsights).toEqual(["Second file"]);
  });
});
