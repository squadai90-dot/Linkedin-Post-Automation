/* ============================================================
   POLL INTELLIGENCE

   The poll was the one format the content-intelligence work never reached.
   It had a single prompt, a single canned fallback question about content
   workflows, and no validation beyond LinkedIn's character counts — so a
   post about Australian payroll and a post about hiring both fell back to
   "What actually slows your content down?".

   What makes a poll worth answering is narrow: one clear question, options
   that are genuinely different from each other, no option written to be the
   obvious answer, and nothing presented as a finding when it is only a
   question. That is what this file decides and checks.

   The limits are LinkedIn's real ones — 140 characters for the question, 30
   per option, two to four options, one day to two weeks — confirmed against
   published guidance and matching what the publisher and both Make scenarios
   already enforce. They are not guesses.
   ============================================================ */

import { COUNTRIES, findStats } from "./intel.js";

export const LIMITS = {
  question: 140,
  option: 30,
  minOptions: 2,
  maxOptions: 4,
  durations: ["1 day", "3 days", "1 week", "2 weeks"],
  defaultDuration: "1 week",
};

/* The kinds of poll worth asking, and what each is for. `fits` scores a
   classification so the style follows the post rather than a rotation. */
export const POLL_STYLES = [
  {
    id: "challenge",
    label: "Challenge",
    note: "Which version of a shared problem the reader actually has.",
    ask: "Ask which form of the problem the post describes the reader recognises in their own firm. The options are different causes, not degrees of severity.",
    fits: (cls) => (["capacity", "seasonal"].includes(cls?.pillar) ? 3 : 1),
  },
  {
    id: "practice",
    label: "Business practice",
    note: "How the reader's firm actually does the thing.",
    ask: "Ask how the reader's firm currently handles the specific process the post describes. The options are real alternative practices.",
    fits: (cls) => (["educational", "thought"].includes(cls?.pillar) ? 3 : 1),
  },
  {
    id: "adoption",
    label: "Adoption",
    note: "How far along the reader is with something.",
    ask: "Ask how far the reader's firm has got with the change the post describes. The options are stages, in order, and must not overlap.",
    fits: (cls) => (["regulatory", "thought"].includes(cls?.pillar) ? 3 : 1),
  },
  {
    id: "knowledge",
    label: "Knowledge check",
    note: "Whether the reader knows a fact the post then confirms.",
    ask: "Ask a factual question the post itself answers. Exactly one option must be correct, and the post must contain the answer.",
    /* Only where the post carries a sourced fact to be right about. */
    fits: (cls) => (cls?.pillar === "regulatory" && cls?.factHeavy ? 3 : 0),
    factual: true,
  },
  {
    id: "experience",
    label: "Experience",
    note: "What happened when the reader tried it.",
    ask: "Ask what actually happened when the reader did the thing the post describes. The options are outcomes, not opinions about outcomes.",
    fits: (cls) => (cls?.pillar === "proof" ? 3 : 1),
  },
  {
    id: "preference",
    label: "Preference",
    note: "Which of several defensible choices the reader would make.",
    ask: "Ask which approach the reader would choose. Every option must be a defensible professional choice — none of them a straw man.",
    fits: () => 1,
  },
];

export const STYLE_BY_ID = Object.fromEntries(POLL_STYLES.map((s) => [s.id, s]));

export function pollStyleFor(cls) {
  const scored = POLL_STYLES.map((s) => ({ s, n: s.fits(cls) })).sort((a, b) => b.n - a.n);
  return scored[0].n > 0 ? scored[0].s : STYLE_BY_ID.preference;
}

/* ---------- validation ----------
   Findings, not a score. Each names what is wrong and what to do about it,
   because "low quality" tells the user nothing they can act on. */

const lower = (s) => String(s || "").toLowerCase();
/* Light stemming before comparison. "Not enough staff" and "not enough
   staffing" are the same option worded twice, and a reader who picks one
   could just as well have picked the other — but as raw tokens they only
   overlap two words in three and slipped through. */
const stem = (w) => w.replace(/(?:ings?|ed|es|s)$/, "");
const words = (s) => new Set(lower(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2).map(stem).filter(Boolean));
const overlap = (a, b) => {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.min(A.size, B.size);
};

/* Wording that makes one option the obvious answer. */
/* "Always", "never" and "everyone" are deliberately absent: as OPTIONS they
   are an ordinary frequency scale ("Always / Sometimes / Never"), and
   flagging those as loaded made a perfectly balanced poll look broken. What
   is left is wording that praises or belittles one choice. */
const LOADED = ["best", "worst", "obviously", "of course", "simply", "just", "easily", "smart", "stupid", "proper", "correct way", "the right", "no-brainer", "pointless"];
/* Options that are not really options. */
const NON_ANSWERS = ["all of the above", "none of the above", "n/a", "not applicable", "it depends", "other (please specify)"];

