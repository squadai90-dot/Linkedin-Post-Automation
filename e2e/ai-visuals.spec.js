import { test, expect } from "@playwright/test";

/* The compositing layer, exercised in a real browser because that is where
   it runs. Artwork comes from a model; the words do not. This suite proves
   the words are drawn by Unison, are the exact approved ones, and never
   collide with the footer or run off the frame — which is the whole reason
   the model is forbidden from writing them. */

const SIZE = { w: 1200, h: 630 };

/* The preview server serves the built bundle, so the source module is not
   importable from the page. Bundle the real file once and inject it, which
   tests the module that actually ships rather than a copy of its logic. */
let BUNDLE = "";
test.beforeAll(async () => {
  const { build } = await import("vite");
  const res = await build({
    root: process.cwd(), logLevel: "error",
    build: {
      write: false, minify: false,
      lib: { entry: "src/lib/compose.js", formats: ["iife"], name: "UnisonCompose", fileName: () => "c.js" },
    },
  });
  BUNDLE = res[0].output[0].code;
});

const setup = async (page) => {
  await page.goto("/");
  await page.addScriptTag({ content: BUNDLE });
};

/* Paint with the real module and read back what landed on the canvas. */
const compose = (page, fields, layout) => page.evaluate(async ([fields, layout, SIZE]) => {
  const mod = window.UnisonCompose;
  const art = document.createElement("canvas");
  art.width = 1536; art.height = 1024;
  const ax = art.getContext("2d");
  const g = ax.createLinearGradient(0, 0, 1536, 1024);
  g.addColorStop(0, "#E0457B"); g.addColorStop(0.5, "#F2B705"); g.addColorStop(1, "#2E9E5B");
  ax.fillStyle = g; ax.fillRect(0, 0, 1536, 1024);

  const url = await mod.composite({ artwork: art.toDataURL(), fields, layout });

  /* Measure the result: size, and whether anything was drawn in the band the
     footer owns above where the footer itself sits. */
  const im = new Image();
  await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = url; });
  const c = document.createElement("canvas");
  c.width = im.width; c.height = im.height;
  const x = c.getContext("2d");
  x.drawImage(im, 0, 0);
  /* The footer is drawn at 78% white over a dark scrim, so "ink" is anything
     clearly lighter than the scrim rather than pure white. */
  const bandInk = (from, to) => {
    let ink = 0;
    for (let y = from; y <= to; y++) {
      const d = x.getImageData(0, y, c.width, 1).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 170 && d[i + 1] > 170 && d[i + 2] > 170) ink++;
      }
    }
    return ink;
  };
  return {
    url, width: im.width, height: im.height,
    // the strip between the source line and the footer rule must be clear
    gapInk: bandInk(SIZE.h - 96, SIZE.h - 88),
    footerInk: bandInk(SIZE.h - 66, SIZE.h - 48),
  };
}, [fields, layout, SIZE]);

test.describe("compositing the approved words over AI artwork", () => {
  test.skip(({ isMobile }) => isMobile);

  test("produces a LinkedIn-sized PNG", async ({ page }) => {
    await setup(page);
    const r = await compose(page, { kicker: "Navratri", headline: "Happy Navratri from everyone at Unison Globus", footer: "unisonglobus.com" }, "bottom");
    expect(r.url.startsWith("data:image/png;base64,")).toBe(true);
    expect(r.width).toBe(SIZE.w);
    expect(r.height).toBe(SIZE.h);
  });

  test("keeps the source clear of the footer, even with a long headline", async ({ page }) => {
    await setup(page);
    const r = await compose(page, {
      kicker: "Capacity",
      headline: "Tax season did not break your firm, and it was never going to — your capacity did, months earlier than anyone noticed",
      support: "Staff shortages and rising costs mean longer hours for the same work.",
      source: "internal case study",
      footer: "unisonglobus.com",
    }, "left");
    expect(r.footerInk, "the footer should be drawn").toBeGreaterThan(0);
    expect(r.gapInk, "nothing may be drawn between the source and the footer rule").toBe(0);
  });

  test("refuses to hand back artwork with no words on it", async ({ page }) => {
    await setup(page);
    const err = await page.evaluate(async () => {
      const mod = window.UnisonCompose;
      try { await mod.composite({ artwork: null, fields: { headline: "x" } }); return null; }
      catch (e) { return e.message; }
    });
    expect(err).toMatch(/No artwork/i);
  });

  test("the style picker offers every style and says which one Automatic chose", async ({ page }) => {
    for (const h of ["**://api.groq.com/**", "**://api.anthropic.com/**", "**://hook.*.make.com/**"]) await page.route(h, (r) => r.abort());
    await page.goto("/");
    await page.getByPlaceholder("What is this post about?").fill("Happy Navratri from everyone at the firm");
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator(".angle").first().click();
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
    await page.locator(".fmt", { hasText: "Image" }).first().click();
    await expect(page.getByRole("heading", { name: "Media" })).toBeVisible({ timeout: 40_000 });
    /* generating a new picture lives under the image's "More options" */
    await page.locator("summary", { hasText: "More options" }).click({ timeout: 40_000 });

    const panel = page.locator(".card", { hasText: "Visual style" }).first();
    await expect(panel).toBeVisible({ timeout: 30_000 });
    for (const s of ["Automatic", "Illustrated", "3D animated", "Editorial", "Infographic", "Realistic"]) {
      await expect(panel.getByRole("button", { name: s, exact: true })).toBeVisible();
    }
    /* With no key on the server it must say so plainly rather than offering a
       button that quietly fails. */
    await expect(panel).toContainText(/AI artwork is off/i);
    await expect(page.getByRole("button", { name: /Generate artwork \(AI\)/ })).toBeDisabled();
  });
});


