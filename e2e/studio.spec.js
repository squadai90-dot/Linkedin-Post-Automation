import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/* The design studio, driven through the real built app in a real browser.
 *
 * Every relay is intercepted. No live Canva, OpenAI, Google or Runway call is
 * made — this environment cannot reach those services, and a test that
 * claimed otherwise would be lying. What these tests prove is everything that
 * belongs to Unison:
 *
 *   — the four required scenarios get designs that fit them (a Navratri
 *     greeting gets festival designs, a launch gets launch designs …);
 *   — quick edits change the actual design, survive switching option and
 *     reloading, and nothing is attached until the user says so;
 *   — the Canva round trip creates a design, opens Canva's editor with a
 *     return marker, and on return EXPORTS the edited design without
 *     refilling it;
 *   — a video is only offered once a real MP4 has come back and this browser
 *     has decoded its duration; a file that is not one is refused;
 *   — no Canva credential ever reaches the page.
 */

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOo6fkPRwzEcQBDkSBxVMCyJQAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_B64, "base64");
/* A real 2.2-second MP4 (VP9), recorded by this same Chromium, so the browser
   can genuinely decode its duration. */
const MP4 = readFileSync(new URL("./fixtures/clip.mp4", import.meta.url));

const PROFILE = {
  company: "Acme Advisory", website: "acme.example", followers: "", userName: "",
  industry: "Finance and accounting outsourcing", audience: "CPA firm partners", keywords: "outsourced accounting",
};

const quiet = async (page) => {
  for (const h of ["**://api.anthropic.com/**", "**://api.groq.com/**", "**://hook.*.make.com/**", "**://api.canva.com/**", "**://commons.wikimedia.org/**"]) await page.route(h, (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/ai**", (r) => r.fulfill({ status: 404, json: {} }));
  await page.route("**/api/image**", (r) => r.fulfill({ status: 404, json: {} }));
};

const noVideoRelay = (page) => page.route("**/api/video**", (r) => r.fulfill({ status: 404, json: {} }));
const noCanvaRelay = (page) => page.route("**/api/canva**", (r) => r.fulfill({ status: 404, json: {} }));

/* The Canva relay as deployed: sessions in an HttpOnly cookie the page never
   sees, so nothing here returns a token. `sent` records every call. */
function mockCanva(page, { templates = [], designs = [], sent = [], exportFile = PNG, exportType = "image/png", formats = ["png", "jpg", "pdf", "mp4"], failAutofill = false } = {}) {
  let exportFormat = "png";
  return page.context().route("**/api/canva**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "GET") {
      return route.fulfill({ json: {
        service: "unison-canva-relay", version: 2, configured: true, configSource: "env", hasSecret: true,
        clientId: "OC-TES…", redirectUri: "http://localhost:4173/", persistence: "cookie",
        scopes: ["design:meta:read", "design:content:read", "design:content:write", "asset:read", "asset:write", "brandtemplate:meta:read", "brandtemplate:content:read"],
        tokenRequired: false,
      } });
    }
    if (url.searchParams.get("action") === "upload") {
      sent.push({ action: "upload", type: req.headers()["content-type"], bytes: (req.postDataBuffer() || Buffer.alloc(0)).length });
      return route.fulfill({ json: { ok: true, jobId: "UP-1", state: "in_progress" } });
    }
    const body = req.postDataJSON() || {};
    sent.push(body);
    const j = (o) => route.fulfill({ json: { ok: true, ...o } });
    switch (body.action) {
      case "start": return j({ url: "https://www.canva.com/api/oauth/authorize?state=STATE-E2E", state: "STATE-E2E" });
      case "exchange": return j({ connected: true, scope: "design:content:write", expiresIn: 3600 });
      case "status": return j({ connected: sent.some((b) => b.action === "exchange"), scope: "design:content:write", expiresAt: Date.now() + 3600e3 });
      case "disconnect": return j({ connected: false });
      case "templates": return j({ items: templates, continuation: null });
      case "dataset": return j({ fields: [{ name: "Headline", type: "text" }, { name: "sub_title", type: "text" }] });
      case "autofill":
        if (failAutofill) return route.fulfill({ status: 403, json: { ok: false, code: "forbidden", message: "Canva refused this on the connected account's plan. Brand templates and Autofill are available to Canva Enterprise organisations." } });
        return j({ jobId: "JOB-1", state: "in_progress" });
      case "job": return j({ state: "done", design: { id: "DESIGN-AF", title: "Filled design", editUrl: "https://www.canva.com/design/DESIGN-AF/edit" } });
      case "uploadJob": return j({ state: "done", assetId: "ASSET-1" });
      case "createDesign": return j({ design: { id: "DESIGN-NEW", title: body.title, editUrl: "https://www.canva.com/design/DESIGN-NEW/edit", viewUrl: "https://www.canva.com/design/DESIGN-NEW/view" } });
      case "designs": return j({ items: designs, continuation: null });
      case "exportFormats": return j({ formats });
      case "export": exportFormat = body.format; return j({ jobId: "EXP-1", state: "in_progress", format: body.format === "mp4" ? "mp4" : "png" });
      case "exportJob": return j({ state: "done", files: 1 });
      case "download": return route.fulfill({ status: 200, contentType: exportType, body: exportFile, headers: { "x-unison-kind": exportFormat } });
      default: return route.fulfill({ status: 400, json: { ok: false, code: "unknown_action", message: "no" } });
    }
  });
}

