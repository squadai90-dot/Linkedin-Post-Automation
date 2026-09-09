import { describe, it, expect, beforeEach } from "vitest";
import { setBrandText, esc, wrapText, tplCard, tplPage, tplTile, tplPoster, renderBrandImage } from "../src/lib/brand.js";

/* Generated SVG is handed to the browser as a data: URI, which is parsed as
   strict XML. One malformed entity blanks the whole image, so escaping is not
   cosmetic here. */

const parse = (svg) => new DOMParser().parseFromString(svg, "image/svg+xml");
const parseFails = (svg) => parse(svg).getElementsByTagName("parsererror").length > 0;

beforeEach(() => setBrandText({ name: "Smith & Co", site: "smith.co" }));

describe("esc", () => {
  it("escapes the three characters that break XML", () => {
    expect(esc('a & b < c > d')).toBe("a &amp; b &lt; c &gt; d");
    expect(esc(null)).toBe("");
    expect(esc(42)).toBe("42");
  });
});

describe("templates survive hostile text", () => {
  const nasty = 'R&D <script>alert(1)</script> "quoted" & more';

  it("never emits an uppercased entity", () => {
    // Uppercasing after escaping produces &AMP;, which is not a valid entity
    // and makes the whole document fail to parse.
    for (const svg of [tplCard(nasty, nasty, nasty), tplPage(1, 3, nasty, nasty), tplTile(nasty, "42"), tplPoster(nasty)]) {
      expect(svg).not.toMatch(/&[A-Z]+;/);
    }
  });

  it("produces parseable SVG for every template", () => {
    for (const svg of [tplCard(nasty, nasty, nasty), tplPage(2, 4, nasty, nasty), tplTile(nasty, "7"), tplPoster(nasty)]) {
      expect(parseFails(svg)).toBe(false);
    }
  });

  it("parses with an ampersand in the company name", () => {
    setBrandText({ name: "Smith & Co", site: "smith.co" });
    expect(parseFails(tplTile("A label", "12"))).toBe(false);
    expect(parseFails(tplPage(1, 2, "Heading", "Body"))).toBe(false);
    expect(parseFails(tplPoster("A title"))).toBe(false);
  });

  it("does not leak a script element into the document", () => {
    const doc = parse(tplCard("k", nasty, "f"));
    expect(doc.getElementsByTagName("script")).toHaveLength(0);
  });

  it("renders every image variant without breaking", () => {
    for (let v = 0; v < 4; v++) {
      const svg = renderBrandImage({ headline: nasty, kicker: nasty, support: nasty }, v);
      expect(parseFails(svg)).toBe(false);
      expect(svg).not.toMatch(/&[A-Z]+;/);
    }
  });

  it("still shows the text, uppercased where the design calls for it", () => {
    const svg = tplTile("a label", "12");
    expect(svg).toContain("SMITH &amp; CO"); // uppercased, then escaped
  });
});

describe("wrapText", () => {
  it("breaks on whole words within the limit", () => {
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });

  it("handles empty and absent input", () => {
    expect(wrapText("", 10)).toEqual([]);
    expect(wrapText(null, 10)).toEqual([]);
  });

  it("keeps a word longer than the limit rather than dropping it", () => {
    expect(wrapText("supercalifragilistic", 5)).toEqual(["supercalifragilistic"]);
  });
});
