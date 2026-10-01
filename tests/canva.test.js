import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { INTENTS, INTENT_BY_ID, SHAPES, shapeFit, rankIntents, scoreTemplate, suggestTemplates, mapFields } from "../src/lib/canvamatch.js";
import { classify } from "../src/lib/intel.js";

/* The Canva integration, exercised with Canva mocked.
 *
 * No live Canva call is made here and this environment could not make one:
 * api.canva.com is unreachable from it. What these tests prove is everything
 * this repository is responsible for — that the secret and the tokens never
 * leave the server, that a client cannot turn the relay into an open proxy,
 * that the suggestions are relevant and genuinely different from each other,
 * and that a failure arrives as something the UI can explain.
 */

/* ---------------------------------------------------------------- matching */

const post = (hook, body, cta = "") => ({ hook, body, cta });
const clsOf = (p) => classify({ hook: p.hook, body: p.body, cta: p.cta });

describe("suggesting a design for a post", () => {
  it("offers at least three options, all different layouts", () => {
    const p = post(
      "Three things that slow down a year-end close",
      "Reconciliations left to the last week.\nApprovals waiting on one person.\nA trial balance nobody owns.",
      "Which one is yours?",
    );
    const { suggestions } = suggestTemplates({ cls: clsOf(p), content: p, postType: "image" });
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    const families = new Set(suggestions.map((s) => s.intent));
    /* Four options have to be four arrangements, not one design recoloured. */
    expect(families.size).toBe(suggestions.length);
  });

  it("does not offer a statistic card for a post with no figure in it", () => {
    const p = post("Why outsourcing works when the brief is clear", "A clear brief is the whole job.");
    const { suggestions } = suggestTemplates({ cls: clsOf(p), content: p, postType: "image" });
    expect(suggestions.some((s) => s.intent === "stat")).toBe(false);
  });

  it("puts the statistic card first when the post turns on a figure", () => {
    const p = post("Audit turnaround fell 38% after we moved the prep offshore", "The work did not change. The queue did.");
    const ranked = rankIntents(clsOf(p), p, { postType: "image" });
    expect(ranked[0].intent.id).toBe("stat");
  });

  it("leads with the occasion layout for a festival greeting, and gives a reason naming it", () => {
    const p = post("Happy Diwali from all of us", "May the year ahead be a bright one for your firm.");
    const { suggestions } = suggestTemplates({ cls: clsOf(p), content: p, postType: "image" });
    expect(suggestions[0].intent).toBe("occasion");
    expect(suggestions[0].why.toLowerCase()).toContain("diwali");
  });

  it("leads with open roles for a hiring post that lists several", () => {
    const p = post("We are hiring in Ahmedabad", "Senior auditor.\nTax associate.\nBookkeeping lead.\nClient manager.");
    const { suggestions } = suggestTemplates({ cls: clsOf(p), content: p, postType: "image" });
    expect(suggestions[0].intent).toBe("roles");
  });

  it("never suggests the photo layout for a video, because it cannot make one", () => {
    const p = post("Meet the team behind the close", "Six people, two cities, one deadline.");
    const { suggestions } = suggestTemplates({ cls: clsOf(p), content: p, postType: "video" });
    expect(suggestions.some((s) => s.intent === "people")).toBe(false);
    expect(INTENT_BY_ID.people.suits).not.toContain("video");
  });

  it("marks every option as a Unison layout when Canva is not connected", () => {
    const p = post("One change that cut our review time", "We stopped reviewing twice.");
    const { suggestions } = suggestTemplates({ cls: clsOf(p), content: p, postType: "image", templates: [] });
    expect(suggestions.length).toBeGreaterThan(0);
    /* The important half of the promise: nothing is presented as a Canva
       template unless Canva returned it. */
    expect(suggestions.every((s) => s.source === "unison")).toBe(true);
    expect(suggestions.every((s) => s.thumbnail === null)).toBe(true);
  });

  it("uses a real Canva template when the account has one that fits", () => {
    const p = post("Audit turnaround fell 38% this year", "Same team, different queue.");
    const templates = [{ id: "T1", title: "Statistic card — data highlight", thumbnail: "https://example.test/t1.png", width: 1200, height: 628 }];
    const { suggestions } = suggestTemplates({ cls: clsOf(p), content: p, postType: "image", templates, canvaConnected: true });
    const canva = suggestions.filter((s) => s.source === "canva");
    expect(canva.length).toBe(1);
    expect(canva[0].templateId).toBe("T1");
    expect(canva[0].thumbnail).toBe("https://example.test/t1.png");
  });

  it("refuses a template whose shape would have to be distorted", () => {
    const tall = { id: "T2", title: "Statistic card", thumbnail: "x", width: 1080, height: 1920 };
    const { suggestions } = suggestTemplates({
      cls: clsOf(post("Turnaround fell 38%", "Same team.")), content: post("Turnaround fell 38%", "Same team."),
      postType: "image", templates: [tall], canvaConnected: true,
    });
    expect(suggestions.every((s) => s.templateId !== "T2")).toBe(true);
    expect(shapeFit(1080, 1920, "image").fit).toBe("wrong");
  });

  it("only accepts 16:9 for video, because that is the export the relay asks for", () => {
    expect(shapeFit(1920, 1080, "video").fit).toBe("ideal");
    expect(shapeFit(1200, 628, "video").fit).toBe("wrong");
    expect(SHAPES.video.ideal).toBeCloseTo(16 / 9, 5);
  });

  it("accepts both landscape and square for an image post", () => {
    expect(shapeFit(1200, 627, "image").fit).toBe("ideal");
    expect(shapeFit(1200, 1200, "image").fit).toBe("ok");
  });

  it("does not offer the same design twice under two different names", () => {
    const p = post("Three things that slow a close", "One.\nTwo.\nThree.");
    const templates = [
      { id: "A", title: "Key points list", width: 1200, height: 628, thumbnail: "a" },
      { id: "B", title: "List points key", width: 1200, height: 628, thumbnail: "b" },
    ];
    const { suggestions } = suggestTemplates({ cls: clsOf(p), content: p, postType: "image", templates, canvaConnected: true });
    const ids = suggestions.filter((s) => s.source === "canva").map((s) => s.templateId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(1);
  });

  it("scores a template by its own title, not by wishful thinking", () => {
    const intent = INTENT_BY_ID.roles;
    const good = scoreTemplate({ title: "Hiring — open roles", width: 1200, height: 628 }, intent, "image");
    const bad = scoreTemplate({ title: "Holiday greeting card", width: 1200, height: 628 }, intent, "image");
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.hits).toContain("hiring");
  });

  it("every curated entry points at a layout the renderer really has", async () => {
    const { TEMPLATE_BY_ID } = await import("../src/lib/templates.js");
    const { FORMATS } = await import("../src/lib/visual.js");
    for (const i of INTENTS) {
      expect(FORMATS[i.format], i.id).toBeTruthy();
      expect(TEMPLATE_BY_ID[FORMATS[i.format].template], i.id).toBeTruthy();
    }
  });
});

