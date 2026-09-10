/* Post image templates: the words go where they are meant to, nothing is cut
   off, and a photograph carries its licence. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TEMPLATES, TEMPLATE_BY_ID, FIELDS, autoFill, renderTemplate } from "../src/lib/templates.js";
import { setBrandText } from "../src/lib/brand.js";
import { commonsPhotos, photoQuery } from "../src/lib/freeApis.js";

const parse = (svgText) => new DOMParser().parseFromString(svgText, "image/svg+xml");
const textOf = (doc) => [...doc.querySelectorAll("text")].map((t) => t.textContent).join(" ");

const brief = { kicker: "Capacity planning", headline: "Tax season is won in October, not March", support: "Practices that staff in autumn keep their best people." };
const draft = { hook: "Tax season is won in October, not March.", body: "Most practices staff up when the work arrives.\nBy then the good people are gone.\n62% of firms we surveyed hire too late.\nPlanning in October costs less than panic in January." };

beforeEach(() => setBrandText({ name: "Ledgerline", site: "ledgerline.co" }));

describe("every template", () => {
  it.each(TEMPLATES.map((t) => [t.id, t]))("%s renders valid SVG at LinkedIn's ratio", (id, t) => {
    const doc = parse(renderTemplate(id, autoFill(id, brief, draft), null));
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 1200 630");
  });

  it.each(TEMPLATES.map((t) => [t.id]))("%s only asks for fields the editor can show", (id) => {
    TEMPLATE_BY_ID[id].fields.forEach((f) => expect(FIELDS[f], `${id} wants an unknown field "${f}"`).toBeTruthy());
  });

  it.each(TEMPLATES.map((t) => [t.id]))("%s survives empty fields rather than drawing 'undefined'", (id) => {
    const out = renderTemplate(id, {}, null);
    expect(parse(out).querySelector("parsererror")).toBeNull();
    expect(out).not.toMatch(/undefined|\[object/);
  });

  it("escapes an ampersand in a company name without breaking the XML", () => {
    // The bug this repo has met before: uppercasing an escaped string turns
    // &amp; into &AMP;, which is not valid XML.
    const doc = parse(renderTemplate("statement", { kicker: "R&D", headline: "Cost & margin", footer: "a&b.co" }, null));
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(textOf(doc)).toContain("R&D");
  });
});

describe("auto-fill", () => {
  it("gives a template exactly the fields it declares, no more", () => {
    TEMPLATES.forEach((t) => expect(Object.keys(autoFill(t.id, brief, draft)).sort()).toEqual([...t.fields].sort()));
  });

  it("finds a number in the post for the big-number template", () => {
    expect(autoFill("figure", {}, draft).stat).toBe("62%");
  });

  it("leaves the number empty rather than inventing one", () => {
    expect(autoFill("figure", {}, { hook: "No figures here", body: "None at all." }).stat).toBe("");
  });

  it("turns the body into separate points for the list template", () => {
    const items = autoFill("list", {}, draft).items.split("\n");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items[0]).toMatch(/Most practices staff up/);
  });

  it("stamps the company site as the footer", () => {
    expect(autoFill("statement", {}, draft).footer).toBe("ledgerline.co");
  });
});

describe("what actually gets drawn", () => {
  it("prints every point in full, never cut off mid-sentence", () => {
    const f = autoFill("list", {}, draft);
    const drawn = textOf(parse(renderTemplate("list", f, null)));
    // Four points, and the last one ends where the sentence ends.
    expect(drawn).toContain("Planning in October costs less than panic in January.");
  });

  it("shrinks a long figure instead of letting it run off the frame", () => {
    const big = renderTemplate("figure", { stat: "1,240,000" }, null);
    const small = renderTemplate("figure", { stat: "62%" }, null);
    const sizeOf = (s) => Number((s.match(/font-size="(\d+)"[^>]*>1,240,000|font-size="(\d+)"[^>]*>62%/) || [])[1] || 0);
    expect(sizeOf(big)).toBeLessThan(168);
    expect(small).toContain('font-size="168"');
  });

  it("draws the photo credit onto the image, where the licence needs it", () => {
    const photo = { url: "https://upload.wikimedia.org/a.jpg", credit: "A. Photographer · CC BY-SA 4.0 · Wikimedia Commons" };
    const drawn = textOf(parse(renderTemplate("photo", autoFill("photo", brief, draft), photo)));
    expect(drawn).toContain("CC BY-SA 4.0");
  });

  it("still renders a photo template when no photo was chosen", () => {
    const out = renderTemplate("photo", autoFill("photo", brief, draft), null);
    expect(parse(out).querySelector("parsererror")).toBeNull();
    expect(out).not.toContain("<image");
  });
});

describe("finding a photograph", () => {
  afterEach(() => vi.restoreAllMocks());

  const page = (over = {}) => ({
    pageid: 1, title: "File:An office.jpg",
    imageinfo: [{
      thumburl: "https://upload.wikimedia.org/thumb.jpg", url: "https://upload.wikimedia.org/full.jpg",
      width: 2000, height: 1200, thumbwidth: 1200, thumbheight: 720,
      descriptionurl: "https://commons.wikimedia.org/wiki/File:An_office.jpg",
      extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "<a href='#'>A. Photographer</a>" } },
      ...over,
    }],
  });
  const ok = (pages) => ({ ok: true, status: 200, json: async () => ({ query: { pages } }) });

  it("returns a usable photo with its credit assembled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ 1: page() })));
    const [p] = await commonsPhotos("office");
    expect(p.author).toBe("A. Photographer");       // the markup is stripped
    expect(p.licence).toBe("CC BY-SA 4.0");
    expect(p.credit).toBe("A. Photographer · CC BY-SA 4.0 · Wikimedia Commons");
    expect(p.source).toMatch(/commons\.wikimedia\.org/);
  });

  it("drops anything whose licence it cannot vouch for", async () => {
    // "Fair use" is not free to use in a company post, and a licence we
    // cannot read is one we cannot promise is safe.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({
      1: page({ extmetadata: { LicenseShortName: { value: "Fair use" }, Artist: { value: "X" } } }),
      2: page({ extmetadata: { LicenseShortName: { value: "" }, Artist: { value: "Y" } } }),
    })));
    expect(await commonsPhotos("office")).toEqual([]);
  });

  it("keeps CC0 and public domain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({
      1: page({ extmetadata: { LicenseShortName: { value: "CC0" }, Artist: { value: "A" } } }),
      2: { pageid: 2, title: "File:B.jpg", imageinfo: [{ ...page().imageinfo[0], extmetadata: { LicenseShortName: { value: "Public domain" }, Artist: { value: "B" } } }] },
    })));
    expect(await commonsPhotos("office")).toHaveLength(2);
  });

  it("drops portraits, which cannot fill a 1200x630 frame without losing the subject", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ 1: page({ width: 800, height: 1200 }) })));
    expect(await commonsPhotos("office")).toEqual([]);
  });

  it("returns nothing rather than throwing when Commons is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await commonsPhotos("office")).toEqual([]);
  });

  it("does not search on an empty query", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await commonsPhotos("  ")).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("turning a post into a search", () => {
  it("picks the words worth searching, not the whole post", () => {
    const q = photoQuery(draft, {});
    expect(q.split(" ")).toHaveLength(3);
    expect(q).not.toMatch(/\b(the|and|when|most)\b/);
  });

  it("falls back to the industry when the post has no strong words", () => {
    expect(photoQuery({ hook: "It is what it is" }, { industry: "Accounting" })).toBe("accounting");
  });
});
