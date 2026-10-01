/* ============================================================
   POST INTENT

   What the post is FOR, decided before anything is researched or written.

   This exists because a Navratri post came back with the angles "The hard
   part of Navratri isn't the technology", "What changes when Navratri reaches
   production" and "Why the category is consolidating around Navratri". Two
   things caused it, and both are fixed by deciding intent first:

   — the angle prompt offered only four B2B frames (Contrarian, Educational,
     Industry insight, Data-driven), so even a working model had to force a
     festival into one of them;
   — when the model was unavailable, the fallback was one fixed set of
     technology angles with the topic pasted in.

   A festival therefore defaults to a GREETING — a warm, short wish from a
   company page — unless the user asks for something else (its history, a
   recap of the office celebration, a CSR activity, an event). Launches,
   milestones, events and hiring each get angles that fit them. Thought
   leadership is one intent among several, not the default for everything.
   ============================================================ */

import { detectOccasion, greetingFor, classify } from "./intel.js";

/* ---------- the catalogue ----------
   `research`: whether sources help this kind of post. A greeting needs none;
   inventing "sources" for one is how placeholder rows ended up on a festival.
   `angles`: the only angle types offered for this intent, with what each means. */
export const INTENTS = {
  greeting: {
    label: "Festival greeting",
    occasion: true,
    research: false,
    guidance: "A warm, sincere greeting from the company to its followers on the day.",
    angles: [
      ["Warm wishes", "A simple, sincere greeting — what followers expect from a company page on the day."],
      ["Meaning of the festival", "A greeting with one respectful line on what the festival celebrates."],
      ["Team celebration", "The greeting, voiced by the people behind the firm. Works well with a team photo."],
      ["Gratitude", "The greeting as a thank-you to the clients and partners the firm works with."],
    ],
    forbid: "Do not suggest thought-leadership, technology, industry-analysis, data-driven, contrarian, product or sales angles. Do not mention the company's services.",
  },
  occasion_info: {
    label: "Festival history and culture",
    occasion: true,
    research: true,
    guidance: "An informative, respectful post about the festival's history, meaning or traditions.",
    angles: [
      ["Origins", "Where the festival comes from, told simply and accurately."],
      ["Traditions", "How it is celebrated — customs, food, music, dress."],
      ["Across regions", "How the celebration differs from one region to another."],
      ["What it means to us", "Why the festival matters to the team, with a warm close."],
    ],
    forbid: "Do not suggest technology, product, sales or industry-analysis angles. Make no religious claims beyond what sources support.",
  },
  occasion_recap: {
    label: "Celebration recap",
    occasion: true,
    research: false,
    guidance: "A recap of how the team celebrated the festival.",
    angles: [
      ["Highlights", "The best moments of the celebration."],
      ["Our people", "The colleagues who made it happen."],
      ["Thank you", "Thanks to the organisers and everyone who joined."],
      ["What it meant", "Why celebrating together matters to the team."],
    ],
    forbid: "Do not suggest technology, product, sales or industry-analysis angles.",
  },
  occasion_csr: {
    label: "Festival CSR activity",
    occasion: true,
    research: false,
    guidance: "A post about a community or CSR activity the firm did for the festival.",
    angles: [
      ["What we did", "The activity, plainly described."],
      ["Why it matters", "The need it served and who it helped."],
      ["Thank you", "Thanks to the volunteers and partners."],
      ["Join in", "How others can support the same cause."],
    ],
    forbid: "Do not suggest technology, product or sales angles. Do not invent numbers of people helped or amounts raised.",
  },
  occasion_event: {
    label: "Festival event",
    occasion: true,
    research: false,
    guidance: "An invitation to, or announcement of, a festival event the firm is holding.",
    angles: [
      ["Invitation", "Who is invited, and why they should come."],
      ["What to expect", "The music, food and activities planned."],
      ["Practical details", "When, where and how to join."],
      ["Countdown", "A short reminder as the day approaches."],
    ],
    forbid: "Do not suggest technology, product or industry-analysis angles. Do not invent a date, time or venue.",
  },
  launch: {
    label: "Product or service launch",
    research: false,
    guidance: "Announce something new the firm is offering, clearly and without hype.",
    angles: [
      ["Announcement", "Says plainly what is new and that it is available."],
      ["The problem it solves", "Leads with the client problem, then the answer."],
      ["Who it is for", "Speaks directly to the people it is built for."],
      ["Behind the build", "How and why the team built it."],
    ],
    forbid: "Do not suggest festival, contrarian or industry-consolidation angles. Do not invent features, prices, dates or customer quotes.",
  },
  milestone: {
    label: "Company milestone",
    research: false,
    guidance: "Celebrate an achievement — an anniversary, award, certification, expansion or number reached.",
    angles: [
      ["Announcement", "States the milestone plainly and proudly."],
      ["Thank you", "Credits the clients, partners and team behind it."],
      ["The journey", "A short look back at how the firm got here."],
      ["What's next", "What the milestone makes possible from here."],
    ],
    forbid: "Do not suggest contrarian, technology-adoption or industry-analysis angles. Do not invent figures beyond those in the topic.",
  },
  event: {
    label: "Event or webinar",
    research: false,
    guidance: "Promote something people can attend.",
    angles: [
      ["Invitation", "Who should come, and why."],
      ["What you will learn", "The useful thing attendees take away."],
      ["Speakers and agenda", "Who is speaking and what is covered."],
      ["Reminder", "A short nudge as the date approaches."],
    ],
    forbid: "Do not invent a date, time, speaker or registration link.",
  },
  hiring: {
    label: "Hiring",
    research: false,
    guidance: "Invite the right people to apply.",
    angles: [
      ["Open roles", "The roles and where they are based."],
      ["Why join us", "What working at the firm is actually like."],
      ["A day in the role", "What the person will really do."],
      ["Referral ask", "Ask the network to pass it on."],
    ],
    forbid: "Do not invent salaries, benefits or perks.",
  },
  culture: {
    label: "Team and culture",
    research: false,
    guidance: "Show the people behind the firm.",
    angles: [
      ["The moment", "What happened, told simply."],
      ["Our people", "The colleagues in it."],
      ["Values in action", "What it says about how the firm works."],
      ["Thank you", "Credit to the people who made it happen."],
    ],
    forbid: "Do not suggest technology, sales or industry-analysis angles.",
  },
  educational: {
    label: "Educational",
    research: true,
    guidance: "Explain something useful to the audience, accurately.",
    angles: [
      ["How it works", "A clear explanation of the mechanics."],
      ["Common mistakes", "What people get wrong, and how to avoid it."],
      ["Checklist", "Practical steps, in order."],
      ["Explainer", "The one thing worth understanding, made simple."],
    ],
    forbid: "",
  },
  thought: {
    label: "Thought leadership",
    research: true,
    guidance: "A considered point of view the firm can stand behind.",
    angles: [
      ["Point of view", "A clear position, argued plainly."],
      ["Contrarian", "Challenges a common assumption — only if it is genuinely defensible."],
      ["Lesson learned", "What the firm learned from experience."],
      ["What's changing", "Where things are heading, grounded in evidence."],
    ],
    forbid: "",
  },
  news: {
    label: "Industry news or regulation",
    research: true,
    guidance: "Explain a change that affects clients, and what to do about it.",
    angles: [
      ["What changed", "The change itself, stated precisely."],
      ["Who it affects", "Which clients need to pay attention."],
      ["What to do now", "The practical next steps."],
      ["Our take", "The firm's view on what it means."],
    ],
    forbid: "Never state a date, threshold or rule that the research does not contain.",
  },
};