describe("the reasons shown to the user", () => {
  /* These sentences are read by a person, and the first version built them by
     dropping a category label into "It is a ___ post." That produced "It is a
     how something works post." and "It is a event or webinar post". */
  it("reads as English for every pillar, with the right article", () => {
    const posts = [
      ["How the monthly close actually works", "First reconcile.\nThen review.\nThen sign off."],
      ["Join our webinar on year-end planning", "Register now.\nSeats are limited.\nIt runs an hour."],
      ["We are hiring in Ahmedabad", "Senior auditor.\nTax associate.\nBookkeeping lead."],
      ["Making Tax Digital starts 6 April 2026", "The threshold is £50,000.\nFiling moves quarterly.\nRegister early."],
      ["Audit turnaround fell 38% this year", "Same team, different queue."],
      ["Happy Diwali from all of us", "May the year ahead be a bright one."],
    ];
    for (const [hook, body] of posts) {
      const c = { hook, body, cta: "" };
      const { suggestions } = suggestTemplates({ cls: clsOf(c), content: c, postType: "image" });
      expect(suggestions.length, hook).toBeGreaterThanOrEqual(3);
      for (const s of suggestions) {
        expect(s.why, hook).toBeTruthy();
        /* the label-jamming shapes, in any form */
        expect(s.why, `${hook} -> ${s.why}`).not.toMatch(/\bIt is a (how|what|result or|point of|capacity and|season |tax or|festival or|event or|team and)/i);
        expect(s.why, `${hook} -> ${s.why}`).not.toMatch(/\bA (numbered|key points|open roles|side by side|pull quote|single statement|fact or)/i);
        /* "a event", "a occasion" — an article that does not fit its noun */
        expect(s.why, `${hook} -> ${s.why}`).not.toMatch(/\ba [aeiou]/i);
        expect(s.why.trim(), hook).toMatch(/[.!?]$/);
      }
    }
  });

  it("gives every layout its own sentence, so none has to be assembled", () => {
    for (const i of INTENTS) {
      expect(i.blurb, i.id).toBeTruthy();
      expect(i.blurb.trim(), i.id).toMatch(/[.!?]$/);
      expect(i.blurb, i.id).not.toContain(i.label.toLowerCase());
    }
  });
});

