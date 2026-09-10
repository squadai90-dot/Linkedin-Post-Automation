

/* ---------- seed data ----------
   Example rows so the screens are not empty on a first run. Every one is
   flagged `sample: true` so the UI can label it and the team can clear them
   in one action. Dates are relative to today, so the demo never looks stale
   and a sample post is never "overdue" on day one. */

import { addDays, todayISO } from "./dates.js";

const day = (n) => addDays(todayISO(), n);

export const SEED_POSTS = [
  { id: "p-201", title: "Why procurement is the real AI bottleneck", state: "HUMAN_REVIEW", date: day(-2), sample: true },
  { id: "p-202", title: "Three questions to ask before you buy an AI tool", state: "HUMAN_REVIEW", date: day(-2), sample: true },
  { id: "p-203", title: "What our support team learned in 90 days", state: "HUMAN_REVIEW", date: day(-3), sample: true },
  { id: "p-198", title: "AI agents in enterprise software", state: "PUBLISHED", date: day(-14), sample: true, metrics: { impressions: 14820, reactions: 386, comments: 74, shares: 41, clicks: 512 } },
  { id: "p-195", title: "The quiet cost of unverified content", state: "PUBLISHED", date: day(-21), sample: true, metrics: { impressions: 9110, reactions: 211, comments: 33, shares: 18, clicks: 274 } },
  { id: "p-207", title: "Q3 customer roundup", state: "SCHEDULED", date: day(4), time: "09:30", sample: true },
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

/* No invented colleagues. The team list starts empty and the workspace
   settings explain what it is for. */
export const SEED_TEAM = [];

export const DEFAULT_PROFILE = {
  company: "", website: "", followers: "", userName: "",
  industry: "Enterprise software", audience: "Marketing and RevOps leaders", keywords: "AI agents, automation, buying process",
};