export const INTENT_IDS = Object.keys(INTENTS);

/* What a user can switch to. A festival offers its own variations; anything
   else offers the general intents. */
export const OCCASION_CHOICES = ["greeting", "occasion_info", "occasion_recap", "occasion_csr", "occasion_event"];
export const GENERAL_CHOICES = ["launch", "milestone", "event", "hiring", "culture", "educational", "thought", "news"];

/* ---------- detection ---------- */

const has = (text, words) => words.some((w) => new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text));

const CUES = {
  occasion_info: ["history", "origin", "significance", "meaning of", "story of", "story behind", "why we celebrate", "traditions", "tradition of", "cultural", "culture of", "rituals", "mythology", "explained"],
  occasion_recap: ["celebrated", "celebration at", "recap", "highlights", "how we celebrated", "office celebration", "team celebrated", "our celebration", "moments from"],
  occasion_csr: ["csr", "donat", "charity", "volunteer", "distributed", "food drive", "community drive", "for the community", "community service", "giving back", "give back", "blood donation", "plantation", "orphanage", "ngo"],
  occasion_event: ["garba night", "join us", "invite", "invitation", "register", "event at", "tickets", "we are hosting", "we're hosting"],
  launch: ["launch", "launching", "introducing", "introduce", "unveil", "now available", "now live", "new product", "new service", "new feature", "new offering", "rolling out", "rolled out", "release of", "announcing our new"],
  milestone: ["anniversary", "years of", "year journey", "milestone", "completes", "completed", "crossed", "reached", "award", "won ", "wins ", "recognised", "recognized", "certified", "certification", "iso ", "new office", "opened", "expansion", "partnership with", "funding"],
  event: ["webinar", "conference", "summit", "workshop", "meetup", "live session", "masterclass", "join us", "register"],
  hiring: ["hiring", "we're hiring", "we are hiring", "job opening", "vacanc", "open role", "open position", "join our team", "careers", "recruit"],
  culture: ["team outing", "offsite", "team building", "team lunch", "our people", "employee of", "work culture", "welcome to the team", "farewell"],
  educational: ["how to", "guide", "tips", "explained", "checklist", "steps to", "what is", "a primer", "mistakes"],
  news: ["making tax digital", "deadline", "regulation", "new rule", "rule change", "takes effect", "comes into force", "effective from", "new law", "budget", "compliance", "filing", "hmrc", "irs", "ato", "cra", "vat", "gst", "threshold", "starts on", "mandatory from"],
};

