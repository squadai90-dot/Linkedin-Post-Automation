import { describe, it, expect } from "vitest";
import { imagePrompt, videoPrompt, autoStyle, resolveStyle, subjectFor, estimateCost, STYLES, STYLE_BY_ID } from "../src/lib/artdirection.js";
import { classify } from "../src/lib/intel.js";

const post = (hook, body = "", topic = "") => ({ hook, body, topic, cta: "" });
const promptFor = (p, style = "illustrated") =>
  imagePrompt({ classification: classify(p), content: p, style, brand: { name: "Unison Globus" } });

describe("never asking a model to write", () => {
  it("forbids text, numbers and logos in every generated style", () => {
    for (const s of STYLES.filter((x) => !x.rendered)) {
      const p = promptFor(post("A thought about capacity", "Teams are stretched."), s.id);
      expect(p, s.id).toMatch(/no text, letters, numbers, words, signage, logos/i);
    }
  });

  it("returns no prompt at all for the style Unison draws itself", () => {
    expect(promptFor(post("A rule changed", "HMRC confirmed it."), "infographic")).toBeNull();
    expect(STYLE_BY_ID.infographic.rendered).toBe(true);
  });

  it("leaves room for the headline it will composite afterwards", () => {
    expect(promptFor(post("Something", "Anything"))).toMatch(/empty space in the left third/i);
  });
});

describe("the picture is of what the post is about", () => {
  it("draws Navratri as garba, not as an office", () => {
    const p = promptFor(post("Happy Navratri from all of us", "Our teams are celebrating."));
    expect(p).toMatch(/chaniya choli/i);
    expect(p).toMatch(/dandiya/i);
    expect(p).toMatch(/garba/i);
    expect(p).toMatch(/Culturally accurate Navratri detail/i);
  });

  it("refuses the robot cliché on an AI post", () => {
    const p = promptFor(post("What AI actually changed in our review process", "Machine learning handles the first pass now."));
    expect(p).toMatch(/Do not draw a humanoid robot/i);
  });

  it("refuses coins and piggy banks on a cost post", () => {
    expect(promptFor(post("The real cost of a late close", "Fees rise when the file moves late."))).toMatch(/Do not draw coins/i);
  });

  it("refuses the arrow-over-skyline on a growth post", () => {
    expect(promptFor(post("How firms scale without hiring", "Growth without headcount."))).toMatch(/generic upward arrow/i);
  });

  it("puts people in a culture post and a workload in a capacity post", () => {
    expect(subjectFor(classify(post("Congratulations to our team", "We celebrate five years.")), {})).toMatch(/colleagues/i);
    expect(subjectFor(classify(post("Capacity, not people", "Staff shortages mean longer hours.")), {})).toMatch(/workload/i);
  });

  it("names the country when one is implied and there is no festival", () => {
    expect(promptFor(post("Self Assessment lands in January", "HMRC expects the return by then."))).toMatch(/United Kingdom/);
  });
});

describe("choosing a style when the user has not", () => {
  it("sends anything with a figure or a rule to the renderer, where it is exact", () => {
    expect(autoStyle(classify(post("Turnaround", "It fell to 9 days.")))).toBe("infographic");
    expect(autoStyle(classify(post("HMRC confirms", "The regulation takes effect in April.")))).toBe("infographic");
  });

  it("illustrates a festival and photographs a culture post", () => {
    expect(autoStyle(classify(post("Happy Diwali", "Wishing you a bright year.")))).toBe("illustrated");
    expect(autoStyle(classify(post("Congratulations to our team", "We celebrate a milestone.")))).toBe("realistic");
  });

  it("honours an explicit choice over the automatic one", () => {
    const cls = classify(post("Turnaround", "It fell to 9 days."));
    expect(resolveStyle("auto", cls, {})).toBe("infographic");
    expect(resolveStyle("editorial", cls, {})).toBe("editorial");
  });

  it("falls back to a real style when handed a nonsense one", () => {
    expect(resolveStyle("no-such-style", {}, {})).toBe("illustrated");
  });
});

describe("video prompts", () => {
  it("describes real movement for a festival that moves", () => {
    const p = post("Happy Navratri", "Our teams are celebrating this week.");
    const v = videoPrompt({ classification: classify(p), content: p, style: "illustrated" });
    expect(v).toMatch(/dancing garba/i);
    expect(v).toMatch(/camera push/i);
  });

  it("carries the scene's own idea into the prompt", () => {
    const p = post("Closing the year", "Reconcile payroll first.");
    const v = videoPrompt({ classification: classify(p), content: p, style: "illustrated", scene: { line: "Reconcile payroll first" } });
    expect(v).toContain("Reconcile payroll first");
  });

  it("asks for consistency across scenes", () => {
    const p = post("A topic", "A body sentence here.");
    expect(videoPrompt({ classification: classify(p), content: p, style: "3d" })).toMatch(/Consistent lighting and palette/i);
  });
});

describe("telling the user what it will cost", () => {
  const pricing = { openai: { usdPerImage: 0.04 }, google: { usdPerSecond: 0.05 } };

  it("prices an image and a clip from the relay's own figures", () => {
    expect(estimateCost({ kind: "image", provider: "openai", pricing })).toBe(0.04);
    expect(estimateCost({ kind: "image", provider: "openai", pricing, count: 3 })).toBe(0.12);
    expect(estimateCost({ kind: "video", provider: "google", pricing, seconds: 8 })).toBe(0.4);
  });

  it("says nothing rather than guessing when the price is unknown", () => {
    expect(estimateCost({ kind: "image", provider: "nobody", pricing })).toBeNull();
    expect(estimateCost({ kind: "image", provider: "google", pricing })).toBeNull();
  });
});
