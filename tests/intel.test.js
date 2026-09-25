import { describe, it, expect } from "vitest";
import { classify, detectCountry, detectOccasion, findStats, researchGuidance, COUNTRIES } from "../src/lib/intel.js";
import { decideFormat, visualStrategy, itemsFrom } from "../src/lib/visual.js";

const post = (hook, body, cta = "") => ({ hook, body, cta });

describe("knowing which country a post is about", () => {
  it("reads UK from its own vocabulary", () => {
    const r = detectCountry("Self Assessment returns are due to HMRC by 31 January, and Making Tax Digital starts in April.");
    expect(r.country).toBe("UK");
    expect(r.confident).toBe(true);
  });

  it("reads Australia from BAS, STP and the ATO", () => {
    expect(detectCountry("Quarterly BAS lodgment and STP finalisation with the ATO").country).toBe("AU");
  });

  it("reads the US from its forms", () => {
    expect(detectCountry("1099 filing, Schedule C and the IRS deadline").country).toBe("US");
  });

  it("says nothing rather than guessing when no country is implied", () => {
    expect(detectCountry("How we run a weekly close").country).toBeNull();
  });

  it("flags a post that mixes two countries' rules", () => {
    const r = detectCountry("File your Self Assessment with HMRC, then send the 1099 forms to the IRS before the deadline.");
    expect(r.mixed.sort()).toEqual(["UK", "US"]);
  });

  it("points research at the right regulator and forbids the others", () => {
    const lines = researchGuidance({ country: "AU", factHeavy: true }).join(" ");
    expect(lines).toContain("ato.gov.au");
    expect(lines).toContain("1 July to 30 June");
    expect(lines).toMatch(/Do not cite .*IRS/);
  });

  it("carries no tax rate or threshold that could go stale", () => {
    const dump = JSON.stringify(COUNTRIES);
    expect(dump).not.toMatch(/\d+\s?%/);
  });
});

describe("knowing what kind of post it is", () => {
  it("recognises a regulatory update", () => {
    const c = classify(post("HMRC has confirmed the new filing threshold", "The rule change takes effect from April and applies to every Self Assessment client."));
    expect(c.pillar).toBe("regulatory");
    expect(c.country).toBe("UK");
    expect(c.factHeavy).toBe(true);
  });

  it("recognises a hiring post", () => {
    expect(classify(post("We are hiring in Ahmedabad", "Fund Accounting Associate — 7 openings. Apply now.")).pillar).toBe("hiring");
  });

  it("recognises a capacity post", () => {
    expect(classify(post("Tax season did not break you, your capacity did", "Staff shortages and rising costs mean longer hours for the same work.")).pillar).toBe("capacity");
  });

  it("treats an occasion as an occasion whatever else it mentions", () => {
    const c = classify(post("Happy Diwali from all of us", "Our teams are back on Monday, ready for the quarterly BAS run."));
    expect(c.pillar).toBe("occasion");
    expect(c.occasion).toBe("diwali");
  });

  it("finds the figures worth checking", () => {
    expect(findStats("Turnaround fell 35% to 9 days across 42 engagements")).toEqual(expect.arrayContaining(["35%", "9 days"]));
  });

  /* These three cost a full round of wrong output before they were found.
     "irs" inside "first" made a monthly-close post a US tax update; "cra"
     inside "scramble" did the same for Canada; "act" inside "actually" made
     an Australian year-end checklist a regulatory post. */
  it("does not find a regulator inside an ordinary word", () => {
    const p = post("A month-end close that slips is never a people problem", "It is a sequencing problem. Which of those four slips first in your practice? Do not let it scramble.");
    const c = classify(p);
    expect(c.country).toBeNull();
    expect(c.pillar).not.toBe("regulatory");
  });

  it("does not read 'actually' as an Act of parliament", () => {
    const p = post("How a monthly close actually works", "Confirm the ledger was actually reconciled, not just reviewed. Then lock the period so nobody posts into it.");
    expect(classify(p).pillar).not.toBe("regulatory");
  });

  it("does not read a year as a New Year greeting", () => {
    const p = post("Making Tax Digital starts on 6 April 2026", "It applies to sole traders whose qualifying income was over the threshold for 2024/25, and HMRC has confirmed the date.");
    const c = classify(p);
    expect(c.occasion).toBeNull();
    expect(c.pillar).toBe("regulatory");
  });

  it("keeps a figure free of the sentence's punctuation", () => {
    expect(findStats("The threshold is £50,000.")).toEqual(["£50,000"]);
  });

  it("does not fall over on an empty post", () => {
    expect(() => classify({})).not.toThrow();
    expect(classify({}).country).toBeNull();
  });
});

