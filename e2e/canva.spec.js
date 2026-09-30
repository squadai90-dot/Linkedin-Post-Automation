import { test, expect } from "@playwright/test";

/* The Canva design workflow, driven through the real built app in a real
 * browser with the relay intercepted.
 *
 * No live Canva call happens here, and this environment could not make one:
 * api.canva.com is unreachable from it. What this proves is everything that
 * belongs to Unison — that the OAuth round trip completes without a token
 * ever entering the page, that the suggestions shown are the ones Canva really
 * returned, that the preview is the exported file rather than a placeholder,
 * that nothing is attached until the user says so, and that a refusal from
 * Canva arrives as an explanation with a way to retry.
 */

/* A real 4x4 PNG — valid header, valid chunk CRCs. A malformed fixture once
   sent an afternoon looking for a bug in the product that was not there. */
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOo6fkPRwzEcQBDkSBxVMCyJQAAAABJRU5ErkJggg==";

const LANDSCAPE = { id: "T-STAT", title: "Statistic card — data highlight", thumbnail: "https://example.test/stat.png", width: 1200, height: 628 };
const WIDESCREEN = { id: "T-VID", title: "Statistic card motion", thumbnail: "https://example.test/vid.png", width: 1920, height: 1080 };

const quiet = async (page) => {
  for (const h of ["**://api.anthropic.com/**", "**://api.groq.com/**", "**://hook.*.make.com/**", "**://api.canva.com/**"]) await page.route(h, (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/ai", (r) => r.fulfill({ status: 404, json: {} }));
  await page.route("**/api/image", (r) => r.fulfill({ status: 404, json: {} }));
  await page.route("**/api/video", (r) => r.fulfill({ status: 404, json: {} }));
};

/* The relay, with Canva behind it. `sent` records what the page asked for, so
   a test can assert that no credential was ever posted from the browser. */
function mockRelay(page, { templates = [LANDSCAPE], fail = null, sent = [], fields = null } = {}) {
  const STATE = "STATE-E2E";
  return page.context().route("**/api/canva", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      return route.fulfill({ json: {
        service: "unison-canva-relay", version: 1, configured: true, configSource: "runtime", hasSecret: true,
        clientId: "OC-TES…", redirectUri: "http://localhost:4173/", persistence: "memory",
        memoryWarning: "Connections and any runtime configuration are held in memory and are lost when the server restarts.",
        scopes: ["design:meta:read", "design:content:read", "design:content:write", "asset:read", "asset:write", "brandtemplate:meta:read", "brandtemplate:content:read"],
        tokenRequired: false,
      } });
    }
    const body = req.postDataJSON() || {};
    sent.push(body);
    const j = (o) => route.fulfill({ json: { ok: true, ...o } });
    switch (body.action) {
      case "start": return j({ url: `https://www.canva.com/api/oauth/authorize?state=${STATE}`, state: STATE });
      case "exchange": return j({ sessionId: "SESSION-OPAQUE-E2E", scope: "brandtemplate:meta:read", expiresIn: 3600 });
      case "status": return j({ connected: true, scope: "brandtemplate:meta:read", expiresAt: Date.now() + 3600e3 });
      case "disconnect": return j({ connected: false });
      case "templates": return j({ items: templates, continuation: null });
      case "dataset": return j({ fields: fields || [{ name: "Headline", type: "text" }, { name: "sub_title", type: "text" }, { name: "Logo", type: "image" }] });
      case "autofill":
        if (fail === "autofill") return route.fulfill({ status: 403, json: { ok: false, code: "forbidden", message: "Canva refused this on the connected account's plan. Autofill and brand templates need a Canva Enterprise organisation." } });
        return j({ jobId: "JOB-1", state: "in_progress" });
      case "job": return j({ state: "done", design: { id: "DESIGN-1", title: "Unison post", editUrl: "https://www.canva.com/design/DESIGN-1/edit", viewUrl: "https://www.canva.com/design/DESIGN-1/view" } });
      case "export": return j({ jobId: "EXP-1", state: "in_progress", format: body.format === "mp4" ? "mp4" : "png" });
      case "exportJob": return j({ state: "done", urls: ["https://export-download.canva.com/out.png"] });
      case "fetch": return j({ mime: "image/png", bytes: 120, b64: PNG_B64 });
      default: return route.fulfill({ status: 400, json: { ok: false, code: "unknown_action", message: "no" } });
    }
  });
}

/* Canva's consent screen, replaced by something that does what consent does:
   send the browser back to Unison with a code and the state it was given.
   The redirect has to be absolute — inside the pop-up the current origin is
   canva.com, so a relative one would never come back to the app. */
/* Registered on the CONTEXT, not the page: a route on a page does not apply to
   the pop-up that page opens, and the pop-up is where consent happens. */