/* `override` is the user's own choice and always wins. Without it, a festival
   is a greeting unless the topic says plainly that it wants something else. */
export function detectIntent(topic = "", { override } = {}) {
  const text = String(topic || "");
  const occasion = detectOccasion(text);
  const pick = (kind, why) => ({
    kind,
    ...INTENTS[kind],
    occasion: occasion && INTENTS[kind].occasion ? occasion : null,
    greeting: occasion ? greetingFor(occasion, text) : "",
    why,
    detected: !override,
  });

  if (override && INTENTS[override]) {
    if (INTENTS[override].occasion && !occasion) return pick("greeting", "Chosen by you.");
    return pick(override, "Chosen by you.");
  }

  if (occasion) {
    for (const kind of ["occasion_csr", "occasion_event", "occasion_recap", "occasion_info"]) {
      if (has(text, CUES[kind])) return pick(kind, `It mentions ${occasion.label} and asks for a ${INTENTS[kind].label.toLowerCase()}.`);
    }
    return pick("greeting", `It mentions ${occasion.label}, so it defaults to a greeting. Choose another option to write something else.`);
  }

  for (const kind of ["hiring", "launch", "event", "milestone", "culture"]) {
    if (has(text, CUES[kind])) return pick(kind, `The topic reads as a ${INTENTS[kind].label.toLowerCase()}.`);
  }
  const cls = classify({ topic: text });
  /* "How to prepare for Making Tax Digital" explains; "Making Tax Digital
     starts 6 April" reports. The explainer wording is checked first. */
  if (has(text, CUES.educational)) return pick("educational", "The topic explains something.");
  if (has(text, CUES.news) || cls.pillar === "regulatory" || cls.pillar === "seasonal") return pick("news", "The topic is about a rule, deadline or change.");
  if (cls.pillar === "educational") return pick("educational", "The topic explains something.");
  if (cls.pillar === "hiring") return pick("hiring", "The topic is about hiring.");
  if (cls.pillar === "event") return pick("event", "The topic is about something to attend.");
  if (cls.pillar === "culture") return pick("culture", "The topic is about the team.");
  return pick("thought", "No more specific purpose was found, so it is treated as a point of view.");
}

/* ---------- the subject ----------
   The thing the post is about, without the verb the user wrapped it in:
   "We are launching Unison Payroll Assist" -> "Unison Payroll Assist". */
