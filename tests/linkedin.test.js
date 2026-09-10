/* The LinkedIn bridge and the direct publish route. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { saveLinkedInSettings, loadLinkedInSettings, bridgeTarget, bridgeHealth, resetBridgeProbe, isBridgeConfigured, LI_RELAY_PATH, connectionFromToken, normalizeOrgs } from "../src/lib/linkedinAuth.js";
import { directLinkedInService, publishRoute, DIRECT_POST_TYPES } from "../src/lib/publish.js";

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
const bridgeUp = () => res(200, { service: "unison-linkedin-bridge", version: 1, configured: true, actions: ["exchange", "publish"] });

const connected = () => saveLinkedInSettings({
  clientId: "abc",
  connection: connectionFromToken({ accessToken: "li_tok", expiresIn: 3600, organizations: [{ urn: "urn:li:organization:1", name: "Acme" }], via: "bridge" }),
});

beforeEach(() => { localStorage.clear(); loadLinkedInSettings(); resetBridgeProbe(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("choosing a bridge", () => {
  it("uses the deployed one with no configuration at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bridgeUp()));
    await bridgeHealth();
    expect(bridgeTarget()).toEqual({ url: LI_RELAY_PATH, kind: "built-in" });
    expect(isBridgeConfigured()).toBe(true);
  });

  it("lets an explicit URL win over the built-in one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bridgeUp()));
    await bridgeHealth();
    saveLinkedInSettings({ bridgeUrl: "https://hook.eu1.make.com/abc" });
    expect(bridgeTarget().kind).toBe("custom");
  });

  it("reports none when the endpoint is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(404, {})));
    await bridgeHealth();
    expect(bridgeTarget().kind).toBe("none");
    expect(isBridgeConfigured()).toBe(false);
  });

  it("reports none when the function is deployed without a client secret", async () => {
    // "Deployed but unconfigured" must not read as usable, or sign-in fails
    // with a confusing error instead of a clear one.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(200, { service: "unison-linkedin-bridge", configured: false })));
    await bridgeHealth();
    expect(bridgeTarget().kind).toBe("none");
  });
});

describe("posting straight to LinkedIn", () => {
  it("only claims the post types it can actually complete", () => {
    // Image, video and document posts need an upload handshake first, so they
    // stay with Make rather than half-working here.
    expect(DIRECT_POST_TYPES).toEqual(["text", "article"]);
    expect(directLinkedInService.supports("text")).toBe(true);
    expect(directLinkedInService.supports("image")).toBe(false);
  });

  it("needs a bridge, a token and a Page before it offers to go direct", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bridgeUp()));
    expect(await directLinkedInService.available({ postType: "text" })).toBe(false); // no connection yet
    connected();
    expect(await directLinkedInService.available({ postType: "text", companyUrn: "urn:li:organization:1" })).toBe(true);
    expect(await directLinkedInService.available({ postType: "image", companyUrn: "urn:li:organization:1" })).toBe(false);
  });

  it("sends the post and returns what LinkedIn said", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(bridgeUp())
      .mockResolvedValueOnce(res(200, { published: true, urn: "urn:li:share:99", url: "https://www.linkedin.com/feed/update/urn:li:share:99/" }));
    vi.stubGlobal("fetch", fetchMock);
    connected();

    const r = await directLinkedInService.publish({ postId: "p1", postType: "text", content: "Hello", companyUrn: "urn:li:organization:1" });
    expect(r.published).toBe(true);
    expect(r.urn).toBe("urn:li:share:99");
    expect(r.transport).toBe("linkedin");

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.action).toBe("publish");
    expect(body.author).toBe("urn:li:organization:1");
    expect(body.text).toBe("Hello");
    expect(body.access_token).toBe("li_tok");
  });

  it("attaches an article link when the post has one", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bridgeUp()).mockResolvedValueOnce(res(200, { published: true, urn: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    connected();
    await directLinkedInService.publish({ postId: "p", postType: "article", content: "Read this", companyUrn: "urn:li:organization:1", article: { url: "https://acme.com/post", title: "T" } });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.link).toBe("https://acme.com/post");
    expect(body.linkTitle).toBe("T");
  });

  it("names an expired token as something to fix, not a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(bridgeUp()).mockResolvedValueOnce(res(401, { error: "token expired" })));
    connected();
    await expect(directLinkedInService.publish({ postType: "text", content: "x", companyUrn: "urn:li:organization:1" }))
      .rejects.toThrow(/Reconnect under Settings/);
  });

  it("separates being unable to post to a Page from being signed out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(bridgeUp()).mockResolvedValueOnce(res(403, { error: "not an admin" })));
    connected();
    await expect(directLinkedInService.publish({ postType: "text", content: "x", companyUrn: "urn:li:organization:1" }))
      .rejects.toMatchObject({ kind: "li-permission" });
  });

  it("refuses to post with no Page selected rather than guessing one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bridgeUp()));
    saveLinkedInSettings({ clientId: "abc", connection: connectionFromToken({ accessToken: "t", organizations: [] }) });
    await expect(directLinkedInService.publish({ postType: "text", content: "x" })).rejects.toThrow(/No Company Page/);
  });
});

describe("choosing a route", () => {
  it("goes direct when it can", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bridgeUp()));
    connected();
    expect(await publishRoute({ postType: "text", companyUrn: "urn:li:organization:1" })).toBe("linkedin");
  });

  it("falls to the publishing relay for a post type LinkedIn needs an upload for", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) =>
      String(url).includes("linkedin") ? bridgeUp() : res(200, { service: "unison-publish-relay" })));
    connected();
    expect(await publishRoute({ postType: "image", companyUrn: "urn:li:organization:1" })).toBe("relay");
  });

  it("reports none when nothing at all is configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(404, {})));
    expect(["make", "none"]).toContain(await publishRoute({ postType: "video" }));
  });
});

describe("organizations", () => {
  it("keeps only Pages this account can actually post to", () => {
    const orgs = normalizeOrgs([
      { urn: "urn:li:organization:1", name: "Acme", role: "ADMINISTRATOR" },
      { urn: "urn:li:organization:2", name: "Read only", role: "ANALYST" },
      { nonsense: true },
    ]);
    expect(orgs).toHaveLength(2);
    expect(orgs[0].canPublish).toBe(true);
    expect(orgs[1].canPublish).toBe(false);   // listed, but not offered as a target
  });

  it("selects the only Page automatically and leaves a choice open otherwise", () => {
    expect(connectionFromToken({ accessToken: "t", organizations: [{ urn: "urn:li:organization:1", name: "One" }] }).selectedUrn).toBe("urn:li:organization:1");
    expect(connectionFromToken({ accessToken: "t", organizations: [{ urn: "urn:li:organization:1" }, { urn: "urn:li:organization:2" }] }).selectedUrn).toBeNull();
  });
});
