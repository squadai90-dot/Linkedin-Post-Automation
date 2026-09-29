/* ============================================================
   ART DIRECTION

   Turns a finished post into a generation prompt, and decides which visual
   style it should be drawn in. This is the difference between "a picture
   about accounting" and a picture about THIS post.

   Two rules run through all of it.

   First, the model is never asked to write. No text, no figures, no logos,
   no signage — diffusion models cannot spell reliably, and a company page
   cannot afford a graphic with a misspelt greeting or a wrong decimal. The
   artwork is generated, then the exact approved words are composited over it
   (see compose.js). That is the only way the words are guaranteed right.

   Second, the subject comes from the post. A festival post gets that
   festival's own scene; a statistics post gets a visual metaphor for what
   the figure measures; an AI post gets what the post actually says about AI
   rather than a robot, which is the cliché every generator reaches for.
   ============================================================ */

import { COUNTRIES, occasionById, findStats } from "./intel.js";

/* The styles a user can pick. `auto` is not in the list because it is a
   decision, not a style — it resolves to one of these. */
export const STYLES = [
  {
    id: "illustrated",
    label: "Illustrated",
    note: "Flat vector illustration with depth — the house style of modern B2B brands.",
    recipe: "professional flat vector editorial illustration, clean geometric shapes, confident line work, subtle grain, generous negative space, restrained two-to-three colour palette with one accent, no outlines around every object, modern B2B brand illustration of the kind used by a serious professional-services firm",
    avoid: "clip art, childish cartoon, mascot characters, gradients on everything, cluttered composition",
  },
  {
    id: "3d",
    label: "3D animated",
    note: "Soft-lit 3D render, the polished look of a modern product site.",
    recipe: "polished soft 3D render, matte clay materials, gentle studio lighting with soft shadows, shallow depth of field, isometric or three-quarter view, restrained palette, premium animated-film look, high craft",
    avoid: "plastic toy look, harsh specular highlights, uncanny human faces, chrome, lens flare",
  },
  {
    id: "editorial",
    label: "Editorial",
    note: "Conceptual artwork of the kind that opens a magazine feature.",
    recipe: "conceptual editorial illustration in the manner of a serious business publication, one strong visual metaphor, bold simplified forms, textured paper feel, limited palette, generous composition with room to breathe",
    avoid: "literal stock imagery, busy collage, clip art, text",
  },
  {
    id: "infographic",
    label: "Infographic",
    note: "Drawn by Unison, not by a model — exact figures, every time.",
    recipe: null,                     // rendered from templates; never sent to a model
    avoid: null,
    rendered: true,
  },
  {
    id: "realistic",
    label: "Realistic",
    note: "Photographic. Best for people and places, worst for anything with a number on it.",
    recipe: "professional editorial photograph, natural light, shallow depth of field, authentic unposed moment, muted colour grade, modern workplace or real location, shot on a fast prime lens",
    avoid: "stock-photo handshakes, fake smiles, obvious staging, watermarks, text",
  },
];

export const STYLE_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s]));
export const STYLE_IDS = ["auto", ...STYLES.map((s) => s.id)];

/* Which style suits this post when the user has not chosen one.
   Deliberately conservative: anything carrying a figure or a rule goes to the
   renderer, because that is the only path where the number is guaranteed
   correct. */
export function autoStyle(cls, content = {}) {
  const stats = cls?.stats?.length ? cls.stats : findStats([content.hook, content.body].join(" "));
  if (cls?.occasion) return "illustrated";
  if (cls?.pillar === "culture") return "realistic";
  if (cls?.pillar === "hiring") return "illustrated";
  /* A rule, a deadline or a figure has to be legible and exact. */
  if (stats.length || ["regulatory", "seasonal", "proof"].includes(cls?.pillar)) return "infographic";
  if (cls?.pillar === "thought") return "editorial";
  return "illustrated";
}

export const resolveStyle = (style, cls, content) =>
  (!style || style === "auto" ? autoStyle(cls, content) : (STYLE_BY_ID[style] ? style : "illustrated"));

/* ---------- subject ----------
   What the picture is OF. Drawn from the post rather than from its keywords,
   which is how every AI post ends up with the same robot. */

const CLICHE = {
  ai: "Do not draw a humanoid robot, a glowing brain, a circuit board or binary digits.",
  money: "Do not draw coins, banknotes, piggy banks or dollar signs.",
  growth: "Do not draw a generic upward arrow over a city skyline.",
  handshake: "Do not draw a handshake.",
};

