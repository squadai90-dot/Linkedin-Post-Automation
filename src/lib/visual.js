/* ============================================================
   THE VISUAL DECISION SYSTEM

   The old path asked a model for a generic "image brief" and then picked one
   of four layouts by `variant % 4`. The layout therefore had nothing to do
   with the post: a tax deadline, a hiring ad and a Diwali greeting all came
   out as the same dark slab with a sentence on it. That is the complaint this
   file answers.

   The rule here is that the visual is decided from the FINISHED post, not
   from the topic that started it. By then we know what kind of post it is,
   which country it applies to, whether it carries a figure, and whether it is
   marking an occasion — which is exactly what decides whether the right
   picture is a statistic, a process, a comparison, a set of roles or a
   festival graphic.

   The design constraints are taken from published guidance on B2B
   infographics rather than from taste: one idea per graphic, type large
   enough to read on a phone without zooming, high contrast, generous
   whitespace, and the source named on the graphic when it carries a figure.
   ============================================================ */

import { PILLAR_BY_ID, occasionById, findStats, COUNTRIES } from "./intel.js";

/* Every visual format the system can choose, what it is for, and which
   template renders it. `needs` is what the format cannot do without — a
   statistic card with no statistic is not a statistic card. */
export const FORMATS = {
  stat: {
    id: "stat", label: "Statistic card", template: "figure",
    why: "One figure, set large enough to read at a glance. Nothing competes with it.",
    needs: ["stat"],
  },
  factcard: {
    id: "factcard", label: "Fact card", template: "factcard",
    why: "A rule or date, stated plainly, with the authority it came from named on the graphic.",
    needs: ["headline"],
  },
  steps: {
    id: "steps", label: "Process steps", template: "steps",
    why: "A sequence read in order. Numbered, because the order is the point.",
    needs: ["items"],
  },
  compare: {
    id: "compare", label: "Side by side", template: "compare",
    why: "Two things held against each other. The contrast carries the meaning.",
    needs: ["leftItems", "rightItems"],
  },
  list: {
    id: "list", label: "Key points", template: "list",
    why: "Three or four points with equal weight, where no order is implied.",
    needs: ["items"],
  },
  statement: {
    id: "statement", label: "Statement", template: "statement",
    why: "The sentence is the whole idea, so the sentence is the whole graphic.",
    needs: ["headline"],
  },
  quote: {
    id: "quote", label: "Quote", template: "quote",
    why: "Someone's own words, attributed.",
    needs: ["quote"],
  },
  roles: {
    id: "roles", label: "Open roles", template: "roles",
    why: "Roles and places, scannable, so the right person recognises themselves.",
    needs: ["items"],
  },
  occasion: {
    id: "occasion", label: "Occasion graphic", template: "occasion",
    why: "The festival has to be legible as that festival — its symbols, its colours — and not a stock office photograph.",
    needs: ["headline"],
  },
  event: {
    id: "event", label: "Event card", template: "event",
    why: "What it is, when it is, and how to get in.",
    needs: ["headline"],
  },
  people: {
    id: "people", label: "People", template: "photo",
    why: "A culture post about people should show people, not typography.",
    needs: ["headline"], photo: true,
  },
};

export const FORMAT_IDS = Object.keys(FORMATS);

/* A headline cut at a character count reads as broken software: "…starts on
   6 April 2026, and the first cohort is". Cut at the last sentence, clause
   or word boundary that fits instead, and drop a trailing comma or "and". */
export function clip(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max + 1);
  const at = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (at > max * 0.45) return head.slice(0, at + 1).trim();
  /* Prefer a clause break even fairly early in the string: "…ends 30 June"
     is a better headline than "…ends 30 June, and the week after decides
     how", which is what cutting at the last word gives. */
  const soft = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(" — "));
  const cut = soft > max * 0.4 ? soft : head.lastIndexOf(" ");
  return head.slice(0, cut > 0 ? cut : max)
    .replace(/[\s,;:—-]+$/, "")
    .replace(/\s+(and|or|but|so|with|for|of|to|the|a|an|that|which|whose|when|where|while|after|before|from|by|as|at|in|on|into|than|their|its|how|what|why|is|are|was|were)$/i, "")
    .trim();
}

/* Split a body into the units a template can use. Lines first, because a post
   written with bullets already did the work; sentences only if it did not. */
