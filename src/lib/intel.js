/* ============================================================
   THE UNISON CONTENT INTELLIGENCE MODEL

   Derived from research, not invented. The pillars below come from posts and
   articles Unison Globus actually published — capacity pressure, tax-season
   readiness, regulatory updates, ROI proof, hiring, employee recognition —
   and from what published analysis says is now working on LinkedIn for
   accounting firms. The country model exists because Unison Globus serves US,
   UK, Australian and Canadian firms, and those four do not share a vocabulary,
   a tax year, or a regulator. Mixing them is the single most damaging factual
   error this product can make: it is invisible to a reader who does not know
   the rules and instantly disqualifying to one who does.

   Nothing here asserts a tax rate, a threshold or a figure. Those change, and
   a constant in a source file is how a product starts lying confidently. What
   this file knows is structural and slow-moving — who the regulator is, what
   a return is called, when the year ends, which domain is authoritative — so
   that research can be pointed at the right place and generated copy can be
   checked for using the wrong country's words.
   ============================================================ */

/* ---------- content pillars ----------
   Observed on the reference account rather than assumed. `cues` are what the
   classifier matches on; `visual` is the default visual format the decision
   table in visual.js starts from. */
export const PILLARS = [
  {
    id: "regulatory",
    label: "Tax or regulatory update",
    note: "A rule, threshold, deadline or filing requirement has changed.",
    visual: "factcard",
    cues: ["deadline", "hmrc", "irs", "ato", "cra", "regulation", "regulatory", "compliance", "legislation", "rule change", "filing", "lodgment", "lodgement", "threshold", "mandate", "effective from", "comes into force", "new rules", "amendment", "act", "statute"],
    factHeavy: true,
  },
  {
    id: "seasonal",
    label: "Season readiness",
    note: "Tax season, year end, quarter end — the calendar is the reason to post.",
    visual: "steps",
    cues: ["tax season", "busy season", "year end", "year-end", "eofy", "end of financial year", "quarter end", "peak season", "filing season", "deadline season", "prepare for", "readiness", "checklist"],
    factHeavy: true,
  },
  {
    id: "capacity",
    label: "Capacity and staffing pressure",
    note: "The firm cannot meet demand with the people it has.",
    visual: "statement",
    cues: ["capacity", "staff shortage", "staffing", "overworked", "burnout", "headcount", "hiring freeze", "workload", "bandwidth", "understaffed", "talent shortage", "attrition", "turnover", "scale", "bottleneck", "longer hours"],
  },
  {
    id: "educational",
    label: "How something works",
    note: "Explains a concept, a process or a distinction.",
    visual: "steps",
    cues: ["how to", "how a", "how we", "what is", "guide", "explained", "step", "process", "sequence", "in order", "difference between", "versus", "understand", "basics", "means that", "works like", "walkthrough", "actually works"],
    factHeavy: true,
  },
  {
    id: "proof",
    label: "Result or case study",
    note: "Something measurable happened to a named or anonymised firm.",
    visual: "stat",
    cues: ["case study", "roi", "result", "reduced", "increased", "saved", "turnaround", "we helped", "client story", "outcome", "before and after", "measured", "cut by"],
    factHeavy: true,
  },
  {
    id: "thought",
    label: "Point of view",
    note: "An argument about where the profession is going. Opinion, owned.",
    visual: "statement",
    cues: ["the future", "i think", "we believe", "my view", "unpopular", "nobody talks about", "shift", "trend", "next decade", "rethink", "here is the problem", "hot take", "prediction"],
  },
  {
    id: "hiring",
    label: "Hiring",
    note: "An open role, with places and requirements.",
    visual: "roles",
    cues: ["we are hiring", "we're hiring", "now hiring", "join our team", "open role", "vacancy", "apply now", "career opportunity", "openings", "job opening", "recruiting", "send your cv", "share your resume"],
  },
  {
    id: "culture",
    label: "Team and culture",
    note: "People, milestones, promotions, anniversaries, life at the firm.",
    visual: "people",
    cues: ["congratulations", "congratulate", "welcome to the team", "anniversary", "promoted", "promotion", "milestone", "proud of", "our team", "celebrat", "achievement", "qualified as", "passed the"],
  },
  {
    id: "occasion",
    label: "Festival or occasion",
    note: "A cultural or national date the firm is marking.",
    visual: "occasion",
    cues: [],          // matched by the occasion detector, not by keyword
  },
  {
    id: "event",
    label: "Event or webinar",
    note: "Something to attend, at a time, with a way in.",
    visual: "event",
    cues: ["webinar", "register", "join us on", "live session", "audio event", "conference", "roundtable", "panel", "rsvp", "save the date", "booth", "speaking at"],
  },
  {
    id: "service",
    label: "What we offer",
    note: "Direct promotion of a service or package.",
    visual: "statement",
    cues: ["our services", "we offer", "package", "get in touch", "book a call", "schedule a call", "talk to us", "partner with us", "contact us today"],
  },
];

