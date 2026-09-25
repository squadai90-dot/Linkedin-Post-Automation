import { test, expect } from "@playwright/test";

/* The times Content shows, taken from posts made through the real UI.
 *
 * The thing being guarded is that "Scheduled" and "Published" are two
 * different recorded moments — not one field printed twice, and not the
 * scheduled time relabelled once the post goes out. */

const HOOK = "**://hook.*.make.com/**";
const STAMP = /\d{1,2} [A-Z][a-z]{2} \d{4} · \d{1,2}:\d{2} (AM|PM) [A-Z0-9+:]{2,7}/;

const quiet = async (page) => {
  await page.route("**://api.anthropic.com/**", (r) => r.abort());
  await page.route("**://api.groq.com/**", (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
};

const makeSays = (page, reply) =>
  page.route(HOOK, (route) => route.fulfill({
    status: 200, headers: { "access-control-allow-origin": "*" },
    contentType: "application/json", body: JSON.stringify(reply),
  }));

const approvedDraft = async (page, topic) => {
  await page.goto("/");
  await page.getByPlaceholder("What is this post about?").fill(topic);
  await page.getByRole("button", { name: "Start" }).click();
  await page.locator(".angle").first().click();
  await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
  await page.getByRole("button", { name: "Approve anyway" }).click();
};

/* Open one post in Content by its title — the list also carries the sample
   posts that ship with the demo — and read its times block. */
const openInContent = async (page, title) => {
  await page.getByRole("button", { name: /^Content/ }).click();
  await page.locator("tr", { hasText: title }).getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".ptimes")).toBeVisible({ timeout: 20_000 });
  return page.locator(".ptimes");
};
const row = (times, label) => times.locator(".ptime", { hasText: label }).locator(".ptime-v");

test.describe("the times Content shows", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 180_000 });

  test("an immediate post shows when it published, and no scheduled time", async ({ page }) => {
    await quiet(page);
    await makeSays(page, { status: "published", urn: "urn:li:share:e2e", url: "https://www.linkedin.com/feed/update/urn:li:share:e2e/" });
    const topic = "A post that goes out straight away";
    await approvedDraft(page, topic);
    await page.getByRole("button", { name: "Publish now" }).first().click();
    await expect(page.getByText(/Published to LinkedIn/).first()).toBeVisible({ timeout: 60_000 });

    const times = await openInContent(page, topic);
    await expect(row(times, "Published")).toHaveText(STAMP);
    // An immediate post never had a scheduled time, so it must not show one.
    await expect(times.locator(".ptime", { hasText: "Scheduled" })).toHaveCount(0);
    await expect(times.locator(".ptime", { hasText: "Sent to Make" })).toHaveCount(0);
  });

  test("a post handed to Make shows when Make took it, and no publication time", async ({ page }) => {
    await quiet(page);
    await makeSays(page, { status: "queued", postId: "e2e" });
    const topic = "A post handed over for later";
    await approvedDraft(page, topic);
    await page.getByRole("button", { name: "Schedule post" }).click();
    await page.getByRole("button", { name: /^Hand to Make for / }).click();
    await expect(page.getByText(/Queued in Make/).first()).toBeVisible({ timeout: 60_000 });

    const times = await openInContent(page, topic);
    await expect(row(times, "Scheduled")).toHaveText(STAMP);
    await expect(row(times, "Sent to Make")).toHaveText(STAMP);
    // Make has it. LinkedIn has not confirmed anything.
    await expect(row(times, "Published")).toHaveText("Not yet confirmed");
  });

  test("a scheduled post that Unison publishes shows both times, and the gap", async ({ page }) => {
    await quiet(page);
    await makeSays(page, { status: "published", urn: "urn:li:share:e2e", url: "https://www.linkedin.com/feed/update/urn:li:share:e2e/" });
    const topic = "A post that should go out by itself";
    await approvedDraft(page, topic);
    await page.getByRole("button", { name: "Schedule post" }).click();
    await expect(page.getByText(/Unison publishes this at/)).toBeVisible();

    /* Move its minute into the past so the in-app publisher takes it, the way
       the afternoon would. The session save is debounced, so write, outlast
       the debounce and check it stuck. */
    const KEY = "unison:session:v1";
    let wrote = null;
    await expect.poll(async () => {
      wrote = await page.evaluate((k) => {
        let s; try { s = JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; }
        if (!(s?.posts || []).some((p) => p.state === "SCHEDULED")) return null;
        const past = new Date(Date.now() - 120000);
        const pad = (n) => String(n).padStart(2, "0");
        const date = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`;
        const time = `${pad(past.getHours())}:${pad(past.getMinutes())}`;
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        s.posts = s.posts.map((p) => (p.state === "SCHEDULED"
          ? { ...p, date, time, tz, scheduledDate: date, scheduledTime: time, scheduledTz: tz, scheduledFor: new Date(past.getTime() - (past.getSeconds() * 1000) - past.getMilliseconds()).toISOString() }
          : p));
        localStorage.setItem(k, JSON.stringify(s));
        return `${date} ${time}`;
      }, KEY) || wrote;
      if (!wrote) return false;
      await page.waitForTimeout(900);
      return page.evaluate(([k, want]) => {
        try {
          const s = JSON.parse(localStorage.getItem(k) || "null");
          return (s?.posts || []).some((p) => `${p.scheduledDate} ${p.scheduledTime}` === want);
        } catch { return false; }
      }, [KEY, wrote]);
    }, { timeout: 30_000, intervals: [100] }).toBe(true);
    await page.reload();
    await expect(page.getByText(/Published to LinkedIn/).first()).toBeVisible({ timeout: 90_000 });

    const times = await openInContent(page, topic);
    const scheduled = await row(times, "Scheduled").innerText();
    const published = await row(times, "Published").innerText();
    expect(scheduled).toMatch(STAMP);
    expect(published).toMatch(STAMP);
    /* The whole point: the chosen minute was not overwritten by the minute it
       actually went out. */
    expect(published).not.toBe(scheduled);
    await expect(times.locator(".ptime-gap")).toContainText(/than scheduled|on the scheduled minute/);
  });
});
