/* ============================================================
   FREE, KEYLESS PUBLIC APIS
   Each helper is optional, fails soft (throws a tagged error the caller can
   show or ignore) and never blocks the main workflow. All of them answer
   cross-origin requests from a browser without a key.
     · Hacker News (Algolia)    — trending stories for Discover
     · Wikipedia                — background context for Research
     · LanguageTool             — grammar and style check on the draft
     · Nager.Date               — public holidays for the schedule warning
     · Pollinations.ai          — optional AI-generated post image
   ============================================================ */

export const FREE_APIS = {
  hn: { id: "hn", label: "Hacker News trending", url: "https://hn.algolia.com/api/v1/search", note: "Real stories with links for Discover when live web search is unavailable." },
  wikipedia: { id: "wikipedia", label: "Wikipedia background", url: "https://en.wikipedia.org/w/api.php", note: "Adds an encyclopaedic background source to research." },
  languagetool: { id: "languagetool", label: "LanguageTool grammar check", url: "https://api.languagetool.org/v2/check", note: "Checks the draft for spelling, grammar and style. Text is sent to languagetool.org." },
  holidays: { id: "holidays", label: "Public holidays (Nager.Date)", url: "https://date.nager.at/api/v3/PublicHolidays", note: "Warns when a scheduled date is a public holiday in the chosen timezone's country." },
  pollinations: { id: "pollinations", label: "Pollinations AI images", url: "https://image.pollinations.ai/prompt/", note: "Generates a photographic post image from the creative brief. Off by default — the branded renderer stays the default." },
};
export const DEFAULT_EXTRAS = { hn: true, wikipedia: true, languagetool: true, holidays: true, pollinations: false };

const tagged = (message, kind, extra = {}) => Object.assign(new Error(message), { kind, ...extra });
const withTimeout = (ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };

async function getJSON(url, { timeoutMs = 8000, init } = {}) {
  const { signal, done } = withTimeout(timeoutMs);
  let res;
  try { res = await fetch(url, { ...init, signal }); }
  catch (e) { done(); throw tagged(e?.name === "AbortError" ? "Timed out." : "Unreachable from this browser.", e?.name === "AbortError" ? "timeout" : "network", { cause: e }); }
  done();
  if (!res.ok) throw tagged(`HTTP ${res.status}`, "http", { status: res.status });
  try { return await res.json(); } catch { throw tagged("Unreadable reply.", "unreadable"); }
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const stripTags = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/* ---------- Hacker News ---------- */
export async function hnStories(query, { limit = 6, days = 21, minPoints = 20 } = {}) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const q = new URLSearchParams({ query: String(query || "").slice(0, 200), tags: "story", hitsPerPage: String(Math.min(50, limit * 3)), numericFilters: `created_at_i>${since},points>${minPoints}` });
  const data = await getJSON(`${FREE_APIS.hn.url}?${q}`);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return hits
    .filter((h) => h && h.title)
    .map((h) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      publisher: h.url ? hostOf(h.url) : "news.ycombinator.com",
      points: h.points || 0,
      comments: h.num_comments || 0,
      date: String(h.created_at || "").slice(0, 10),
      discussion: `https://news.ycombinator.com/item?id=${h.objectID}`,
    }))
    .sort((a, b) => (b.points + b.comments * 2) - (a.points + a.comments * 2))
    .slice(0, limit);
}

/* Turn stories into the shape Discover renders. Score is a rough urgency mix
   of recency and engagement; gap is unknown because nothing has compared them
   to the Page's history — the UI says so. */
export function hnToOpportunities(stories, { now = Date.now() } = {}) {
  return stories.map((s) => {
    const ageDays = Math.max(0, (now - Date.parse(s.date || "")) / 86400000);
    const recency = Math.max(0, 40 - ageDays * 2);
    const heat = Math.min(60, Math.log10(1 + s.points + s.comments * 2) * 20);
    return {
      headline: s.title, summary: `${s.points} points · ${s.comments} comments on Hacker News`, publisher: s.publisher, url: s.url, date: s.date,
      score: Math.round(Math.min(99, recency + heat)), whyNow: ageDays < 3 ? "Being discussed right now." : `Discussed ${Math.round(ageDays)} days ago and still ranking.`,
      gap: "unknown", angle: "Industry insight", via: "hn",
    };
  });
}

