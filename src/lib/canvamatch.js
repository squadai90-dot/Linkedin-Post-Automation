/* ============================================================
   TEMPLATE SUGGESTION

   Turns a finished post into three or four genuinely different design
   options, each with a reason drawn from the post itself.

   Two honest sources, never mixed up with each other:

   — A template from the connected Canva account's own brand templates.
     Canva publishes no API for searching its whole public template library,
     only `GET /v1/brand-templates`, which returns what the connected account
     owns or has access to. So those are the real Canva designs available, and
     they are matched by their own titles and shapes.

   — A Unison layout, rendered by the renderer this product already had. These
     are labelled as Unison layouts everywhere they appear. They are NOT shown
     as Canva templates and they carry no invented Canva thumbnail, because a
     fabricated Canva result is worse than no result.

   "Distinct" is enforced rather than hoped for: one suggestion per layout
   family, so four options are four different arrangements of the page and not
   one design in four colourways.
   ============================================================ */

import { FORMATS, decideFormat, visualFields, itemsFrom, chooseStat } from "./visual.js";
import { PILLAR_BY_ID, occasionById, findStats } from "./intel.js";

/* ---------- the curated library ----------
   One entry per layout family. `tags` and `categories` are what a real Canva
   brand template's title is matched against, and are also what a user would
   search for in Canva — they are the vocabulary of the family, not decoration.
   `format` points at the existing local renderer, so a Unison layout suggestion
   is a real, renderable design rather than a placeholder. */
export const INTENTS = [
  {
    id: "stat", format: "stat", label: "Statistic card",
    categories: ["data", "report"],
    tags: ["stat", "statistic", "number", "figure", "metric", "kpi", "data", "percent", "percentage", "result", "results", "growth", "infographic"],
    pillars: ["proof", "regulatory", "educational", "capacity"],
    needs: "a figure in the post",
    suits: ["image", "video"],
  },
  {
    id: "factcard", format: "factcard", label: "Fact or deadline card",
    categories: ["announcement", "compliance"],
    tags: ["fact", "deadline", "date", "rule", "regulation", "compliance", "notice", "alert", "update", "reminder", "tax", "filing"],
    pillars: ["regulatory", "seasonal"],
    needs: "a headline",
    suits: ["image", "video"],
  },
  {
    id: "steps", format: "steps", label: "Numbered steps",
    categories: ["process", "explainer"],
    tags: ["step", "steps", "process", "how", "guide", "checklist", "workflow", "timeline", "stages", "roadmap", "tutorial"],
    pillars: ["educational", "seasonal", "capacity"],
    needs: "three or more points in order",
    suits: ["image", "video"],
  },
  {
    id: "list", format: "list", label: "Key points",
    categories: ["explainer", "tips"],
    tags: ["list", "points", "tips", "takeaways", "reasons", "ways", "bullets", "summary", "highlights"],
    pillars: ["educational", "thought", "capacity", "service"],
    needs: "several points",
    suits: ["image", "video"],
  },
  {
    id: "compare", format: "compare", label: "Side by side",
    categories: ["comparison", "explainer"],
    tags: ["compare", "comparison", "versus", "vs", "before", "after", "myth", "fact", "instead", "either", "two"],
    pillars: ["thought", "educational", "proof"],
    needs: "two sides to contrast",
    suits: ["image", "video"],
  },
  {
    id: "statement", format: "statement", label: "Single statement",
    categories: ["quote", "announcement"],
    tags: ["statement", "headline", "bold", "text", "typography", "message", "insight", "opinion", "minimal"],
    pillars: ["thought", "service", "proof", "capacity"],
    needs: "a headline",
    suits: ["image", "video"],
  },
  {
    id: "quote", format: "quote", label: "Pull quote",
    categories: ["quote", "testimonial"],
    tags: ["quote", "quotation", "testimonial", "said", "words", "client", "review", "feedback", "voice"],
    pillars: ["proof", "culture", "thought"],
    needs: "a line worth quoting",
    suits: ["image", "video"],
  },
  {
    id: "roles", format: "roles", label: "Open roles",
    categories: ["hiring", "recruitment"],
    tags: ["hiring", "hire", "job", "jobs", "role", "roles", "vacancy", "vacancies", "recruit", "recruitment", "career", "careers", "join", "team", "apply", "opening", "openings"],
    pillars: ["hiring"],
    needs: "two or more roles",
    suits: ["image", "video"],
  },
  {
    id: "occasion", format: "occasion", label: "Festival or occasion",
    categories: ["greeting", "festival"],
    tags: ["greeting", "greetings", "wishes", "festival", "celebration", "holiday", "diwali", "holi", "eid", "christmas", "new", "year", "navratri", "dussehra", "easter", "thanksgiving", "womens", "day"],
    pillars: ["occasion", "culture"],
    needs: "an occasion to mark",
    suits: ["image", "video"],
  },
  {
    id: "event", format: "event", label: "Event card",
    categories: ["event", "webinar"],
    tags: ["event", "webinar", "invite", "invitation", "register", "registration", "session", "workshop", "conference", "summit", "live", "rsvp", "agenda"],
    pillars: ["event"],
    needs: "something to attend",
    suits: ["image", "video"],
  },
  {
    id: "people", format: "people", label: "People and culture",
    categories: ["culture", "team"],
    tags: ["team", "people", "culture", "photo", "staff", "colleagues", "office", "celebrate", "anniversary", "welcome", "milestone"],
    pillars: ["culture", "hiring"],
    needs: "a photograph of people",
    suits: ["image"],
  },
];