const TOPIC_CLICHES = [
  [/\b(ai|artificial intelligence|machine learning|automation|llm)\b/i, CLICHE.ai],
  [/\b(cost|price|saving|revenue|profit|fee)\b/i, CLICHE.money],
  [/\b(growth|scale|scaling|expand)\b/i, CLICHE.growth],
  [/\b(partner|client|relationship|trust)\b/i, CLICHE.handshake],
];

/* One concrete scene, in the post's own terms. */
export function subjectFor(cls, content = {}) {
  const occ = cls?.occasion ? occasionById(cls.occasion) : null;
  if (occ) return occ.scene || `a ${occ.label} celebration scene with ${(occ.symbols || []).join(", ")}`;

  const hook = String(content.hook || "").replace(/\s+/g, " ").trim();
  const body = String(content.body || "");
  const stats = cls?.stats?.length ? cls.stats : findStats(`${hook} ${body}`);

  switch (cls?.pillar) {
    case "hiring":
      return "a small group of accounting professionals working together in a bright modern office, one of them explaining something at a screen";
    case "culture":
      return "colleagues in a real working moment together — not posed, not a meeting-room stock scene";
    case "capacity":
      return "a workload visibly out of balance: one desk stacked while another is clear, or a queue of work moving unevenly";
    case "seasonal":
      return "a calendar or a working year rendered as a clear, calm visual sequence";
    case "proof":
      return stats.length
        ? `a visual metaphor for something measurably improving — a process getting shorter or lighter — with no numbers drawn`
        : "a before-and-after of the same working process, the second version visibly calmer";
    case "regulatory":
      return "an official document or filing rendered as a clean, abstract object on a calm background";
    default:
      return hook ? `a visual metaphor for: ${hook}` : "a calm, abstract professional business scene";
  }
}

/* ---------- the prompt ---------- */

export function imagePrompt({ classification = {}, content = {}, style, brand = {} } = {}) {
  const resolved = resolveStyle(style, classification, content);
  const spec = STYLE_BY_ID[resolved];
  if (!spec || spec.rendered) return null;           // drawn by Unison, not by a model

  const subject = subjectFor(classification, content);
  const occ = classification.occasion ? occasionById(classification.occasion) : null;
  const country = classification.country ? COUNTRIES[classification.country] : null;
  const text = `${content.hook || ""} ${content.body || ""}`;
  const cliches = TOPIC_CLICHES.filter(([re]) => re.test(text)).map(([, note]) => note);

  const parts = [
    subject + ".",
    spec.recipe + ".",
    occ ? `Culturally accurate ${occ.label} detail: ${(occ.symbols || []).join(", ")}. Colours drawn from ${(occ.palette || []).join(", ")}. Respectful and celebratory, suitable for a company page.` : "",
    country && !occ ? `Setting reads as ${country.label}.` : "",
    "Wide 16:9 composition with clear empty space in the left third, because a headline is placed there afterwards.",
    /* The single most important instruction in the whole prompt. */
    "Absolutely no text, letters, numbers, words, signage, logos, watermarks or user-interface elements anywhere in the image.",
    `Avoid: ${spec.avoid}.`,
    ...cliches,
    brand.name ? "Corporate, restrained, suitable for a professional services company." : "",
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/* A video prompt for one scene. Motion is described because a still prompt
   sent to a video model produces a still that drifts. */
export function videoPrompt({ classification = {}, content = {}, style, scene = null } = {}) {
  const base = imagePrompt({ classification, content, style });
  if (!base) return null;
  const occ = classification.occasion ? occasionById(classification.occasion) : null;
  const motion = occ?.moving
    ? `The subject is genuinely moving — ${occ.id === "navratri" ? "dancing garba, sticks striking in rhythm, skirt turning" : "the celebration is in motion"} — with a slow camera push in.`
    : "Slow, deliberate motion: a gentle camera push and one element of the scene moving. No fast cuts.";
  const beat = scene?.line ? `This scene carries the idea: ${scene.line}.` : "";
  return [base, motion, beat, "Consistent lighting and palette with the other scenes."].filter(Boolean).join(" ");
}

/* What a generation will cost, from the relay's own published pricing.
   Returns null when nothing reliable is known, so the UI can say so rather
   than guess. */
export function estimateCost({ kind, provider, pricing, seconds = 8, count = 1 } = {}) {
  const p = pricing?.[provider];
  if (!p) return null;
  if (kind === "image" && typeof p.usdPerImage === "number") return Number((p.usdPerImage * count).toFixed(3));
  if (kind === "video" && typeof p.usdPerSecond === "number") return Number((p.usdPerSecond * seconds).toFixed(3));
  return null;
}
