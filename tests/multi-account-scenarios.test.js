import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* The two multi-account TEST scenarios, checked from the blueprints that were
 * uploaded to Make (make/multi-account/). These prove the wiring: every
 * LinkedIn call takes its Page from the job, only the three test Pages pass
 * the filters, and nothing the test scenarios write can be picked up by the
 * production scheduler. They do not prove LinkedIn accepts the posts. */

const read = (p) => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf8"));
const A = read("make/multi-account/scenario-a-multi-account-test.json");
const B = read("make/multi-account/scenario-b-multi-account-test.json");
const PROD_B = read("make/scenario-b-scheduled-publisher.json");
const ALLOWED = ["urn:li:organization:146260120", "urn:li:organization:145298202", "urn:li:organization:145301196"];
const PROD_DATASTORE = 193288;

const walk = (flow, out = []) => {
  for (const m of flow || []) {
    out.push(m);
    for (const r of m.routes || []) walk(r.flow, out);
    walk(m.onerror, out);
  }
  return out;
};
const modsA = walk(A.flow);
const modsB = walk(B.flow);
const linkedin = (mods) => mods.filter((m) => m.module.startsWith("linkedin:"));
const writes = (mods) => mods.filter((m) => ["datastore:AddRecord", "datastore:UpdateRecord", "datastore:DeleteRecord"].includes(m.module));

describe("immediate test scenario", () => {
  it("listens on its own webhook, not production's", () => {
    expect(A.flow[0].parameters.hook).toBe(3885267);
    expect(A.flow[0].parameters.hook).not.toBe(3744886);
  });

  it("posts each job to the Page the job names", () => {
    const calls = linkedin(modsA);
    expect(calls).toHaveLength(4);   // text, image, video, poll
    for (const m of calls) {
      const target = m.mapper.organization || JSON.stringify(modsA.find((x) => x.module === "json:CreateJSON")?.mapper.author);
      if (m.module !== "linkedin:MakeAPICall") expect(m.mapper.organization).toContain("2.companyUrn");
      else expect(target).toContain("2.companyUrn");
    }
  });

  it("only lets the three test Pages through", () => {
    const routes = A.flow[2].routes;
    const typed = routes.filter((r) => /^Now · \w+ · allowed Page$/.test(r.flow[0].filter?.name || ""));
    expect(typed).toHaveLength(4);
    for (const r of typed) {
      const urns = r.flow[0].filter.conditions.map((g) => g.find((c) => /companyUrn/.test(c.a)).b);
      expect(urns.sort()).toEqual([...ALLOWED].sort());
    }
    const reject = routes.find((r) => /not an allowed Page/.test(r.flow[0].filter?.name || ""));
    expect(reject.flow[0].mapper.status).toBe(422);
  });

  it("answers a LinkedIn refusal with a per-Page failure instead of silence", () => {
    for (const m of linkedin(modsA)) {
      const respond = (m.onerror || []).find((x) => x.module === "gateway:WebhookRespond");
      expect(respond?.mapper.body).toMatch(/"status":"failed"/);
      expect(respond?.mapper.body).toMatch(/destinationId/);
    }
  });

  it("queues a scheduled post once, with one job per allowed Page", () => {
    const route = A.flow[2].routes.find((r) => /queue one job per Page/.test(r.flow[0].filter?.name || ""));
    const [parent, feeder, child] = route.flow;
    expect(parent.mapper.key).toBe("mt:{{2.postId}}");
    expect(parent.mapper.data.status).toBe("mtparent");
    expect(parent.mapper.data.media).toBe("{{2.media}}");
    expect(feeder.mapper.array).toBe("{{2.destinations}}");
    expect(child.mapper.key).toMatch(/^mt:\{\{2\.postId\}\}~\{\{\d+\.id\}\}$/);
    expect(child.mapper.data.status).toBe("mtqueued");
    expect(child.mapper.data.media).toBeUndefined();   // media stored once, on the parent
    expect(child.filter.conditions.map((g) => g[0].b).sort()).toEqual([...ALLOWED].sort());
  });

  it("writes only test keys", () => {
    for (const m of writes(modsA)) expect(m.mapper.key).toMatch(/^mt:/);
  });
});

describe("scheduled test scenario", () => {
  it("only ever picks up test records", () => {
    const statuses = B.flow[0].mapper.filter.map((g) => g.find((c) => c.a === "status").b);
    expect(statuses.sort()).toEqual(["mtparent", "mtpublishing", "mtqueued"]);
  });

  it("is never picked up by the production scheduler, and never picks up production", () => {
    const prod = PROD_B.flow[0].mapper.filter.map((g) => g.find((c) => c.a === "status").b);
    expect(prod.sort()).toEqual(["publishing", "queued"]);
    const testWrites = writes(modsB).map((m) => m.mapper.data?.status).filter(Boolean);
    for (const s of testWrites) expect(prod).not.toContain(s);
    expect(testWrites.every((s) => s.startsWith("mt"))).toBe(true);
  });

  it("claims a job before publishing it, and reports a stale claim instead of reposting", () => {
    for (const r of B.flow[1].routes.filter((x) => /Text|Image|Video|Poll/.test(x.flow[0].filter?.name || ""))) {
      expect(r.flow[0].module).toBe("datastore:UpdateRecord");
      expect(r.flow[0].mapper.data.status).toBe("mtpublishing");
      expect(r.flow[1].module).toBe("datastore:GetRecord");
      expect(r.flow[1].mapper.key).toBe("mt:{{19.data.postId}}");
    }
    const stuck = B.flow[1].routes.find((x) => /Interrupted/.test(x.flow[0].filter?.name || ""));
    expect(stuck.flow[0].mapper.data.status).toBe("mtstuck");
  });

  it("publishes each job to its own Page, with the content held on the parent", () => {
    for (const m of linkedin(modsB)) {
      if (m.module === "linkedin:MakeAPICall") continue;
      expect(m.mapper.organization).toBe("{{19.data.companyUrn}}");
      expect(m.mapper.content).toMatch(/^\{\{\d+\.content\}\}$/);
    }
    const poll = modsB.find((m) => m.module === "json:CreateJSON");
    expect(poll.mapper.author).toBe("{{19.data.companyUrn}}");
  });

  it("uses the one data store this Make plan allows, and the same LinkedIn connection", () => {
    for (const m of [...modsA, ...modsB].filter((x) => x.module.startsWith("datastore:"))) expect(m.parameters.datastore).toBe(PROD_DATASTORE);
    for (const m of [...linkedin(modsA), ...linkedin(modsB)]) expect(m.parameters.__IMTCONN__).toBe(10513797);
  });
});