export const INTENT_BY_ID = Object.fromEntries(INTENTS.map((i) => [i.id, i]));

/* ---------- shape ----------
   LinkedIn's own sizes. A template whose shape does not fit is rejected rather
   than stretched: a distorted logo is not an acceptable outcome. */
export const SHAPES = {
  image: { ideal: 1200 / 627, also: [1, 4 / 5], tolerance: 0.12, label: "1200 × 627 (landscape) or square" },
  /* The export the relay asks Canva for is horizontal 1080p, so a video
     template that is not 16:9 would arrive letterboxed or cropped. */
  video: { ideal: 16 / 9, also: [], tolerance: 0.06, label: "1920 × 1080 (16:9)" },
};

export function shapeFit(width, height, postType = "image") {
  const s = SHAPES[postType] || SHAPES.image;
  if (!width || !height) return { fit: "unknown", score: 0, note: "Canva did not report this template's size." };
  const r = width / height;
  const near = (target) => Math.abs(r - target) / target <= s.tolerance;
  if (near(s.ideal)) return { fit: "ideal", score: 3, note: `Matches ${s.label}.` };
  for (const alt of s.also) {
    if (near(alt)) return { fit: "ok", score: 1, note: "A supported LinkedIn shape, though not the widest one." };
  }
  return { fit: "wrong", score: -10, note: `This template is ${width} × ${height}, which does not fit ${s.label} without distorting it.` };
}

/* ---------- relevance ----------
   Which layout families this particular post could honestly use, in order.
   The primary comes from the existing decision system so a suggestion never
   contradicts the format the product already chose. */
const WORD = /[a-z0-9]+/g;
const tokens = (s) => String(s || "").toLowerCase().match(WORD) || [];

