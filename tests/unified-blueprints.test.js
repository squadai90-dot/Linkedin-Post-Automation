import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMake } from "./helpers/make-sim.js";

/* The shape of the two replacement blueprints: which Make resources they
 * use, which modules, and the isolation rules the cutover depends on. */

const load = (p) => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf8"));
const UA = load("make/unified/unified-immediate-publisher.json");
const UB = load("make/unified/unified-scheduled-publisher.json");
const TA = load("make/unified/test/unified-immediate-publisher.test.json");
const PB = load("make/scenario-b-scheduled-publisher.json");

const modules = (flow, out = []) => {
  for (const m of flow) {
    out.push(m);
    for (const r of m.routes || []) modules(r.flow, out);
    modules(m.onerror || [], out);
  }
  return out;
};
/* Every module the production scenarios use, plus four data-store and JSON
   modules whose names and settings were checked against Make's own module
   definitions (validate_module_configuration: valid). */
const KNOWN = new Set(["gateway:CustomWebHook", "json:ParseJSON", "builtin:BasicRouter", "linkedin:CreateTextShare", "linkedin:CreateCompanyImagePost",
  "linkedin:createOrganizationVideoPost", "linkedin:MakeAPICall", "builtin:BasicFeeder", "builtin:BasicAggregator", "json:CreateJSON",
  "datastore:AddRecord", "datastore:UpdateRecord", "builtin:Ignore", "gateway:WebhookRespond",
  "datastore:SearchRecord", "datastore:GetRecord", "datastore:DeleteRecord", "json:TransformToJSON"]);
const ALLOWED = ["urn:li:organization:146260120", "urn:li:organization:145298202", "urn:li:organization:145301196"];

describe("the unified blueprints", () => {
  for (const [name, bp] of [["immediate", UA], ["scheduled", UB], ["test immediate", TA]]) {
    it(`${name}: unique module ids, and only modules Make has`, () => {
      const all = modules(bp.flow);
      expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
      for (const m of all) expect(KNOWN.has(m.module), m.module).toBe(true);
    });
  }

  it("use the production connection, store and webhook — and nothing else", () => {
    for (const bp of [UA, UB]) {
      for (const m of modules(bp.flow)) {
        if (m.module.startsWith("linkedin:")) expect(m.parameters.__IMTCONN__).toBe(10513797);
        if (m.module.startsWith("datastore:")) expect(m.parameters.datastore).toBe(193288);
      }
    }
    expect(UA.flow[0].parameters.hook).toBe(3744886);
    expect(UA.metadata.instant).toBe(true);
    expect(UB.scheduling).toEqual({ type: "indefinitely", interval: 3600 });   // hourly, as production
  });

  it("the test copy never touches a data store and listens on the test webhook", () => {
    const all = modules(TA.flow);
    expect(all.some((m) => m.module.startsWith("datastore:"))).toBe(false);
    expect(TA.flow[0].parameters.hook).toBe(3885267);
    const sim = createMake({ linkedin: () => ({ id: "urn:li:share:1" }) });
    const now = { source: "x", postId: "p-t~test-2", idempotencyKey: "p-t~test-2", postType: "text", content: "TEST", publishMode: "now", companyUrn: ALLOWED[1], destinationId: "test-2", media: [] };
    expect(JSON.parse(sim.deliver(TA, JSON.stringify(now)).body)).toMatchObject({ status: "published", destinationId: "test-2" });
    const later = { ...now, postId: "p-t", publishMode: "scheduled", scheduledDate: "2026-10-20", scheduledTime: "09:00", timezone: "Asia/Calcutta", destinations: [{ id: "test-2", organizationUrn: ALLOWED[1] }] };
    const r = sim.deliver(TA, JSON.stringify(later));
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body).stage).toBe("config");
    expect(sim.store.size).toBe(0);
  });

  it("post only to the three allowed Pages, for the four post types", () => {
    const route = UA.flow[2].routes.map((r) => r.flow[0]).find((m) => m.filter?.name === "Now · allowed Page");
    const pairs = route.filter.conditions.map((g) => [g.find((c) => c.a === "{{2.postType}}").b, g.find((c) => c.a.includes("companyUrn")).b]);
    expect(pairs).toHaveLength(12);
    expect(new Set(pairs.map(([, u]) => u))).toEqual(new Set(ALLOWED));
    expect(new Set(pairs.map(([t]) => t))).toEqual(new Set(["text", "image", "video", "poll"]));
  });

  it("give Page jobs statuses the production scheduler never selects", () => {
    const selected = PB.flow[0].mapper.filter.map((g) => g.find((c) => c.a === "status").b);
    expect(selected.sort()).toEqual(["publishing", "queued"]);
    const written = JSON.stringify(UA) + JSON.stringify(UB);
    for (const s of ["page-queued", "page-publishing", "parent"]) {
      expect(written).toContain(`"${s}"`);
      expect(selected).not.toContain(s);
    }
  });

  it("answer every webhook outcome in JSON — there is no route that ends without a response", () => {
    /* each top-level route ends in, or contains, a WebhookRespond */
    for (const r of UA.flow[2].routes) expect(modules(r.flow).some((m) => m.module === "gateway:WebhookRespond")).toBe(true);
  });
});