export const PILLAR_BY_ID = Object.fromEntries(PILLARS.map((p) => [p.id, p]));

/* ---------- countries ----------
   `terms` are words that only make sense in that jurisdiction, and are what
   the classifier reads and the checker polices. `authorities` are where a
   fact about that country should come from — the primary regulator first.
   `yearEnd` and `keyDates` are structural and stable; every one of them was
   verified against published guidance rather than recalled. */
export const COUNTRIES = {
  US: {
    id: "US", label: "United States", adjective: "US",
    regulator: "IRS",
    terms: ["irs", "form 1040", "1040", "1099", "w-2", "w2", "schedule c", "s corp", "s-corp", "c corp", "llc", "cpa", "enrolled agent", " ea ", "sales tax", "401(k)", "us gaap", "fasb", "aicpa", "sec ", "ppp", "k-1", "estimated tax", "state tax", "franchise tax", "sales and use tax"],
    authorities: ["irs.gov", "aicpa-cima.com", "sec.gov", "fasb.org", "treasury.gov"],
    spelling: "US",                              // organize, analyze, -ize
    yearEnd: "31 December for most filers",
    keyDates: "Individual returns are generally due 15 April; the IRS publishes the exact date each year.",
    money: "USD",
  },
  UK: {
    id: "UK", label: "United Kingdom", adjective: "UK",
    regulator: "HMRC",
    terms: ["hmrc", "self assessment", "self-assessment", "companies house", "vat", "making tax digital", "mtd", "paye", "national insurance", "corporation tax", "icaew", "acca", "frs 102", "uk gaap", "ct600", "p60", "p11d", "sa100", "limited company", "dividend allowance", "capital allowances"],
    authorities: ["gov.uk", "icaew.com", "frc.org.uk", "accaglobal.com"],
    spelling: "UK",                              // organise, analyse, -ise
    yearEnd: "The tax year runs 6 April to 5 April.",
    keyDates: "Paper Self Assessment returns are due 31 October after the tax year ends; online returns and payment are due the following 31 January.",
    money: "GBP",
  },
  AU: {
    id: "AU", label: "Australia", adjective: "Australian",
    regulator: "ATO",
    terms: ["ato", "bas", "business activity statement", "gst", "single touch payroll", "stp", "tfn", "abn", "superannuation", "super guarantee", "cpa australia", "ca anz", "aasb", "asic", "payg", "fbt", "division 7a", "myob", "lodgment", "lodgement"],
    authorities: ["ato.gov.au", "asic.gov.au", "aasb.gov.au", "cpaaustralia.com.au"],
    spelling: "UK",                              // Australian English follows -ise
    yearEnd: "The financial year runs 1 July to 30 June.",
    keyDates: "Self-lodged individual returns are due 31 October. Quarterly BAS are due 28 October, 28 February, 28 April and 28 July.",
    money: "AUD",
  },
  CA: {
    id: "CA", label: "Canada", adjective: "Canadian",
    regulator: "CRA",
    terms: ["cra", "canada revenue", "gst/hst", "hst", "t1", "t2", "t4", "rrsp", "tfsa", "cpa canada", "aspe", "gst hst", "revenu québec", "revenu quebec"],
    authorities: ["canada.ca", "cpacanada.ca"],
    spelling: "US",
    yearEnd: "31 December for individuals.",
    keyDates: "Individual returns are generally due 30 April; the CRA publishes the exact date each year.",
    money: "CAD",
  },
};

export const COUNTRY_IDS = Object.keys(COUNTRIES);

/* Words that belong to exactly one country. Using one of these in a post
   about a different country is the error that matters most, so they are kept
   as an explicit cross-check rather than being inferred. */
export const EXCLUSIVE_TERMS = Object.fromEntries(
  COUNTRY_IDS.map((id) => [id, COUNTRIES[id].terms.filter((t) =>
    !COUNTRY_IDS.some((other) => other !== id && COUNTRIES[other].terms.includes(t)))]),
);

/* ---------- occasions ----------
   Dates that move by the lunar or Hindu calendar are deliberately given no
   fixed date: the detector matches the name, and anything date-driven is left
   to research rather than to a constant that goes stale. `symbols` and
   `palette` exist so a festival graphic can actually look like the festival
   instead of defaulting to a stock businesswoman at a laptop. */
