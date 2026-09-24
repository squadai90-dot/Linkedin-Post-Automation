import { test, expect } from "@playwright/test";

/* What actually leaves the browser when Publish is pressed.
 *
 * These run against the built app with the Make webhook intercepted, so the
 * request body can be read. They exist because "the scenario returned 200" is
 * not evidence that the right bytes were sent: the video bug this suite was
 * written for showed a success in Make while the payload carried no video at
 * all. The assertions are on the payload, not on the UI copy.
 *
 * No AI key is configured, so every engine falls back to its sample data —
 * which is the point. The storyboard, the encoder and the base64 step are all
 * real; only the words are canned. */

const HOOK = "**://hook.*.make.com/**";

const quiet = async (page) => {
  await page.route("**://api.anthropic.com/**", (r) => r.abort());
  await page.route("**://api.groq.com/**", (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
};

/* Stand in for Make and keep whatever was sent. The reply is the scenario's
   real success shape, so the app takes the published branch. */
const captureWebhook = async (page, reply = { status: "published", urn: "urn:li:share:e2e", url: "https://www.linkedin.com/feed/update/urn:li:share:e2e/" }) => {
  const sent = [];
  await page.route(HOOK, async (route) => {
    const body = route.request().postData() || "";
    try { sent.push(JSON.parse(body)); } catch { sent.push({ unparseable: body.slice(0, 200) }); }
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: JSON.stringify(reply),
    });
  });
  return sent;
};

/* Drive the app from an idea to an approved draft carrying `component`. */
const draftWith = async (page, topic, component) => {
  await page.goto("/");
  await page.getByPlaceholder("What is this post about?").fill(topic);
  await page.getByRole("button", { name: "Start" }).click();
  await page.locator(".angle").first().click();
  await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
  if (component) {
    await page.locator(".fmt", { hasText: component }).first().click();
    await expect(page.getByRole("heading", { name: component === "Poll" ? "Poll" : "Media" })).toBeVisible({ timeout: 40_000 });
  }
};

