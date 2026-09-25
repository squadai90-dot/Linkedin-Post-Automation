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

/* Which container the browser running this suite can actually record.
   Chrome and Edge give H.264 in MP4, which is what LinkedIn documents.
   Chromium built without proprietary codecs gives WebM. The app is expected
   to send whichever it really produced and to say so — never to label a WebM
   as an MP4, which is how a post reaches LinkedIn and is rejected as
   corrupt after a minute of transcoding. */
const recordedType = (page) =>
  page.evaluate(() =>
    ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1.4D401E", "video/mp4;codecs=h264",
     "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find((m) => MediaRecorder.isTypeSupported(m))?.split(";")[0] || "video/webm");

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

  test("a generated video is encoded and sent as a real file, with no manual export", async ({ page }) => {
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

    // Whatever it says it is, it must actually be that.
    const expected = await recordedType(page);
    expect(video.mimeType).toBe(expected);
    expect(video.filename).toBe(expected === "video/mp4" ? "unison-video.mp4" : "unison-video.webm");
    // Real bytes: base64, and far more than an empty container would be.
    expect(typeof video.data).toBe("string");
    expect(video.data.length).toBeGreaterThan(2000);
    expect(video.data).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(video.sizeBytes).toBeGreaterThan(1000);
    // A browser that cannot record H.264 must not leave that a surprise.
    if (expected !== "video/mp4") await expect(page.getByText(/rather than MP4/).first()).toBeVisible();

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
    expect(video?.mimeType).toBe(await recordedType(page));
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

/* Move a post's time into the past, as the afternoon would.
   The app saves the session on a 700 ms debounce, so a single write races a
   pending save that would put the original time straight back. Write, wait
   past the debounce, read it back, and write again if it was overwritten. */
const shiftIntoPast = async (page, { match = "SCHEDULED", patch = {} } = {}) => {
  const KEY = "unison:session:v1";
  const rewrite = ([k, st, extra]) => {
    let s;
    try { s = JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; }
    const hits = (s?.posts || []).filter((p) => p.state === st);
    if (!hits.length) return null;
    const past = new Date(Date.now() - 120000);
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`;
    const time = `${pad(past.getHours())}:${pad(past.getMinutes())}`;
    s.posts = (s.posts || []).map((p) => (p.state === st
      ? { ...p, date, time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...extra }
      : p));
    localStorage.setItem(k, JSON.stringify(s));
    return `${date} ${time}`;
  };

  let wrote = null;
  await expect.poll(async () => {
    wrote = await page.evaluate(rewrite, [KEY, match, patch]) || wrote;
    if (!wrote) return false;
    await page.waitForTimeout(900);                       // outlast the 700 ms debounce
    return page.evaluate(([k, want]) => {
      try {
        const s = JSON.parse(localStorage.getItem(k) || "null");
        return (s?.posts || []).some((p) => `${p.date} ${p.time}` === want);
      } catch { return false; }
    }, [KEY, wrote]);
  }, { timeout: 30_000, intervals: [100] }).toBe(true);
};

/* Make's queue can only afford to look for due posts once an hour on this
   plan, so a post scheduled for 10:00 goes out some time before 11:00. These
   cover the path that does hit the minute: Unison publishing it itself while
   it is open. */
test.describe("publishing a scheduled post on time", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 180_000 });

  test("a post whose time has come is published without anyone pressing anything", async ({ page }) => {
    await quiet(page);
    const sent = await captureWebhook(page);
    await draftWith(page, "A post that should go out by itself", null);
    await page.getByRole("button", { name: "Approve anyway" }).click();

    /* Schedule it for a minute that has just passed. The app refuses a past
       time in the picker — deliberately — so the post is scheduled normally
       and the clock is what moves, exactly as it would in the afternoon. */
    await page.getByRole("button", { name: "Schedule post" }).click();
    await expect(page.getByText(/Unison publishes this at/)).toBeVisible();
    expect(sent, "scheduling alone must not send anything").toHaveLength(0);

    await shiftIntoPast(page);
    await page.reload();

    // No click anywhere after the reload: the app has to notice by itself.
    await expect.poll(() => sent.length, { timeout: 90_000, intervals: [500] }).toBe(1);
    const p = sent[0];
    expect(p.postType).toBe("text");
    // Published, not queued — this is the immediate route, so it is on
    // LinkedIn now rather than waiting for Make's timer.
    expect(p.publishMode).toBe("now");
    await expect(page.getByText(/Published to LinkedIn/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("a post handed to Make is left for Make, never published twice", async ({ page }) => {
    await quiet(page);
    const sent = await captureWebhook(page, { status: "queued", postId: "e2e" });
    await draftWith(page, "A post handed over for later", null);
    await page.getByRole("button", { name: "Approve anyway" }).click();
    await page.getByRole("button", { name: "Schedule post" }).click();
    await page.getByRole("button", { name: /^Hand to Make for / }).click();
    await expect.poll(() => sent.length, { timeout: 60_000 }).toBe(1);
    expect(sent[0].publishMode).toBe("scheduled");

    // Now move that post's time into the past. It is Make's to publish, so
    // the in-app publisher must leave it alone rather than duplicate it.
    await shiftIntoPast(page, { match: "SENT", patch: { state: "SCHEDULED", scheduledHandoff: true } });
    await page.reload();
    await page.waitForTimeout(45_000);
    expect(sent, "a post Make already has must not be published again from here").toHaveLength(1);
  });
});
