/* Single source of truth for "which captions exist" and "what language is this".
 *
 * Why this file exists: the evidence table used to build its rows from
 * `contributions` (every caption feeding a line) while the translators built
 * their work list from `sourceLabels` (ONE caption per target — last write
 * wins) plus `unmatched`. Any caption that lost that last-write-wins race was
 * therefore visible on screen and counted on the button, but unreachable by the
 * translator, which then reported "Nothing left to translate".
 *
 * Both sides now call collectCaptionLabels(), so the two lists cannot diverge.
 */

export type CaptionSource = {
  contributions?: Record<string, Array<{ label: string }>>;
  sourceLabels?: Record<string, { label: string }>;
  unmatched?: Array<{ label: string }>;
};

/** Every caption an entity holds, from all three provenance stores, de-duped.
    This must remain a SUPERSET of whatever the evidence table can display. */
export function collectCaptionLabels(ent: CaptionSource): string[] {
  const out = new Set<string>();
  for (const list of Object.values(ent.contributions || {})) {
    for (const c of list || []) if (c?.label) out.add(c.label);
  }
  for (const src of Object.values(ent.sourceLabels || {})) {
    if (src?.label) out.add(src.label);
  }
  for (const u of ent.unmatched || []) if (u?.label) out.add(u.label);
  return [...out];
}

/* ------------------------------------------------------------------ */

const SCRIPTS: Array<{ name: string; code: string; re: RegExp }> = [
  { name: "Arabic", code: "ar", re: /[\u0600-\u06FF]/ },
  { name: "Chinese", code: "zh", re: /[\u4E00-\u9FFF]/ },
  { name: "Japanese", code: "ja", re: /[\u3040-\u30FF]/ },
  { name: "Korean", code: "ko", re: /[\uAC00-\uD7AF]/ },
  { name: "Russian", code: "ru", re: /[\u0400-\u04FF]/ },
  { name: "Greek", code: "el", re: /[\u0370-\u03FF]/ },
  { name: "Hebrew", code: "he", re: /[\u0590-\u05FF]/ },
  { name: "Hindi", code: "hi", re: /[\u0900-\u097F]/ },
  { name: "Bengali", code: "bn", re: /[\u0980-\u09FF]/ },
  { name: "Tamil", code: "ta", re: /[\u0B80-\u0BFF]/ },
  { name: "Telugu", code: "te", re: /[\u0C00-\u0C7F]/ },
  { name: "Gujarati", code: "gu", re: /[\u0A80-\u0AFF]/ },
  { name: "Thai", code: "th", re: /[\u0E00-\u0E7F]/ },
];

const HINTS: Array<{ name: string; code: string; words: string[] }> = [
  { name: "French", code: "fr", words: ["achats", "charges", "produits", "créances", "dettes", "immobilisations", "amortissements", "loyer", "société", "trésorerie", "capital social", "intérêts", "assimilées", "chiffre d'affaires", "résultat", "exercice"] },
  { name: "Spanish", code: "es", words: ["ingresos", "gastos", "cuenta", "clientes", "proveedores", "inmovilizado", "existencias", "capital", "banco"] },
  { name: "German", code: "de", words: ["umsatz", "aufwand", "ertrag", "forderungen", "verbindlichkeiten", "anlagevermögen", "kapital"] },
  { name: "Portuguese", code: "pt", words: ["receita", "despesa", "clientes", "fornecedores", "imobilizado", "capital"] },
  { name: "Italian", code: "it", words: ["ricavi", "costi", "crediti", "debiti", "immobilizzazioni", "capitale"] },
  { name: "Vietnamese", code: "vi", words: ["doanh thu", "chi phí", "tài sản", "nợ phải trả", "vốn chủ sở hữu", "hàng tồn kho", "lợi nhuận", "khoản phải thu", "tiền mặt"] },
  { name: "Dutch", code: "nl", words: ["omzet", "kosten", "vorderingen", "schulden", "eigen vermogen", "voorzieningen", "materiële", "overlopende"] },
];

