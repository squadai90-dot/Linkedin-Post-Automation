import { test, expect } from "@playwright/test";

/* What uploading a document actually does.
 *
 * The complaint this file exists for was that a file could be uploaded and
 * nothing anywhere changed. So these assert on the visible consequences —
 * the sources list, the research panel, and the words that reach the writer
 * — rather than on the upload succeeding. Both paths are covered: with a
 * model behind it, and with nothing behind it at all. */

const GROQ = "**://api.groq.com/openai/v1/**";

const DOC = `Quarterly operations review for the outsourcing practice, prepared for the partners.
Average turnaround on a statutory audit fell from 14 days to 9 days across the quarter.
The team closed 42 engagements in the quarter, which is up 18% on the same quarter last year.
Clients repeatedly asked for a single named point of contact rather than a shared team inbox.
Hiring qualified reviewers remains the one constraint on how many engagements can be taken on.`;

const quiet = async (page) => {
  await page.route("**://api.anthropic.com/**", (r) => r.abort());
  await page.route("**://hook.*.make.com/**", (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/ai", (r) => r.fulfill({ status: 404, json: {} }));
};

const research = async (page, topic = "How outsourcing teams cut audit turnaround") => {
  await page.goto("/");
  await page.getByPlaceholder("What is this post about?").fill(topic);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { name: "Research" })).toBeVisible({ timeout: 40_000 });
};

/* The document panel's input is the only one that takes .docx. */
const upload = async (page, name = "review.txt") => {
  await page.locator('input[type="file"][accept*=".docx"]').setInputFiles({
    name, mimeType: "text/plain", buffer: Buffer.from(DOC, "utf8"),
  });
};

test.describe("uploading a document you already have", () => {
  test.skip(({ isMobile }) => isMobile);
  test.describe.configure({ timeout: 120_000 });

  test("with no AI configured, the file still becomes a primary source", async ({ page }) => {
    await quiet(page);
    await page.route("**://api.groq.com/**", (r) => r.abort());
    await research(page);
    await upload(page);

    // It is in the sources list, at the top, marked as the user's own.
    const src = page.locator(".src", { hasText: "review.txt" });
    await expect(src).toBeVisible({ timeout: 40_000 });
    await expect(src).toContainText("your upload");
    await expect(src.locator(".tier")).toContainText("T1");
    await expect(page.locator(".src").first()).toContainText("review.txt");

    // The panel says what the upload did, as a number, not as "added".
    const panel = page.locator(".srcdoc");
    await expect(panel).toContainText(/claim(s)? given to the writer/);
    await expect(panel).toContainText("Claims the writer will use");
    // With no model, the claims are the document's own sentences, quoted —
    // and the panel says so rather than passing them off as analysis.
    await expect(panel).toContainText("42 engagements");
    await expect(panel).toContainText("Read without AI");
    /* Nothing invented: a heuristic read cannot produce an insight, so the
       research panel must not grow a "From your document" section here. */
    await expect(page.getByText("From your document")).toHaveCount(0);
  });

  test("with a model behind it, the document changes research and reaches the writer", async ({ page }) => {
    const prompts = [];
    await quiet(page);
    await page.addInitScript(() => {
      if (localStorage.getItem("unison:ai:v1")) return;
      localStorage.setItem("unison:ai:v1", JSON.stringify({
        provider: "groq", keys: { groq: "gsk_e2e_key", anthropic: "" },
        models: { groq: "llama-3.3-70b-versatile", anthropic: "claude-opus-5" }, useLocal: false,
      }));
    });
    await page.route(GROQ, async (route) => {
      const req = route.request();
      if (req.url().endsWith("/models")) return route.fulfill({ json: { data: [{ id: "llama-3.3-70b-versatile" }] } });
      const sent = req.postDataJSON();
      const prompt = JSON.stringify(sent.messages);
      prompts.push(prompt);
      let reply;
      if (/business document/i.test(prompt)) {
        reply = {
          summary: "A quarterly review of the outsourcing practice.",
          facts: ["Clients want a single named point of contact"],
          stats: ["Turnaround fell from 14 days to 9 days", "42 engagements closed, up 18%"],
          insights: ["Reviewer hiring is the ceiling on growth"],
          claims: ["Audit turnaround fell from 14 days to 9 days", "Engagements rose 18% year on year"],
        };
      } else if (/discovery engine/i.test(prompt)) {
        reply = { sources: [{ title: "An industry report", publisher: "Test", date: "2026-09-01", tier: 2, note: "From the model", url: "https://example.com/report" }], claims: [{ text: "A researched claim", sourceIndex: 0 }], insights: ["An insight from the engine"], freshness: "Recent", risks: [] };
      } else if (/content intelligence/i.test(prompt)) {
        reply = { angles: [{ type: "Data-driven", headline: "Turnaround is the number clients notice", rationale: "It is measurable", recommended: true }], reason: "It is the strongest figure." };
      } else {
        reply = { hook: "Audit turnaround is the number clients notice.", body: "We took it from 14 days to 9.", cta: "What is yours?", hashtags: ["#audit"] };
      }
      return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }] } });
    });

    await research(page);
    await upload(page);
    await expect(page.locator(".srcdoc")).toContainText("Claims the writer will use", { timeout: 40_000 });

    // The research panel visibly grows: the document's own insight appears
    // beside the engine's, under its own heading.
    await expect(page.getByText("From your document")).toBeVisible();
    await expect(page.locator(".card", { hasText: "What stood out" })).toContainText("Reviewer hiring is the ceiling on growth");
    await expect(page.locator(".srcdoc")).toContainText("Audit turnaround fell from 14 days to 9 days");

    await page.locator(".angle").first().click();
    await expect(page.locator(".li-body")).toBeVisible({ timeout: 40_000 });

    /* The point of the upload: the writer is told the file exists, is given
       its claims, and is given its figures. Without this the document is
       decoration. */
    const writer = prompts.filter((p) => p.includes("Claims available"));
    expect(writer.length, "the writer must have been asked for a post").toBeGreaterThan(0);
    const all = writer.join(" ");
    expect(all).toContain("review.txt");
    expect(all).toContain("Audit turnaround fell from 14 days to 9 days");
    expect(all).toMatch(/42 engagements|18%/);
  });

  test("the document is still there after the page is reloaded", async ({ page }) => {
    await quiet(page);
    await page.route("**://api.groq.com/**", (r) => r.abort());
    await research(page);
    await upload(page);
    await expect(page.locator(".src", { hasText: "review.txt" })).toBeVisible({ timeout: 40_000 });

    await page.waitForTimeout(1500);   // let the debounced save run
    await page.reload();

    await expect(page.locator(".src", { hasText: "review.txt" })).toBeVisible({ timeout: 40_000 });
    await expect(page.locator(".srcdoc")).toContainText("Claims the writer will use");
    // Once, not twice.
    await expect(page.locator(".src", { hasText: "review.txt" })).toHaveCount(1);
  });
});
