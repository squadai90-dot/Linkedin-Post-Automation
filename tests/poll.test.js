import { describe, it, expect } from "vitest";
import { checkPoll, fallbackPoll, pollStyleFor, pollGuidance, LIMITS } from "../src/lib/poll.js";
import { classify } from "../src/lib/intel.js";

const ids = (l) => l.map((f) => f.id);
const post = (hook, body, topic = "") => ({ hook, body, topic, cta: "" });

describe("LinkedIn's real poll limits", () => {
  it("matches what the publisher and the Make scenarios enforce", () => {
    expect(LIMITS).toMatchObject({ question: 140, option: 30, minOptions: 2, maxOptions: 4 });
    expect(LIMITS.durations).toEqual(["1 day", "3 days", "1 week", "2 weeks"]);
  });

  it("blocks a question over the limit", () => {
    const p = { question: "x".repeat(141), options: ["A choice", "Another choice"] };
    expect(ids(checkPoll(p))).toContain("poll-question-long");
  });

  it("blocks options over the limit, naming them", () => {
    const p = { question: "Which one?", options: ["Short", "y".repeat(31)] };
    const f = checkPoll(p).find((x) => x.id === "poll-option-long");
    expect(f.severity).toBe("blocking");
    expect(f.message).toContain("30");
  });

  it("blocks too few and too many options", () => {
    expect(ids(checkPoll({ question: "Which?", options: ["Only one"] }))).toContain("poll-too-few");
    expect(ids(checkPoll({ question: "Which?", options: ["a1", "b2", "c3", "d4", "e5"] }))).toContain("poll-too-many");
  });

  it("blocks a duration LinkedIn does not accept", () => {
    expect(ids(checkPoll({ question: "Which?", options: ["A one", "B two"], duration: "30 days" }))).toContain("poll-duration");
  });
});

describe("options that are not really choices", () => {
  it("blocks two identical options", () => {
    expect(ids(checkPoll({ question: "Which?", options: ["Outsource review", "Outsource review"] }))).toContain("poll-duplicate");
  });

  it("warns when two options say nearly the same thing", () => {
    const p = { question: "Which slows you most?", options: ["Not enough staff", "Not enough staffing", "Software"] };
    expect(ids(checkPoll(p))).toContain("poll-overlap");
  });

  it("warns when one option is written to win", () => {
    const p = { question: "How do you review?", options: ["The right way, in one pass", "Ad hoc", "Not at all"] };
    expect(ids(checkPoll(p))).toContain("poll-biased");
  });

  it("warns about filler options but accepts a plain Other", () => {
    expect(ids(checkPoll({ question: "Which?", options: ["A one", "B two", "All of the above"] }))).toContain("poll-non-answer");
    expect(ids(checkPoll({ question: "Which?", options: ["A one", "B two", "Other"] }))).not.toContain("poll-non-answer");
  });
});

describe("keeping a poll honest", () => {
  it("warns when the question states the finding instead of asking", () => {
    const p = { question: "Most firms now outsource review — do you?", options: ["Yes we do", "No we do not"] };
    expect(ids(checkPoll(p))).toContain("poll-presents-as-research");
  });

  it("blocks a knowledge check the post does not answer", () => {
    const content = post("A note on deadlines", "Nothing here says which date applies.");
    const p = { question: "Which date applies?", options: ["31 January", "5 April"], style: "knowledge" };
    expect(ids(checkPoll(p, { content }))).toContain("poll-unanswerable");
  });

  it("passes a knowledge check the post does answer", () => {
    const content = post("Self Assessment", "The online Self Assessment deadline is 31 January.");
    const p = { question: "Which date applies?", options: ["31 January", "5 April"], style: "knowledge" };
    expect(ids(checkPoll(p, { content }))).not.toContain("poll-unanswerable");
  });

  it("blocks a poll that spans two tax systems", () => {
    const cls = classify(post("Deadlines", "File Self Assessment with HMRC, then the 1099 forms with the IRS and Schedule C."));
    expect(ids(checkPoll({ question: "Which?", options: ["A one", "B two"] }, { classification: cls }))).toContain("poll-mixed-country");
  });

  it("passes a clean, well-formed poll", () => {
    const p = { question: "How does your firm handle first-pass review?", options: ["In-house only", "Offshore team", "Mix of both"], duration: "1 week" };
    expect(checkPoll(p)).toEqual([]);
  });
});