export const OCCASIONS = [
  { id: "diwali", label: "Diwali", aliases: ["diwali", "deepavali", "dipawali", "festival of lights"], region: "IN",
    symbols: ["diya oil lamps", "rangoli pattern", "marigold", "fireworks"], palette: ["#F5A524", "#C7332B", "#5B2E8C"], greeting: "Happy Diwali", moving: true },
  { id: "holi", label: "Holi", aliases: ["holi", "festival of colours", "festival of colors"], region: "IN",
    symbols: ["colour powder", "gulal", "scattered pigment"], palette: ["#E0457B", "#F2B705", "#2E9E5B"], greeting: "Happy Holi", moving: true },
  { id: "eid", label: "Eid", aliases: ["eid", "eid al-fitr", "eid ul fitr", "eid al-adha", "ramadan", "ramzan"], region: "GLOBAL",
    symbols: ["crescent moon", "lantern", "geometric arabesque"], palette: ["#0E7A5F", "#D4AF37", "#0B2E24"], greeting: "Eid Mubarak", moving: true },
  { id: "christmas", label: "Christmas", aliases: ["christmas", "xmas", "yuletide"], region: "GLOBAL",
    symbols: ["evergreen", "star", "warm string lights"], palette: ["#0F5132", "#A4161A", "#F2E8CF"], greeting: "Merry Christmas", date: "12-25" },
  { id: "newyear", label: "New Year", aliases: ["new year", "new year's", "happy new year"], region: "GLOBAL",
    symbols: ["fireworks", "clean horizon line", "forward arrow"], palette: ["#1B2A5B", "#C9A227", "#F5F5F0"], greeting: "Happy New Year", date: "01-01" },
  { id: "thanksgiving", label: "Thanksgiving", aliases: ["thanksgiving"], region: "US",
    symbols: ["autumn leaves", "harvest table", "wheat"], palette: ["#8C4B1F", "#D98324", "#F0E3D2"], greeting: "Happy Thanksgiving", moving: true },
  { id: "easter", label: "Easter", aliases: ["easter", "good friday"], region: "GLOBAL",
    symbols: ["spring shoots", "soft pastel arc"], palette: ["#6B9BD1", "#F2C5A0", "#FAF6EF"], greeting: "Happy Easter", moving: true },
  { id: "australiaday", label: "Australia Day", aliases: ["australia day"], region: "AU",
    symbols: ["southern cross", "coastline"], palette: ["#00247D", "#CF142B", "#FFFFFF"], greeting: "", date: "01-26",
    care: "Australia Day is contested. Keep it factual and low-key, or mark the long weekend instead." },
  { id: "independenceday", label: "Independence Day", aliases: ["independence day", "fourth of july", "4th of july"], region: "US",
    symbols: ["fireworks", "flag-inspired stripes"], palette: ["#0A3161", "#B31942", "#FFFFFF"], greeting: "Happy Fourth", date: "07-04" },
  { id: "internationalwomensday", label: "International Women's Day", aliases: ["international women's day", "womens day", "women's day", "iwd"], region: "GLOBAL",
    symbols: ["portrait grid", "upward line"], palette: ["#6A1B9A", "#E91E63", "#FFF3E0"], greeting: "", date: "03-08",
    care: "Say what the firm actually does about it. A purple graphic on its own reads as decoration." },
];

const lower = (s) => String(s || "").toLowerCase();

/* Substring matching is not good enough here, and the way it fails is
   embarrassing rather than subtle: "irs" matches inside "first", "cra"
   inside "scramble", "bas" inside "based", "ato" inside "automation". A
   monthly-close post was being read as a US tax update because its call to
   action ended in "first". So a term has to sit on word boundaries.

   Cues are matched as stems — boundary at the front, any ending allowed — so
   "filing" catches "filings" and "celebrat" catches "celebrating", which is
   what those entries are written for. */
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cache = new Map();
const matcher = (term, stem) => {
  const key = `${stem ? "s" : "w"}:${term}`;
  let re = cache.get(key);
  if (!re) {
    re = new RegExp(`(?<![a-z0-9])${esc(term.trim())}${stem ? "" : "(?![a-z0-9])"}`, "i");
    cache.set(key, re);
  }
  return re;
};
const hasTerm = (hay, term) => matcher(term, false).test(hay);
/* Only a cue long enough to have a distinctive stem is matched as one. A
   short cue matched as a stem is worse than useless: "act" caught
   "actually", which made a monthly-close post read as a regulatory update
   and an Australian year-end checklist read as one too. */
const hasCue = (hay, cue) => matcher(cue, cue.trim().length >= 5).test(hay);
const countHits = (hay, needles, stem = false) =>
  needles.reduce((n, t) => (stem ? hasCue(hay, t) : hasTerm(hay, t)) ? n + 1 : n, 0);

