

/* ---------- seed data ---------- */

export const SEED_POSTS = [
  { id: "p-201", title: "Why procurement is the real AI bottleneck", state: "HUMAN_REVIEW", date: "2026-08-26" },
  { id: "p-202", title: "Three questions to ask before you buy an AI tool", state: "HUMAN_REVIEW", date: "2026-08-26" },
  { id: "p-203", title: "What our support team learned in 90 days", state: "HUMAN_REVIEW", date: "2026-08-25" },
  { id: "p-198", title: "AI agents in enterprise software", state: "PUBLISHED", date: "2026-08-19", metrics: { impressions: 14820, reactions: 386, comments: 74, shares: 41, clicks: 512 } },
  { id: "p-195", title: "The quiet cost of unverified content", state: "PUBLISHED", date: "2026-08-12", metrics: { impressions: 9110, reactions: 211, comments: 33, shares: 18, clicks: 274 } },
  { id: "p-207", title: "Q3 customer roundup", state: "SCHEDULED", date: "2026-09-02" },
];

/* Home holds the composer, so there is no separate "New". "Drafts" is the
   list of unfinished posts; the open workspace lives under it. */
export const NAV = [["home", "Home"], ["discover", "Discover"], ["drafts", "Drafts"], ["content", "Content"], ["calendar", "Calendar"], ["insights", "Insights"]];
export const navKey = (view) => (view === "workspace" ? "drafts" : view);

export const RAIL = [
  { key: "idea", label: "Idea", engine: "Orchestrator" },
  { key: "research", label: "Research", engine: "Discovery" },
  { key: "angles", label: "Angles", engine: "Intelligence" },
  { key: "draft", label: "Draft", engine: "Brand writer" },
  { key: "evidence", label: "Evidence", engine: "Trust" },
  { key: "health", label: "Health", engine: "Trust" },
  { key: "media", label: "Media", engine: "Media" },
  { key: "approval", label: "Approval", engine: "Human" },
  { key: "schedule", label: "Schedule", engine: "Scheduler" },
  { key: "published", label: "Performance", engine: "Learning" },
];

export const ENGINES = [
  { tag: "Discovery", title: "Finds the story, then proves it", body: "Scans the live web for what moved in your category, ranks each story by urgency and by whether your Page has covered it, and keeps every link attached." },
  { tag: "Intelligence", title: "Four angles, one recommendation", body: "Turns raw research into distinct positions — contrarian, educational, industry, data-led — and says which one fits your Page and why." },
  { tag: "Brand writer", title: "Your voice, expressed as numbers", body: "Drafts against a measured voice profile: formality, opinion strength, technical depth, banned vocabulary. Move a slider, get a different draft." },
  { tag: "Trust", title: "Every claim tied to a source", body: "Marks each factual statement green, amber or red, shows you exactly where it sits in the post, and blocks approval when it cannot be supported." },
  { tag: "Media", title: "Brand visuals written as code", body: "Generates a real branded SVG for the post — your palette, your type, LinkedIn's aspect ratio — that you can download and reuse." },
  { tag: "Learning", title: "Why it worked, not just how it did", body: "Reads performance against your history and returns likely reasons plus a next topic. Correlation stays labelled as correlation." },
];

export const FAQ = [
  { q: "Does Unison publish on its own?", a: "No. Research, writing, verification, media and scheduling are automated, but a human approves before anything reaches LinkedIn. That rule sits in the state machine, not in a setting." },
  { q: "Where do trending stories come from?", a: "Live web search across news, company newsrooms, industry press and public pages. LinkedIn has no free public API for trending content and scraping it breaks their terms, so nothing here claims to read LinkedIn's feed." },
  { q: "What happens when a claim can't be verified?", a: "It turns amber or red in the evidence panel. Amber needs a human decision, red blocks approval. You can replace the source, rewrite the claim, drop it, or send it back for more research." },
  { q: "What if publishing fails?", a: "The draft is preserved, the attempt is logged with an idempotency key, and you get a plain explanation with retry, reconnect and edit as next steps." },
];

export const REJECT_REASONS = ["Wrong tone", "Wrong angle", "Fact needs correction", "Too generic", "Too promotional", "Weak hook", "Needs stronger evidence", "Incorrect audience"];

export const DEFAULT_VOICE = {
  professional: 78, conversational: 62, technical: 48, opinionated: 82, humour: 18, emoji: 8,
  cta: "Question-based", paragraphs: "Short", hashtags: "2–3",
  avoid: ["leverage", "synergy", "game-changer", "in today's fast-paced world"],
  prefer: ["operators", "evidence", "workflow", "shipped"],
};

export const SEED_TEAM = [
  { name: "Jaynil A.", email: "jaynil@acme.systems", role: "Owner" },
  { name: "Krunal P.", email: "krunal@acme.systems", role: "Admin" },
  { name: "Priya S.", email: "priya@acme.systems", role: "Creator" },
  { name: "Daniel R.", email: "daniel@acme.systems", role: "Reviewer" },
];

export const DEFAULT_PROFILE = { industry: "Enterprise software", audience: "Marketing and RevOps leaders", keywords: "AI agents, automation, buying process" };