describe("filling a template's own fields", () => {
  it("matches the designer's field names to what the post provides", () => {
    const canvaFields = [
      { name: "Headline", type: "text" },
      { name: "sub_title", type: "text" },
      { name: "Company name", type: "text" },
      { name: "Logo", type: "image" },
      { name: "Mystery box", type: "text" },
    ];
    const { values, unmatched } = mapFields(canvaFields, { headline: "Year-end is close", support: "Start the reconciliations now", attrib: "Unison Globus" });
    expect(values.Headline).toBe("Year-end is close");
    expect(values.sub_title).toBe("Start the reconciliations now");
    expect(values["Company name"]).toBe("Unison Globus");
    /* A name Unison cannot read is left blank and reported, never guessed. */
    expect(values["Mystery box"]).toBeUndefined();
    expect(unmatched.map((f) => f.name)).toContain("Mystery box");
    expect(unmatched.map((f) => f.name)).toContain("Logo");
  });

  it("builds the shape the autofill API documents, by field type", async () => {
    const { buildAutofillData } = await import("../src/lib/canva.js");
    const data = buildAutofillData(
      [{ name: "Headline", type: "text" }, { name: "Logo", type: "image" }, { name: "Chart", type: "chart" }],
      { Headline: "Year-end is close", Logo: "ASSET123", Chart: "ignored" },
    );
    expect(data.Headline).toEqual({ type: "text", text: "Year-end is close" });
    expect(data.Logo).toEqual({ type: "image", asset_id: "ASSET123" });
    /* Chart and sheet fields are preview features Unison does not fill. */
    expect(data.Chart).toBeUndefined();
  });
});

/* ------------------------------------------------------------------- relay */

/* A response double that records cookies and streamed bytes the way Vercel's
   Node helpers would. */
const res = () => {
  const r = { code: 0, body: null, headers: {}, chunks: [], ended: false, headersSent: false };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; r.headersSent = true; return r; };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.write = (c) => { r.headersSent = true; r.code = r.code || r.statusCode; r.chunks.push(Buffer.from(c)); };
  r.end = () => { r.ended = true; r.code = r.code || r.statusCode; };
  return r;
};
/* Carry Set-Cookie from one response into the next request, like a browser. */
const jarFrom = (r, jar = {}) => {
  for (const c of [].concat(r.headers["set-cookie"] || [])) {
    const [pair, ...attrs] = c.split("; ");
    const [k, v] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
    if (attrs.includes("Max-Age=0") || v === "") delete jar[k]; else jar[k] = v;
  }
  return jar;
};
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status, body) => ({ ok: false, status, json: async () => body });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOo6fkPRwzEcQBDkSBxVMCyJQAAAABJRU5ErkJggg==", "base64");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(32)]);
const streamOf = (buf) => new ReadableStream({ start(c) { c.enqueue(new Uint8Array(buf.subarray(0, 8))); c.enqueue(new Uint8Array(buf.subarray(8))); c.close(); } });