/* ---------- detection ---------- */

export function detectCountry(text) {
  const hay = ` ${lower(text)} `;
  const scores = COUNTRY_IDS.map((id) => ({ id, score: countHits(hay, COUNTRIES[id].terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scores.length) return { country: null, confident: false, mixed: [] };
  /* Two jurisdictions' vocabularies in one post is either a deliberate
     comparison or a mistake. Either way the caller has to know. */
  const mixed = scores.filter((x) => x.score >= 2).map((x) => x.id);
  const top = scores[0];
  const runnerUp = scores[1]?.score || 0;
  return { country: top.id, confident: top.score >= 2 && top.score > runnerUp, mixed: mixed.length > 1 ? mixed : [] };
}

export function detectOccasion(text) {
  const hay = ` ${lower(text)} `;
  for (const o of OCCASIONS) {
    if (o.aliases.some((a) => hasTerm(hay, a))) return o;
  }
  return null;
}

export const occasionById = (id) => OCCASIONS.find((o) => o.id === id) || null;

/* A figure worth putting on a graphic — and worth checking before it goes
   out. Percentages, multiples, money and counts with a unit. */
export const STAT_RE = /(\d{1,3}(?:[.,]\d+)?\s?%)|(\b\d+(?:\.\d+)?x\b)|([$£€₹]\s?\d[\d,.]*\s?(?:k|m|bn|billion|million)?)|(\b\d{1,3}(?:,\d{3})+\b)|(\b\d+(?:\.\d+)?\s?(?:hours?|days?|weeks?|months?|years?|fte|staff|firms?|clients?|returns?)\b)/gi;

/* The sentence's full stop is not part of the figure. Leaving it on meant
   "£50,000." never matched the "£50,000" research had actually supplied, and
   a properly sourced number was reported as invented. */
export const findStats = (text) =>
  [...String(text || "").matchAll(STAT_RE)].map((m) => m[0].trim().replace(/[.,;:]+$/, "")).filter(Boolean);

/* ---------- the classifier ----------
   Deterministic and cheap: it runs on every draft, with no model call and no
   network. A model can refine the result afterwards, but the product must
   still behave sensibly when there is no key, no quota and no connection. */
export function classify({ hook = "", body = "", cta = "", topic = "", hashtags = [] } = {}) {
  const text = [topic, hook, body, cta, (hashtags || []).join(" ")].filter(Boolean).join("\n");
  const hay = ` ${lower(text)} `;

  const occasion = detectOccasion(text);
  const scored = PILLARS
    .map((p) => ({ id: p.id, score: countHits(hay, p.cues, true) }))
    .sort((a, b) => b.score - a.score);

  /* An occasion post is an occasion post whatever else it mentions — the
     greeting is the message. */
  let pillar = occasion ? "occasion" : (scored[0].score > 0 ? scored[0].id : "thought");
  const runnerUp = occasion ? null : (scored[1]?.score ? scored[1].id : null);

  const { country, confident, mixed } = detectCountry(text);
  const stats = findStats(text);

  return {
    pillar,
    pillarLabel: PILLAR_BY_ID[pillar]?.label || pillar,
    alternative: runnerUp,
    confidence: occasion ? "high" : scored[0].score >= 3 ? "high" : scored[0].score >= 1 ? "medium" : "low",
    country,
    countryConfident: confident,
    mixedCountries: mixed,
    occasion: occasion ? occasion.id : null,
    stats,
    factHeavy: !!PILLAR_BY_ID[pillar]?.factHeavy || stats.length > 0,
  };
}

/* What research should be pointed at, given a classification. Used to steer
   the discovery prompt rather than to fetch anything directly. */
export function researchGuidance(cls) {
  const c = cls.country ? COUNTRIES[cls.country] : null;
  const lines = [];
  if (c) {
    lines.push(`This is a ${c.adjective} topic. Use ${c.adjective} terminology and ${c.regulator} rules only.`);
    lines.push(`Prefer sources from: ${c.authorities.join(", ")}.`);
    lines.push(c.yearEnd);
    lines.push(c.keyDates);
    lines.push(`Do not cite ${COUNTRY_IDS.filter((x) => x !== c.id).map((x) => COUNTRIES[x].regulator).join(", ")} rules for this post.`);
  } else {
    lines.push("No single country is implied. Either keep the post jurisdiction-neutral or state plainly which country it applies to.");
  }
  if (cls.factHeavy) {
    lines.push("This topic carries facts that go stale. Every rate, threshold and date must come from a source and be dated. If a figure cannot be sourced, leave it out rather than estimating it.");
  }
  return lines;
}