export function itemsFrom(text, max = 4) {
  const raw = String(text || "");
  /* Strip whatever the writer used as a bullet. The tick is written out as
     an escape because it carries a variation selector, which inside a
     character class silently means something other than "this character". */
  const lines = raw.split(/\n+/)
    /* Strip whatever the writer used as a bullet, including a leading "1." —
       the steps template draws its own numbers, and leaving the writer's in
       gives every card two. */
    .map((l) => l.replace(/^(?:[\s•\-–—*▪●·]|\u2714\uFE0F?|\u2705)+/, "").replace(/^\d{1,2}[.)]\s+/, "").trim())
    .filter((l) => l.length > 8);
  const source = lines.length >= 2 ? lines : raw.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 12);
  return source.slice(0, max).map((s) => s.replace(/\s+/g, " ").slice(0, 78));
}

/* "fell from 14 days to 9 days" carries two figures, and the one the post is
   about is the second. Shared by the decision and the fields so the reason
   given can never name a different number from the one on the card. */
export function chooseStat(content = {}, stats = []) {
  if (!stats.length) return "";
  const fromTo = [content.hook, content.body].filter(Boolean).join(" ")
    /* The second half is matched greedily so "to 9 days" yields "9 days" and
       not a bare "9", which matched nothing and quietly left the before
       figure on the card. */
    .match(/\bfrom\s+(\S[^,.;]{0,18}?)\s+to\s+(\S[^,.;]{0,18})(?=[,.;]|\s*$|\s)/i);
  if (fromTo) {
    const tail = fromTo[2].trim();
    const target = stats.find((f) => f === tail) || stats.find((f) => tail.startsWith(f) || f.startsWith(tail));
    if (target) return target;
  }
  return stats[0];
}

/* A numbered or "first/then/finally" body is a sequence, not a list. */
const SEQUENCE_RE = /(^|\n)\s*(\d+[.)]\s|step\s*\d|first[,:\s]|then[,:\s]|next[,:\s]|finally[,:\s])/i;
/* Two-sided language. "rather than" and "instead of" are deliberately NOT
   here: they turn up inside ordinary sentences ("review the coding before
   the BAS rather than after it") and were strong enough to make a four-step
   checklist come out as a comparison. A comparison has to be the shape of
   the post, not a turn of phrase inside one line of it. */
const COMPARE_RE = /\b(vs\.?|versus|compared to|the difference between|on the one hand|before and after)\b/i;
/* …or the post is explicitly built in two halves. */
const TWO_SIDED_RE = /(^|\n)\s*(pros?\b|cons?\b|before\b|after\b|old way|new way|in-?house|outsourc\w*)\s*[:—-]/i;

/* ---------- the decision ----------
   Order matters. The specific reasons to choose a format are tested before
   the general ones, so "this post is a Diwali greeting" beats "this post
   contains a number". */
export function decideFormat(cls, content = {}) {
  const body = [content.hook, content.body, content.cta].filter(Boolean).join("\n");
  const stats = cls?.stats?.length ? cls.stats : findStats(body);
  const items = itemsFrom(content.body);
  const stat = chooseStat(content, stats);

  if (cls?.occasion) return pick("occasion", `It is marking ${occasionById(cls.occasion)?.label || "an occasion"}, so the graphic has to read as that occasion.`);
  if (cls?.pillar === "hiring" && items.length >= 2) return pick("roles", "It is a hiring post with several roles, which people scan rather than read.");
  if (cls?.pillar === "event") return pick("event", "It is something to attend, so the graphic has to carry what, when and how to join.");
  if (cls?.pillar === "culture") return pick("people", "It is about people, so it should show people rather than a typographic slab.");

  /* Sequence is tested first: a numbered list is a sequence even if one of
     its lines happens to contain comparative wording. */
  if (SEQUENCE_RE.test(content.body || "") && items.length >= 3) return pick("steps", "It describes an ordered process, and the order is the point.");
  if ((COMPARE_RE.test(body) || TWO_SIDED_RE.test(content.body || "")) && items.length >= 2) {
    return pick("compare", "It sets two things against each other, and the contrast is the message.");
  }

  if (stats.length && ["proof", "regulatory", "educational", "capacity"].includes(cls?.pillar)) {
    return pick("stat", `It turns on a figure (${stat}), which is the one thing worth reading at a glance.`);
  }
  if (cls?.pillar === "regulatory") return pick("factcard", "It states a rule or a date, which has to be legible and attributed on the graphic itself.");
  if (cls?.pillar === "seasonal" && items.length >= 3) return pick("steps", "It is a readiness post, which is a sequence of things to do.");
  if (cls?.pillar === "educational" && items.length >= 3) return pick("steps", "It explains how something works, which reads as ordered steps.");
  if (items.length >= 3) return pick("list", "It makes several points of equal weight, with no order implied.");
  if (stats.length) return pick("stat", `It carries a figure (${stat}) worth setting large.`);
  return pick("statement", "The sentence is the whole idea, so it is set as the whole graphic.");

  function pick(id, why) { return { format: id, template: FORMATS[id].template, reason: why }; }
}