describe("choosing the style from the post", () => {
  it("asks about the problem on a capacity post", () => {
    expect(pollStyleFor(classify(post("Capacity", "Staff shortages and rising costs mean longer hours."))).id).toBe("challenge");
  });

  it("asks a knowledge check only where a sourced fact exists", () => {
    const factual = classify(post("HMRC confirms the threshold", "The regulation takes effect in April for every Self Assessment filer. The new threshold is £50,000."));
    expect(factual.pillar).toBe("regulatory");
    expect(["knowledge", "adoption"]).toContain(pollStyleFor(factual).id);
    const opinion = classify(post("A view on hybrid work", "We think the future is flexible for every practice."));
    expect(pollStyleFor(opinion).id).not.toBe("knowledge");
  });

  it("tells the model the country rules and the real limits", () => {
    const g = pollGuidance(classify(post("Australian payroll", "STP finalisation and the quarterly BAS with the ATO.")));
    expect(g).toContain("Australian");
    expect(g).toContain("ATO");
    expect(g).toContain("140");
  });
});

describe("the fallback, when no model is available", () => {
  it("builds the options out of the post's own list", () => {
    const c = post("Closing the year", "1. Reconcile payroll and finalise STP\n2. Review the GST coding\n3. Confirm super was paid\n4. Lock the period", "Australian year end");
    const p = fallbackPoll(c, classify(c));
    expect(p.options.length).toBeGreaterThanOrEqual(2);
    expect(p.options.join(" ")).toMatch(/Reconcile|GST|super|Lock/);
    expect(p.derived).toBe(true);
  });

  it("produces a poll that passes its own checks", () => {
    const c = post("Closing the year", "1. Reconcile payroll and finalise STP\n2. Review the GST coding\n3. Confirm super was paid\n4. Lock the period", "Australian year end");
    const p = fallbackPoll(c, classify(c));
    expect(checkPoll(p, { content: c }).filter((f) => f.severity === "blocking")).toEqual([]);
  });

  it("returns nothing when there is no subject to ask about at all", () => {
    expect(fallbackPoll({ hook: "", body: "", topic: "" }, {})).toBeNull();
  });

  it("does not read a frequency option as loaded wording", () => {
    const p = { question: "How often do you review before filing?", options: ["Always", "Usually", "Sometimes", "Never"] };
    expect(ids(checkPoll(p))).not.toContain("poll-biased");
  });

  it("never exceeds LinkedIn's option length", () => {
    const c = post("Long options", "A very long first alternative that goes on well past thirty characters\nA second alternative that is also far too long to fit in the option", "Topic");
    const p = fallbackPoll(c, {});
    expect(p.options.every((o) => o.length <= LIMITS.option)).toBe(true);
  });
});

describe("a post that is prose, not a list", () => {
  const prose = post("Clients notice how long they wait", "Nothing about the audit changed. The file simply stopped sitting in a queue overnight.", "Audit turnaround");

  it("still produces a usable poll rather than failing", () => {
    const p = fallbackPoll(prose, classify(prose));
    expect(p).not.toBeNull();
    expect(p.options.length).toBeGreaterThanOrEqual(LIMITS.minOptions);
  });

  it("marks the options as generic so the user knows to sharpen them", () => {
    expect(fallbackPoll(prose, classify(prose)).generic).toBe(true);
  });

  it("and the generic options still pass every check", () => {
    const p = fallbackPoll(prose, classify(prose));
    expect(checkPoll(p, { content: prose })).toEqual([]);
  });

  it("prefers the post's own list when it has one", () => {
    const listed = post("Closing the year", "1. Reconcile payroll\n2. Review the GST coding\n3. Confirm super was paid", "Year end");
    expect(fallbackPoll(listed, classify(listed)).generic).toBe(false);
  });
});
