/* ============================================================
   THE QUALITY GATE

   Run before anything is shown, on the post, the graphic and the storyboard.
   Every check here is deterministic: it needs no model, no key and no
   network, so it still runs when the free tier is exhausted — which is
   exactly when generated output is most likely to be thin.

   The checks are written to catch the specific failures that matter for
   accounting content. A figure nobody can source. Two countries' rules in
   one post. A Diwali greeting on a stock office graphic. A statistic card
   with no statistic. A video whose scenes say something the post does not.
   A "game-changing solution in today's fast-paced landscape", which is what
   a model produces when it has nothing to say.

   `blocking` means do not show this. `warn` means show it and say why.
   ============================================================ */

import { COUNTRIES, COUNTRY_IDS, EXCLUSIVE_TERMS, findStats, occasionById } from "./intel.js";
import { FORMATS } from "./visual.js";
import { TEMPLATE_BY_ID } from "./templates.js";
import { LI_LIMIT, LI_FOLD } from "./util.js";

/* Phrases that appear when a model is padding. Each one is a whole phrase
   rather than a single word, because "leverage" in "leverage ratio" is a
   real accounting term and flagging it would be worse than useless. */
const FILLER = [
  "in today's fast-paced", "in today's ever-changing", "in the ever-evolving", "in an increasingly",
  "game-changer", "game changing", "revolutionize", "revolutionise", "unlock the power",
  "take it to the next level", "it's no secret that", "at the end of the day",
  "delve into", "navigate the complexities", "navigating the complexities",
  "in this digital age", "the world of accounting", "look no further",
  "leverage synergies", "best-in-class solutions", "cutting-edge solutions",
  "seamlessly integrate", "empower your business", "drive growth and efficiency",
  "one-stop shop", "tailored to your unique needs", "we've got you covered",
];

const lower = (s) => String(s || "").toLowerCase();
const finding = (id, severity, message, fix) => ({ id, severity, message, fix });

/* ---------- content ---------- */

export function checkContent({ draft, classification, research } = {}) {
  const out = [];
  if (!draft) return out;
  const text = [draft.hook, draft.body, draft.cta].filter(Boolean).join("\n");
  const hay = lower(text);
  const cls = classification || {};

  /* Every figure in the post should be traceable to something research
     found. A number a model produced on its own is the single most damaging
     thing this product can publish. */
  const stats = findStats(text);
  if (stats.length) {
    const sourced = lower([
      ...(research?.claims || []).map((c) => c.text),
      ...(research?.insights || []),
      ...(research?.sources || []).map((s) => s.note),
    ].join(" "));
    const loose = stats.filter((f) => !sourced.includes(lower(f)));
    if (loose.length) {
      out.push(finding("unsourced-figure", "blocking",
        `${loose.length === 1 ? "A figure is" : `${loose.length} figures are`} in the post that research did not supply: ${loose.join(", ")}.`,
        "Cite a source for it, or take it out. Do not publish a number the research did not produce."));
    }
  }

  /* Two jurisdictions' vocabularies in one post is either a deliberate
     comparison or a serious mistake, and it reads as a mistake to anyone who
     knows the rules. */
  if ((cls.mixedCountries || []).length > 1) {
    const names = cls.mixedCountries.map((id) => COUNTRIES[id].label).join(" and ");
    out.push(finding("mixed-jurisdiction", "blocking",
      `The post uses ${names} terminology together.`,
      "Pick one country and use only its regulator, forms and deadlines — or say explicitly that you are comparing them."));
  }

  /* A country-specific post that never names its country leaves the reader
     guessing which rules apply to them. */
  if (cls.country && !(cls.mixedCountries || []).length) {
    const c = COUNTRIES[cls.country];
    const named = hay.includes(lower(c.label)) || hay.includes(lower(c.adjective)) || hay.includes(lower(c.regulator));
    if (!named) {
      out.push(finding("country-unstated", "warn",
        `This reads as a ${c.adjective} post but never says so.`,
        `Name ${c.adjective} or ${c.regulator} in the first two lines so a reader in another country knows it is not about them.`));
    }
  }

  const hits = FILLER.filter((f) => hay.includes(f));
  if (hits.length) {
    out.push(finding("filler", hits.length > 1 ? "blocking" : "warn",
      `Generic phrasing: ${hits.map((h) => `"${h}"`).join(", ")}.`,
      "Published analysis is blunt about this — a post anyone's AI could have written is worth nothing. Replace it with something only this firm could say."));
  }

  /* Nothing concrete at all is the generic-filler failure in its other form:
     no number, no rule, no named thing. */
  if (!stats.length && !cls.country && !cls.occasion && text.length > 200) {
    const concrete = /\b(19|20)\d{2}\b|\b\d+\b|[£$€₹]/.test(text);
    if (!concrete) {
      out.push(finding("no-specifics", "warn",
        "The post contains no figure, date, rule or named thing.",
        "Add one concrete detail — a deadline, a figure from the research, a named form — or the post says nothing a reader can act on."));
    }
  }

  if (text.length > LI_LIMIT) {
    out.push(finding("too-long", "blocking", `The post is ${text.length} characters; LinkedIn allows ${LI_LIMIT}.`, "Cut it back."));
  }
  const firstLine = String(draft.hook || "").trim();
  if (firstLine.length > LI_FOLD) {
    out.push(finding("hook-folded", "warn",
      `The opening line is ${firstLine.length} characters, so it is cut off at about ${LI_FOLD} behind "see more".`,
      "Put the point before the fold."));
  }
  const tags = (draft.hashtags || []).length;
  if (tags > 5) out.push(finding("hashtags", "warn", `${tags} hashtags.`, "Three to five reads as considered; more reads as reach-chasing."));

  return out;
}

