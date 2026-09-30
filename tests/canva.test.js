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

const res = () => {
  const r = { code: 0, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
};

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status, body) => ({ ok: false, status, json: async () => body });

let fetchMock;
const load = async (file = "canva.js") => {
  vi.resetModules();
  return import(`../api/${file}?t=${Math.random()}`);
};

beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllEnvs?.(); vi.unstubAllGlobals(); });

const SECRET = "cnvcaSUPERSECRETVALUE";

/* Configure at runtime and connect, returning the session id the browser gets. */
async function connect(mod, { expiresIn = 3600 } = {}) {
  const h = mod.default;
  let r = res();
  await h({ method: "POST", headers: {}, body: { action: "configure", clientId: "OC-TEST", clientSecret: SECRET, redirectUri: "https://unison.test/" } }, r);
  expect(r.body.configured).toBe(true);

  r = res();
  await h({ method: "POST", headers: {}, body: { action: "start" } }, r);
  const { url, state } = r.body;

  fetchMock.mockResolvedValueOnce(okJson({ access_token: "AT-TOKEN", refresh_token: "RT-TOKEN", expires_in: expiresIn, scope: "design:meta:read" }));
  const x = res();
  await h({ method: "POST", headers: {}, body: { action: "exchange", code: "CODE", state } }, x);
  return { h, url, state, exchange: x };
}

