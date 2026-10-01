import { describe, it, expect } from "vitest";
import {
  studioContext, autoText, stylesFor, designFor, renderDesign, restyleSvg, contrast, bulletsOf,
  milestoneFigure, placePhoto, artPrompt, footagePrompt, CANVASES, HOUSE, signature,
} from "../src/lib/designer.js";
import { detectIntent } from "../src/lib/intent.js";
import { OCCASIONS } from "../src/lib/intel.js";
import { OCCASION_ART, renderTemplate } from "../src/lib/templates.js";

const PROFILE = { company: "Acme Advisory", website: "https://acme.example/" };
const setup = (topic, draft = {}) => {
  const intent = detectIntent(topic);
  const ctx = studioContext({ intent, topic, draft, profile: PROFILE });
  return { intent, ctx, text: autoText(ctx, draft), styles: stylesFor(ctx) };
};
const words = (svg) => (svg.match(/<text[^>]*>([^<]*)<\/text>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(" ");

describe("what the studio offers for each kind of post", () => {
  it("gives a festival greeting four distinct festival designs", () => {
    const { ctx, text, styles } = setup("Navratri greetings", { hook: "Happy Navratri from all of us at Acme Advisory!", body: "Nine nights of devotion, music and garba." });
    expect(ctx.group).toBe("festival");
    expect(styles.map((s) => s.id)).toEqual(["traditional", "corporate", "celebratory", "minimal"]);
    expect(text.headline).toBe("Happy Navratri");
    expect(text.signoff).toBe("Warm wishes from Acme Advisory");
    /* four different designs, not one in four colourways */
    const sigs = new Set(styles.map((s) => JSON.stringify([s.defaults.font, s.defaults.align, s.defaults.background, s.defaults.frame, s.defaults.decor, s.defaults.motifMode])));
    expect(sigs.size).toBe(4);
  });

  it("uses the festival's own greeting wording", () => {
    expect(setup("Makar Sankranti wishes").text.headline).toBe("Happy Makar Sankranti");
    expect(setup("Eid greetings to our clients").text.headline).toBe("Eid Mubarak");
  });

  it("does not make a non-greeting festival post read as a greeting", () => {
    const { ctx, text } = setup("Diwali food drive by our team", { hook: "Our team packed 400 meal kits this Diwali.", body: "Thank you to everyone who volunteered." });
    expect(ctx.group).toBe("festival");
    expect(text.headline).toBe("Our team packed 400 meal kits this Diwali.");
    expect(text.kicker).toBe("Diwali");
  });

  it("gives a product launch launch designs, with features only from the post's own bullets", () => {
    const withBullets = setup("We are launching Unison Payroll Assist", { hook: "Payroll without the chase.", body: "Today we launch it.\n• Imports timesheets\n• Flags exceptions\n• Exports a summary", cta: "Book a demo" });
    expect(withBullets.ctx.group).toBe("launch");
    expect(withBullets.text.headline).toBe("Unison Payroll Assist");
    expect(withBullets.text.items.split("\n")).toEqual(["Imports timesheets", "Flags exceptions", "Exports a summary"]);
    expect(withBullets.styles.map((s) => s.id)).toEqual(["spotlight", "announcement", "features", "minimal"]);

    const noBullets = setup("We are launching Unison Payroll Assist", { hook: "Payroll without the chase.", body: "Today we launch it. It saves hours." });
    expect(noBullets.text.items).toBe("");
    expect(noBullets.styles.map((s) => s.id)).not.toContain("features");
  });

  it("takes a milestone's number from the topic, and invents none when there is none", () => {
    const ten = setup("Celebrating 10 years of Acme Advisory", { hook: "Ten years ago we started with two desks." });
    expect(ten.ctx.group).toBe("milestone");
    expect(ten.text.stat).toBe("10");
    expect(ten.text.statLabel).toBe("years");
    expect(ten.styles[0].id).toBe("figure");

    const none = setup("Celebrating our company anniversary milestone", { hook: "A milestone worth marking." });
    expect(none.text.stat).toBe("");
    expect(none.styles.map((s) => s.id)).not.toContain("figure");
  });

  it("reads milestone figures as they are written", () => {
    expect(milestoneFigure("We now serve 1,000 clients")).toEqual({ stat: "1,000", statLabel: "clients" });
    expect(milestoneFigure("25+ countries")).toEqual({ stat: "25+", statLabel: "countries" });
    expect(milestoneFigure("nothing numeric here")).toBeNull();
  });

  it("only treats marked lines as bullets", () => {
    expect(bulletsOf("One sentence. Another sentence.")).toEqual([]);
    expect(bulletsOf("Intro\n- First point here\n2) Second point here")).toEqual(["First point here", "Second point here"]);
  });
});

describe("rendering", () => {
  const navratri = setup("Navratri greetings", { hook: "Happy Navratri from all of us!", body: "Nine nights of devotion, music and garba." });

  it("draws the occasion's motif, so a greeting is never a slab of text", () => {
    for (const st of navratri.styles) {
      const r = renderDesign(designFor(st, { text: navratri.text }), "image");
      expect(r.svg).toContain('viewBox="0 0 1200 630"');
      expect((r.svg.match(/<circle/g) || []).length).toBeGreaterThan(15);
      expect(words(r.svg)).toContain("Happy Navratri");
    }
  });

  it("puts the words the user typed into the design, escaped", () => {
    const st = navratri.styles[0];
    const r = renderDesign(designFor(st, { text: { ...navratri.text, headline: "Go <b> & c" } }), "image");
    expect(r.svg).toContain("Go &lt;b&gt; &amp; c");
    expect(r.svg).not.toContain("<b>");
  });

  it("applies colour, type and arrangement edits to the actual SVG", () => {
    const st = navratri.styles[0];
    const base = renderDesign(designFor(st, { text: navratri.text }), "image");
    const edited = renderDesign(designFor(st, { text: navratri.text, tweak: { palette: { bg1: "#123456" }, font: "sans", align: "right" } }), "image");
    expect(edited.svg).toContain("#123456");
    expect(edited.svg).toContain("Helvetica");
    expect(edited.svg).toContain('text-anchor="end"');
    expect(edited.sig).not.toBe(base.sig);
  });

  it("gives the same design the same signature, whatever the random id prefix", () => {
    const d = designFor(navratri.styles[1], { text: navratri.text });
    const a = renderDesign(d, "image"), b = renderDesign(d, "image");
    expect(a.svg).not.toBe(b.svg);
    expect(a.sig).toBe(b.sig);
  });

  it("renders the video frame at 16:9", () => {
    const r = renderDesign(designFor(navratri.styles[0], { text: navratri.text }), "video");
    expect(r.svg).toContain('viewBox="0 0 1200 675"');
    expect(CANVASES.video.px).toEqual([1920, 1080]);
  });

  it("warns, rather than cutting silently, when a headline cannot fit", () => {
    const long = "This headline goes on and on well past anything a graphic could hold at a readable size for anyone at all on a phone";
    const r = renderDesign(designFor(navratri.styles[0], { text: { ...navratri.text, headline: long } }), "image");
    expect(r.warnings.join(" ")).toMatch(/headline is too long/i);
    expect(words(r.svg)).toContain("…");
  });

  it("warns when the chosen colours make the words hard to read", () => {
    const r = renderDesign(designFor(navratri.styles[0], { text: navratri.text, tweak: { palette: { bg1: "#FFFFFF", bg2: "#FFFFFF", ink: "#FAFAFA" } } }), "image");
    expect(r.warnings.join(" ")).toMatch(/hard to read/);
  });

  it("ships readable defaults: every built-in style passes AA contrast", () => {
    const cases = ["Navratri greetings", "Diwali wishes", "Holi greetings", "We are launching Unison Payroll Assist", "Celebrating 10 years of Acme Advisory", "How to prepare for year end"];
    for (const topic of cases) {
      const s = setup(topic, { hook: "A headline", body: "A supporting sentence." });
      for (const st of s.styles) {
        const P = st.defaults.palette;
        expect(contrast(P.ink, P.bg1), `${topic} · ${st.id}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("places and crops a picture by zoom and position", () => {
    const box = { x: 0, y: 0, w: 1200, h: 630 };
    const centred = placePhoto({ w: 1000, h: 1000, zoom: 1, x: 50, y: 50 }, box);
    expect(centred.w).toBe(1200);
    expect(centred.y).toBeCloseTo((630 - 1200) / 2);
    const zoomed = placePhoto({ w: 1000, h: 1000, zoom: 2, x: 0, y: 0 }, box);
    expect([zoomed.x, zoomed.y, zoomed.w]).toEqual([0, 0, 2400]);
  });

  it("puts a picture in the launch spotlight panel, and the credit on the image", () => {
    const launch = setup("We are launching Unison Payroll Assist", { hook: "Payroll without the chase." });
    const photo = { dataUrl: "data:image/jpeg;base64,AAAA", w: 800, h: 600, zoom: 1, x: 50, y: 50, credit: "Photo: Acme" };
    const r = renderDesign(designFor(launch.styles[0], { text: launch.text, photo }), "image");
    expect(r.svg).toContain("data:image/jpeg;base64,AAAA");
    expect(r.svg).toContain("clip-path");
    expect(words(r.svg)).toContain("Photo: Acme");
  });
});

describe("festival artwork", () => {
  it("exists for every occasion Unison can detect", () => {
    for (const o of OCCASIONS) expect(OCCASION_ART[o.id], o.id).toBeTruthy();
  });

  it("renders every occasion without broken numbers", () => {
    for (const id of Object.keys(OCCASION_ART)) {
      const svg = renderTemplate("occasion", { greeting: "Hi", headline: "Wishing you well", occasionId: id }, null);
      expect(svg, id).not.toMatch(/NaN|undefined/);
    }
  });
});

describe("restyling the existing layouts", () => {
  it("is identical to the original when nothing is changed", () => {
    const svg = '<svg><rect fill="#0A0F1A"/><text font-family="Inter, Helvetica, Arial, sans-serif" fill="#EEF2F8">x</text></svg>';
    expect(restyleSvg(svg, undefined, "sans")).toBe(svg);
  });

  it("swaps the house colours and typeface", () => {
    const svg = `<svg><rect fill="${HOUSE.bg}"/><text font-family="Inter, Helvetica, Arial, sans-serif" fill="${HOUSE.ink}">x</text></svg>`;
    const out = restyleSvg(svg, { bg1: "#FFFFFF", ink: "#111111" }, "serif");
    expect(out).toContain('fill="#FFFFFF"');
    expect(out).toContain('fill="#111111"');
    expect(out).toContain("Georgia");
  });
});

describe("prompts for paid generation", () => {
  it("never asks a model for words, logos or numbers", () => {
    const { ctx, styles } = setup("Navratri greetings", { hook: "Happy Navratri" });
    for (const p of [artPrompt(ctx, styles[0]), footagePrompt(ctx)]) {
      expect(p).toMatch(/No text, letters, numbers, logos/);
    }
    expect(artPrompt(ctx, styles[0])).toMatch(/garba/);
  });

  it("does not ask for a picture of a product it has never seen", () => {
    const { ctx, styles } = setup("We are launching Unison Payroll Assist", { hook: "x" });
    expect(artPrompt(ctx, styles[0])).toMatch(/no product shown/);
    expect(footagePrompt(ctx)).toMatch(/no product or screen shown/);
  });

  it("signature is stable and sensitive", () => {
    expect(signature("abc")).toBe(signature("abc"));
    expect(signature("abc")).not.toBe(signature("abd"));
  });
});
