/* Every AI call must say what job it is doing.
 *
 * The tier router reads MODEL_REGISTRY[capability]. A call that omits the
 * capability silently falls back to "reasoning", so the draft would quietly
 * run on the standard model while Settings claimed it used the strong one.
 * That failure is invisible in the UI and invisible in a unit test of the
 * router — it only shows up by reading the call sites, so read them here. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MODEL_REGISTRY } from "../src/lib/ai.js";

const FILES = ["src/App.jsx", "src/lib/media.js"];

/* Pull out each askJSON/askText call with its argument object. */
function callSites(src, file) {
  const out = [];
  const re = /(askJSON|askText)\(\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = re.lastIndex - 1;          // the "{" of the argument object
    let depth = 0, i = open;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) break;
    }
    out.push({ fn: m[1], body: src.slice(open + 1, i), line: src.slice(0, m.index).split("\n").length, file });
  }
  return out;
}

const sites = FILES.flatMap((f) => callSites(readFileSync(f, "utf8"), f));

/* A capability can be a literal or a choice — media.js picks between an image
   and a video prompt inline. Take every quoted word from the expression and
   keep the ones the registry knows; a comparison value like "video" is not a
   capability and simply will not match. */
const capsOf = (site) => {
  const expr = (site.body.match(/capability:([^,\n]*)/) || [])[1] || "";
  return [...expr.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]).filter((n) => MODEL_REGISTRY[n]);
};
const usedCaps = new Set(sites.flatMap(capsOf));

describe("AI call sites", () => {
  it("finds them all, so an empty pass cannot look like success", () => {
    expect(sites.length).toBeGreaterThan(15);
  });

  it("every call declares the capability it is performing", () => {
    const undeclared = sites.filter((s) => !/\bcapability:/.test(s.body)).map((s) => `${s.file}:${s.line} (${s.fn})`);
    expect(undeclared, "these would silently route to the standard model").toEqual([]);
  });

  it("every declared capability resolves to one the registry knows", () => {
    const unresolved = sites.filter((s) => capsOf(s).length === 0).map((s) => `${s.file}:${s.line}`);
    expect(unresolved, "a name the registry does not know routes nowhere").toEqual([]);
  });

  it("puts the draft and the evidence check on the strong tier", () => {
    // These two are what a human reads and what carries the risk of being
    // wrong in public, so they are the ones worth the best free model.
    expect(MODEL_REGISTRY.writing.tier).toBe("strong");
    expect(MODEL_REGISTRY.verification.tier).toBe("strong");
  });

  /* A tier nothing asks for is a setting that does nothing — the exact state
     the app shipped in before this test existed. */
  it.each(["strong", "standard", "fast"])("actually uses the %s tier somewhere", (tier) => {
    const inTier = Object.entries(MODEL_REGISTRY).filter(([, v]) => v.tier === tier).map(([k]) => k);
    expect(inTier.some((c) => usedCaps.has(c)), `no call site asks for a ${tier}-tier capability`).toBe(true);
  });

  it("passes the step-down notice on, so the user is told once", () => {
    const silent = sites.filter((s) => !/\bonNotice\b/.test(s.body)).map((s) => `${s.file}:${s.line}`);
    expect(silent).toEqual([]);
  });
});