describe("choosing the visual from the finished post", () => {
  it("gives a festival post the occasion graphic, not a business image", () => {
    const c = classify(post("Happy Diwali", "Wishing your firm a bright year."));
    expect(decideFormat(c, post("Happy Diwali", "Wishing your firm a bright year.")).format).toBe("occasion");
  });

  it("gives an ordered process the steps diagram", () => {
    const p = post("Closing the Australian financial year", "1. Reconcile payroll and finalise STP.\n2. Review GST coding before the last BAS.\n3. Confirm super has been paid.");
    expect(decideFormat(classify(p), p).format).toBe("steps");
  });

  it("gives a result with a figure the statistic card", () => {
    const p = post("What three firms got back", "Average audit turnaround fell to 9 days in our case study, from 14 before.");
    expect(decideFormat(classify(p), p).format).toBe("stat");
  });

  it("gives a rule the fact card, with the authority on it", () => {
    const p = post("HMRC confirms the new threshold", "The regulation takes effect in April for Self Assessment filers.");
    const s = visualStrategy(classify(p), p);
    expect(s.format).toBe("factcard");
    expect(s.fields.source).toBe("gov.uk");
  });

  it("gives a hiring post the roles layout", () => {
    const p = post("We are hiring", "Fund Accounting Associate — 7 openings\nUS Tax Reviewer — 3 openings\nAudit Senior — 2 openings");
    expect(decideFormat(classify(p), p).format).toBe("roles");
  });

  it("gives a genuinely two-sided post the comparison", () => {
    const p = post("Hire ahead or borrow capacity", "In-house: the cost lands three months before the work does.\nOutsourced: the cost lands with the work and stops in February.");
    expect(decideFormat(classify(p), p).format).toBe("compare");
  });

  it("takes 'vs' as a comparison too", () => {
    const p = post("Hiring vs borrowing capacity", "Hiring ahead means carrying the cost all year long.\nBorrowing capacity means paying for the weeks you actually use.");
    expect(decideFormat(classify(p), p).format).toBe("compare");
  });

  /* A four-step checklist was coming out as a comparison because one of its
     lines happened to contain "rather than". The order of the steps is the
     message; an incidental turn of phrase is not. */
  it("does not read a numbered checklist as a comparison", () => {
    const p = post("Closing the year", "1. Reconcile payroll and finalise STP.\n2. Review the GST coding before the last BAS rather than after it.\n3. Confirm super has been paid.\n4. Lock the period.");
    expect(decideFormat(classify(p), p).format).toBe("steps");
  });

  it("falls back to a statement when the sentence is the whole idea", () => {
    const p = post("The work nobody wants is the work that keeps clients", "");
    expect(decideFormat(classify(p), p).format).toBe("statement");
  });

  it("always explains why it chose what it chose", () => {
    const p = post("We are hiring", "Fund Accounting Associate — 7 openings\nUS Tax Reviewer — 3 openings");
    expect(decideFormat(classify(p), p).reason.length).toBeGreaterThan(20);
  });

  it("never invents a figure for a statistic card", () => {
    const p = post("A thought about capacity", "There is no number in this post at all.");
    const s = visualStrategy(classify(p), p);
    expect(s.format).not.toBe("stat");
    expect(s.fields.stat).toBe("");
  });

  it("splits a bulleted body into items without the bullets", () => {
    expect(itemsFrom("✔️ Reconcile the payroll run\n— Review the GST coding\n• Confirm super was paid")).toEqual([
      "Reconcile the payroll run", "Review the GST coding", "Confirm super was paid",
    ]);
  });
});

import { chooseStat, clip } from "../src/lib/visual.js";

describe("which figure goes on the card", () => {
  it("takes the result, not the number it improved on", () => {
    const c = { hook: "Clients notice how long they wait.", body: "Average audit turnaround fell from 14 days to 9 days." };
    expect(chooseStat(c, findStats(`${c.hook} ${c.body}`))).toBe("9 days");
  });

  it("works for a percentage that fell", () => {
    const c = { hook: "Margins", body: "Write-offs went from 12% to 4% after the change." };
    expect(chooseStat(c, findStats(c.body))).toBe("4%");
  });

  it("takes the only figure when there is one", () => {
    expect(chooseStat({ body: "Turnaround is 9 days." }, findStats("Turnaround is 9 days."))).toBe("9 days");
  });

  it("returns nothing when the post has no figure", () => {
    expect(chooseStat({ body: "Nothing numeric here." }, [])).toBe("");
  });
});

describe("cutting text for a graphic", () => {
  it("cuts at the end of a sentence when one fits", () => {
    expect(clip("Making Tax Digital starts in April. It applies to sole traders.", 45)).toBe("Making Tax Digital starts in April.");
  });

  it("cuts at a comma rather than mid-clause", () => {
    expect(clip("Making Tax Digital for Income Tax starts on 6 April 2026, and the first cohort is decided", 60))
      .toBe("Making Tax Digital for Income Tax starts on 6 April 2026");
  });

  it("never ends on a dangling connective", () => {
    for (const w of ["and", "whose", "from", "to", "that"]) {
      const out = clip(`A sentence that runs on ${w} something else entirely here`, 26 + w.length);
      expect(out.endsWith(` ${w}`), `ended on "${w}": ${out}`).toBe(false);
    }
  });

  it("leaves short text alone", () => {
    expect(clip("Short enough", 40)).toBe("Short enough");
  });
});
