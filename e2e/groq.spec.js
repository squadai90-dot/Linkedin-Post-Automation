import { test, expect } from "@playwright/test";

/* The Groq path, exercised through the real bundled app in a real browser
   with api.groq.com intercepted.
 *
 * What this proves: the request Unison sends is a valid Groq chat-completions
 * call, the reply is parsed, and every failure the free tier can produce
 * reaches the user as advice rather than a stack trace.
 *
 * What it cannot prove: that Groq itself accepts the request from a browser
 * origin. That needs one real call — Settings -> AI -> Test connection. */

const GROQ = "**://api.groq.com/openai/v1/**";

/* Everything else stays off the network so a failure here is about Groq. */
const quiet = async (page) => {
  await page.route("**://api.anthropic.com/**", (r) => r.abort());
  await page.route("**://hook.*.make.com/**", (r) => r.abort());
  await page.route("**://hn.algolia.com/**", (r) => r.fulfill({ json: { hits: [] } }));
  await page.route("**://en.wikipedia.org/**", (r) => r.fulfill({ json: { query: { search: [] } } }));
  await page.route("**://api.languagetool.org/**", (r) => r.fulfill({ json: { matches: [] } }));
  await page.route("**://date.nager.at/**", (r) => r.fulfill({ json: [] }));
  await page.route("**/api/ai", (r) => r.fulfill({ status: 404, json: {} })); // no relay: take the direct path
};

/* Replies the app asks for, keyed by the shape each engine expects. */
const replyFor = (prompt) => {
  if (/opportunity engine/i.test(prompt)) {
    return { items: [{ headline: "Groq wired in", summary: "Live reply", publisher: "Test", url: "https://example.com/a", date: "2026-09-01", score: 91, whyNow: "Proves the path", gap: "open", angle: "Educational" }] };
  }
  if (/discovery engine/i.test(prompt)) {
    return { sources: [{ title: "A real source", publisher: "Test", date: "2026-09-01", tier: 1, note: "From the model", url: "https://example.com/s" }], claims: [{ text: "A checked claim", sourceIndex: 0 }], insights: ["An insight from Groq"], freshness: "Recent", risks: [] };
  }
  return { angles: [], hook: "", body: "", cta: "", hashtags: [] };
};

const captured = [];
const mockGroq = (page, { status = 200, body = null, exposeQuota = true } = {}) =>
  page.route(GROQ, async (route) => {
    const req = route.request();
    if (req.url().endsWith("/models")) {
      return route.fulfill({ json: { data: [{ id: "llama-3.3-70b-versatile" }, { id: "openai/gpt-oss-120b" }, { id: "whisper-large-v3" }] } });
    }
    const sent = req.postDataJSON();
    captured.push({ headers: req.headers(), body: sent });
    if (status !== 200) return route.fulfill({ status, json: body });
    const prompt = JSON.stringify(sent.messages);
    return route.fulfill({
      headers: {
        "x-ratelimit-limit-requests": "1000", "x-ratelimit-remaining-requests": "994", "x-ratelimit-reset-requests": "7h12m",
        /* A browser can only read these across origins when the server lists
           them here. Without it the numbers are invisible to any frontend. */
        ...(exposeQuota ? { "access-control-expose-headers": "x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-ratelimit-reset-requests" } : {}),
      },
      json: { choices: [{ message: { content: JSON.stringify(replyFor(prompt)) }, finish_reason: "stop" }] },
    });
  });

/* Put a key in before the app boots, so it starts configured. */
const withKey = (page) => page.addInitScript(() => {
  localStorage.setItem("unison:ai:v1", JSON.stringify({ provider: "groq", keys: { groq: "gsk_e2e_key", anthropic: "" }, models: { groq: "llama-3.3-70b-versatile", anthropic: "claude-opus-5" }, useLocal: false }));
});