/* ---------- visual ---------- */

export function checkVisual({ asset, classification, draft } = {}) {
  const out = [];
  if (!asset) return out;
  const cls = classification || {};
  const strategy = asset.strategy;
  const f = strategy?.fields || {};

  if (!strategy) {
    out.push(finding("no-strategy", "warn", "This graphic was not chosen from the post.", "Regenerate it so the layout follows what the post actually says."));
    return out;
  }

  /* A format that cannot do its job without a field it does not have. */
  const spec = FORMATS[strategy.format];
  const missing = (spec?.needs || []).filter((k) => !String(f[k] || "").trim());
  if (missing.length) {
    out.push(finding("format-empty", "blocking",
      `A ${spec.label.toLowerCase()} was chosen but ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} empty.`,
      "Choose a format the post can actually fill."));
  }

  /* The occasion is the message. Anything else is the stock-photo failure. */
  if (cls.occasion && strategy.format !== "occasion") {
    const occ = occasionById(cls.occasion);
    out.push(finding("occasion-mismatch", "blocking",
      `This marks ${occ?.label || "an occasion"} but the graphic is a ${spec?.label.toLowerCase() || strategy.format}.`,
      `Use the occasion graphic so it reads as ${occ?.label || "the occasion"} rather than as a generic business image.`));
  }
  if (cls.occasion && occasionById(cls.occasion)?.care) {
    out.push(finding("occasion-care", "warn", occasionById(cls.occasion).care, "Say what the firm actually does, not only that the date exists."));
  }

  /* A figure on a graphic, with nothing saying where it came from, is the
     most screenshotted and least defensible thing a firm can post. */
  const onGraphic = findStats([f.stat, f.headline, f.statLabel, f.items].filter(Boolean).join(" "));
  /* Having a source in the fields is not the same as showing one. The gate
     passed a statistic card whose source was set and whose template had no
     place to draw it, which is exactly the unattributed figure this check
     exists to catch. */
  const drawsSource = (TEMPLATE_BY_ID[strategy.template]?.fields || []).includes("source");
  const sourceShown = drawsSource && !!String(f.source || "").trim();
  if (onGraphic.length && !sourceShown && strategy.format !== "occasion") {
    out.push(finding("stat-unattributed", "warn",
      `The graphic shows ${onGraphic[0]} with no source on it${drawsSource ? "" : " — this layout has nowhere to put one"}.`,
      "Put the authority on the graphic — it travels without the post text when someone screenshots it."));
  }

  /* Headlines that will be clipped by the renderer rather than shrunk. */
  if (String(f.headline || "").length > 90) {
    out.push(finding("headline-clipped", "warn", "The headline is longer than the template can set.", "Cut it to one idea."));
  }

  /* The graphic should be about the post. Overlap of meaningful words is a
     crude but honest test, and it catches a graphic left over from a
     previous draft. */
  if (draft?.hook && f.headline) {
    const words = (s) => new Set(lower(s).split(/[^a-z0-9]+/).filter((w) => w.length > 4));
    const a = words(`${draft.hook} ${draft.body || ""}`), b = words(f.headline);
    const shared = [...b].filter((w) => a.has(w)).length;
    if (b.size >= 3 && shared === 0) {
      out.push(finding("graphic-unrelated", "warn", "Nothing on the graphic appears in the post.", "Regenerate the graphic from the current draft."));
    }
  }
  return out;
}

