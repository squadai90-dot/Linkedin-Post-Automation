import { test, expect } from "@playwright/test";

/* Poll and video intelligence, driven through the real app.
 *
 * Both run here with no AI key, which is the harder case and the one that
 * matters: it is the path a user lands on when the free tier is gone. The
 * poll has to come out of the post rather than from a canned question, and
 * the video has to animate what each scene is carrying rather than putting
 * every scene on the same background. */

const quiet = async (page) => {
  for (const h of ["**://api.anthropic.com/**", "**://api.groq.com/**", "**://hook.*.make.com/**"]) await page.route(h, (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/ai", (r) => r.fulfill({ status: 404, json: {} }));
};

const draftWith = async (page, topic, component) => {
  await page.goto("/");
  await page.getByPlaceholder("What is this post about?").fill(topic);
  await page.getByRole("button", { name: "Start" }).click();
  await page.locator(".angle").first().click();
  await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
  await page.locator(".fmt", { hasText: component }).first().click();
  await expect(page.getByRole("heading", { name: component === "Poll" ? "Poll" : "Media" })).toBeVisible({ timeout: 40_000 });
};

/* The poll editor is the card carrying the question counter — several
   other cards on the page mention the word "Poll". */
const pollPanel = (page) => page.locator(".card").filter({ hasText: /Question · \d+\/140/ }).first();

test.describe("poll intelligence", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 180_000 });

  test("the poll comes out of the post and says what kind of poll it is", async ({ page }) => {
    await quiet(page);
    await draftWith(page, "Why audit turnaround is the number clients notice", "Poll");
    const panel = pollPanel(page);
    await expect(panel.locator("input").first()).toHaveValue(/.+/, { timeout: 40_000 });

    const text = await panel.innerText();
    // It names the kind of question it chose, with a reason.
    expect(text).toMatch(/(Challenge|Business practice|Adoption|Knowledge check|Experience|Preference) poll/);
    // And it is not the old canned question, whatever the post was about.
    expect(text).not.toContain("What actually slows your content down?");
  });

  test("it respects LinkedIn's real limits and says so", async ({ page }) => {
    await quiet(page);
    await draftWith(page, "How firms handle first-pass review", "Poll");
    const panel = pollPanel(page);
    await expect(panel.locator("input").first()).toHaveValue(/.+/, { timeout: 40_000 });

    await expect(panel).toContainText("/140");
    await expect(panel).toContainText("max 4, 30 characters each");

    const values = await panel.locator("input").evaluateAll((els) => els.map((e) => e.value));
    const [question, ...options] = values;
    expect(question.length).toBeLessThanOrEqual(140);
    expect(options.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    expect(options.filter(Boolean).length).toBeLessThanOrEqual(4);
    for (const o of options.filter(Boolean)) expect(o.length).toBeLessThanOrEqual(30);
  });

  test("editing an option into a duplicate is flagged straight away", async ({ page }) => {
    await quiet(page);
    await draftWith(page, "How firms handle first-pass review", "Poll");
    const panel = pollPanel(page);
    await expect(panel.locator("input").first()).toHaveValue(/.+/, { timeout: 40_000 });

    const opts = panel.locator("input").nth(1);
    const second = panel.locator("input").nth(2);
    const first = await opts.inputValue();
    await second.fill(first);                       // make it a duplicate of the first
    await expect(panel).toContainText(/the same/i, { timeout: 10_000 });
  });
});

test.describe("video scenes", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 300_000 });

  test("scenes carry a kind, and the preview draws more than text", async ({ page }) => {
    await quiet(page);
    await draftWith(page, "Closing the Australian financial year on 30 June", "Video");
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);

    /* The storyboard is stored on the session, so read what the engine
       actually decided rather than guessing from pixels. */
    const kinds = await page.evaluate(() => {
      try {
        const s = JSON.parse(localStorage.getItem("unison:session:v1") || "null");
        return (s?.assets?.video?.storyboard || []).map((x) => x.kind);
      } catch { return []; }
    });
    expect(kinds.length, "a storyboard should exist").toBeGreaterThan(1);
    expect(kinds.every(Boolean), `every scene needs a kind: ${JSON.stringify(kinds)}`).toBe(true);
    expect(kinds[kinds.length - 1]).toBe("cta");
    // Not every scene the same — that was the slideshow this replaced.
    expect(new Set(kinds).size, `all scenes identical: ${JSON.stringify(kinds)}`).toBeGreaterThan(1);

    /* And every scene has to come from the post. A weaker check passed while
       the storyboard was still four canned lines about "teams" and
       "automation" that no post ever contained. */
    const { lines, postText } = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("unison:session:v1") || "null");
      const d = s?.draft || {};
      return {
        lines: (s?.assets?.video?.storyboard || []).map((x) => x.line),
        postText: [d.hook, d.body, d.cta].filter(Boolean).join(" ").toLowerCase(),
      };
    });
    expect(lines.join(" ")).not.toContain("What actually slows teams down");
    for (const l of lines.slice(0, -1)) {
      const w = String(l).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 4);
      expect(w.some((x) => postText.includes(x)), `scene not in the post: "${l}"`).toBe(true);
    }

    // The canvas is actually painted, not blank.
    const painted = await page.locator("canvas").first().evaluate((c) => {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4000) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      return seen.size;
    });
    expect(painted, "the preview canvas should have more than one colour on it").toBeGreaterThan(3);
  });
});