const finding = (id, severity, message, fix) => ({ id, severity, message, fix });

export function checkPoll(poll, { classification = {}, content = {}, style = null } = {}) {
  const out = [];
  if (!poll) return out;
  const q = String(poll.question || "").trim();
  const opts = (poll.options || []).map((o) => String(o || "").trim()).filter(Boolean);

  /* --- LinkedIn's own limits. Blocking, because the post will be rejected. --- */
  if (!q) out.push(finding("poll-no-question", "blocking", "The poll has no question.", "Write one."));
  if (q.length > LIMITS.question) {
    out.push(finding("poll-question-long", "blocking", `The question is ${q.length} characters; LinkedIn allows ${LIMITS.question}.`, "Shorten it to one sentence."));
  }
  if (opts.length < LIMITS.minOptions) {
    out.push(finding("poll-too-few", "blocking", `${opts.length} option${opts.length === 1 ? "" : "s"}. LinkedIn needs at least ${LIMITS.minOptions}.`, "Add another real alternative."));
  }
  if (opts.length > LIMITS.maxOptions) {
    out.push(finding("poll-too-many", "blocking", `${opts.length} options. LinkedIn allows ${LIMITS.maxOptions}.`, "Merge or drop the weakest."));
  }
  const long = opts.filter((o) => o.length > LIMITS.option);
  if (long.length) {
    out.push(finding("poll-option-long", "blocking", `${long.length} option${long.length === 1 ? " is" : "s are"} over ${LIMITS.option} characters: ${long.map((o) => `"${o}"`).join(", ")}.`, "LinkedIn truncates them — cut to a few words."));
  }
  if (poll.duration && !LIMITS.durations.includes(poll.duration)) {
    out.push(finding("poll-duration", "blocking", `"${poll.duration}" is not a duration LinkedIn accepts.`, `Use one of: ${LIMITS.durations.join(", ")}.`));
  }

  /* --- options that are not really different from each other --- */
  for (let i = 0; i < opts.length; i++) {
    for (let j = i + 1; j < opts.length; j++) {
      if (lower(opts[i]) === lower(opts[j])) {
        out.push(finding("poll-duplicate", "blocking", `Two options are the same: "${opts[i]}".`, "Replace one."));
      } else if (overlap(opts[i], opts[j]) >= 0.75) {
        out.push(finding("poll-overlap", "warn", `"${opts[i]}" and "${opts[j]}" say nearly the same thing.`, "A reader who picks one could just as well pick the other. Make them distinct choices."));
      }
    }
  }

  /* --- one option written to win --- */
  const loaded = opts.filter((o) => LOADED.some((w) => lower(o).includes(w)));
  if (loaded.length && loaded.length < opts.length) {
    out.push(finding("poll-biased", "warn", `${loaded.map((o) => `"${o}"`).join(", ")} ${loaded.length === 1 ? "is" : "are"} worded more favourably than the rest.`, "Word every option as a professional would describe their own choice."));
  }

  /* --- filler options --- */
  const filler = opts.filter((o) => NON_ANSWERS.includes(lower(o)));
  if (filler.length) {
    out.push(finding("poll-non-answer", "warn", `${filler.map((o) => `"${o}"`).join(", ")} is not an answer.`, "With only four slots, spend them on real alternatives. A plain \"Other\" is fine; \"All of the above\" is not."));
  }

  /* --- a question nobody can answer from the post --- */
  if (q && !/\?$/.test(q)) {
    out.push(finding("poll-not-a-question", "warn", "The question does not end in a question mark.", "LinkedIn shows it as written — make it read as a question."));
  }

  /* --- country --- */
  const mixed = classification?.mixedCountries || [];
  if (mixed.length > 1) {
    out.push(finding("poll-mixed-country", "blocking",
      `The poll mixes ${mixed.map((id) => COUNTRIES[id].label).join(" and ")} rules.`,
      "A reader cannot answer a question that spans two tax systems. Pick one."));
  }

  /* --- a knowledge check has to have a knowable answer --- */
  const s = style || (poll.style ? STYLE_BY_ID[poll.style] : null);
  if (s?.factual) {
    const postText = lower([content.hook, content.body, content.cta].filter(Boolean).join(" "));
    const answered = opts.some((o) => {
      const ws = [...words(o)];
      return ws.length && ws.every((w) => postText.includes(w));
    });
    if (!answered) {
      out.push(finding("poll-unanswerable", "blocking",
        "This is a knowledge check, but the post does not contain the correct answer.",
        "Either put the answer in the post, or ask for an opinion instead of a fact."));
    }
  }

  /* --- never present a poll as a finding --- */
  const claimy = /\b(most|majority|industry standard|everyone agrees|research shows|studies show|\d+%\s+of)\b/i;
  if (claimy.test(q)) {
    out.push(finding("poll-presents-as-research", "warn",
      "The question asserts what is already true rather than asking.",
      "A poll collects opinion — it is not evidence. Ask the question without stating the answer."));
  }

  return out;
}