let fetchMock;
const load = async (file = "canva.js") => { vi.resetModules(); return import(`../api/${file}?t=${Math.random()}`); };
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllEnvs?.(); vi.unstubAllGlobals(); });

const SECRET = "cnvcaSUPERSECRETVALUE";

/* Configure from the environment, then run the whole OAuth round trip the
   way a browser would — carrying cookies, nothing else. */
async function connect(mod, { expiresIn = 14400, env = true } = {}) {
  if (env) { vi.stubEnv("CANVA_CLIENT_ID", "OC-TEST"); vi.stubEnv("CANVA_CLIENT_SECRET", SECRET); vi.stubEnv("CANVA_REDIRECT_URI", "https://unison.test/"); }
  mod = mod || await load();
  const h = mod.default;
  let jar = {};
  let r = res();
  await h({ method: "POST", headers: { "x-forwarded-proto": "https" }, body: { action: "start" } }, r);
  jar = jarFrom(r, jar);
  const { url, state } = r.body;
  fetchMock.mockResolvedValueOnce(okJson({ access_token: "AT-TOKEN", refresh_token: "RT-TOKEN", expires_in: expiresIn, scope: "design:meta:read" }));
  const x = res();
  await h({ method: "POST", headers: { cookie: cookieHeader(jar), "x-forwarded-proto": "https" }, body: { action: "exchange", code: "CODE", state } }, x);
  jar = jarFrom(x, jar);
  const ask = async (body, extra = {}) => { const rr = res(); await h({ method: "POST", headers: { cookie: cookieHeader(jar), ...extra }, body, query: {} }, rr); jar = jarFrom(rr, jar); return rr; };
  return { mod, h, url, state, exchange: x, start: r, jar: () => jar, ask };
}

