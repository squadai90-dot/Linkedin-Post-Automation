import { describe, it, expect } from "vitest";
import { drawScene, countUp, SCENE_KINDS } from "../src/lib/scenes.js";

/* A recording stand-in for a 2D context: enough surface for the renderer,
   and it remembers what was drawn so a test can assert on it. */
function mockCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push({ name, args });
  return {
    calls,
    texts: () => calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0])),
    used: (name) => calls.some((c) => c.name === name),
    canvas: {},
    fillText: rec("fillText"), strokeText: rec("strokeText"),
    fillRect: rec("fillRect"), strokeRect: rec("strokeRect"),
    beginPath: rec("beginPath"), closePath: rec("closePath"),
    moveTo: rec("moveTo"), lineTo: rec("lineTo"), arc: rec("arc"), arcTo: rec("arcTo"),
    fill: rec("fill"), stroke: rec("stroke"), save: rec("save"), restore: rec("restore"),
    translate: rec("translate"), measureText: () => ({ width: 10 }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    set fillStyle(v) { calls.push({ name: "fillStyle", args: [v] }); },
    set strokeStyle(v) { calls.push({ name: "strokeStyle", args: [v] }); },
    set font(v) { calls.push({ name: "font", args: [v] }); },
    set globalAlpha(v) { calls.push({ name: "globalAlpha", args: [v] }); },
    set lineWidth(v) {}, set textAlign(v) {}, set textBaseline(v) {},
  };
}

const draw = (scene, t = 0.7) => {
  const c = mockCtx();
  drawScene(c, 1280, 720, scene, 1, 4, t, { brand: "Unison Globus" });
  return c;
};

describe("a figure counting up", () => {
  it("keeps the units and the suffix all the way", () => {
    expect(countUp("9 days", 0)).toBe("0 days");
    expect(countUp("9 days", 1)).toBe("9 days");
    expect(countUp("38%", 1)).toBe("38%");
  });

  it("keeps a currency prefix and thousands separators", () => {
    expect(countUp("£50,000", 1)).toBe("£50,000");
    expect(countUp("£50,000", 0)).toBe("£0");
  });

  it("keeps decimals at the same precision", () => {
    expect(countUp("2.5x", 1)).toBe("2.5x");
  });

  it("leaves text with no number alone", () => {
    expect(countUp("no figure here", 0.5)).toBe("no figure here");
  });
});

describe("each scene draws the thing it is about", () => {
  it("a statistic scene draws its figure and its ring", () => {
    const c = draw({ kind: "stat", label: "PROOF", line: "x", data: { value: "9 days", label: "average audit turnaround" } });
    expect(c.texts().join(" ")).toContain("9 days");
    expect(c.texts().join(" ")).toContain("average audit turnaround");
    expect(c.used("arc")).toBe(true);
  });

  it("a steps scene draws every step and numbers them", () => {
    const items = ["Reconcile payroll", "Review the coding", "Confirm super paid"];
    const t = draw({ kind: "steps", label: "HOW", line: "Year end", data: { items } }, 0.95).texts().join(" ");
    for (const it of items) expect(t).toContain(it);
    expect(t).toContain("1"); expect(t).toContain("3");
  });

  it("a comparison draws both sides with their headings", () => {
    const t = draw({ kind: "compare", line: "Two ways", data: {
      leftLabel: "Hire ahead", left: ["Cost lands early"],
      rightLabel: "Borrow capacity", right: ["Cost lands with the work"],
    } }, 0.9).texts().join(" ");
    expect(t).toContain("HIRE AHEAD");
    expect(t).toContain("BORROW CAPACITY");
    expect(t).toContain("Cost lands with the work");
  });

  it("a timeline draws its last marker, not only the earlier ones", () => {
    const t = draw({ kind: "timeline", line: "The year", data: { items: [
      { when: "6 April", what: "Year starts" },
      { when: "31 Oct", what: "Paper due" },
      { when: "31 Jan", what: "Online due" },
    ] } }, 0.9).texts().join(" ");
    expect(t).toContain("6 April");
    expect(t).toContain("31 Jan");        // the one a distance-based reveal never showed
  });

  it("a bar scene draws the values it was given, not recomputed ones", () => {
    const t = draw({ kind: "bars", line: "Where the time goes", data: { items: [
      { label: "Review", value: 14, display: "14 days" },
      { label: "Prep", value: 9, display: "9 days" },
    ] } }, 0.9).texts().join(" ");
    expect(t).toContain("14 days");
    expect(t).toContain("9 days");
  });

  it("a closing scene draws the ask", () => {
    expect(draw({ kind: "cta", line: "What would you change?" }, 0.9).texts().join(" ")).toContain("What would you change?");
  });
});

describe("never breaking on what the model did not supply", () => {
  it("falls back to type when a data-driven kind has no data", () => {
    for (const kind of ["steps", "compare", "timeline", "bars"]) {
      const c = draw({ kind, line: "A sentence that still has to appear" });
      expect(c.texts().join(" "), kind).toContain("A sentence that still has to appear");
    }
  });

  it("draws an unknown kind rather than throwing", () => {
    expect(() => draw({ kind: "no-such-kind", line: "Still drawn" })).not.toThrow();
    expect(draw({ kind: "no-such-kind", line: "Still drawn" }).texts().join(" ")).toContain("Still drawn");
  });

  it("survives an empty scene", () => {
    expect(() => drawScene(mockCtx(), 1280, 720, {}, 0, 1, 0, {})).not.toThrow();
    expect(() => drawScene(mockCtx(), 1280, 720, null, 0, 1, 0.5, {})).not.toThrow();
  });

  it("draws every kind at both ends of its timing without throwing", () => {
    for (const kind of SCENE_KINDS) {
      for (const t of [0, 0.5, 1]) {
        expect(() => draw({ kind, line: "Line", data: { items: ["a step"], left: ["l"], right: ["r"], value: "9 days" } }, t), `${kind}@${t}`).not.toThrow();
      }
    }
  });
});