test.describe("Groq", () => {
  test.skip(({ isMobile }) => isMobile);
  test.beforeEach(() => { captured.length = 0; });

  test("sends a valid chat-completions request and renders the reply", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message)));
    await quiet(page);
    await withKey(page);
    await mockGroq(page);
    await page.goto("/");

    await page.getByPlaceholder("What is this post about?").fill("Why approval workflows decide AI rollouts");
    await page.getByRole("button", { name: "Start" }).click();

    // The model's own words reach the screen — not a fallback dressed up.
    await expect(page.getByText("An insight from Groq")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText("A real source")).toBeVisible();
    await expect(page.getByText(/these are placeholders/)).toHaveCount(0);

    // Research searches the web, so it goes to the compound model — and that
    // model rejects every tuning parameter, so it must be sent none of them.
    const search = captured.find((c) => /discovery engine/.test(JSON.stringify(c.body.messages)));
    expect(search, "the research engine called Groq").toBeTruthy();
    expect(search.headers.authorization).toBe("Bearer gsk_e2e_key");
    expect(search.body.model).toBe("groq/compound");
    expect(Object.keys(search.body).sort()).toEqual(["messages", "model"]);

    // The follow-up call does not search, so it takes the chosen model and
    // the full OpenAI parameter set.
    const plain = captured.find((c) => /content intelligence/.test(JSON.stringify(c.body.messages)));
    expect(plain, "the angle engine called Groq").toBeTruthy();
    expect(plain.body.model).toBe("llama-3.3-70b-versatile");
    expect(plain.body.messages[0].role).toBe("system");
    expect(plain.body.messages.at(-1).role).toBe("user");
    expect(plain.body.response_format).toEqual({ type: "json_object" });
    expect(plain.body.max_completion_tokens).toBeGreaterThan(0);
    expect(plain.body.max_tokens).toBeUndefined();  // that is Anthropic's field
    expect(errors).toEqual([]);
  });

  test("shows the daily allowance the reply reported", async ({ page }) => {
    await quiet(page);
    await withKey(page);
    await mockGroq(page);
    await page.goto("/");

    await page.getByPlaceholder("What is this post about?").fill("Anything at all");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("An insight from Groq")).toBeVisible({ timeout: 40_000 });

    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("tab", { name: "AI" }).click();
    // The number that matters on a free tier is what is left, not what failed.
    await expect(page.getByText(/994 of 1000 requests/)).toBeVisible({ timeout: 20_000 });
  });

  test("stays quiet about the allowance when the provider does not expose it", async ({ page }) => {
    // Groq may or may not send access-control-expose-headers. If it does not,
    // the panel must be absent rather than reporting a confident zero.
    await quiet(page);
    await withKey(page);
    await mockGroq(page, { exposeQuota: false });
    await page.goto("/");

    await page.getByPlaceholder("What is this post about?").fill("Anything at all");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("An insight from Groq")).toBeVisible({ timeout: 40_000 });

    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("tab", { name: "AI" }).click();
    await expect(page.getByText(/Free allowance left/)).toHaveCount(0);
  });

  test("refreshes the model list from the key rather than a list we shipped", async ({ page }) => {
    await quiet(page);
    await withKey(page);
    await mockGroq(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("tab", { name: "AI" }).click();
    await page.getByRole("button", { name: "Refresh model list" }).click();

    const options = page.locator("select").first().locator("option");
    await expect(options).toHaveCount(2, { timeout: 15_000 });   // the speech model is dropped
    await expect(options.first()).toHaveText(/Llama 3.3 70B/);
  });

  test("explains a rejected key instead of failing silently", async ({ page }) => {
    await quiet(page);
    await withKey(page);
    await mockGroq(page, { status: 401, body: { error: { message: "Invalid API Key" } } });
    await page.goto("/");

    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await page.getByRole("tab", { name: "AI" }).click();
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText(/Invalid API Key|rejected/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("falls back to labelled sample data when the daily limit is spent", async ({ page }) => {
    await quiet(page);
    await withKey(page);
    await mockGroq(page, { status: 429, body: { error: { message: "Rate limit reached for model llama-3.3-70b-versatile: tokens per day (TPD)" } } });
    await page.goto("/");

    await page.getByPlaceholder("What is this post about?").fill("Anything at all");
    await page.getByRole("button", { name: "Start" }).click();
    // A spent quota must not read as a real result.
    await expect(page.getByText(/these are placeholders, not real sources/)).toBeVisible({ timeout: 40_000 });
  });
});