const LEADS = [
  /^(?:we(?:'re| are)\s+)?(?:excited|proud|thrilled|happy|pleased)\s+to\s+(?:announce|share|introduce|launch|unveil)\s+/i,
  /^(?:we(?:'re| are)\s+|we\s+)?(?:launching|introducing|announcing|unveiling|celebrating|hiring for|hiring|hosting|organising|organizing)\s+/i,
  /^(?:the\s+)?(?:launch|introduction|announcement|release)\s+of\s+/i,
  /^(?:product|service|new)\s+launch(?:\s*[:-]|\s+for|\s+of)?\s+/i,
  /^(?:celebrating|marking)\s+/i,
  /^(?:post|linkedin post|a post)\s+(?:about|on)\s+/i,
];
export function subjectOf(topic = "") {
  let t = String(topic || "").trim().replace(/[.!]+$/, "");
  for (let i = 0; i < 3; i++) {
    const before = t;
    for (const re of LEADS) t = t.replace(re, "");
    if (t === before) break;
  }
  return t.trim() || String(topic || "").trim();
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const startsWithVerbish = (s) => /\b(completes?|reaches|reached|crosses|crossed|wins|won|celebrates|turns|hits|opens|opened|achieves|achieved|receives|received)\b/i.test(s);

/* ---------- angles without AI ----------
   Used only when the model cannot be reached, and labelled as such. They are
   built from the intent and the user's own words — nothing is invented. */
export function fallbackAngles(intent, { topic = "", company = "" } = {}) {
  const i = intent || detectIntent(topic);
  /* Without a company name the sentence has to stand on its own — "from all
     of us at our team" and "Why join our team" read as broken. */
  const at = company ? ` at ${company}` : "";
  const who = company || "us";
  const subject = subjectOf(topic);
  const o = i.occasion;
  const name = o?.label || subject;
  const greet = i.greeting || (o ? `Happy ${o.label}` : "");
  const H = {
    greeting: [
      `${greet} from all of us${at}`,
      `What ${name} celebrates, and the wish we share with you`,
      `How our team is celebrating ${name}`,
      `${name} wishes to the clients and partners we work alongside`,
    ],
    occasion_info: [`The story behind ${name}`, `How ${name} is celebrated`, `${name} across regions`, `What ${name} means to our team`],
    occasion_recap: [`Highlights from our ${name} celebration`, `The people who made our ${name} celebration`, `Thank you to everyone who joined us for ${name}`, `Why celebrating ${name} together matters to us`],
    occasion_csr: [`How our team marked ${name} with the community`, `Why we chose to give back this ${name}`, `Thank you to our ${name} volunteers`, `How you can support the cause this ${name}`],
    occasion_event: [`You're invited to our ${name} celebration`, `What to expect at our ${name} celebration`, `How to join our ${name} celebration`, `${name} is almost here — see you there`],
    launch: [`Introducing ${subject}`, `The problem ${subject} was built to solve`, `Who ${subject} is for`, `Behind the launch of ${subject}`],
    milestone: [
      startsWithVerbish(subject) ? cap(subject) : `Celebrating ${subject}`,
      `Thank you to everyone behind ${startsWithVerbish(subject) ? "this milestone" : subject}`,
      `Looking back on ${startsWithVerbish(subject) ? "how we got here" : subject}`,
      `What comes next after ${startsWithVerbish(subject) ? "this milestone" : subject}`,
    ],
    event: [`Join us: ${subject}`, `What you will take away from ${subject}`, `Who is speaking at ${subject}`, `A reminder: ${subject}`],
    hiring: [`We're hiring: ${subject}`, `Why join ${who}`, `A day in the role${at}`, `Know someone? Help us find them`],
    culture: [cap(subject), `The people behind ${subject}`, `What ${subject} says about how we work`, `Thank you to everyone who made ${subject} happen`],
    educational: [`How ${subject} works`, `Common mistakes with ${subject}`, `A checklist for ${subject}`, `${cap(subject)}, explained simply`],
    thought: [`Our view on ${subject}`, `A common assumption about ${subject}, re-examined`, `What we have learned about ${subject}`, `Where ${subject} is heading`],
    news: [`What changed: ${subject}`, `Who ${subject} affects`, `What to do now about ${subject}`, `Our take on ${subject}`],
  }[i.kind] || [cap(subject)];
  const angles = i.angles.map(([type, rationale], k) => ({ type, headline: H[k] || cap(subject), rationale, recommended: k === 0 }));
  return {
    angles,
    reason: i.kind === "greeting"
      ? `A festival post defaults to a warm greeting. The other options are still greetings — choose "Write something else" for history, a recap, CSR or an event.`
      : `The first option says the thing most directly, which suits a ${i.label.toLowerCase()} post.`,
    intent: i.kind,
  };
}

/* The model is asked for angles that fit, but asked is not the same as
   guaranteed. Anything off-intent is replaced from the fallback set, so a
   festival never comes back with "the hard part isn't the technology". */
const OFF_GREETING = /\b(technolog|ai\b|artificial intelligence|production|adoption|consolidat|data-driven|numbers?|statistic|market|industry|vendor|pipeline|roi|saas|software|automation|pilot)/i;
export function enforceAngles(intent, result, ctx = {}) {
  const i = intent;
  const allowed = new Set(i.angles.map(([t]) => t.toLowerCase()));
  const backup = fallbackAngles(i, ctx).angles;
  const raw = Array.isArray(result?.angles) ? result.angles : [];
  const kept = [];
  for (const a of raw) {
    if (!a || !a.headline) continue;
    const typeOk = allowed.has(String(a.type || "").toLowerCase());
    const offTopic = i.occasion && OFF_GREETING.test(`${a.headline} ${a.rationale || ""}`);
    if (!typeOk || offTopic) continue;
    if (kept.some((k) => k.type.toLowerCase() === a.type.toLowerCase())) continue;   /* distinct types only */
    kept.push({ ...a, type: i.angles.find(([t]) => t.toLowerCase() === a.type.toLowerCase())[0] });
  }
  for (const b of backup) {
    if (kept.length >= 4) break;
    if (!kept.some((k) => k.type === b.type)) kept.push({ ...b, recommended: false, fromTemplate: true });
  }
  if (!kept.some((k) => k.recommended)) kept[0].recommended = true;
  if (kept.filter((k) => k.recommended).length > 1) kept.forEach((k, n) => { if (n > 0) k.recommended = false; });
  return { ...result, angles: kept.slice(0, 4), intent: i.kind, replaced: Math.max(0, 4 - raw.filter(Boolean).length) };
}

/* ---------- prompts ---------- */

const angleList = (i) => i.angles.map(([t, m]) => `- ${t}: ${m}`).join("\n");

export function occasionBrief(i) {
  const o = i.occasion;
  if (!o) return "";
  return [
    `Occasion: ${o.label}. Greeting to use: "${i.greeting || o.greeting}".`,
    o.symbols?.length ? `Its familiar symbols: ${o.symbols.join(", ")}.` : "",
    o.care ? `Care: ${o.care}` : "",
  ].filter(Boolean).join("\n");
}

export function anglePrompt(i, { topic, company, industry, audience, formats = [], insights = [], verified = false }) {
  return `Company: ${company || "the company"}${industry ? ` (${industry})` : ""}. Audience: ${audience || "its LinkedIn followers"}.
Topic as the user typed it: "${topic}"
Post intent: ${i.label} — ${i.guidance}
${occasionBrief(i)}
Post format: ${formats.length ? formats.join(" + ") : "text"}.
${insights.length ? `${verified ? "Verified research" : "Background ideas (AI-generated, not verified)"}: ${JSON.stringify(insights.slice(0, 3))}` : ""}
Suggest 4 distinct angles for this post. Use ONLY these angle types, each at most once:
${angleList(i)}
${i.forbid}
Every headline must be about this topic and this intent. Recommend exactly one${i.kind === "greeting" ? " — the warm wishes angle, unless another clearly fits better" : ""}.
{"angles":[{"type":"one of the types above","headline":"under 14 words","rationale":"one line on why it suits this post","recommended":false}],"reason":"why the recommended angle, 1-2 sentences"}`;
}

/* What the writer is held to, per intent. Appended to the existing rules. */
export function intentRules(i, { company = "" } = {}) {
  const o = i.occasion;
  const tags = o?.tags?.length ? o.tags.slice(0, 4).join(" ") : "";
  switch (i.kind) {
    case "greeting":
      return [
        `— This is a festival greeting from ${company || "the company"}'s LinkedIn page for ${o?.label}. Write a warm, sincere, professional greeting — not an article.`,
        `— Open the hook with the greeting itself ("${i.greeting}" or close to it).`,
        "— One or two short paragraphs. Speak to colleagues, clients and partners. Mention the festival's spirit respectfully and in general terms.",
        "— Do not explain rituals in detail, make religious claims, or state dates, history or facts. Do not mention the company's services, sell anything, or use statistics, technology or industry language.",
        "— The call to action is a closing wish (for example \"Wishing you and your families a joyful celebration.\"), not a question and not a sales prompt.",
        tags ? `— Use 3-4 hashtags such as ${tags}.` : "— Use 2-3 relevant hashtags.",
      ].join("\n");
    case "occasion_info":
      return `— This is an informative post about ${o?.label}. Be accurate and respectful. Use only the claims listed; if there are none, keep it to widely known, general statements and make no specific historical claim.${tags ? `\n— Hashtags such as ${tags}.` : ""}`;
    case "occasion_recap":
      return `— This is a recap of how the team celebrated ${o?.label}. Warm and human. Do not invent names, numbers or activities the topic does not mention.`;
    case "occasion_csr":
      return `— This is about a community activity for ${o?.label}. Describe only what the topic states. Never invent the number of people helped, items distributed or money raised.`;
    case "occasion_event":
      return `— This is an invitation to a ${o?.label} event. Never invent a date, time, venue or registration link; if the topic does not give them, say details will follow.`;
    case "launch":
      return "— This is a launch announcement. Say clearly what it is, who it is for and the problem it solves. Use only facts in the topic or the claims; never invent features, prices, dates, availability or customer quotes. No hype words.";
    case "milestone":
      return "— This is a milestone announcement. Celebrate it, thank the clients, partners and team behind it, and look ahead briefly. Never add a figure the topic does not state.";
    case "event":
      return "— This promotes an event. Never invent a date, time, speaker or link; if the topic does not give them, say details will follow.";
    case "hiring":
      return "— This is a hiring post. Never invent salary, benefits or perks.";
    case "culture":
      return "— This is a team and culture post. Warm and specific to what the topic describes. No sales language.";
    default:
      return "";
  }
}

/* ---------- research policy ---------- */

export function researchPolicy(i) {
  if (i.research) return { run: true };
  const why = {
    greeting: "A festival greeting doesn't need sources — it is a wish, not a claim.",
    occasion_recap: "A recap of your own celebration comes from you, not from the web.",
    occasion_csr: "Your own activity is the source here.",
    occasion_event: "Your own event is the source here.",
    launch: "Your own launch is the source here — research can't know more about it than you do.",
    milestone: "Your own milestone is the source here.",
    event: "Your own event is the source here.",
    hiring: "Your own roles are the source here.",
    culture: "Your own team is the source here.",
  }[i.kind] || "This kind of post doesn't need sources.";
  return { run: false, reason: why };
}

export function researchSystem(i) {
  return i.kind === "occasion_info"
    ? "You research festivals and cultural occasions for a company's LinkedIn page, using reputable cultural, educational and official sources."
    : "You research topics for a professional services firm's LinkedIn page.";
}

/* ---------- drafts without AI ----------
   Only for intents where a template is genuinely complete and invents
   nothing. Everything else gets no draft and an honest message instead. */
export function templateDraft(i, { topic = "", company = "" } = {}) {
  const at = company ? ` at ${company}` : "";
  const o = i.occasion;
  const subject = subjectOf(topic);
  if (i.kind === "greeting" && o) {
    const g = i.greeting || o.greeting || `Happy ${o.label}`;
    const wish = o.wish || `Wishing you and your loved ones a wonderful ${o.label}.`;
    return {
      hook: `${g} from all of us${at}!`,
      body: `${wish}\n\nTo our colleagues, clients and partners celebrating — thank you for being part of our journey. We hope the festival brings you and your families happiness and good health.`,
      cta: company ? `Warm wishes from the ${company} team.` : "Warm wishes from all of us.",
      hashtags: (o.tags || [`#${o.label.replace(/\W+/g, "")}`]).slice(0, 4),
      claims: [],
      template: "greeting",
    };
  }
  if (i.kind === "milestone") {
    const line = startsWithVerbish(subject) ? cap(subject) : `We're proud to be celebrating ${subject}`;
    return {
      hook: `${line}.`,
      body: `A milestone like this belongs to the people who made it possible: our clients, our partners and our team.\n\nThank you for your trust and support. We're grateful for the journey so far and looking forward to what comes next.`,
      cta: "Thank you for being part of it.",
      hashtags: ["#Milestone", "#ThankYou"],
      claims: [],
      template: "milestone",
    };
  }
  if (i.kind === "launch") {
    return {
      hook: `Introducing ${subject}.`,
      /* Deliberately thin. Nothing about the product can be known without the
         model or the user, and an instruction placed in the body could be
         published by mistake — so the UI asks for the details instead. */
      body: company ? `We're excited to share something new from ${company}: ${subject}.` : `We're excited to share something new: ${subject}.`,
      cta: "",
      hashtags: ["#Launch"],
      claims: [],
      template: "launch",
      needsDetail: true,
    };
  }
  return null;
}
