import { describe, it, expect } from "vitest";
import { detectIntent, fallbackAngles, enforceAngles, anglePrompt, intentRules, researchPolicy, templateDraft, subjectOf, INTENTS, OCCASION_CHOICES } from "../src/lib/intent.js";
import { detectOccasion, greetingFor, OCCASIONS } from "../src/lib/intel.js";
import { fb } from "../src/lib/ai.js";

/* The failure that started this: a Navratri post came back with
   "The hard part of Navratri isn't the technology", placeholder sources,
   and angles about production and industry consolidation. */
const TECH = /technolog|production|consolidat|adoption|four numbers|pilot|\bAI\b/i;

describe("deciding what a post is for", () => {
  it.each([
    ["Navratri", "greeting"],
    ["Navratri wishes for our clients", "greeting"],
    ["Happy Diwali", "greeting"],
    ["Uttarayan", "greeting"],
    ["Eid", "greeting"],
    ["Christmas", "greeting"],
    ["Holi", "greeting"],
    ["History of Navratri", "occasion_info"],
    ["How our team celebrated Diwali", "occasion_recap"],
    ["Diwali food drive for the community", "occasion_csr"],
    ["Garba night at our office — join us", "occasion_event"],
    ["We are launching Unison Payroll Assist", "launch"],
    ["Celebrating 10 years of Unison Globus", "milestone"],
    ["We won the Best Outsourcing Partner award", "milestone"],
    ["Webinar on year-end close for CPA firms", "event"],
    ["We are hiring senior auditors in Ahmedabad", "hiring"],
    ["How the monthly close actually works", "educational"],
    ["Making Tax Digital starts 6 April 2026", "news"],
    ["Why outsourcing works when the brief is clear", "thought"],
  ])("%s -> %s", (topic, kind) => {
    expect(detectIntent(topic).kind).toBe(kind);
  });

  it("a festival defaults to a greeting, and says so", () => {
    const i = detectIntent("Navratri");
    expect(i.kind).toBe("greeting");
    expect(i.occasion.id).toBe("navratri");
    expect(i.greeting).toBe("Happy Navratri");
    expect(i.why).toMatch(/defaults to a greeting/i);
  });

  it("the user's own choice always wins", () => {
    expect(detectIntent("Navratri", { override: "occasion_info" }).kind).toBe("occasion_info");
    expect(detectIntent("Navratri", { override: "occasion_recap" }).kind).toBe("occasion_recap");
    expect(detectIntent("Our new payroll service", { override: "launch" }).detected).toBe(false);
  });

  it("does not offer festival options for a topic with no festival in it", () => {
    expect(detectIntent("Payroll tips", { override: "occasion_info" }).kind).toBe("greeting");
    expect(detectIntent("Payroll tips", { override: "occasion_info" }).occasion).toBeNull();
  });

  it("wishes the festival the user actually named", () => {
    const o = detectOccasion("Makar Sankranti greetings");
    expect(o.id).toBe("uttarayan");
    expect(greetingFor(o, "Makar Sankranti greetings")).toBe("Happy Makar Sankranti");
    expect(greetingFor(o, "Uttarayan")).toBe("Happy Uttarayan");
  });

  it("does not assume which country's Independence Day is meant", () => {
    expect(detectOccasion("Independence Day").id).toBe("independence");
    expect(detectOccasion("Independence Day").care).toMatch(/which one/i);
    expect(detectOccasion("Indian Independence Day").id).toBe("indiaindependence");
    expect(detectOccasion("Fourth of July").id).toBe("independenceday");
  });

  it("every festival carries a greeting and hashtags", () => {
    for (const o of OCCASIONS) {
      expect(Array.isArray(o.tags), o.id).toBe(true);
      expect(typeof o.wish, o.id).toBe("string");
    }
  });

  it("finds the subject inside the user's wording", () => {
    expect(subjectOf("We are launching Unison Payroll Assist")).toBe("Unison Payroll Assist");
    expect(subjectOf("Celebrating 10 years of Unison Globus")).toBe("10 years of Unison Globus");
    expect(subjectOf("Launch of our new bookkeeping service")).toBe("our new bookkeeping service");
  });
});