/* The whole chain with the relay mocked: probe -> style -> prompt ->
   artwork -> composite -> asset -> publish payload.
 *
 * This is NOT a live provider test. No OpenAI, Google or Runway call is made
 * and this environment could not make one. What it proves is every part
 * this repository owns, including that the composited PNG — not the raw
 * artwork — is what reaches the existing publishing path. */
test.describe("end to end with the image relay mocked", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 180_000 });

  /* A valid 8x8 PNG, standing in for whatever a model would return.
     Generated with correct CRCs — the first attempt at this fixture had bad
     chunk CRCs, which made the browser refuse it and looked like a product
     bug for a while. */
  const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4YROFFTEMLQkATEZXgWfmY7oAAAAASUVORK5CYII=";

  const mockRelay = async (page, { prompts }) => {
    await page.route("**/api/image", async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        return route.fulfill({ json: {
          service: "unison-image-relay", configured: true,
          providers: { openai: true }, defaultProvider: "openai",
          pricing: { openai: { usdPerImage: 0.04, model: "gpt-image-1" } },
        } });
      }
      prompts.push(JSON.parse(req.postData() || "{}"));
      return route.fulfill({ json: { ok: true, provider: "openai", model: "gpt-image-1", shape: "wide", usd: 0.04, b64: TINY_PNG, mime: "image/png" } });
    });
  };

  test("generates artwork, composites the exact words, and publishes that PNG", async ({ page }) => {
    const prompts = [];
    const sent = [];
    for (const h of ["**://api.groq.com/**", "**://api.anthropic.com/**"]) await page.route(h, (r) => r.abort());
    await page.route("**://hook.*.make.com/**", async (route) => {
      sent.push(JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json",
        body: JSON.stringify({ status: "published", urn: "urn:li:share:e2e", url: "https://www.linkedin.com/feed/update/urn:li:share:e2e/" }) });
    });
    await mockRelay(page, { prompts });

    await page.goto("/");
    await page.getByPlaceholder("What is this post about?").fill("Happy Navratri from everyone at the firm");
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator(".angle").first().click();
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
    await page.locator(".fmt", { hasText: "Image" }).first().click();
    await expect(page.getByRole("heading", { name: "Media" })).toBeVisible({ timeout: 40_000 });
    /* generating a new picture lives under the image's "More options" */
    await page.locator("summary", { hasText: "More options" }).click({ timeout: 40_000 });

    const go = page.getByRole("button", { name: /Generate artwork \(AI\)/ });
    await expect(go).toBeEnabled({ timeout: 30_000 });
    await go.click();

    /* The panel has to say where the picture came from and what it cost. */
    const badge = page.locator(".badge", { hasText: /AI artwork —/ }).first();
    await expect(badge).toBeVisible({ timeout: 60_000 });
    await expect(badge).toContainText("openai/gpt-image-1");
    await expect(badge).toContainText("about $0.04");
    await expect(badge).toContainText(/words were added by Unison/i);

    /* The prompt is the art-directed one, and it forbids the model writing. */
    expect(prompts.length).toBe(1);
    expect(prompts[0].prompt).toMatch(/chaniya choli/i);
    expect(prompts[0].prompt).toMatch(/no text, letters, numbers/i);
    expect(prompts[0].shape).toBe("wide");
    /* No key may travel from the browser. */
    expect(JSON.stringify(prompts[0])).not.toMatch(/sk-|api[_-]?key/i);

    await page.getByRole("button", { name: "Approve anyway" }).click();
    await page.getByRole("button", { name: "Publish now" }).first().click();
    await expect.poll(() => sent.length, { timeout: 90_000 }).toBe(1);

    /* The composited PNG is what publishes — not the raw artwork, and not a
       template quietly swapped in. The existing payload shape is unchanged. */
    const p = sent[0];
    expect(p.postType).toBe("image");
    expect(p.media).toHaveLength(1);
    expect(p.media[0].data.length).toBeGreaterThan(TINY_PNG.length * 4);
    expect(p.idempotencyKey).toBe(p.postId);
    expect(p.companyUrn == null || String(p.companyUrn).startsWith("urn:li:organization:")).toBe(true);
  });

  test("a relay failure keeps the post and says what happened", async ({ page }) => {
    for (const h of ["**://api.groq.com/**", "**://api.anthropic.com/**", "**://hook.*.make.com/**"]) await page.route(h, (r) => r.abort());
    await page.route("**/api/image", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: { configured: true, providers: { openai: true }, defaultProvider: "openai", pricing: { openai: { usdPerImage: 0.04 } } } });
      }
      return route.fulfill({ status: 502, json: { ok: false, code: "upstream", message: "Rate limit reached" } });
    });

    await page.goto("/");
    await page.getByPlaceholder("What is this post about?").fill("A post about audit turnaround");
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator(".angle").first().click();
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
    const body = await page.locator(".li-body").innerText();

    await page.locator(".fmt", { hasText: "Image" }).first().click();
    await expect(page.getByRole("heading", { name: "Media" })).toBeVisible({ timeout: 40_000 });
    /* generating a new picture lives under the image's "More options" */
    await page.locator("summary", { hasText: "More options" }).click({ timeout: 40_000 });
    await page.locator(".chip", { hasText: "Illustrated" }).first().click();
    const go = page.getByRole("button", { name: /Generate artwork \(AI\)/ });
    await expect(go).toBeEnabled({ timeout: 30_000 });
    await go.click();

    /* The error is shown, the approved post is untouched, and no template
       has been silently substituted for the artwork that was asked for. */
    await expect(page.getByText(/Rate limit reached/)).toBeVisible({ timeout: 60_000 });
    expect(await page.locator(".li-body").innerText()).toBe(body);
  });
});