/* Positions a reader can genuinely hold, per style. Not "All of the above"
   filler — each is a distinct, unbiased answer that asserts nothing. */
const SCALES = {
  challenge: ["Capacity", "Deadlines", "Client readiness", "Software"],
  practice: ["All in-house", "Mostly in-house", "Mixed", "Mostly outsourced"],
  adoption: ["Already done", "In progress", "Planned", "Not yet"],
  knowledge: ["Yes, confident", "I think so", "Not sure", "No"],
  experience: ["Tried, it worked", "Tried, it did not", "Never tried", "Not relevant"],
  preference: ["Strongly agree", "Agree", "Disagree", "Depends on the client"],
};

/* ---------- a fallback that comes from the post ----------
   Used when no model is available. The old fallback was one fixed question
   about content workflows, which had nothing to do with whatever the post
   said. This builds from the post's own words, and returns null rather than
   inventing a poll when there is nothing to build from. */
export function fallbackPoll(content = {}, classification = {}, style = null) {
  const s = style || pollStyleFor(classification);
  const body = String(content.body || "");
  /* The post's own list is the best source of options there is: they are
     already the alternatives the writer had in mind. */
  const lines = body.split(/\n+/)
    .map((l) => l.replace(/^(?:[\s•\-–—*▪●·]|✔️?|✅)+/, "").replace(/^\d{1,2}[.)]\s+/, "").trim())
    /* A long bullet is trimmed to fit rather than thrown away: a post whose
       points run to a sentence each should still yield a poll. `short`
       below cuts at a word boundary, and checkPoll verifies the result. */
    .filter((l) => l.length > 3 && l.length <= 110);

  const short = (t) => {
    const clean = String(t).replace(/\s+/g, " ").replace(/[.?!]+$/, "").trim();
    if (clean.length <= LIMITS.option) return clean;
    const cut = clean.slice(0, LIMITS.option + 1).lastIndexOf(" ");
    return clean.slice(0, cut > 8 ? cut : LIMITS.option).replace(/[\s,;:—-]+$/, "");
  };

  let options = lines.slice(0, LIMITS.maxOptions).map(short).filter((o) => o.length >= 3);
  /* Deduplicate before counting — two near-identical steps are one option. */
  options = options.filter((o, i) => !options.slice(0, i).some((p) => overlap(p, o) >= 0.75));

  /* Most posts are prose, not lists, and refusing to make a poll for them
     broke the format for the ordinary case. A scale is a legitimate poll
     design rather than a filler one: the options are real, distinct
     positions a reader can hold, and they invent no fact. They are marked
     as generic so the panel can invite the user to sharpen them. */
  let generic = false;
  if (options.length < LIMITS.minOptions) {
    options = SCALES[s.id] || SCALES.preference;
    generic = true;
  }
  if (!options.length) return null;

  const subject = String(content.topic || content.hook || "").replace(/\s+/g, " ").trim();
  /* Nothing to ask about is the one case where no poll is the right answer. */
  if (!subject) return null;
  const stem = {
    challenge: "Which of these slows your firm down most?",
    practice: "How does your firm handle this today?",
    adoption: "How far has your firm got with this?",
    knowledge: "Which of these is correct?",
    experience: "What happened when you tried it?",
    preference: "Which would you choose?",
  }[s.id] || "Which would you choose?";

  const question = subject && `${subject}: ${stem}`.length <= LIMITS.question
    ? `${subject}: ${stem}`
    : stem;

  return {
    question, options: options.slice(0, LIMITS.maxOptions),
    duration: LIMITS.defaultDuration, style: s.id, derived: true, generic,
  };
}

/* What the model is told, for this post. */
export function pollGuidance(classification = {}, style = null) {
  const s = style || pollStyleFor(classification);
  const c = classification?.country ? COUNTRIES[classification.country] : null;
  const lines = [
    `Poll style: ${s.label}. ${s.ask}`,
    `Hard limits: the question must be ${LIMITS.question} characters or fewer, each option ${LIMITS.option} or fewer, ${LIMITS.minOptions} to ${LIMITS.maxOptions} options.`,
    "The options must be genuinely different from each other, mutually exclusive where possible, and none written to be the obvious answer.",
    "Do not use \"All of the above\" or \"None of the above\". Do not state a finding in the question — a poll asks, it does not report.",
  ];
  if (c) lines.push(`This is a ${c.adjective} poll. Use ${c.adjective} terms and ${c.regulator} rules only, and never another country's.`);
  if (s.factual) lines.push("Exactly one option must be correct, and the post must already contain that answer.");
  return lines.join("\n");
}

export { findStats };
