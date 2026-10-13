import { test, expect } from "@playwright/test";

/* Publishing one post to several LinkedIn Pages, driven through the real built
 * app. The server endpoints (/api/destinations, /api/publish-to) are mocked
 * with the shape the real ones return; Make and LinkedIn are not involved.
 * What this proves is Unison's half: the picker, what is sent for which Page,
 * per-Page results, retrying only what failed, and that the choice survives
 * a reload. It does not prove LinkedIn accepts the posts. */

const PAGES = [
  { id: "test-1", name: "Unison Content OS Test", organizationUrn: "urn:li:organization:146260120", logo: null, enabled: true },
  { id: "test-2", name: "Unison Content OS Test 2", organizationUrn: "urn:li:organization:145298202", logo: null, enabled: true },
  { id: "test-3", name: "Unison Content OS Test 3", organizationUrn: "urn:li:organization:145301196", logo: null, enabled: true },
];

const quiet = async (page) => {
  for (const h of ["**://api.anthropic.com/**", "**://api.groq.com/**", "**://hook.*.make.com/**", "**://api.canva.com/**", "**://commons.wikimedia.org/**"]) await page.route(h, (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
};

/* The server, as deployed with LINKEDIN_DESTINATIONS and MAKE_MULTI_WEBHOOK_URL. */
const server = async (page, { sent, answer }) => {
  await page.route("**/api/destinations", (r) => r.fulfill({ json: { service: "unison-destinations", version: 1, enabled: true, webhookConfigured: true, destinations: PAGES, problems: [] } }));
  await page.route("**/api/publish-to", async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    sent.push(body);
    const a = answer(body, sent.length);
    await r.fulfill({ status: a.status || 200, json: a.json });
  });
};

const approved = async (page, topic) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.getByPlaceholder("What is this post about?").fill(topic);
  await page.getByRole("button", { name: "Start" }).click();
  await page.locator(".angle").first().click({ timeout: 40_000 });
  await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
  await page.getByRole("button", { name: "Approve anyway" }).click();
  const picker = page.getByTestId("destinations");
  await expect(picker).toBeVisible({ timeout: 20_000 });
  return picker;
};