test.describe("what Publish sends", () => {
  test.skip(({ isMobile }) => isMobile);
  /* Encoding a video is real-time capture of the storyboard, so these run
     long by nature rather than because something is stuck. */
  test.describe.configure({ timeout: 300_000 });

  test("only the post types the publisher can complete are offered", async ({ page }) => {
    await quiet(page);
    await page.goto("/");
    await page.getByPlaceholder("What is this post about?").fill("Which components exist");
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator(".angle").first().click();
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });

    const labels = await page.locator(".fmt-label").allTextContents();
    expect(labels.sort()).toEqual(["Image", "Poll", "Video"]);
    // The four that could be chosen and would then fail are gone entirely.
    for (const dead of ["Article", "Carousel", "Multi-image", "Document"]) {
      expect(labels, `${dead} must not be selectable`).not.toContain(dead);
    }
  });

  test("a generated video is encoded and sent as a real MP4, with no manual export", async ({ page }) => {
    await quiet(page);
    const sent = await captureWebhook(page);
    await draftWith(page, "Why approval steps decide AI rollouts", "Video");

    // The storyboard exists; the file does not. This is exactly the state the
    // bug report described — Publish is pressed without touching Export.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 40_000 });

    await page.getByRole("button", { name: "Approve anyway" }).click();
    await page.getByRole("button", { name: "Publish now" }).first().click();

    // Encoding is real-time capture of the storyboard, so this is slow.
    await expect.poll(() => sent.length, { timeout: 180_000, intervals: [1000] }).toBe(1);

    const p = sent[0];
    expect(p.postType).toBe("video");
    const video = (p.media || []).find((m) => m.kind === "video");
    expect(video, "the payload must carry the video, not just describe one").toBeTruthy();
    expect(video.mimeType).toBe("video/mp4");
    expect(video.filename).toMatch(/\.mp4$/);
    // Real bytes: base64, and far more than an empty container would be.
    expect(typeof video.data).toBe("string");
    expect(video.data.length).toBeGreaterThan(2000);
    expect(video.data).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(video.sizeBytes).toBeGreaterThan(1000);

    // And the user is told it published, because Make said so — not because
    // the request was accepted.
    await expect(page.getByText(/Published to LinkedIn/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("a scheduled video carries the same file into the queue", async ({ page }) => {
    await quiet(page);
    // A scheduled hand-off is answered "queued", not "published" — nothing is
    // on LinkedIn until the scheduled publisher runs.
    const sent = await captureWebhook(page, { status: "queued", postId: "e2e" });
    await draftWith(page, "Scheduling a video post", "Video");
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: "Approve anyway" }).click();
    await page.getByRole("button", { name: "Schedule post" }).click();
    // Scheduling parks the post in Unison; this is the deliberate hand-off
    // that puts it in Make's data store for the scheduled publisher to find.
    await page.getByRole("button", { name: /^Hand to Make for / }).click();

    await expect.poll(() => sent.length, { timeout: 240_000, intervals: [1000] }).toBe(1);
    const p = sent[0];
    expect(p.publishMode).toBe("scheduled");
    expect(p.postType).toBe("video");
    expect(p.scheduledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.timezone).toBeTruthy();
    const video = (p.media || []).find((m) => m.kind === "video");
    expect(video?.mimeType).toBe("video/mp4");
    expect(video.data.length).toBeGreaterThan(2000);
    // It has to fit Make's data store, or the scheduled publisher never sees
    // it. This is the whole reason a queued post is encoded smaller.
    expect(video.data.length).toBeLessThan(600 * 1024);
    // …and the post says so rather than quietly shipping a worse video.
    await expect(page.getByText(/fits the scheduled queue/).first()).toBeVisible();
  });

  test("an image post sends one PNG with its bytes", async ({ page }) => {
    await quiet(page);
    const sent = await captureWebhook(page);
    await draftWith(page, "One chart, one claim", "Image");
    await expect(page.locator(".svgframe img")).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: "Approve anyway" }).click();
    await page.getByRole("button", { name: "Publish now" }).first().click();

    await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(1);
    const p = sent[0];
    expect(p.postType).toBe("image");
    const images = (p.media || []).filter((m) => m.kind === "image");
    // One image, never a set — multi-image is not a thing here any more.
    expect(images).toHaveLength(1);
    expect(images[0].mimeType).toBe("image/png");
    expect(images[0].data.length).toBeGreaterThan(1000);
  });

  test("a poll sends the question and options, not a picture of them", async ({ page }) => {
    await quiet(page);
    const sent = await captureWebhook(page);
    await draftWith(page, "What slows content down", "Poll");
    await page.getByRole("button", { name: "Approve anyway" }).click();
    await page.getByRole("button", { name: "Publish now" }).first().click();

    await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(1);
    const p = sent[0];
    expect(p.postType).toBe("poll");
    expect(p.poll.question.length).toBeGreaterThan(5);
    expect(p.poll.options.length).toBeGreaterThanOrEqual(2);
    expect(p.poll.options.length).toBeLessThanOrEqual(4);
    expect(p.poll.duration).toBeTruthy();
    expect(p.media || []).toHaveLength(0);
  });

  test("a text post sends the words and nothing else", async ({ page }) => {
    await quiet(page);
    const sent = await captureWebhook(page);
    await draftWith(page, "A plain written post", null);
    await page.getByRole("button", { name: "Approve anyway" }).click();
    await page.getByRole("button", { name: "Publish now" }).first().click();

    await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(1);
    const p = sent[0];
    expect(p.postType).toBe("text");
    expect(p.content.length).toBeGreaterThan(20);
    expect(p.media || []).toHaveLength(0);
    expect(p.poll).toBeNull();
    // The idempotency key is what stops a double click posting twice.
    expect(p.idempotencyKey).toBe(p.postId);
  });
});
