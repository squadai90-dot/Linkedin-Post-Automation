import { test, expect } from "@playwright/test";

/* These run against the built app with nothing connected — no AI key, no
   Make webhook, no LinkedIn. That is the state a reviewer opens it in, and
   every engine is expected to degrade to labelled sample data rather than
   fail. Anything that would send a real post must stay a dry run. */

const stubExternals = async (page) => {
  // Nothing should reach the network in a test run.
  await page.route("**://api.anthropic.com/**", (r) => r.abort());
  await page.route("**://hook.*.make.com/**", (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
};

const errorsOf = (page) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  return errors;
};

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile);

  test("loads without a runtime error and shows honest setup state", async ({ page }) => {
    const errors = errorsOf(page);
    await stubExternals(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
    // Nothing is configured, and the app says so instead of pretending.
    await expect(page.getByText("Set up Unison")).toBeVisible();
    await expect(page.getByText(/AI not configured/)).toBeVisible();
    await expect(page.getByText(/Publishing not connected/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("settings opens on every tab and keeps what you type", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByPlaceholder("e.g. Unison Systems").fill("Acme Labs");
    for (const tab of ["AI", "LinkedIn", "Publishing", "Appearance", "Advanced"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    }
    await page.getByRole("tab", { name: "Workspace" }).click();
    await expect(page.getByPlaceholder("e.g. Unison Systems")).toHaveValue("Acme Labs");
    await page.keyboard.press("Escape");
    // The company name reaches the dashboard.
    await expect(page.getByText("Acme Labs").first()).toBeVisible();
  });

  test("modal fields accept real typing without losing focus", async ({ page }) => {
    // Regression: the dialog re-ran its setup effect on every parent render,
    // pulling focus back to the first tab after a single keystroke.
    await stubExternals(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    const field = page.getByPlaceholder("e.g. Unison Systems");
    await field.click();
    await page.keyboard.type("Acme Labs", { delay: 30 });
    await expect(field).toHaveValue("Acme Labs");
    await expect(field).toBeFocused();
  });

  test("the whole post journey runs on sample data and never claims to have published", async ({ page }) => {
    const errors = errorsOf(page);
    await stubExternals(page);
    await page.goto("/");

    await page.getByPlaceholder("What is this post about?").fill("Why approval workflows decide AI rollouts");
    await page.locator(".fmt", { hasText: "Poll" }).first().click();
    await page.getByRole("button", { name: "Start" }).click();

    // Research falls back and says the sources are placeholders.
    await expect(page.getByText(/these are placeholders, not real sources/)).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText("AI isn't set up")).toBeVisible();

    // Pick an angle, wait for the draft.
    await page.locator(".angle").first().click();
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText(/Sample text/)).toBeVisible();

    // The checks could not run, so approval is not presented as verified.
    await expect(page.getByText(/Not verified — the AI was unavailable/)).toBeVisible();
    await page.getByRole("button", { name: "Approve anyway" }).click();

    // Scheduling never requires a connection.
    const scheduleBtn = page.getByRole("button", { name: "Schedule post" });
    await expect(scheduleBtn).toBeEnabled();
    await scheduleBtn.click();
    await expect(page.getByText(/held in Unison until you publish/)).toBeVisible();

    // Publishing with nothing connected is a labelled dry run.
    await page.getByRole("button", { name: "Publish now" }).first().click();
    await expect(page.getByText(/Simulated publish — nothing was sent/).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("a post appears once in the calendar, not once per state", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    await page.getByPlaceholder("What is this post about?").fill("Calendar dedupe check");
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator(".angle").first().click();
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: "Approve anyway" }).click();
    await page.getByRole("button", { name: "Schedule post" }).click();
    await page.getByRole("button", { name: "Publish now" }).first().click();
    await page.waitForTimeout(1000);

    await page.getByRole("button", { name: "Calendar", exact: true }).first().click();
    await expect(page.locator(".pill", { hasText: "Calendar dedupe check" })).toHaveCount(1);
  });

  test("the calendar navigates months and marks today", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Calendar", exact: true }).first().click();
    await expect(page.locator(".cell.today")).toHaveCount(1);
    const label = page.locator(".sec-h .eyebrow").first();
    const first = await label.textContent();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(label).not.toHaveText(first);
    await page.getByRole("button", { name: "Today" }).click();
    await expect(label).toHaveText(first);
    await page.getByRole("button", { name: "Week view" }).click();
    await expect(page.getByRole("button", { name: "Month view" })).toBeVisible();
  });

  test("content list filters and searches", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Content", exact: true }).first().click();
    const rows = page.locator("table.tbl tbody tr");
    const total = await rows.count();
    expect(total).toBeGreaterThan(0);
    await page.getByPlaceholder("Search posts…").fill("procurement");
    await expect(rows).toHaveCount(1);
    await page.getByPlaceholder("Search posts…").fill("");
    await page.getByRole("button", { name: "Published" }).click();
    const published = await rows.count();
    expect(published).toBeLessThan(total);
  });

  test("insights refuses to invent numbers", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Insights", exact: true }).first().click();
    // The demo rows are labelled as samples rather than presented as the Page's performance.
    await expect(page.getByText(/Sample data/)).toBeVisible();
    await expect(page.getByText("+24%")).toHaveCount(0);
  });

  test("work survives a reload", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    const topic = "Persistence check across reload";
    const title = page.locator(".sec, .disp").filter({ hasText: topic }).first();
    await page.getByPlaceholder("What is this post about?").fill(topic);
    await page.getByRole("button", { name: "Start" }).click();
    await expect(title).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(1500); // let the debounced save run
    await page.reload();
    await expect(title).toBeVisible();
    // A stage that was mid-flight settles instead of spinning forever.
    await expect(page.locator(".pstep.active")).toHaveCount(0);
  });

  test("the LinkedIn flow explains itself and never fakes a connection", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    await page.getByRole("button", { name: /Connect LinkedIn/ }).click();
    await page.getByRole("button", { name: /Sign in with LinkedIn|Connect LinkedIn/ }).last().click();
    await expect(page.getByText(/LinkedIn sign-in isn't set up yet|Connect your LinkedIn Company Page/)).toBeVisible();
  });

  test("both themes render", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    await expect(page.locator(".unison")).toHaveAttribute("data-t", "dark");
    await page.getByRole("switch", { name: /Switch to light theme/ }).click();
    await expect(page.locator(".unison")).toHaveAttribute("data-t", "light");
  });
});

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile);

  test("the menu reaches every view and nothing overflows sideways", async ({ page }) => {
    const errors = errorsOf(page);
    await stubExternals(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // No horizontal scroll on a phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Menu" }).click();
    for (const view of ["Discover", "Content", "Calendar", "Insights"]) {
      await expect(page.getByRole("button", { name: view, exact: true }).first()).toBeVisible();
    }
    await page.getByRole("button", { name: "Calendar", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow2).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test("settings is reachable and usable on a phone", async ({ page }) => {
    await stubExternals(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await expect(page.getByRole("tab", { name: "Workspace" })).toBeVisible();
    await page.getByRole("tab", { name: "AI" }).click();
    await expect(page.getByText("Hosted AI (Anthropic)")).toBeVisible();
  });
});