const mockConsent = (page, origin) => page.context().route("**://www.canva.com/api/oauth/authorize**", (route) => {
  const state = new URL(route.request().url()).searchParams.get("state");
  return route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><title>Canva</title><script>location.replace(${JSON.stringify(origin)} + "/?code=AUTH-CODE&state=${state}")</script>`,
  });
});

const draftWith = async (page, topic, component) => {
  await page.goto("/");
  await page.getByPlaceholder("What is this post about?").fill(topic);
  await page.getByRole("button", { name: "Start" }).click();
  await page.locator(".angle").first().click();
  await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
  await page.locator(".fmt", { hasText: component }).first().click();
  await expect(page.getByRole("heading", { name: "Media" })).toBeVisible({ timeout: 40_000 });
};

/* Settings -> AI -> Connect Canva, all the way through the pop-up. */
const connectCanva = async (page) => {
  /* Registered here so the redirect can name the origin the app is served
     from, whatever that is. */
  await mockConsent(page, new URL(page.url()).origin);
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("tab", { name: "AI" }).click();
  const card = page.locator(".conn").filter({ hasText: "Canva (template designs)" });
  await expect(card).toBeVisible();
  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Connect Canva" }).click();
  await (await popup).waitForEvent("close").catch(() => {});
  await expect(card.getByRole("button", { name: "Disconnect" })).toBeVisible({ timeout: 30_000 });
  return card;
};

const designer = (page) => page.locator("details.studio").filter({ hasText: "Design from a template" }).first();

/* What the post actually carries. The rendered preview alone is not proof of
   anything — Unison's own renderer puts a picture in the LinkedIn preview as
   soon as the Media step opens. `assets.upload` is the attachment, and it is
   the field the publishing path reads. The session save is debounced, so this
   is polled rather than read once. */
const attachment = (page) => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("unison:session:v1") || "{}")?.assets?.upload || null; }
  catch { return null; }
});

test.describe("Canva designs", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 180_000 });

  test("connects without a token reaching the browser, then suggests real templates", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message)));
    const sent = [];
    await quiet(page);
    await mockRelay(page, { sent });

    await draftWith(page, "Audit turnaround fell 38% after we moved first-pass prep offshore", "Image");

    /* connect from Settings, which is where the integration is configured */
    const card = await connectCanva(page);
    await expect(card).toContainText("Session only");
    await page.getByRole("button", { name: "Close" }).first().click().catch(() => page.keyboard.press("Escape"));

    /* nothing resembling a Canva credential is anywhere in browser storage */
    const stored = await page.evaluate(() => {
      const dump = (s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`).join("\n");
      return { local: dump(localStorage), session: dump(sessionStorage) };
    });
    for (const blob of [stored.local, stored.session]) {
      expect(blob).not.toContain("SESSION-OPAQUE-E2E");
      expect(blob).not.toContain("AUTH-CODE");
      expect(blob.toLowerCase()).not.toContain("access_token");
      expect(blob.toLowerCase()).not.toContain("client_secret");
    }
    /* and the browser never posted a secret to the relay either */
    expect(JSON.stringify(sent)).not.toContain("clientSecret\":\"cnv");

    await expect(page.getByRole("heading", { name: "Media" })).toBeVisible({ timeout: 40_000 });
    const d = designer(page);
    await d.locator("summary").click();
    await expect(d).toContainText("your 1 Canva brand template", { timeout: 30_000 });

    /* three or more options, and the Canva one is labelled as Canva's */
    const options = d.locator(".tpl");
    expect(await options.count()).toBeGreaterThanOrEqual(3);
    await expect(d.locator(".tpl", { hasText: "Statistic card — data highlight" })).toContainText("Your Canva template");
    /* the rest are honestly labelled as Unison's own, not as Canva results */
    await expect(d.locator(".tpl", { hasText: "Unison layout" }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("renders the exported file, and attaches nothing until told to", async ({ page }) => {
    const sent = [];
    await quiet(page);
    await mockRelay(page, { sent });
    await draftWith(page, "Audit turnaround fell 38% after we moved first-pass prep offshore", "Image");
    await connectCanva(page);
    await page.keyboard.press("Escape");

    const d = designer(page);
    await d.locator("summary").click();
    await d.locator(".tpl", { hasText: "Statistic card — data highlight" }).click();

    /* the template's own fields, pre-filled from the post */
    await expect(d.locator("#cv-Headline")).toHaveValue(/\S/, { timeout: 30_000 });
    /* choosing a template must not have finalized anything */
    expect(await attachment(page)).toBeNull();
    expect(sent.some((b) => b.action === "autofill")).toBe(false);

    await d.getByRole("button", { name: "Render the image" }).click();
    const preview = d.locator(".visual-frame img");
    await expect(preview).toBeVisible({ timeout: 60_000 });
    await expect(d).toContainText("This is what will be published");
    await expect(d).toContainText("Exported from Canva");

    /* the picture on screen is the bytes the relay handed back */
    expect(await preview.getAttribute("src")).toContain(PNG_B64.slice(0, 24));

    /* rendering it is still not attaching it */
    expect(await attachment(page)).toBeNull();
    await d.getByRole("button", { name: "Use this image" }).click();
    await expect(page.locator(".li-visual img").first()).toBeVisible({ timeout: 30_000 });

    /* and it arrived through the ordinary upload path, so the publishing
       contract did not have to change to carry it */
    await expect.poll(async () => (await attachment(page))?.name, { timeout: 20_000 }).toMatch(/^canva-image-\d+\.png$/);
    expect((await attachment(page)).type).toBe("image/png");
    expect((await attachment(page)).data).toContain("data:image/png;base64,");
  });

  test("explains a plan refusal and offers a retry rather than failing silently", async ({ page }) => {
    await quiet(page);
    await mockRelay(page, { fail: "autofill" });
    await draftWith(page, "Audit turnaround fell 38% after we moved first-pass prep offshore", "Image");
    await connectCanva(page);
    await page.keyboard.press("Escape");

    const d = designer(page);
    await d.locator("summary").click();
    await d.locator(".tpl", { hasText: "Statistic card — data highlight" }).click();
    await expect(d.locator("#cv-Headline")).toHaveValue(/\S/, { timeout: 30_000 });
    await d.getByRole("button", { name: "Render the image" }).click();

    await expect(d.locator(".badge.bad")).toContainText(/Enterprise/i, { timeout: 40_000 });
    await expect(d.getByRole("button", { name: "Try again" })).toBeVisible();
    /* a failure is never dressed up as a result */
    expect(await d.locator(".visual-frame img").count()).toBe(0);
    expect(await d.getByRole("button", { name: /^Use this/ }).count()).toBe(0);
    expect(await attachment(page)).toBeNull();
  });

  test("marks template video unavailable rather than showing a control that cannot work", async ({ page }) => {
    await quiet(page);
    /* the account owns only a landscape template, which cannot become a 16:9 video */
    await mockRelay(page, { templates: [LANDSCAPE] });
    await draftWith(page, "Audit turnaround fell 38% after we moved first-pass prep offshore", "Video");
    await connectCanva(page);
    await page.keyboard.press("Escape");

    const d = designer(page);
    await d.locator("summary").click();
    await expect(d).toContainText("Template video is not available for this post", { timeout: 30_000 });
    await expect(d).toContainText("cannot generate original footage");
    expect(await d.locator(".tpl").count()).toBe(0);
    expect(await d.getByRole("button", { name: /^Render/ }).count()).toBe(0);
  });

  test("exports an mp4 when the account has a 16:9 template", async ({ page }) => {
    const sent = [];
    await quiet(page);
    await mockRelay(page, { templates: [WIDESCREEN], sent });
    await draftWith(page, "Audit turnaround fell 38% after we moved first-pass prep offshore", "Video");
    await connectCanva(page);
    await page.keyboard.press("Escape");

    const d = designer(page);
    await d.locator("summary").click();
    await expect(d.locator(".tpl", { hasText: "Statistic card motion" })).toContainText("Your Canva template", { timeout: 30_000 });
    await d.locator(".tpl", { hasText: "Statistic card motion" }).click();
    await expect(d.locator("#cv-Headline")).toHaveValue(/\S/, { timeout: 30_000 });

    /* scenes and timing belong to the template, and that is said rather than
       offered as a control */
    await expect(d).toContainText("Scenes, transitions, animation and timing");

    await d.getByRole("button", { name: "Render the video" }).click();
    await expect(d).toContainText("This is what will be published", { timeout: 60_000 });
    expect(sent.find((b) => b.action === "export")?.format).toBe("mp4");
  });

  test("says so plainly when Canva is not connected, and still offers layouts", async ({ page }) => {
    await quiet(page);
    await page.route("**/api/canva", (r) => r.fulfill({ status: 404, json: {} }));
    await draftWith(page, "Three things that slow a year-end close", "Image");

    const d = designer(page);
    await d.locator("summary").click();
    await expect(d).toContainText("There is no backend here", { timeout: 30_000 });
    const options = d.locator(".tpl");
    expect(await options.count()).toBeGreaterThanOrEqual(3);
    /* every option is Unison's own — none is dressed up as a Canva template */
    expect(await d.locator(".tpl", { hasText: "Your Canva template" }).count()).toBe(0);
  });
});