describe("the Canva relay on serverless", () => {
  it("reports whether a secret is set without ever returning it", async () => {
    vi.stubEnv("CANVA_CLIENT_ID", "OC-ENV"); vi.stubEnv("CANVA_CLIENT_SECRET", SECRET); vi.stubEnv("CANVA_REDIRECT_URI", "https://unison.test/");
    const mod = await load();
    const r = res();
    await mod.default({ method: "GET", headers: {} }, r);
    expect(r.body.configured).toBe(true);
    expect(r.body.persistence).toBe("cookie");
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("survives a new function instance between start and exchange", async () => {
    /* The first version kept the PKCE verifier in memory, so an exchange that
       landed on a different Vercel instance failed. The verifier now travels
       in a sealed cookie — loading a fresh copy of the module proves it. */
    vi.stubEnv("CANVA_CLIENT_ID", "OC-TEST"); vi.stubEnv("CANVA_CLIENT_SECRET", SECRET); vi.stubEnv("CANVA_REDIRECT_URI", "https://unison.test/");
    const a = await load();
    const r = res();
    await a.default({ method: "POST", headers: {}, body: { action: "start" } }, r);
    const jar = jarFrom(r);
    const b = await load();                               /* a different instance */
    fetchMock.mockResolvedValueOnce(okJson({ access_token: "AT", refresh_token: "RT", expires_in: 14400 }));
    const x = res();
    await b.default({ method: "POST", headers: { cookie: cookieHeader(jar) }, body: { action: "exchange", code: "C", state: r.body.state } }, x);
    expect(x.body.connected).toBe(true);
    const c = await load();                               /* and a third, for the next call */
    const s = res();
    await c.default({ method: "POST", headers: { cookie: cookieHeader(jarFrom(x, jar)) }, body: { action: "status" } }, s);
    expect(s.body.connected).toBe(true);
  });

  it("uses PKCE, and the verifier is never readable by the browser", async () => {
    const { url, start, state } = await connect();
    const u = new URL(url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("scope")).toBe((await load()).SCOPES.join(" "));
    const pkce = [].concat(start.headers["set-cookie"]).find((c) => c.startsWith("uc_p="));
    expect(pkce).toMatch(/HttpOnly/);
    expect(pkce).toMatch(/SameSite=Lax/);
    expect(pkce).toMatch(/Path=\/api\/canva/);
    /* the code verifier went upstream with the exchange, but it is nowhere in
       the cookie text the browser holds */
    const sent = new URLSearchParams(fetchMock.mock.calls[0][1].body).get("code_verifier");
    expect(sent).toMatch(/^[\w-]{60,}$/);
    expect(pkce).not.toContain(sent);
  });

  it("gives the browser no token — only an encrypted, HttpOnly, Secure cookie", async () => {
    const { exchange, jar } = await connect();
    const text = JSON.stringify(exchange.body) + JSON.stringify(exchange.headers);
    for (const secret of ["AT-TOKEN", "RT-TOKEN", SECRET]) expect(text).not.toContain(secret);
    const cookie = [].concat(exchange.headers["set-cookie"]).find((c) => c.startsWith("uc_s0="));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(Object.keys(jar())).toContain("uc_s0");
    expect(Object.keys(jar())).not.toContain("uc_p");    /* PKCE cookie spent */
  });

  it("rejects a tampered session cookie instead of trusting it", async () => {
    const { h, jar } = await connect();
    const j = jar();
    const bad = j.uc_s0.slice(0, -4) + (j.uc_s0.endsWith("AAAA") ? "BBBB" : "AAAA");
    const r = res();
    await h({ method: "POST", headers: { cookie: `uc_s0=${bad}` }, body: { action: "templates" } }, r);
    expect(r.code).toBe(401);
    expect(r.body.code).toBe("not_connected");
  });

  it("refuses an authorization whose state it did not issue, and a reused one", async () => {
    vi.stubEnv("CANVA_CLIENT_ID", "OC-TEST"); vi.stubEnv("CANVA_CLIENT_SECRET", SECRET); vi.stubEnv("CANVA_REDIRECT_URI", "https://unison.test/");
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "start" } }, r);
    const x = res();
    await mod.default({ method: "POST", headers: { cookie: cookieHeader(jarFrom(r)) }, body: { action: "exchange", code: "C", state: "made-up" } }, x);
    expect(x.body.code).toBe("bad_state");
    /* the PKCE cookie is cleared even on failure, so it cannot be retried */
    expect([].concat(x.headers["set-cookie"]).some((c) => c.startsWith("uc_p=;") && c.includes("Max-Age=0"))).toBe(true);
  });

  it("renews an expiring token and writes the NEW refresh token back — the old one is spent", async () => {
    const { ask, jar } = await connect(undefined, { expiresIn: 30 });
    fetchMock.mockResolvedValueOnce(okJson({ access_token: "AT-2", refresh_token: "RT-2", expires_in: 14400 }));
    fetchMock.mockResolvedValueOnce(okJson({ items: [], continuation: null }));
    const before = jar().uc_s0;
    const r = await ask({ action: "templates" });
    expect(r.body.ok).toBe(true);
    expect(new URLSearchParams(fetchMock.mock.calls[1][1].body).get("refresh_token")).toBe("RT-TOKEN");
    expect(jar().uc_s0).not.toBe(before);                 /* rotated pair stored */
    /* and the next call uses the new pair without refreshing again */
    fetchMock.mockResolvedValueOnce(okJson({ items: [] }));
    await ask({ action: "templates" });
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer AT-2");
  });

  it("asks the user to reconnect when renewal fails, and clears the cookie", async () => {
    const { ask } = await connect(undefined, { expiresIn: 30 });
    fetchMock.mockResolvedValueOnce(errJson(400, { error: "invalid_grant" }));
    const r = await ask({ action: "templates" });
    expect(r.code).toBe(401);
    expect(r.body.code).toBe("expired");
    expect([].concat(r.headers["set-cookie"]).some((c) => c.startsWith("uc_s0=;"))).toBe(true);
  });

  it("disconnect clears the cookie and revokes the connection at Canva", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({}));
    const r = await ask({ action: "disconnect" });
    expect(r.body.connected).toBe(false);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api.canva.com/rest/v1/oauth/revoke");
    expect(new URLSearchParams(init.body).get("token")).toBe("RT-TOKEN");
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it("says 'not connected' and makes no upstream call without a session", async () => {
    vi.stubEnv("CANVA_CLIENT_ID", "OC-TEST"); vi.stubEnv("CANVA_CLIENT_SECRET", SECRET);
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "templates" } }, r);
    expect(r.code).toBe(401);
    expect(r.body.code).toBe("not_connected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains an Enterprise-only refusal, and says what still works", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(errJson(403, {}));
    const r = await ask({ action: "templates" });
    expect(r.code).toBe(403);
    expect(r.body.code).toBe("enterprise_required");
    expect(r.body.message).toMatch(/Enterprise/);
    expect(r.body.message).toMatch(/still works/);
  });

  it("creates a design of an exact size from an uploaded image — no Enterprise needed", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ design: { id: "D1", title: "Unison", urls: { edit_url: "https://www.canva.com/design/D1/edit", view_url: "v" }, thumbnail: { url: "t", width: 1200, height: 627 } } }));
    const r = await ask({ action: "createDesign", assetId: "A1", width: 1200, height: 627, title: "Navratri" });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[1][0].toString()).toBe("https://api.canva.com/rest/v1/designs");
    expect(body).toEqual({ design_type: { type: "custom", width: 1200, height: 627 }, asset_id: "A1", title: "Navratri" });
    expect(r.body.design).toMatchObject({ id: "D1", editUrl: "https://www.canva.com/design/D1/edit" });
  });

  it("refuses a design size Canva would reject", async () => {
    const { ask } = await connect();
    const r = await ask({ action: "createDesign", width: 10, height: 99999 });
    expect(r.code).toBe(400);
  });

  it("lists the account's own designs, newest first", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ items: [{ id: "D9", title: "Edited", urls: { edit_url: "e" }, thumbnail: { url: "t" } }] }));
    const r = await ask({ action: "designs", query: "navratri" });
    const u = new URL(fetchMock.mock.calls[1][0]);
    expect(u.pathname).toBe("/rest/v1/designs");
    expect(u.searchParams.get("sort_by")).toBe("modified_descending");
    expect(r.body.items[0].id).toBe("D9");
  });

  it("reports export completion without handing the browser a download address", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E1", status: "success", urls: ["https://export.example/x.png"] } }));
    const r = await ask({ action: "exportJob", jobId: "E1" });
    expect(r.body).toEqual({ ok: true, state: "done", files: 1 });
    expect(JSON.stringify(r.body)).not.toContain("https://");
  });

  it("streams a download by job id, and only after checking the file's own signature", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E1", status: "success", urls: ["https://export-download.canva.com/a.mp4"] } }));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, body: streamOf(MP4) });
    const r = await ask({ action: "download", jobId: "E1", expect: "mp4" });
    expect(r.headers["content-type"]).toBe("video/mp4");
    expect(r.ended).toBe(true);
    expect(Buffer.concat(r.chunks).equals(MP4)).toBe(true);
    expect(r.body).toBeNull();                              /* streamed, not a JSON body */
  });

  it("refuses to pass on a file that is not what was asked for", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E1", status: "success", urls: ["https://x/a"] } }));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, body: streamOf(PNG) });
    const r = await ask({ action: "download", jobId: "E1", expect: "mp4" });
    expect(r.code).toBe(502);
    expect(r.body.code).toBe("wrong_type");
  });

  it("refuses a file that is neither an image nor a video", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E1", status: "success", urls: ["https://x/a"] } }));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, body: streamOf(Buffer.from("<html>not a file</html>")) });
    const r = await ask({ action: "download", jobId: "E1" });
    expect(r.body.code).toBe("bad_file");
  });

  it("never fetches a URL the client names — there is no such action any more", async () => {
    const { ask } = await connect();
    const r = await ask({ action: "fetch", url: "https://evil.test/x" });
    expect(r.code).toBe(400);
    expect(r.body.code).toBe("unknown_action");
    expect(fetchMock).toHaveBeenCalledTimes(1);             /* only the token exchange */
  });

  it("accepts raw bytes for an upload and names the asset in the documented header", async () => {
    const { h, jar } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "U1", status: "in_progress" } }));
    const r = res();
    await h({ method: "POST", headers: { cookie: cookieHeader(jar()) }, query: { action: "upload", name: "navratri.png" }, body: PNG }, r);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("https://api.canva.com/rest/v1/asset-uploads");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(JSON.parse(init.headers["Asset-Upload-Metadata"]).name_base64).toBe(Buffer.from("navratri.png").toString("base64"));
    expect(Buffer.from(init.body).equals(PNG)).toBe(true);
    expect(r.body.jobId).toBe("U1");
  });

  it("refuses to upload something that is not an image or a video", async () => {
    const { h, jar } = await connect();
    const r = res();
    await h({ method: "POST", headers: { cookie: cookieHeader(jar()) }, query: { action: "upload" }, body: Buffer.from("#!/bin/sh\nrm -rf /") }, r);
    expect(r.code).toBe(400);
    expect(r.body.code).toBe("bad_file");
  });

  it("imports by URL for files too large to pass through a Vercel function", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "UU1", status: "in_progress" } }));
    const r = await ask({ action: "uploadUrl", url: "https://cdn.runwayml.com/clip.mp4", name: "clip.mp4" });
    expect(fetchMock.mock.calls[1][0].toString()).toBe("https://api.canva.com/rest/v1/url-asset-uploads");
    expect(r.body.jobId).toBe("UU1");
    const bad = await ask({ action: "uploadUrl", url: "http://insecure.test/x.mp4" });
    expect(bad.code).toBe(400);
  });

  it("asks for an MP4 at a valid quality, and only for video", async () => {
    const { ask } = await connect();
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E1" } }));
    await ask({ action: "export", designId: "D1", format: "mp4", quality: "vertical_1080p" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).format).toEqual({ type: "mp4", quality: "vertical_1080p" });
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E2" } }));
    await ask({ action: "export", designId: "D1", format: "mp4", quality: "8k-please" });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).format.quality).toBe("horizontal_1080p");
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E3" } }));
    await ask({ action: "export", designId: "D1", format: "png" });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).format).toEqual({ type: "png" });
  });

  it("refuses runtime configuration on a deployment configured from its environment", async () => {
    vi.stubEnv("CANVA_CLIENT_ID", "OC-ENV"); vi.stubEnv("CANVA_CLIENT_SECRET", SECRET);
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "configure", clientId: "OC-EVIL", clientSecret: "evil" } }, r);
    expect(r.body.code).toBe("env_locked");
  });

  it("will not let a public deployment be pointed at someone else's integration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "configure", clientId: "OC-EVIL", clientSecret: "evil", redirectUri: "https://evil.test/" } }, r);
    expect(r.body.code).toBe("needs_env");
  });

  it("honours a relay token when one is set", async () => {
    vi.stubEnv("UNISON_RELAY_TOKEN", "shhh");
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "start" } }, r);
    expect(r.body.code).toBe("unauthorized");
  });

  it("asks Canva for exactly the scopes the first version did — no re-approval needed", async () => {
    expect((await load()).SCOPES).toEqual([
      "design:meta:read", "design:content:read", "design:content:write",
      "asset:read", "asset:write", "brandtemplate:meta:read", "brandtemplate:content:read",
    ]);
  });

  it("never writes a token, a secret or a cookie to the log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ask, jar } = await connect();
    fetchMock.mockResolvedValueOnce(errJson(500, { message: "boom" }));
    await ask({ action: "templates" });
    const logged = spy.mock.calls.flat().join(" ");
    for (const s of ["AT-TOKEN", "RT-TOKEN", SECRET, jar().uc_s0]) expect(logged).not.toContain(s);
    spy.mockRestore();
  });

  it("seals with authenticated encryption — any change is detected", async () => {
    vi.stubEnv("CANVA_CLIENT_SECRET", SECRET);
    const { __test } = await load();
    const sealed = __test.seal({ a: "token" }, "session");
    expect(__test.unseal(sealed, "session")).toEqual({ a: "token" });
    expect(__test.unseal(sealed, "pkce")).toBeNull();          /* bound to its purpose */
    expect(__test.unseal(sealed.slice(0, -2) + "xx", "session")).toBeNull();
  });
});
