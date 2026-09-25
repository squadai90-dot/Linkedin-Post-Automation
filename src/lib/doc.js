/* Reading an uploaded document without a model.
 *
 * The AI path gives a real summary. This is what happens when there is no
 * key, the free limit has run out, or the call fails: rather than the upload
 * doing nothing at all, the document's own sentences are used. Everything
 * here is quoted from the file — nothing is invented — and the result is
 * marked `degraded` so the panel can say where it came from. */

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/* Sentences worth showing: long enough to say something, short enough to
   read, and not a heading, a page number or a row of table gutter. */
export function sentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 300 && /[a-z]/.test(s) && (s.match(/ /g) || []).length >= 5);
}

const FIGURE = /(\d[\d,.]*\s?(%|percent|bn|billion|million|k\b|crore|lakh)|[$£€₹]\s?\d|\b\d{4}\b|\b\d[\d,.]*\b)/i;

export function digestDocument(text, name = "the document") {
  const all = sentences(text);
  const withFigures = all.filter((s) => FIGURE.test(s));
  const plain = all.filter((s) => !withFigures.includes(s));

  const summary = all.length
    ? clip(all[0], 160)
    : `${name} was read but had no readable sentences in it.`;

  const stats = withFigures.slice(0, 4).map((s) => clip(s, 140));
  const facts = plain.slice(0, 4).map((s) => clip(s, 140));
  /* An insight is a judgement about the document. Without a model there is
     nothing honest to put here, so it stays empty rather than being padded
     with the same sentences under a grander heading. */
  const insights = [];
  /* A claim has to be something the writer could stand behind, so the ones
     carrying a figure come first. */
  const claims = [...withFigures, ...plain].slice(0, 3).map((s) => clip(s, 140));

  return { summary, facts, stats, insights, claims, degraded: true };
}

/* An uploaded document is a tier-1 source, and its claims go into the same
   list the writer is handed — that is the whole point of the upload. Folding
   it in is a separate step because research is rebuilt from scratch every
   time discovery runs, and the document has to survive that. */
export const DOC_PUBLISHER = "Uploaded document";

export function addDocToResearch(research, doc) {
  if (!doc) return research;
  const src = {
    title: doc.name,
    publisher: DOC_PUBLISHER,
    date: new Date().toISOString().slice(0, 10),
    tier: 1,
    note: doc.summary || "Uploaded by you.",
    url: "",
    uploaded: true,
  };
  const claims = (doc.claims || []).map((text) => ({ text, sourceIndex: 0, fromDocument: true }));
  /* The engine's own insights stay as they are. What the document says is
     kept beside them under its own heading, so "What stood out" visibly
     grows when a file is uploaded and a second upload replaces the first
     rather than piling on top of it. */
  const docInsights = doc.insights || [];
  if (!research) {
    return { sources: [src], claims, insights: [], docInsights, freshness: "Primary", risks: [] };
  }
  /* Re-uploading, or re-running research, must not stack the same document up
     twice — and every other source shifts down by one, so their claims have
     to keep pointing at the right row. */
  const rest = (research.sources || []).filter((x) => !(x.uploaded && x.title === doc.name));
  const dropped = (research.sources || []).length - rest.length;
  const kept = (research.claims || [])
    .filter((c) => !c.fromDocument)
    .map((c) => ({ ...c, sourceIndex: Math.max(0, (c.sourceIndex || 0) - dropped) + 1 }));
  return { ...research, sources: [src, ...rest], claims: [...claims, ...kept], docInsights };
}