/* ---------- Wikipedia ---------- */
export async function wikiSearch(query, { limit = 3 } = {}) {
  const q = new URLSearchParams({ action: "query", list: "search", srsearch: String(query || "").slice(0, 300), format: "json", origin: "*", srlimit: String(limit), srprop: "snippet|timestamp" });
  const data = await getJSON(`${FREE_APIS.wikipedia.url}?${q}`);
  const rows = data?.query?.search || [];
  return rows.map((r) => ({
    title: r.title,
    snippet: stripTags(r.snippet),
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, "_"))}`,
    date: String(r.timestamp || "").slice(0, 10),
  }));
}
/* As a research source row (tier 3 — reference material, not evidence for claims). */
export const wikiToSources = (rows) => rows.map((r) => ({ title: r.title, publisher: "Wikipedia", date: r.date, tier: 3, note: `Background: ${r.snippet.slice(0, 140)}${r.snippet.length > 140 ? "…" : ""}`, url: r.url, background: true }));

/* ---------- LanguageTool ---------- */
export async function grammarCheck(text, { language = "en-US", timeoutMs = 15000 } = {}) {
  const t = String(text || "").slice(0, 20000);
  if (!t.trim()) return [];
  const body = new URLSearchParams({ text: t, language, enabledOnly: "false", level: "default" });
  const data = await getJSON(FREE_APIS.languagetool.url, { timeoutMs, init: { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() } });
  return (data?.matches || []).map((m) => ({
    message: m.shortMessage || m.message,
    detail: m.message,
    offset: m.offset, length: m.length,
    text: t.slice(m.offset, m.offset + m.length),
    replacements: (m.replacements || []).map((r) => r.value).filter(Boolean).slice(0, 3),
    category: m.rule?.category?.name || m.rule?.issueType || "Style",
    ruleId: m.rule?.id || "",
  }));
}
/* Apply one replacement to the text. */
export const applyReplacement = (text, match, value) => text.slice(0, match.offset) + value + text.slice(match.offset + match.length);

/* ---------- Public holidays ---------- */
const holidayCache = new Map();
export async function publicHolidays(year, countryCode) {
  if (!countryCode) return [];
  const key = `${year}-${countryCode}`;
  if (holidayCache.has(key)) return holidayCache.get(key);
  const p = getJSON(`${FREE_APIS.holidays.url}/${year}/${countryCode}`).then((rows) => (Array.isArray(rows) ? rows : []).map((h) => ({ date: h.date, name: h.localName || h.name, englishName: h.name, national: h.global !== false })));
  holidayCache.set(key, p);
  p.catch(() => holidayCache.delete(key));
  return p;
}
export async function holidayOn(dateISO, countryCode) {
  if (!dateISO || !countryCode) return null;
  const rows = await publicHolidays(String(dateISO).slice(0, 4), countryCode);
  return rows.find((h) => h.date === dateISO) || null;
}

/* ---------- Pollinations image ---------- */
export function pollinationsUrl(prompt, { width = 1200, height = 630, seed } = {}) {
  const p = encodeURIComponent(String(prompt || "abstract professional brand imagery").slice(0, 600));
  const q = new URLSearchParams({ width: String(width), height: String(height), nologo: "true", enhance: "false" });
  if (seed != null) q.set("seed", String(seed));
  return `${FREE_APIS.pollinations.url}${p}?${q}`;
}
/* The image is displayed by URL; for publishing it is fetched into base64. */
export async function fetchImageAsDataUrl(url, { timeoutMs = 60000 } = {}) {
  const { signal, done } = withTimeout(timeoutMs);
  let res;
  try { res = await fetch(url, { mode: "cors", signal }); }
  catch (e) { done(); throw tagged("The image could not be fetched for sending.", e?.name === "AbortError" ? "timeout" : "network"); }
  done();
  if (!res.ok) throw tagged(`HTTP ${res.status}`, "http", { status: res.status });
  const blob = await res.blob();
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(tagged("Unreadable image.", "unreadable")); r.readAsDataURL(blob); });
}