export function rankIntents(cls, content = {}, { postType = "image" } = {}) {
  const body = [content.hook, content.body, content.cta].filter(Boolean).join("\n");
  const stats = cls?.stats?.length ? cls.stats : findStats(body);
  const items = itemsFrom(content.body);
  const primary = decideFormat(cls, content);
  const words = new Set(tokens(`${content.topic || ""} ${body}`));

  const scored = INTENTS
    .filter((i) => i.suits.includes(postType))
    .map((i) => {
      let score = 0;
      const because = [];
      if (i.format === primary.format) { score += 8; because.push(primary.reason); }
      if (i.pillars.includes(cls?.pillar)) { score += 3; because.push(`It is a ${PILLAR_BY_ID[cls?.pillar]?.label?.toLowerCase() || "relevant"} post.`); }
      const hits = i.tags.filter((t) => words.has(t));
      if (hits.length) { score += Math.min(4, hits.length * 1.5); because.push(`The post mentions ${hits.slice(0, 3).join(", ")}.`); }

      /* Evidence gates. An option that the post cannot fill is not an option:
         suggesting a statistic card for a post with no figure in it is exactly
         the kind of irrelevant suggestion to avoid. */
      let usable = true;
      if (i.id === "stat" && !stats.length) usable = false;
      if ((i.id === "steps" || i.id === "list") && items.length < 3) usable = false;
      if (i.id === "compare" && items.length < 2) usable = false;
      if (i.id === "roles" && !(cls?.pillar === "hiring" && items.length >= 2)) usable = false;
      if (i.id === "occasion" && !cls?.occasion) usable = false;
      if (i.id === "event" && cls?.pillar !== "event" && !words.has("webinar") && !words.has("register")) usable = false;
      if (i.id === "quote" && !content.hook) usable = false;
      if (i.id === "people" && cls?.pillar !== "culture" && cls?.pillar !== "hiring") usable = false;
      if (i.id === "factcard" && !content.hook) usable = false;
      if (i.id === "statement" && !content.hook) usable = false;

      if (i.id === "occasion" && cls?.occasion) {
        because.push(`It marks ${occasionById(cls.occasion)?.label || "an occasion"}.`);
        score += 5;
      }
      return { intent: i, score, usable, why: because[0] || `A ${i.label.toLowerCase()} suits this post.`, all: because };
    })
    .filter((x) => x.usable && x.score > 0)
    .sort((a, b) => b.score - a.score);

  /* Always offer something. A post with only a headline still deserves
     options, so the two families that need nothing but a headline backfill. */
  if (scored.length < 3) {
    for (const id of ["statement", "factcard", "list", "quote"]) {
      if (scored.length >= 4) break;
      const i = INTENT_BY_ID[id];
      if (!i?.suits.includes(postType)) continue;
      if (scored.some((s) => s.intent.id === id)) continue;
      if (id === "list" && itemsFrom(content.body).length < 3) continue;
      if ((id === "quote" || id === "statement" || id === "factcard") && !content.hook) continue;
      scored.push({ intent: i, score: 0.5, usable: true, why: `A ${i.label.toLowerCase()} works from the headline alone.`, all: [] });
    }
  }
  return scored;
}

/* ---------- matching real Canva templates ---------- */

const normTitle = (t) => tokens(t).sort().join(" ");

export function scoreTemplate(template, intent, postType = "image") {
  const words = new Set(tokens(template?.title));
  const hits = intent.tags.filter((t) => words.has(t));
  const cats = intent.categories.filter((c) => words.has(c));
  const shape = shapeFit(template?.width, template?.height, postType);
  const score = hits.length * 2 + cats.length * 3 + shape.score;
  return { score, hits, cats, shape };
}

/* ---------- the suggestions ----------
   `templates` is what the relay returned from the connected account, or an
   empty list when Canva is not connected. Either way the caller gets options;
   what changes is the `source` on each one, which the UI shows. */