test.describe("publishing to several LinkedIn Pages", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 120_000 });

  test("picks Pages, sends one job per Page, keeps successes and retries only the failure", async ({ page }) => {
    const sent = [];
    await quiet(page);
    let failTest2 = true;
    await server(page, { sent, answer: (b) => {
      const id = b.destinationIds[0];
      if (id === "test-2" && failTest2) return { status: 502, json: { delivered: false, state: "failed", error: "LinkedIn refused the post for this Page: 403" } };
      return { json: { delivered: true, state: "published", published: true, urn: `urn:li:share:${id}`, url: `https://www.linkedin.com/feed/update/urn:li:share:${id}/` } };
    } });
    const picker = await approved(page, "Test post for the multi-Page check — please ignore");

    /* one Page by default — the behaviour every existing post had */
    await expect(picker.getByTestId("dest-summary")).toHaveText("Publish to 1 Page");
    await expect(picker.getByRole("checkbox", { name: "Unison Content OS Test", exact: true })).toBeChecked();

    /* none chosen: nothing can be sent */
    await picker.getByRole("button", { name: "Clear selection" }).click();
    await expect(picker.getByTestId("dest-summary")).toHaveText("Choose a Page");
    await expect(page.getByRole("button", { name: "Publish now" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Schedule post" })).toBeDisabled();

    await picker.getByRole("button", { name: "Select all" }).click();
    await expect(picker.getByTestId("dest-summary")).toHaveText("Publish to 3 Pages");

    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.getByText("Some Pages didn't get the post.")).toBeVisible({ timeout: 20_000 });
    expect(sent.map((b) => b.destinationIds)).toEqual([["test-1"], ["test-2"], ["test-3"]]);
    expect(sent.every((b) => b.fanout === true && b.post.publishMode === "now" && b.post.postType === "text")).toBe(true);
    /* the browser names Pages by id; it does not send an organization of its choosing */
    expect(sent.every((b) => b.post.destinations === undefined)).toBe(true);

    const results = page.getByTestId("dest-results").first();
    await expect(results).toContainText("Unison Content OS Test 2");
    await expect(results).toContainText("Failed");
    await expect(results).toContainText("LinkedIn refused the post for this Page: 403");

    failTest2 = false;
    await page.getByRole("button", { name: "Retry failed Pages" }).click();
    await expect(page.getByText(/Published to LinkedIn · 3 Pages/)).toBeVisible({ timeout: 20_000 });
    expect(sent).toHaveLength(4);
    expect(sent[3].destinationIds).toEqual(["test-2"]);   // only the failed Page
    expect(sent[3].fanout).toBe(true);                     // so it keeps its own job key
  });

  test("13 Oct case: Page 3 waiting in Make's queue is shown as waiting, not retried, and resent only after a person checks", async ({ page }) => {
    const sent = [];
    await quiet(page);
    let queued = true;
    await server(page, { sent, answer: (b) => {
      const id = b.destinationIds[0];
      /* what api/publish-to.js answers when Make replies a bare "Accepted" */
      if (id === "test-3" && queued) return { json: { delivered: true, state: "accepted", stage: "make-queue", published: false, message: "Make received this but did not run it: the Make scenario is switched off or was busy (or out of operations), so the request is waiting in its webhook queue. It will be posted when the scenario next runs. Do not send it again." } };
      return { json: { delivered: true, state: "published", published: true, urn: `urn:li:share:${id}`, url: `https://www.linkedin.com/feed/update/urn:li:share:${id}/` } };
    } });
    const picker = await approved(page, "TEST — two-Page image check, please ignore");
    await picker.getByRole("checkbox", { name: "Unison Content OS Test", exact: true }).uncheck();
    await picker.getByRole("checkbox", { name: "Unison Content OS Test 2" }).check();
    await picker.getByRole("checkbox", { name: "Unison Content OS Test 3" }).check();
    await page.getByRole("button", { name: "Publish now" }).click();

    await expect(page.getByTestId("dest-result-test-3")).toHaveText(/Waiting in Make — not run yet/, { timeout: 20_000 });
    await expect(page.getByTestId("dest-result-test-2")).toHaveText(/Published/);
    expect(sent.map((b) => b.destinationIds[0])).toEqual(["test-2", "test-3"]);
    /* nothing to retry: Page 3 may still be posted from Make's queue */
    await expect(page.getByTestId("dest-retry")).toHaveCount(0);

    /* a person checked, cleared Make's queue, and allows a resend */
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("dest-not-published-test-3").click();
    queued = false;
    await page.getByTestId("dest-retry").click();
    await expect(page.getByText(/Published to LinkedIn · 2 Pages/)).toBeVisible({ timeout: 20_000 });
    expect(sent.map((b) => b.destinationIds[0])).toEqual(["test-2", "test-3", "test-3"]);
  });

  test("Page 3 only goes to Page 3", async ({ page }) => {
    const sent = [];
    await quiet(page);
    await server(page, { sent, answer: (b) => ({ json: { delivered: true, state: "published", urn: `urn:li:share:${b.destinationIds[0]}` } }) });
    const picker = await approved(page, "Test post for Page 3 only — please ignore");
    await picker.getByRole("checkbox", { name: "Unison Content OS Test", exact: true }).uncheck();
    await picker.getByRole("checkbox", { name: "Unison Content OS Test 3" }).check();
    await expect(picker.getByTestId("dest-summary")).toHaveText("Publish to 1 Page");
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.getByText(/Published to LinkedIn · 1 Page/)).toBeVisible({ timeout: 20_000 });
    expect(sent.map((b) => [b.destinationIds, b.fanout])).toEqual([[["test-3"], false]]);
  });

  test("a scheduled post goes to Make once, carrying its Pages, and they survive a reload", async ({ page }) => {
    const sent = [];
    await quiet(page);
    await server(page, { sent, answer: () => ({ json: { delivered: true, state: "queued", mode: "scheduled" } }) });
    const picker = await approved(page, "Scheduled test post for Pages 1 and 3 — please ignore");
    await picker.getByRole("checkbox", { name: "Unison Content OS Test 3" }).check();
    await page.getByRole("button", { name: "Schedule post" }).click();

    /* reopening keeps the Pages chosen */
    await page.waitForTimeout(1200);
    await page.reload();
    const again = page.getByTestId("destinations");
    await expect(again).toBeVisible({ timeout: 20_000 });
    await expect(again.getByRole("checkbox", { name: "Unison Content OS Test", exact: true })).toBeChecked();
    await expect(again.getByRole("checkbox", { name: "Unison Content OS Test 2" })).not.toBeChecked();
    await expect(again.getByRole("checkbox", { name: "Unison Content OS Test 3" })).toBeChecked();

    await page.getByRole("button", { name: /^Hand to Make for / }).click();
    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
    expect(sent[0].destinationIds).toEqual(["test-1", "test-3"]);
    expect(sent[0].post.publishMode).toBe("scheduled");
    expect(sent[0].post.scheduledDate).toBeTruthy();
    const results = page.getByTestId("dest-results").first();
    await expect(results).toContainText(/Unison Content OS Test\s*— Scheduled in Make/);
    await expect(results).toContainText(/Unison Content OS Test 3\s*— Scheduled in Make/);
    await expect(results).not.toContainText("Unison Content OS Test 2");
  });

  test("a scheduled post's Pages are brought up to date from Make's records, without sending anything", async ({ page }) => {
    const sent = [];
    await quiet(page);
    await server(page, { sent, answer: (b) => (b.action === "status"
      ? { json: { delivered: true, state: "report", postId: b.postId, pages: {
          "test-1": { state: "published", makeStatus: "published", urn: "urn:li:share:71", url: "https://www.linkedin.com/feed/update/urn:li:share:71/" },
          "test-3": { state: "failed", makeStatus: "failed", message: "LinkedIn refused this post: 403" } } } }
      : { json: { delivered: true, state: "queued", mode: "scheduled" } }) });
    const picker = await approved(page, "Scheduled status check for Pages 1 and 3 — please ignore");
    await picker.getByRole("checkbox", { name: "Unison Content OS Test 3" }).check();
    await page.getByRole("button", { name: "Schedule post" }).click();
    await page.getByRole("button", { name: /^Hand to Make for / }).click();
    await expect(page.getByTestId("dest-result-test-1").first()).toHaveAttribute("data-state", "scheduled", { timeout: 20_000 });

    await page.getByTestId("dest-check-status").first().click();
    await expect(page.getByTestId("dest-result-test-1").first()).toHaveText(/Published/, { timeout: 20_000 });
    await expect(page.getByTestId("dest-result-test-3").first()).toHaveAttribute("data-state", "failed");
    await expect(page.getByTestId("dest-results").first()).toContainText("LinkedIn refused this post: 403");
    expect(sent.filter((b) => b.action === "status")).toHaveLength(1);
    expect(sent.filter((b) => b.action !== "status")).toHaveLength(1);   // the status check sent no post
    expect(sent[1].postId).toBe(sent[0].post.postId);
  });

  test("without a Page list on the server nothing changes: no picker, the single-Page path", async ({ page }) => {
    await quiet(page);
    await page.route("**/api/destinations", (r) => r.fulfill({ status: 404, body: "not found" }));
    await page.goto("/");
    await page.getByPlaceholder("What is this post about?").fill("Single page check");
    await page.getByRole("button", { name: "Start" }).click();
    await page.locator(".angle").first().click({ timeout: 40_000 });
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: "Approve anyway" }).click();
    await expect(page.getByRole("button", { name: "Schedule post" })).toBeEnabled();
    await expect(page.getByTestId("destinations")).toHaveCount(0);
  });
});