/* ---------- fields ----------
   Filled from the finished post. Nothing is invented here: if the post does
   not contain a figure, the statistic card does not get one, and the decision
   above will not have chosen it. */
export function visualFields(cls, content = {}, { brief = {}, brand = {} } = {}) {
  const body = String(content.body || "");
  const stats = cls?.stats?.length ? cls.stats : findStats([content.hook, body].join("\n"));
  const items = itemsFrom(body);
  const occ = cls?.occasion ? occasionById(cls.occasion) : null;
  const country = cls?.country ? COUNTRIES[cls.country] : null;

  /* The line under a big number has to say what the number measures, taken
     from the sentence the number appears in. */
  /* "fell from 14 days to 9 days" carries two figures, and the one the post
     is about is the second. Taking the first matched number put the old
     result on the card and called it the headline. */
  const headline = String(content.hook || "");
  const stat = chooseStat(content, stats);
  const statSentence = stat
    ? (body.split(/(?<=[.!?])\s+/).find((x) => x.includes(stat)) || headline || "")
    : "";

  /* Naming the regulator is the point on a post about a rule. On a hiring ad
     or a festival greeting it is just odd — "US · IRS" above "We are hiring"
     tells the reader nothing and looks like a mistake. */
  /* Only where the regulator genuinely is the authority for what the post
     says. "US · IRS" above a case study about audit turnaround names a body
     that has nothing to do with it. */
  const regulatorPillar = ["regulatory", "seasonal"].includes(cls?.pillar);
  /* A body that is a list has no first sentence worth showing, and the list
     is already on the graphic. The call to action is the useful line there. */
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0] || "";
  const bodyIsList = items.length >= 2 && !/[.!?]/.test(firstSentence);

  return {
    kicker: clip(occ ? occ.label : (country && regulatorPillar) ? `${country.adjective} · ${country.regulator}` : PILLAR_BY_ID[cls?.pillar]?.label || "", 28),
    headline: clip(brief.headline || content.hook || "", 90),
    stat,
    statLabel: clip(statSentence.replace(stat, "").replace(/\s+/g, " ").replace(/^[\s,;:—-]+/, "").trim(), 46),
    support: clip(bodyIsList ? (content.cta || "") : firstSentence, 120),
    items: items.join("\n"),
    /* Split down the middle: the first half of the points describe one side,
       the rest the other. Crude, but it is filled from the post rather than
       invented, and the gate rejects the format if either side comes out
       empty. */
    leftItems: items.slice(0, Math.ceil(items.length / 2)).join("\n"),
    rightItems: items.slice(Math.ceil(items.length / 2)).join("\n"),
    leftLabel: "Now",
    rightLabel: "Instead",
    quote: content.hook || "",
    attrib: brand.name || "",
    footer: brand.site || brand.name || "",
    /* Naming a regulator as the source of an internal case study is a
       factual error, and it is now drawn on the graphic — so it is only
       filled where that authority really is where the fact came from.
       Left empty otherwise, which makes the gate ask for a real one. */
    source: brief.source || (country && regulatorPillar ? country.authorities[0] : ""),
    occasionId: occ?.id || "",
    greeting: occ?.greeting || "",
  };
}

/* The whole decision, in one call, from the finished post. */
export function visualStrategy(cls, content, opts = {}) {
  const d = decideFormat(cls, content);
  const f = FORMATS[d.format];
  return {
    ...d,
    label: f.label,
    why: f.why,
    photo: !!f.photo,
    fields: visualFields(cls, content, opts),
  };
}