/** Script first, then accounting vocabulary, then accented-letter fallback. */
export function detectLanguage(label: string): string {
  return detectLanguageEntry(label).name;
}

/** Same detection, but also yields the ISO code the translation services want.
    Returns code "auto" only when we genuinely cannot tell. */
export function detectLanguageEntry(label: string): { name: string; code: string } {
  for (const s of SCRIPTS) if (s.re.test(label)) return { name: s.name, code: s.code };
  // Normalise the apostrophe: PDFs emit U+2019 as often as U+0027, and
  // "chiffre d'affaires" must match either form.
  const l = label.toLowerCase().replace(/[\u2018\u2019\u02BC]/g, "'");
  for (const h of HINTS) if (h.words.some((w) => l.includes(w))) return { name: h.name, code: h.code };
  // Vietnamese shares ă â ê ô with French/Portuguese, so it is tested AFTER the
  // vocabulary hints and only on letters no other Latin language uses.
  if (/[đơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(label)) return { name: "Vietnamese", code: "vi" };
  if (/[àâçéèêëîïôûùÿœ]/.test(l)) return { name: "French", code: "fr" };
  if (/[áíóúñ¿¡]/.test(l)) return { name: "Spanish", code: "es" };
  if (/[äöüß]/.test(l)) return { name: "German", code: "de" };
  return { name: "English", code: "en" };
}

/** The language code to send to a translation service for this caption.
    "auto" when the caption looks English — we still ask, because the
    vocabulary lists are not exhaustive, but we never send "en|en". */
export function translateSourceCode(label: string): string {
  const code = detectLanguageEntry(label).code;
  return code === "en" ? "auto" : code;
}

/* ------------------------------------------------------------------ */

/** MyMemory and friends report failures INSIDE a 200 response, in the same
    field a real translation would occupy. Anything matching here is an error
    message, not a translation, and must never be stored as one. */
const SERVICE_ERROR_RE =
  /MYMEMORY WARNING|QUOTA EXCEEDED|PLEASE SELECT TWO DISTINCT LANGUAGES|INVALID LANGUAGE PAIR|IS AN INVALID|NO TARGET LANGUAGE|ALL RESULTS FILTERED|EXCEEDED YOUR|TOO MANY REQUESTS|LIMIT EXCEEDED/i;

export function isServiceErrorText(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (SERVICE_ERROR_RE.test(t)) return true;
  // Catch-all: these services shout their errors. A caption translation that
  // has letters but not one lowercase letter is a shouted error, not a
  // translation. (Short all-caps acronyms are excluded by the length test.)
  if (t.length > 12 && /[A-Z]/.test(t) && !/[a-z]/.test(t)) return true;
  return false;
}

/** Entries already saved by an earlier build that are actually error strings.
    Returned so they can be dropped and the caption retried. */
export function poisonedTranslationKeys(translations: Record<string, string>): string[] {
  return Object.entries(translations || {})
    .filter(([, v]) => typeof v === "string" && isServiceErrorText(v))
    .map(([k]) => k);
}

/* ------------------------------------------------------------------ */

/** The caption to SHOW and to WRITE for a label, once the document has been
    translated: the stored English if there is a usable one, else the original.

    Translation runs as its own step AFTER processing, so this must be called
    at render/write time, never baked into a stored string — a message built
    during processing would keep the original wording until the entity was
    processed again. The Multilingual evidence tab already resolves this way,
    which is why it was the only surface showing English.

    An error string a service returned in the translation field is not a
    translation (see isServiceErrorText); those fall back to the original
    rather than printing "MYMEMORY WARNING …" onto a work paper. */
export function displayLabel(
  translations: Record<string, string> | undefined,
  label: string,
): string {
  const en = translations?.[label];
  if (!en || en === label) return label;
  return isServiceErrorText(en) ? label : en;
}