export function suggestTemplates({
  cls, content = {}, postType = "image", templates = [], limit = 4, canvaConnected = false, brand = {}, brief = {},
} = {}) {
  const ranked = rankIntents(cls, content, { postType });
  const fields = visualFields(cls, content, { brief, brand });
  const usableCanva = (templates || []).filter((t) => t?.id && shapeFit(t.width, t.height, postType).score > -10);

  const out = [];
  const usedTemplates = new Set();
  const usedTitles = new Set();

  for (const r of ranked) {
    if (out.length >= limit) break;
    const intent = r.intent;

    /* Best unused real template for this family, if the account has one. */
    let best = null;
    for (const t of usableCanva) {
      if (usedTemplates.has(t.id)) continue;
      const nt = normTitle(t.title);
      if (nt && usedTitles.has(nt)) continue;   /* two templates with the same
        title are the same design twice, which is not a second option. */
      const s = scoreTemplate(t, intent, postType);
      if (s.score <= 0) continue;
      if (!best || s.score > best.s.score) best = { t, s };
    }

    if (best) {
      usedTemplates.add(best.t.id);
      usedTitles.add(normTitle(best.t.title));
      out.push({
        key: `canva:${best.t.id}`,
        source: "canva",
        intent: intent.id,
        label: best.t.title,
        family: intent.label,
        why: r.why,
        shapeNote: best.s.shape.note,
        templateId: best.t.id,
        thumbnail: best.t.thumbnail || null,
        viewUrl: best.t.viewUrl || null,
        editUrl: best.t.createUrl || null,
        matched: [...best.s.cats, ...best.s.hits].slice(0, 4),
        score: Math.round((r.score + best.s.score) * 10) / 10,
      });
      continue;
    }

    /* No Canva template fits this family. Offer the Unison layout, labelled
       as one — never a Canva template that does not exist. */
    const f = FORMATS[intent.format];
    out.push({
      key: `unison:${intent.format}`,
      source: "unison",
      intent: intent.id,
      label: f?.label || intent.label,
      family: intent.label,
      why: r.why,
      shapeNote: SHAPES[postType]?.label ? `Rendered at ${SHAPES[postType].label}.` : "",
      format: intent.format,
      template: f?.template || intent.format,
      photo: !!f?.photo,
      thumbnail: null,
      note: canvaConnected
        ? "Your Canva brand templates do not include one for this layout, so this is Unison's own."
        : "A Unison layout. Connect Canva in Settings → AI to use your own brand templates.",
      matched: [],
      score: Math.round(r.score * 10) / 10,
    });
  }

  return { suggestions: out.slice(0, limit), fields, postType, canvaConnected, ranked: ranked.map((r) => r.intent.id) };
}

/* Which template fields Unison can offer to fill, given what the post has.
   Used to pre-fill a Canva template's real dataset fields by matching their
   names, which is the only way to fill a template the user designed. */
const FIELD_ALIASES = {
  headline: ["headline", "title", "heading", "header", "hook", "main", "h1"],
  support: ["support", "subtitle", "subheading", "sub", "body", "description", "text", "caption", "detail"],
  kicker: ["kicker", "eyebrow", "label", "category", "tag", "topic"],
  stat: ["stat", "number", "figure", "metric", "value", "percent", "percentage", "kpi"],
  statLabel: ["statlabel", "unit", "measure", "metriclabel", "numberlabel"],
  items: ["items", "points", "list", "bullets", "steps"],
  quote: ["quote", "quotation", "testimonial"],
  attrib: ["attrib", "attribution", "author", "name", "person", "company", "companyname", "brand", "by"],
  footer: ["footer", "website", "site", "url", "link", "handle", "contact"],
  greeting: ["greeting", "wishes", "message"],
  source: ["source", "authority", "reference", "citation"],
};

/* Canva field names are whatever the designer typed — "Headline 1",
   "sub_title", "Company name". Matching on the words in the name is how a fill
   lands in the right place.

   The whole name is tried first, because a name is more than its words:
   "sub_title" reads as one word, "subtitle", which belongs to the supporting
   line. Matching word by word instead put the headline there, since "title" is
   also a word for a headline. Where only single words match, the earliest one
   in the name decides — it is the word that distinguishes the field. */
export function mapFields(canvaFields, fields) {
  const values = {};
  const unmatched = [];
  const available = Object.entries(FIELD_ALIASES).filter(([key]) => fields?.[key]);

  for (const f of canvaFields || []) {
    if (f.type !== "text") { if (f.type === "image") unmatched.push(f); continue; }
    const want = tokens(f.name);
    const joined = want.join("");

    let hit = available.find(([, aliases]) => aliases.includes(joined))?.[0] || null;

    if (!hit) {
      let bestAt = Infinity;
      for (const [key, aliases] of available) {
        const at = want.findIndex((w) => aliases.includes(w));
        if (at !== -1 && at < bestAt) { bestAt = at; hit = key; }
      }
    }

    if (hit) values[f.name] = fields[hit];
    else unmatched.push(f);
  }
  return { values, unmatched };
}

export { chooseStat };