/* Canva's consent page, replaced by what consent does: send the browser back
   with a code and the state it was given. */
const mockConsent = (page, origin) => page.context().route("**://www.canva.com/api/oauth/authorize**", (route) => {
  const state = new URL(route.request().url()).searchParams.get("state");
  return route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Canva</title><script>location.replace(${JSON.stringify(origin)} + "/?code=AUTH-CODE&state=${state}")</script>` });
});
/* Canva's editor, replaced by a page that stays put. */
const mockEditor = (page) => page.context().route("**://www.canva.com/design/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Canva editor</title><p>editor</p>" }));

const start = async (page, topic, format) => {
  await page.goto("/");
  await page.evaluate((profile) => { localStorage.clear(); localStorage.setItem("unison:session:v1", JSON.stringify({ profile })); }, PROFILE);
  await page.goto("/");
  await page.getByPlaceholder("What is this post about?").fill(topic);
  await page.getByRole("button", { name: "Start" }).click();
  await page.locator(".angle").first().click({ timeout: 40_000 });
  await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
  await page.locator(".fmt", { hasText: format }).first().click();
  const studio = page.getByTestId(`studio-${format.toLowerCase()}`);
  await expect(studio).toBeVisible({ timeout: 40_000 });
  return studio;
};

const connectCanva = async (page) => {
  await mockConsent(page, new URL(page.url()).origin);
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("tab", { name: "AI" }).click();
  const card = page.locator(".conn").filter({ hasText: "Canva (template designs)" });
  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Connect Canva" }).click();
  await (await popup).waitForEvent("close").catch(() => {});
  await expect(card.getByRole("button", { name: "Disconnect" })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
};

const session = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("unison:session:v1") || "{}"); } catch { return {}; } });
const optionNames = async (studio) => studio.getByTestId("studio-options").locator(".tpl-name").allInnerTexts();

test.describe("Design studio", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 180_000 });

  test("Navratri greeting: festival designs, real quick edits, nothing attached until asked", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await quiet(page); await noCanvaRelay(page); await noVideoRelay(page);
    const studio = await start(page, "Navratri greetings", "Image");

    await expect(studio.getByTestId("visual-brief")).toContainText("Navratri");
    await expect(studio.getByTestId("visual-brief")).toContainText("greeting, not a sales message");
    expect(await optionNames(studio)).toEqual(["Elegant traditional", "Premium corporate", "Colourful celebratory", "Modern minimal"]);
    /* honest labels: these are Unison's, and nothing pretends to be Canva's */
    expect(await studio.getByTestId("studio-options").locator(".badge", { hasText: "Your Canva template" }).count()).toBe(0);
    await expect(studio.getByTestId("studio-source")).toContainText("Unison designs");

    const preview = studio.getByTestId("studio-preview");
    await expect(preview).toContainText("Happy Navratri");
    await expect(preview).toContainText("Warm wishes from Acme Advisory");
    /* a festival design is not a slab of text: the occasion's art is drawn */
    expect(await preview.locator("svg circle").count()).toBeGreaterThan(20);

    /* nothing attached merely by opening the studio */
    expect((await session(page)).assets?.upload || null).toBeNull();

    /* words */
    await studio.locator("#qe-headline").fill("Shubh Navratri");
    await expect(preview).toContainText("Shubh Navratri");
    /* colours */
    await studio.getByTestId("colour-bg1").fill("#123456");
    await expect.poll(async () => (await preview.innerHTML()).includes("#123456")).toBe(true);
    /* arrangement and type */
    const before = await preview.getAttribute("data-sig");
    await studio.getByRole("button", { name: "Text right" }).click();
    await expect.poll(() => preview.getAttribute("data-sig")).not.toBe(before);
    await studio.getByRole("button", { name: "Clean sans" }).click();
    await expect.poll(async () => (await preview.innerHTML()).includes("Helvetica")).toBe(true);

    /* switching option keeps the words the user wrote */
    await studio.getByTestId("studio-options").locator(".tpl", { hasText: "Modern minimal" }).click();
    await expect(preview).toContainText("Shubh Navratri");
    await studio.getByTestId("studio-options").locator(".tpl", { hasText: "Elegant traditional" }).click();
    await expect.poll(async () => (await preview.innerHTML()).includes("#123456")).toBe(true);

    /* attach, explicitly */
    await studio.getByTestId("use-design").click();
    await expect(studio.getByTestId("attached-ok")).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await session(page)).assets?.upload?.type || null, { timeout: 10_000 }).toMatch(/^image\//);

    /* a later edit is flagged as not yet attached, rather than silently out of date */
    await studio.locator("#qe-headline").fill("Happy Navratri to all");
    await expect(studio.getByTestId("attached-stale")).toBeVisible();

    /* edits survive a reload */
    await expect.poll(async () => (await session(page)).assets?.designStudio?.image?.edits?.headline || "", { timeout: 10_000 }).toBe("Happy Navratri to all");
    await page.reload();
    const again = page.getByTestId("studio-image");
    await expect(again).toBeVisible({ timeout: 40_000 });
    await expect(again.locator("#qe-headline")).toHaveValue("Happy Navratri to all");
    await expect.poll(async () => (await again.getByTestId("studio-preview").innerHTML()).includes("#123456")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("design edits survive switching what the post is for", async ({ page }) => {
    await quiet(page); await noCanvaRelay(page); await noVideoRelay(page);
    const studio = await start(page, "Navratri greetings", "Image");
    await studio.locator("#qe-headline").fill("Shubh Navratri");
    await studio.getByTestId("colour-accent").fill("#00AA55");
    await expect.poll(async () => (await session(page)).assets?.designStudio?.image?.edits?.headline || "", { timeout: 10_000 }).toBe("Shubh Navratri");

    /* switch the festival post from a greeting to its history and culture */
    await page.getByTestId("intent-bar").getByRole("button", { name: "History & culture" }).click();
    await page.locator(".angle").first().click({ timeout: 40_000 });
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
    const again = page.getByTestId("studio-image");
    /* the post keeps its format across the re-run; choose it only if it did not */
    await page.waitForTimeout(1000);
    if (!(await again.isVisible())) await page.locator(".fmt", { hasText: "Image" }).first().click();
    await expect(again).toBeVisible({ timeout: 40_000 });
    await expect(again.locator("#qe-headline")).toHaveValue("Shubh Navratri");
    await expect.poll(async () => (await again.getByTestId("studio-preview").innerHTML()).includes("#00AA55")).toBe(true);
    await expect(again.getByTestId("visual-brief")).toContainText(/history and culture/i);
  });

  test("Diwali greeting gets Diwali's own designs, not a generic card", async ({ page }) => {
    await quiet(page); await noCanvaRelay(page); await noVideoRelay(page);
    const studio = await start(page, "Diwali wishes to our clients", "Image");
    await expect(studio.getByTestId("visual-brief")).toContainText("Diwali");
    expect(await optionNames(studio)).toEqual(["Elegant traditional", "Premium corporate", "Colourful celebratory", "Modern minimal"]);
    await expect(studio.getByTestId("studio-preview")).toContainText("Happy Diwali");
    /* the brief rules out a sales message on a greeting */
    await expect(studio.getByTestId("visual-brief")).toContainText("Offers or calls to buy");
  });

  test("product launch: launch designs, with your own picture placed and cropped", async ({ page }) => {
    await quiet(page); await noCanvaRelay(page); await noVideoRelay(page);
    const studio = await start(page, "We are launching Unison Payroll Assist", "Image");
    const names = await optionNames(studio);
    expect(names[0]).toBe("Product spotlight");
    expect(names).toContain("Launch announcement");
    await expect(studio.getByTestId("studio-preview")).toContainText("Unison Payroll");
    await expect(studio.getByTestId("studio-preview")).toContainText("INTRODUCING");

    await studio.getByTestId("studio-photo-input").setInputFiles({ name: "product.png", mimeType: "image/png", buffer: PNG });
    await expect(studio.getByTestId("photo-controls")).toBeVisible({ timeout: 10_000 });
    const preview = studio.getByTestId("studio-preview");
    await expect.poll(async () => (await preview.innerHTML()).includes("data:image/jpeg")).toBe(true);
    const before = await preview.getAttribute("data-sig");
    await studio.getByLabel("Zoom").fill("2");
    await expect.poll(() => preview.getAttribute("data-sig")).not.toBe(before);
    /* AI artwork is off without a server key, and says which key */
    await expect(studio.getByText("AI artwork is off")).toContainText("OPENAI_API_KEY");
  });

  test("company milestone: the number from the topic, and nothing invented", async ({ page }) => {
    await quiet(page); await noCanvaRelay(page); await noVideoRelay(page);
    const studio = await start(page, "Celebrating 10 years of Acme Advisory", "Image");
    const names = await optionNames(studio);
    expect(names[0]).toBe("Big number");
    expect(names).toContain("Thank-you card");
    await expect(studio.getByTestId("studio-preview")).toContainText("10");
    await expect(studio.getByTestId("studio-preview")).toContainText("YEARS");
    await expect(studio.getByTestId("visual-brief")).toContainText("as your post states it");
  });

  test("Canva round trip: edit in Canva, come back, and the edited design is exported — never refilled", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const sent = [];
    await quiet(page); await noVideoRelay(page);
    await mockCanva(page, { sent });
    await mockEditor(page);
    const studio = await start(page, "Navratri greetings", "Image");
    await connectCanva(page);
    await expect(studio.getByTestId("studio-source")).toContainText("Canva is connected", { timeout: 20_000 });
    await expect(studio.getByTestId("studio-source")).toContainText("no endpoint for searching Canva's public library");

    const editor = page.waitForEvent("popup");
    await studio.getByTestId("edit-in-canva").click();
    const tab = await editor;
    await tab.waitForURL(/canva\.com\/design\/DESIGN-NEW\/edit/, { timeout: 30_000 });
    const marker = new URL(tab.url()).searchParams.get("correlation_state");
    expect(marker).toBeTruthy();

    /* the design was sent as raw bytes, then a design of the right size made */
    const up = sent.find((b) => b.action === "upload");
    expect(up.type).toBe("application/octet-stream");
    expect(up.bytes).toBeGreaterThan(1000);
    const made = sent.find((b) => b.action === "createDesign");
    expect([made.width, made.height, made.assetId]).toEqual([1200, 630, "ASSET-1"]);
    await expect(studio.getByTestId("canva-ref")).toContainText("made from a Unison design");

    /* Canva sends the user back to the Return URL with a signed JWT that
       carries the marker. The app picks it up and fetches the design. */
    const payload = Buffer.from(JSON.stringify({ correlation_state: marker })).toString("base64url");
    await tab.goto(`/?correlation_jwt=e30.${payload}.sig`);
    await expect(studio.getByTestId("studio-output")).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByTestId("output-meta")).toContainText("From Canva");
    await expect(studio.getByTestId("output-meta")).toContainText("4 × 4");
    expect(sent.filter((b) => b.action === "export").length).toBeGreaterThanOrEqual(1);
    expect(sent.some((b) => b.action === "autofill")).toBe(false);

    /* and the manual way back works too, still without refilling */
    await studio.getByTestId("bring-back").click();
    await expect(studio.getByTestId("studio-busy")).toBeHidden({ timeout: 30_000 });
    expect(sent.some((b) => b.action === "autofill")).toBe(false);

    await studio.getByTestId("use-output").click();
    await expect.poll(async () => (await session(page)).assets?.upload?.type || null, { timeout: 10_000 }).toMatch(/^image\//);

    /* no credential anywhere the page can read */
    const stored = await page.evaluate(() => [localStorage, sessionStorage].map((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`).join("\n")).join("\n"));
    expect(stored).not.toContain("AUTH-CODE");
    expect(stored.toLowerCase()).not.toContain("access_token");
    expect(stored.toLowerCase()).not.toContain("refresh_token");
    expect(errors).toEqual([]);
  });

  test("brand templates are shown as Canva's only when Canva returns them, and a plan refusal is explained", async ({ page }) => {
    const sent = [];
    await quiet(page); await noVideoRelay(page);
    await mockCanva(page, { sent, failAutofill: true, templates: [{ id: "T-GREET", title: "Festival greeting card", thumbnail: null, width: 1200, height: 628 }] });
    const studio = await start(page, "Diwali wishes to our clients", "Image");
    await connectCanva(page);
    const canvaOpt = studio.getByTestId("studio-options").locator(".tpl", { hasText: "Festival greeting card" });
    await expect(canvaOpt).toContainText("Your Canva template", { timeout: 20_000 });
    await canvaOpt.click();
    const editor = studio.getByTestId("canva-template-editor");
    await expect(editor.getByLabel("Headline")).toHaveValue(/Happy Diwali/, { timeout: 20_000 });
    await editor.getByTestId("fill-canva").click();
    await expect(studio.getByTestId("studio-error")).toContainText("Enterprise");
    expect((await session(page)).assets?.upload || null).toBeNull();
  });

  test("a file that is not what Canva claimed is refused, and nothing is attached", async ({ page }) => {
    await quiet(page); await noVideoRelay(page);
    await mockCanva(page, { exportFile: Buffer.from("<html>not an image</html>"), exportType: "image/png", designs: [{ id: "D-OLD", title: "Old design", editUrl: "https://www.canva.com/design/D-OLD/edit" }] });
    const studio = await start(page, "Navratri greetings", "Image");
    await connectCanva(page);
    await studio.getByTestId("my-designs").click();
    await studio.getByTestId("design-picker").locator(".tpl", { hasText: "Old design" }).click();
    await expect(studio.getByTestId("studio-error")).toContainText("not an image or a video", { timeout: 30_000 });
    await expect(studio.getByTestId("studio-output")).toHaveCount(0);
    expect((await session(page)).assets?.upload || null).toBeNull();
  });

  test("video from Canva: the preview is the exported MP4 with a real duration", async ({ page }) => {
    const sent = [];
    await quiet(page); await noVideoRelay(page);
    await mockCanva(page, { sent, exportFile: MP4, exportType: "video/mp4", designs: [{ id: "D-VID", title: "Diwali reel", editUrl: "https://www.canva.com/design/D-VID/edit" }] });
    const studio = await start(page, "Diwali wishes to our clients", "Video");
    await connectCanva(page);
    await studio.getByTestId("my-designs").click();
    await studio.getByTestId("design-picker").locator(".tpl", { hasText: "Diwali reel" }).click();
    await expect(studio.getByTestId("output-video")).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByTestId("output-meta")).toContainText("video/mp4");
    await expect(studio.getByTestId("output-meta")).toContainText(/2\.\d s/);
    const exp = sent.find((b) => b.action === "export");
    expect([exp.format, exp.quality]).toEqual(["mp4", "horizontal_720p"]);
    await studio.getByTestId("use-output").click();
    await expect(page.locator(".li-visual video")).toHaveAttribute("src", /^data:video\/mp4/, { timeout: 15_000 });
  });

  test("video: a design Canva cannot export as MP4 is refused before anything is shown", async ({ page }) => {
    await quiet(page); await noVideoRelay(page);
    await mockCanva(page, { formats: ["png", "jpg", "pdf"], designs: [{ id: "D-STILL", title: "Still poster", editUrl: "https://www.canva.com/design/D-STILL/edit" }] });
    const studio = await start(page, "Diwali wishes to our clients", "Video");
    await connectCanva(page);
    await studio.getByTestId("my-designs").click();
    await studio.getByTestId("design-picker").locator(".tpl", { hasText: "Still poster" }).click();
    await expect(studio.getByTestId("studio-error")).toContainText("cannot be exported as an MP4");
    await expect(studio.getByTestId("studio-output")).toHaveCount(0);
  });

  test("AI footage: generated, downloaded, checked and played before it can be used", async ({ page }) => {
    const calls = [];
    await quiet(page); await noCanvaRelay(page);
    await page.route("**/api/video**", async (route) => {
      const req = route.request();
      if (req.method() === "GET") return route.fulfill({ json: { service: "unison-video-relay", version: 2, configured: true, providers: { google: true, runway: false }, defaultProvider: "google", pricing: { google: { usdPerSecond: 0.05, maxSeconds: 8, model: "veo-test" } } } });
      const body = req.postDataJSON() || {};
      calls.push(body);
      if (body.action === "status") return route.fulfill({ json: { ok: true, provider: "google", state: "done", mime: "video/mp4" } });
      if (body.action === "download") return route.fulfill({ status: 200, contentType: "video/mp4", body: MP4 });
      return route.fulfill({ status: 202, json: { ok: true, provider: "google", model: "veo-test", id: "operations/1", seconds: body.seconds, usd: 0.4, state: "running" } });
    });
    const studio = await start(page, "Navratri greetings", "Video");
    const ai = studio.getByTestId("ai-footage");
    await expect(ai.getByTestId("make-clip")).toContainText("$0.40");
    await expect(ai.getByLabel("What the footage should show")).toHaveValue(/garba/);
    await ai.getByTestId("make-clip").click();
    await expect(studio.getByTestId("output-video")).toBeVisible({ timeout: 60_000 });
    await expect(studio.getByTestId("output-meta")).toContainText("AI-generated footage — google/veo-test");
    await expect(studio.getByTestId("output-meta")).toContainText(/2\.\d s/);
    expect(calls.map((c) => c.action || "start")).toEqual(["start", "status", "download"]);
  });

  test("AI footage that is not a video is refused, with the reason", async ({ page }) => {
    await quiet(page); await noCanvaRelay(page);
    await page.route("**/api/video**", async (route) => {
      const req = route.request();
      if (req.method() === "GET") return route.fulfill({ json: { configured: true, providers: { google: true }, defaultProvider: "google", pricing: { google: { usdPerSecond: 0.05, maxSeconds: 8, model: "veo-test" } } } });
      const body = req.postDataJSON() || {};
      if (body.action === "status") return route.fulfill({ json: { ok: true, provider: "google", state: "done" } });
      if (body.action === "download") return route.fulfill({ status: 200, contentType: "video/mp4", body: PNG });
      return route.fulfill({ status: 202, json: { ok: true, provider: "google", model: "veo-test", id: "operations/1", seconds: 8, usd: 0.4, state: "running" } });
    });
    const studio = await start(page, "Navratri greetings", "Video");
    await studio.getByTestId("make-clip").click();
    await expect(studio.getByTestId("studio-error")).toContainText("A video was expected", { timeout: 60_000 });
    await expect(studio.getByTestId("studio-output")).toHaveCount(0);
  });

  test("with no video key on the server, the studio names the variables to set", async ({ page }) => {
    await quiet(page); await noCanvaRelay(page);
    await page.route("**/api/video**", (r) => r.fulfill({ json: { service: "unison-video-relay", configured: false, providers: { google: false, runway: false }, defaultProvider: null, pricing: {} } }));
    const studio = await start(page, "Celebrating 10 years of Acme Advisory", "Video");
    await expect(studio.getByTestId("ai-footage-off")).toContainText("GOOGLE_API_KEY");
    await expect(studio.getByTestId("ai-footage-off")).toContainText("RUNWAY_API_KEY");
    /* and the opening frame is honestly called a still */
    await expect(studio).toContainText("It is a still picture, not a video.");
  });
});
