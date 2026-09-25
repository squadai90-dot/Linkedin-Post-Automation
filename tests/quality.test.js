import { describe, it, expect } from "vitest";
import { review, checkContent, checkVisual, checkVideo } from "../src/lib/quality.js";
import { classify } from "../src/lib/intel.js";
import { visualStrategy } from "../src/lib/visual.js";

const draft = (hook, body, cta = "What would you change?", hashtags = []) => ({ hook, body, cta, hashtags });
const ids = (list) => list.map((f) => f.id);

describe("stopping a figure nobody can source", () => {
  it("blocks a number research never produced", () => {
    const d = draft("Turnaround is the number clients notice", "Firms that outsource review cut turnaround by 38% on average.");
    const r = checkContent({ draft: d, classification: classify(d), research: { claims: [], sources: [], insights: [] } });
    expect(ids(r)).toContain("unsourced-figure");
    expect(r.find((f) => f.id === "unsourced-figure").severity).toBe("blocking");
  });

  it("allows a number the research actually returned", () => {
    const d = draft("Turnaround is the number clients notice", "Our own case study put the fall at 38% across three firms.");
    const r = checkContent({
      draft: d, classification: classify(d),
      research: { claims: [{ text: "Audit turnaround fell 38% across three firms" }], sources: [], insights: [] },
    });
    expect(ids(r)).not.toContain("unsourced-figure");
  });
});

describe("keeping jurisdictions apart", () => {
  it("blocks a post that mixes HMRC and IRS rules", () => {
    const d = draft("Two deadlines to watch", "File Self Assessment with HMRC in January, then send your 1099 forms to the IRS and check Schedule C.");
    const r = checkContent({ draft: d, classification: classify(d), research: {} });
    expect(ids(r)).toContain("mixed-jurisdiction");
  });

  it("asks a country-specific post to say which country it is about", () => {
    const d = draft("The new threshold lands in April", "Every client filing a Self Assessment return will notice the change to the reporting rules.");
    const cls = classify(d);
    expect(cls.country).toBe("UK");
    // it never says "UK" or "HMRC"… wait, it does say Self Assessment only
    const r = checkContent({ draft: d, classification: cls, research: {} });
    expect(ids(r)).toContain("country-unstated");
  });
});

describe("catching what a model writes when it has nothing to say", () => {
  it("blocks stacked filler", () => {
    const d = draft("Unlock the power of outsourcing", "In today's fast-paced world, our cutting-edge solutions are a game-changer for your firm.");
    expect(ids(checkContent({ draft: d, classification: classify(d), research: {} }))).toContain("filler");
  });

  it("does not flag 'leverage' where it is an accounting term", () => {
    const d = draft("Reading a balance sheet", "The leverage ratio tells you more about the risk than the revenue line does, once the debt is netted off.");
    expect(ids(checkContent({ draft: d, classification: classify(d), research: {} }))).not.toContain("filler");
  });

  it("notices a post with nothing concrete in it", () => {
    const d = draft("Outsourcing helps firms grow", "Working with a partner means your team can focus on advisory work and client relationships while someone else handles the routine tasks that take up time.");
    expect(ids(checkContent({ draft: d, classification: classify(d), research: {} }))).toContain("no-specifics");
  });
});

describe("checking the graphic against the post", () => {
  it("blocks a festival post that got a business graphic", () => {
    const d = draft("Happy Diwali from all of us", "Wishing your firm a bright and balanced year ahead.");
    const cls = classify(d);
    const wrong = { strategy: { format: "statement", fields: { headline: "Happy Diwali from all of us" } } };
    expect(ids(checkVisual({ asset: wrong, classification: cls, draft: d }))).toContain("occasion-mismatch");
  });

  it("passes the festival post when it got the occasion graphic", () => {
    const d = draft("Happy Diwali from all of us", "Wishing your firm a bright and balanced year ahead.");
    const cls = classify(d);
    const asset = { strategy: visualStrategy(cls, d) };
    expect(ids(checkVisual({ asset, classification: cls, draft: d }))).not.toContain("occasion-mismatch");
  });

  it("blocks a statistic card with no statistic", () => {
    const asset = { strategy: { format: "stat", fields: { headline: "A number", stat: "" } } };
    expect(ids(checkVisual({ asset, classification: {}, draft: draft("A number", "") }))).toContain("format-empty");
  });

  it("asks for a source when a figure is on the graphic", () => {
    const asset = { strategy: { format: "stat", fields: { headline: "Turnaround", stat: "38%", source: "" } } };
    expect(ids(checkVisual({ asset, classification: {}, draft: draft("Turnaround", "38% faster") }))).toContain("stat-unattributed");
  });

  it("notices a graphic left over from another draft", () => {
    const d = draft("Quarterly BAS lodgment is changing", "The Australian reporting window moves this year.");
    const asset = { strategy: { format: "statement", fields: { headline: "Recruitment marketing budgets climbing" } } };
    expect(ids(checkVisual({ asset, classification: classify(d), draft: d }))).toContain("graphic-unrelated");
  });
});

describe("checking the video tells the post's story", () => {
  it("blocks scenes the post never says", () => {
    const d = draft("Closing the financial year", "Reconcile payroll and finalise reporting before the deadline.");
    const asset = { storyboard: [
      { label: "HOOK", line: "Closing the financial year" },
      { label: "INSIGHT", line: "Blockchain transforms supply logistics" },
      { label: "PROOF", line: "Quantum computing reshapes retail" },
      { label: "CTA", line: "Reconcile payroll early" },
    ] };
    const r = checkVideo({ asset, draft: d, seconds: 10 });
    expect(ids(r)).toContain("video-off-script");
    expect(r.find((f) => f.id === "video-off-script").severity).toBe("blocking");
  });

  it("passes a storyboard drawn from the post", () => {
    const d = draft("Closing the financial year", "Reconcile payroll before the deadline. Review the coding afterwards.");
    const asset = { storyboard: [
      { label: "HOOK", line: "Closing the financial year" },
      { label: "PROBLEM", line: "Reconcile payroll before the deadline" },
      { label: "CTA", line: "What would you change?" },
    ] };
    expect(ids(checkVideo({ asset, draft: d, seconds: 7 }))).not.toContain("video-off-script");
  });
});

describe("the verdict", () => {
  it("passes clean work and says so", () => {
    const d = draft("Reconcile payroll before 30 June", "Australian employers finalise STP after the financial year ends. The ATO expects it marked as tax ready.");
    const cls = classify(d);
    const r = review({ draft: d, classification: cls, research: {}, image: { strategy: visualStrategy(cls, d) } });
    expect(r.pass).toBe(true);
    expect(r.summary).toMatch(/Nothing/);
  });

  it("does not offer to regenerate away a problem regeneration cannot fix", () => {
    const d = draft("Turnaround", "Firms cut turnaround by 38% on average.");
    const r = review({ draft: d, classification: classify(d), research: {} });
    expect(r.pass).toBe(false);
    expect(r.regenerate).toBe(false);          // an unsourced figure needs a source, not another attempt
  });

  it("offers to regenerate a visual that chose the wrong format", () => {
    const d = draft("Happy Diwali from all of us", "Wishing your firm a bright year.");
    const r = review({
      draft: d, classification: classify(d), research: {},
      image: { strategy: { format: "statement", fields: { headline: "Happy Diwali from all of us" } } },
    });
    expect(r.regenerate).toBe(true);
  });
});