describe("angles that fit the post", () => {
  it("Navratri gets greeting angles — never technology, production or consolidation", () => {
    const i = detectIntent("Navratri");
    const { angles } = fallbackAngles(i, { topic: "Navratri", company: "Unison Globus" });
    expect(angles).toHaveLength(4);
    expect(new Set(angles.map((a) => a.type)).size).toBe(4);
    for (const a of angles) {
      expect(a.headline).toMatch(/Navratri/);
      expect(a.headline + a.rationale).not.toMatch(TECH);
    }
    expect(angles[0].headline).toBe("Happy Navratri from all of us at Unison Globus");
    expect(angles.filter((a) => a.recommended)).toHaveLength(1);
  });

  it("Diwali behaves the same way", () => {
    const { angles } = fallbackAngles(detectIntent("Diwali"), { topic: "Diwali", company: "Unison Globus" });
    expect(angles[0].headline).toBe("Happy Diwali from all of us at Unison Globus");
    for (const a of angles) expect(a.headline + a.rationale).not.toMatch(TECH);
  });

  it("a launch gets launch angles", () => {
    const { angles } = fallbackAngles(detectIntent("We are launching Unison Payroll Assist"), { topic: "We are launching Unison Payroll Assist" });
    expect(angles.map((a) => a.type)).toEqual(["Announcement", "The problem it solves", "Who it is for", "Behind the build"]);
    expect(angles[0].headline).toBe("Introducing Unison Payroll Assist");
  });

  it("a milestone gets announcement and thank-you angles", () => {
    const { angles } = fallbackAngles(detectIntent("Celebrating 10 years of Unison Globus"), { topic: "Celebrating 10 years of Unison Globus" });
    expect(angles[0].headline).toBe("Celebrating 10 years of Unison Globus");
    expect(angles.map((a) => a.type)).toContain("Thank you");
  });

  it("the model's off-topic suggestions are replaced, not shown", () => {
    const i = detectIntent("Navratri");
    /* exactly what the broken version produced */
    const model = { angles: [
      { type: "Contrarian", headline: "The hard part of Navratri isn't the technology.", recommended: true },
      { type: "Educational", headline: "What actually changes when Navratri reaches production." },
      { type: "Warm wishes", headline: "Happy Navratri to every family celebrating tonight" },
      { type: "Industry insight", headline: "Why the category is consolidating around Navratri." },
    ] };
    const out = enforceAngles(i, model, { topic: "Navratri", company: "Unison Globus" });
    expect(out.angles).toHaveLength(4);
    for (const a of out.angles) {
      expect(a.headline).not.toMatch(TECH);
      expect(INTENTS.greeting.angles.map(([t]) => t)).toContain(a.type);
    }
    /* the one good suggestion from the model is kept */
    expect(out.angles.some((a) => a.headline === "Happy Navratri to every family celebrating tonight")).toBe(true);
  });

  it("the prompt names the intent and forbids the wrong kinds of angle", () => {
    const p = anglePrompt(detectIntent("Navratri"), { topic: "Navratri", company: "Unison Globus" });
    expect(p).toMatch(/Festival greeting/);
    expect(p).toMatch(/Happy Navratri/);
    expect(p).toMatch(/Do not suggest thought-leadership, technology/);
    expect(p).not.toMatch(/Contrarian\|Educational\|Industry insight\|Data-driven/);
  });

  it("the writer is told to write a greeting, not an article", () => {
    const r = intentRules(detectIntent("Navratri"), { company: "Unison Globus" });
    expect(r).toMatch(/festival greeting/i);
    expect(r).toMatch(/not an article/i);
    expect(r).toMatch(/Do not .* sell anything/i);
    expect(r).toMatch(/#HappyNavratri/);
  });
});

describe("research only where it helps", () => {
  it("is skipped for greetings, launches and milestones, with a reason", () => {
    for (const t of ["Navratri", "Happy Diwali", "We are launching Unison Payroll Assist", "Celebrating 10 years of Unison Globus"]) {
      const p = researchPolicy(detectIntent(t));
      expect(p.run, t).toBe(false);
      expect(p.reason, t).toBeTruthy();
    }
  });

  it("runs for history, explainers, news and points of view", () => {
    for (const t of ["History of Navratri", "How the monthly close works", "Making Tax Digital starts 6 April 2026", "Why outsourcing works"]) {
      expect(researchPolicy(detectIntent(t)).run, t).toBe(true);
    }
  });
});

describe("nothing invented when the AI is unavailable", () => {
  it("research returns no sources at all — no placeholder rows", () => {
    const r = fb.research("Navratri");
    expect(r.sources).toEqual([]);
    expect(r.claims).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/placeholder|example row|not retrieved/i);
  });

  it("verification does not cite sources it never checked", () => {
    const v = fb.verify();
    expect(v.claims).toEqual([]);
    expect(JSON.stringify(v)).not.toMatch(/Financial Times|Industry Weekly/);
  });

  it("quality does not pass checks it never ran", () => {
    expect(fb.quality().checks).toEqual([]);
  });

  it("performance does not make up a percentage", () => {
    expect(JSON.stringify(fb.performance())).not.toMatch(/\d+%/);
  });

  it("Discover does not show sample rows", () => {
    expect(fb.opportunities().items).toEqual([]);
  });

  it("a festival still gets a complete, warm greeting from the template", () => {
    const d = fb.draft("Navratri", { company: "Unison Globus" });
    expect(d.hook).toBe("Happy Navratri from all of us at Unison Globus!");
    expect(d.body).toMatch(/garba/i);
    expect(d.body + d.hook).not.toMatch(TECH);
    expect(d.hashtags).toContain("#HappyNavratri");
    expect(d.claims).toEqual([]);
    expect(d.template).toBe("greeting");
  });

  it("reads correctly when no company name has been set", () => {
    /* "from all of us at our team" and "Warm wishes from the our team team."
       were both produced by the first version. */
    const i = detectIntent("Navratri");
    const d = templateDraft(i, { topic: "Navratri", company: "" });
    expect(d.hook).toBe("Happy Navratri from all of us!");
    expect(d.cta).toBe("Warm wishes from all of us.");
    expect(fallbackAngles(i, { topic: "Navratri", company: "" }).angles[0].headline).toBe("Happy Navratri from all of us");
    const all = JSON.stringify([d, fallbackAngles(detectIntent("We are hiring auditors"), { topic: "We are hiring auditors" })]);
    expect(all).not.toMatch(/at our team|our team team|the us team/i);
  });

  it("a thought-leadership post gets no made-up prose at all", () => {
    const d = fb.draft("Why outsourcing works when the brief is clear", {});
    expect(d.empty).toBe(true);
    expect(d.body).toBe("");
  });

  it("a launch template never puts instructions where they could be published", () => {
    const d = templateDraft(detectIntent("We are launching Unison Payroll Assist"), { topic: "We are launching Unison Payroll Assist", company: "Unison Globus" });
    expect(d.body).not.toMatch(/\badd what\b|\[|\]|TODO|AI was unavailable/i);
    expect(d.needsDetail).toBe(true);
  });

  it("every festival choice is a real intent", () => {
    for (const k of OCCASION_CHOICES) expect(INTENTS[k]?.occasion, k).toBe(true);
  });
});