/* ---------- video ---------- */

export function checkVideo({ asset, draft, seconds } = {}) {
  const out = [];
  const scenes = asset?.storyboard || [];
  if (!scenes.length) return out;

  const labels = scenes.map((s) => String(s.label || "").toUpperCase());
  if (!labels.includes("HOOK")) out.push(finding("video-no-open", "warn", "The video has no opening scene.", "Start on the post's hook."));
  if (!labels.includes("CTA")) out.push(finding("video-no-close", "warn", "The video does not end on an ask.", "Close on what the viewer should do."));

  /* Every scene has to come from the post. A scene about something the post
     never says is the video equivalent of an invented statistic. */
  if (draft) {
    const hay = lower([draft.hook, draft.body, draft.cta].filter(Boolean).join(" "));
    const stray = scenes.filter((s) => {
      const words = lower(s.line).split(/[^a-z0-9]+/).filter((w) => w.length > 4);
      return words.length >= 2 && !words.some((w) => hay.includes(w));
    });
    if (stray.length) {
      out.push(finding("video-off-script", stray.length > 1 ? "blocking" : "warn",
        `${stray.length} scene${stray.length === 1 ? "" : "s"} say something the post does not: ${stray.map((s) => `"${s.line}"`).join(", ")}.`,
        "Rebuild the storyboard from the post."));
    }
  }
  const secs = seconds || asset?.seconds || 0;
  if (secs > 90) out.push(finding("video-long", "warn", `${secs}s. Short-form placement favours under 90.`, "Cut a scene."));
  return out;
}

/* ---------- the verdict ---------- */

export function review({ draft, classification, research, image, video, seconds } = {}) {
  const findings = [
    ...checkContent({ draft, classification, research }),
    ...checkVisual({ asset: image, classification, draft }),
    ...checkVideo({ asset: video, draft, seconds }),
  ];
  const blocking = findings.filter((f) => f.severity === "blocking");
  return {
    findings,
    blocking,
    warnings: findings.filter((f) => f.severity === "warn"),
    pass: blocking.length === 0,
    /* Worth another attempt only when a different choice could fix it.
       An unsourced figure cannot be regenerated away — it needs a source. */
    regenerate: blocking.some((f) => ["format-empty", "occasion-mismatch", "video-off-script", "no-strategy"].includes(f.id)),
    summary: blocking.length
      ? `${blocking.length} thing${blocking.length === 1 ? "" : "s"} to fix before this goes out.`
      : findings.length
        ? `Nothing blocking. ${findings.length} thing${findings.length === 1 ? "" : "s"} worth a look.`
        : "Nothing found.",
  };
}

export const COUNTRY_LABELS = Object.fromEntries(COUNTRY_IDS.map((id) => [id, COUNTRIES[id].label]));
export { EXCLUSIVE_TERMS };