describe("the Canva relay", () => {
  it("reports whether a secret is set without ever returning it", async () => {
    vi.stubEnv("CANVA_CLIENT_ID", "OC-ENV"); vi.stubEnv("CANVA_CLIENT_SECRET", SECRET); vi.stubEnv("CANVA_REDIRECT_URI", "https://unison.test/");
    const mod = await load();
    const r = res();
    await mod.default({ method: "GET", headers: {} }, r);
    expect(r.body.configured).toBe(true);
    expect(r.body.hasSecret).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    /* Even the client id is truncated, and nothing is cacheable. */
    expect(r.body.clientId).not.toBe("OC-ENV");
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  it("uses PKCE, keeping the verifier on the server", async () => {
    const mod = await load();
    const h = mod.default;
    let r = res();
    await h({ method: "POST", headers: {}, body: { action: "configure", clientId: "OC-TEST", clientSecret: SECRET, redirectUri: "https://unison.test/" } }, r);
    r = res();
    await h({ method: "POST", headers: {}, body: { action: "start" } }, r);
    const { url, state } = r.body;
    /* The verifier is held here, unsent, waiting for the code to come back. */
    const verifier = mod.__test.pending.get(state).verifier;
    expect(verifier).toMatch(/^[\w-]{60,}$/);
    expect(url).not.toContain(verifier);
    expect(JSON.stringify(r.body)).not.toContain(verifier);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.canva.com/api/oauth/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(u.searchParams.get("state")).toBe(state);
    expect(u.searchParams.get("scope")).toBe(mod.SCOPES.join(" "));
    expect(u.searchParams.get("redirect_uri")).toBe("https://unison.test/");
  });

  it("hands the browser a session id and no token at all", async () => {
    const mod = await load();
    const { exchange } = await connect(mod);
    expect(exchange.body.sessionId).toMatch(/^[\w-]{20,}$/);
    const asText = JSON.stringify(exchange.body);
    expect(asText).not.toContain("AT-TOKEN");
    expect(asText).not.toContain("RT-TOKEN");
    expect(asText).not.toContain(SECRET);
    expect(exchange.body.accessToken).toBeUndefined();
    expect(exchange.body.refreshToken).toBeUndefined();
    /* The token exists — on the server, under that session id. */
    expect(mod.__test.sessions.get(exchange.body.sessionId).accessToken).toBe("AT-TOKEN");
  });

  it("sends the code verifier, not the code alone, when exchanging", async () => {
    const mod = await load();
    await connect(mod);
    const [tokenUrl, init] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://api.canva.com/rest/v1/oauth/token");
    const sent = new URLSearchParams(init.body);
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code_verifier")).toMatch(/^[\w-]{40,}$/);
    /* The secret goes in the Basic header, as Canva documents — never in a
       query string that could end up in a log. */
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`OC-TEST:${SECRET}`).toString("base64")}`);
  });

  it("refuses an authorization whose state it did not issue", async () => {
    const mod = await load();
    await connect(mod);
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "exchange", code: "CODE", state: "made-up" } }, r);
    expect(r.code).toBe(400);
    expect(r.body.code).toBe("bad_state");
  });

  it("will not let the same authorization code be exchanged twice", async () => {
    const mod = await load();
    const { state } = await connect(mod);
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "exchange", code: "CODE", state } }, r);
    expect(r.body.code).toBe("bad_state");
  });

  it("refuses runtime configuration on a deployment configured from its environment", async () => {
    vi.stubEnv("CANVA_CLIENT_ID", "OC-ENV"); vi.stubEnv("CANVA_CLIENT_SECRET", SECRET);
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "configure", clientId: "OC-EVIL", clientSecret: "evil" } }, r);
    expect(r.code).toBe(409);
    expect(r.body.code).toBe("env_locked");
  });

  it("will not let a public deployment be pointed at someone else's Canva integration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "configure", clientId: "OC-EVIL", clientSecret: "evil", redirectUri: "https://evil.test/" } }, r);
    expect(r.code).toBe(403);
    expect(r.body.code).toBe("needs_env");
    expect(r.body.message).toMatch(/CANVA_CLIENT_ID/);
  });

  it("allows runtime configuration on a deployment that is behind a relay token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UNISON_RELAY_TOKEN", "shhh");
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: { "x-unison-token": "shhh" }, body: { action: "configure", clientId: "OC-OK", clientSecret: SECRET, redirectUri: "https://unison.test/" } }, r);
    expect(r.code).toBe(200);
    expect(r.body.configured).toBe(true);
  });

  it("drops a connection it can no longer renew, rather than holding it forever", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    const id = exchange.body.sessionId;
    const held = mod.__test.sessions.get(id);
    held.refreshToken = "";                       // nothing left to renew with
    held.expiresAt = Date.now() - 3 * 60 * 60e3;  // and long past
    await h({ method: "POST", headers: {}, body: { action: "start" } }, res());
    expect(mod.__test.sessions.has(id)).toBe(false);
  });

  it("says it is not connected rather than calling Canva without a token", async () => {
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "templates", sessionId: "not-a-session" } }, r);
    expect(r.code).toBe(401);
    expect(r.body.code).toBe("not_connected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forgets the session on disconnect", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    const id = exchange.body.sessionId;
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "disconnect", sessionId: id } }, r);
    expect(r.body.connected).toBe(false);
    expect(mod.__test.sessions.has(id)).toBe(false);
  });

  it("renews an expiring token itself, without involving the browser", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod, { expiresIn: 30 });   // inside the 60s refresh window
    fetchMock.mockResolvedValueOnce(okJson({ access_token: "AT-2", refresh_token: "RT-2", expires_in: 3600 }));
    fetchMock.mockResolvedValueOnce(okJson({ items: [], continuation: null }));
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "templates", sessionId: exchange.body.sessionId } }, r);
    expect(r.body.ok).toBe(true);
    const refresh = new URLSearchParams(fetchMock.mock.calls[1][1].body);
    expect(refresh.get("grant_type")).toBe("refresh_token");
    expect(mod.__test.sessions.get(exchange.body.sessionId).accessToken).toBe("AT-2");
    expect(JSON.stringify(r.body)).not.toContain("AT-2");
  });

  it("tells the user to reconnect when the refresh fails, and drops the session", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod, { expiresIn: 30 });
    fetchMock.mockResolvedValueOnce(errJson(400, { message: "invalid_grant" }));
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "templates", sessionId: exchange.body.sessionId } }, r);
    expect(r.code).toBe(401);
    expect(r.body.code).toBe("expired");
    expect(mod.__test.sessions.has(exchange.body.sessionId)).toBe(false);
  });

  it("asks Canva only for the templates the connected account has", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    fetchMock.mockResolvedValueOnce(okJson({ items: [{ id: "T1", title: "Stat card", thumbnail: { url: "u", width: 1200, height: 628 }, urls: {} }], continuation: "c1" }));
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "templates", sessionId: exchange.body.sessionId } }, r);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain("https://api.canva.com/rest/v1/brand-templates");
    expect(init.headers.Authorization).toBe("Bearer AT-TOKEN");
    expect(r.body.items[0]).toMatchObject({ id: "T1", title: "Stat card", width: 1200, height: 628 });
  });

  it("explains a plan refusal instead of reporting a mystery error", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    fetchMock.mockResolvedValueOnce(errJson(403, {}));
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "autofill", sessionId: exchange.body.sessionId, templateId: "T1", data: { a: { type: "text", text: "x" } } } }, r);
    expect(r.code).toBe(403);
    expect(r.body.message).toMatch(/Enterprise/i);
  });

  it("reports a rate limit as one, so the UI can say to wait", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    fetchMock.mockResolvedValueOnce(errJson(429, {}));
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "templates", sessionId: exchange.body.sessionId } }, r);
    expect(r.body.code).toBe("rate_limited");
  });

  it("base64-encodes the asset name in the header Canva documents", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "J1", status: "in_progress" } }));
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "upload", sessionId: exchange.body.sessionId, name: "logo.png", b64: Buffer.from("PNGBYTES").toString("base64") } }, r);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("https://api.canva.com/rest/v1/asset-uploads");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(JSON.parse(init.headers["Asset-Upload-Metadata"]).name_base64).toBe(Buffer.from("logo.png").toString("base64"));
    expect(Buffer.from(init.body).toString()).toBe("PNGBYTES");
    expect(r.body.jobId).toBe("J1");
  });

  it("asks for an mp4 only when a video was asked for", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E1", status: "in_progress" } }));
    let r = res();
    await h({ method: "POST", headers: {}, body: { action: "export", sessionId: exchange.body.sessionId, designId: "D1", format: "mp4" } }, r);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).format).toEqual({ type: "mp4", quality: "horizontal_1080p" });

    fetchMock.mockResolvedValueOnce(okJson({ job: { id: "E2", status: "in_progress" } }));
    r = res();
    await h({ method: "POST", headers: {}, body: { action: "export", sessionId: exchange.body.sessionId, designId: "D1", format: "png" } }, r);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).format).toEqual({ type: "png", lossless: true });
  });

  it("will not be used as an open proxy", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    for (const bad of ["http://export.canva.com/f.png", "https://evil.test/f.png", "https://canva.com.evil.test/f.png", "file:///etc/passwd"]) {
      const r = res();
      await h({ method: "POST", headers: {}, body: { action: "fetch", sessionId: exchange.body.sessionId, url: bad } }, r);
      expect(r.code, bad).toBe(400);
      expect(r.body.code, bad).toBe("bad_host");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);   // only the token exchange
  });

  it("brings a real Canva export back as bytes", async () => {
    const mod = await load();
    const { h, exchange } = await connect(mod);
    const bytes = Buffer.from("FAKEPNG");
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => bytes });
    const r = res();
    await h({ method: "POST", headers: {}, body: { action: "fetch", sessionId: exchange.body.sessionId, url: "https://export-download.canva.com/x.png" } }, r);
    expect(r.body.mime).toBe("image/png");
    expect(Buffer.from(r.body.b64, "base64").toString()).toBe("FAKEPNG");
  });

  it("rejects an unknown action rather than guessing", async () => {
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "sudo" } }, r);
    expect(r.code).toBe(400);
    expect(r.body.code).toBe("unknown_action");
  });

  it("honours a relay token when one is set", async () => {
    vi.stubEnv("UNISON_RELAY_TOKEN", "shhh");
    const mod = await load();
    const r = res();
    await mod.default({ method: "POST", headers: {}, body: { action: "start" } }, r);
    expect(r.code).toBe(401);
    expect(r.body.code).toBe("unauthorized");
  });

  it("asks Canva for no more scopes than the features need", async () => {
    const mod = await load();
    expect(mod.SCOPES).toEqual([
      "design:meta:read", "design:content:read", "design:content:write",
      "asset:read", "asset:write",
      "brandtemplate:meta:read", "brandtemplate:content:read",
    ]);
  });

  it("never writes a token or a secret to the log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await load();
    const { h, exchange } = await connect(mod);
    fetchMock.mockResolvedValueOnce(errJson(500, { message: "boom" }));
    await h({ method: "POST", headers: {}, body: { action: "templates", sessionId: exchange.body.sessionId } }, res());
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("AT-TOKEN");
    expect(logged).not.toContain("RT-TOKEN");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain(exchange.body.sessionId);
    spy.mockRestore();
  });
});
