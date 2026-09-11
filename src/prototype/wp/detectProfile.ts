/* Reads entity particulars out of an uploaded document so the profile fills
   itself. Everything found here is a proposal: the value is written only into
   a field the preparer has left blank, each one records where it came from,
   and all of them stay editable. Nothing detected here can block generation. */

import { CURRENCY_CODES, FX_META } from "./fxRates";

export type DetectedField = {
  key: string;
  value: string;
  sourceLabel: string;
  confidence: "high" | "medium";
  /** Stable provenance for the staleness prune — the source document's name
      when known (sourceLabel is human-prose and may not start with it), plus
      how the value was arrived at when that was not a keyword match. */
  src?: { doc?: string | null; page?: number | null; heading?: string | null; label?: string; via?: string };
};

type Matcher = {
  key: string;
  /** Label variants, lower-cased, matched as substrings of the caption. */
  labels: string[];
  /** Optional post-processing / validation of the captured value. */
  clean?: (raw: string) => string | null;
};

const CATEGORY_KEYS = ["1a", "1b", "1c", "2", "3", "4", "5a", "5b", "5c"];

const YES = /^(y|yes|true|x|✓)$/i;
const NO = /^(n|no|false)$/i;

/** Normalise a caption for comparison: lower case, no punctuation runs. */
const norm = (s: string) => String(s).toLowerCase().replace(/[:\-–—*]+$/g, "").replace(/\s+/g, " ").trim();

/** Dates arrive in many shapes; keep the template's own m/d/yy convention. */
function cleanDate(raw: string): string | null {
  const s = String(raw).trim();
  if (!s) return null;
  // Excel serial date
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) as unknown as number);
    d.setUTCDate(d.getUTCDate() + parseInt(s, 10));
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
  }
  // ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}/${iso[1].slice(2)}`;
  // d/m/yyyy or m/d/yyyy — leave the order alone, just shorten the year
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/.exec(s);
  if (slash) return `${Number(slash[1])}/${Number(slash[2])}/${slash[3].slice(-2)}`;
  if (s.length <= 24) return s;
  return null;
}

function cleanPercent(raw: string): string | null {
  const s = String(raw).trim().replace(/%/g, "");
  const n = Number(s);
  if (!isFinite(n)) return null;
  // A fraction in the source means the same thing as a percentage here.
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  if (pct < 0 || pct > 100) return null;
  return String(Math.round(pct * 100) / 100);
}

function cleanYesNo(raw: string): string | null {
  const s = String(raw).trim();
  if (YES.test(s)) return "Yes";
  if (NO.test(s)) return "No";
  return null;
}

function cleanDays(raw: string): string | null {
  const n = Number(String(raw).replace(/[^0-9]/g, ""));
  if (!isFinite(n) || n < 0 || n > 366) return null;
  return String(n);
}

/** Currency: accept a code, or a currency/country name from the rate tables. */
export function cleanCurrency(raw: string): string | null {
  const s = String(raw).trim();
  const code = s.toUpperCase().replace(/[^A-Z]/g, "");
  if (code.length === 3 && CURRENCY_CODES.includes(code)) return code;
  const lower = s.toLowerCase();
  for (const c of CURRENCY_CODES) {
    const meta = FX_META[c];
    if (!meta) continue;
    if (meta.currency && lower === meta.currency.toLowerCase()) return c;
    if (meta.country && lower === meta.country.toLowerCase()) return c;
  }
  return null;
}

const MATCHERS: Matcher[] = [
  { key: "legalName", labels: ["legal name of entity", "legal name", "entity legal name", "company name", "name of entity", "registered name", "dénomination sociale", "razón social"] },
  { key: "entityShort", labels: ["entity name", "short name", "trading name"] },
  { key: "clientName", labels: ["client name", "client", "group name", "parent name", "shareholder name"] },
  { key: "addr1", labels: ["entity address", "address", "registered address", "registered office", "address line 1", "street", "adresse", "domicilio"] },
  { key: "addr2", labels: ["address line 2", "city", "town", "ville", "ciudad"] },
  { key: "addr3", labels: ["address line 3", "postal code", "post code", "zip", "region", "province"] },
  { key: "formed", labels: ["date of formation", "date of incorporation", "formation date", "incorporation date", "date formed", "incorporated on", "date de création"], clean: cleanDate },
  { key: "countryInc", labels: ["country of incorporation", "country of incorportion", "country of organization", "jurisdiction", "country", "pays", "país"] },
  { key: "booksPerson", labels: ["person in charge", "books and records", "custodian of records", "records keeper", "responsible officer"] },
  { key: "activity", labels: ["principal business activity", "business activity", "nature of business", "principal activity", "activité principale", "actividad"] },
  { key: "currency", labels: ["functional currency", "currency", "reporting currency", "presentation currency", "local currency", "devise", "moneda"], clean: cleanCurrency },
  { key: "cyEnd", labels: ["current year end", "year end", "period end", "fiscal year end", "balance sheet date", "as of", "as at"], clean: cleanDate },
  { key: "pyEnd", labels: ["prior year end", "previous year end", "comparative period", "prior period"], clean: cleanDate },
];

/** The cleaner a matcher would have applied to this field's value. Exported
    so the AI profile pass — which names a FIELD and reuses the document's own
    value — puts that value through exactly the same normalisation a keyword
    match would have. */
export function cleanFor(key: string): ((raw: string) => string | null) | undefined {
  return [...MATCHERS, ...OWNERSHIP_MATCHERS].find((m) => m.key === key)?.clean;
}

/** Does a string parse as a plausible calendar date? Used to REFUSE an AI
    proposal for a date field rather than write a sentence into a date cell. */
export function looksLikeDate(value: unknown): boolean {
  const s = String(value || "").trim();
  if (!s || s.length > 24) return false;
  const d = new Date(s);
  return !isNaN(+d) && d.getFullYear() > 1900 && d.getFullYear() < 2100;
}

const OWNERSHIP_MATCHERS: Matcher[] = [
  { key: "ownStart", labels: ["ownership % at start of year", "ownership at start", "opening ownership", "beginning ownership", "% owned at start"], clean: cleanPercent },
  { key: "ownEnd", labels: ["ownership % at end of year", "ownership at end", "closing ownership", "ending ownership", "% owned at end", "ownership %", "shareholding %", "percentage owned", "% owned"], clean: cleanPercent },
  { key: "isOfficer", labels: ["director or officer", "is the filer a director", "officer of the entity"], clean: cleanYesNo },
  { key: "tenPct", labels: ["10% corporate shareholder", "ten percent shareholder", "10 percent shareholder"], clean: cleanYesNo },
  { key: "cfc", labels: ["cfc?", "cfc", "controlled foreign corporation"], clean: cleanYesNo },
  { key: "daysCfc", labels: ["days in year that entity was cfc", "days as cfc", "cfc days"], clean: cleanDays },
  { key: "daysOwned", labels: ["days in year that filer owned stock", "days owned", "days stock held"], clean: cleanDays },
  { key: "transition", labels: ["transition tax year", "transition tax"], clean: cleanYesNo },
];

/* A caption on a numbered form: "02 Apellido Materno", "05 Nombres", "903 RUT
   del Representante". The box number is followed by words and nothing else
   numeric, which is what separates it from an address like "2 Oriente 248". */
const BOX_CAPTION = /^\d{1,3}\s+[^\d]+$/;

/* A boxed form prints several numbered captions across one line, with the
   values on the line beneath. An ordinary questionnaire row is caption plus
   value and can hold at most one such cell, so it never trips this. */
function isBoxedRow(row: string[]): boolean {
  let n = 0;
  for (const cell of row) {
    if (cell === undefined) continue;
    const t = String(cell).trim();
    if (/^\d{1,3}$/.test(t) || BOX_CAPTION.test(t)) n++;
  }
  return n >= 2;
}

/* The value for a boxed caption, taken from the line below. The grid has no
   coordinates, so the caption's own column is tried first and the rest of the
   row after it: on Chile's Form 22 the entity name sits in the caption's
   column, while the activity description sits left of it with the activity
   CODE in the column — hence the demand for a letter, which the code fails. */
function valueBelow(
  next: string[] | undefined,
  labelCol: number,
  accept: (raw: string) => string | null,
): string | null {
  if (!next) return null;
  const order = [labelCol, ...next.map((_, i) => i)];
  for (const i of order) {
    const cell = next[i];
    if (cell === undefined) continue;
    const raw = String(cell).trim();
    if (!raw || BOX_CAPTION.test(raw)) continue;
    const cleaned = accept(raw);
    if (cleaned !== null) return cleaned;
  }
  return null;
}

/** First non-empty cell to the right of the caption. */
function valueAfter(row: string[], labelCol: number): { value: string; col: number } | null {
  for (let i = labelCol + 1; i < row.length; i++) {
    const v = row[i];
    if (v !== undefined && String(v).trim() !== "") return { value: String(v).trim(), col: i };
  }
  return null;
}

/** A caption/value pair no matcher claimed — a candidate for the AI profile
    pass, which names the FIELD a caption denotes and never invents a value. */
export type ProfileCandidate = {
  caption: string;
  /** Normalised caption, used as the dedupe key and the response key. */
  norm: string;
  value: string;
  src: { doc?: string | null; page?: number | null; heading?: string | null };
};

export type ProfileDetection = {
  profile: DetectedField[];
  ownership: DetectedField[];
  categories: string[];
  /** Unclaimed label/value pairs, capped per grid. See the capture rule. */
  unmatched: ProfileCandidate[];
};

/**
 * Scan parsed rows for entity particulars.
 * Only label/value pairs are considered — a caption on the left, its value to
 * the right — which is how questionnaires and entity-data sheets are laid out.
 */
export function detectProfile(rows: string[][] | null, meta?: { doc?: string }): ProfileDetection {
  const profile = new Map<string, DetectedField>();
  const ownership = new Map<string, DetectedField>();
  const categories = new Set<string>();
  const unmatched: ProfileCandidate[] = [];
  if (!rows) return { profile: [], ownership: [], categories: [], unmatched: [] };

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 2) continue;
    const boxed = isBoxedRow(row);
    const below = rows[r + 1];

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (cell === undefined || String(cell).trim() === "") continue;
      const caption = norm(cell);
      if (caption.length < 3 || caption.length > 60) continue;

      // Category ticks: "Category 4" with a yes/x beside it.
      const catMatch = /^category\s*(1a|1b|1c|2|3|4|5a|5b|5c)$/.exec(caption);
      if (catMatch) {
        const v = valueAfter(row, c);
        if (v && cleanYesNo(v.value) === "Yes") categories.add(catMatch[1]);
        continue;
      }

      /** True when some matcher in `list` claimed this cell. */
      const tryList = (list: Matcher[], into: Map<string, DetectedField>): boolean => {
        for (const m of list) {
          if (into.has(m.key)) continue;                 // first hit wins
          const exact = m.labels.some((l) => caption === l);
          const loose = m.labels.some((l) => caption.startsWith(l) || caption.includes(l));
          if (!exact && !loose) continue;

          const accept = (raw: string): string | null => {
            const c2 = m.clean ? m.clean(raw) : raw;
            if (c2 === null || String(c2).trim() === "") return null;
            // A caption in the value position means we read a header, not a value.
            if (!m.clean && /^(name|address|country|currency|date|value|amount)$/i.test(String(c2))) return null;
            return String(c2);
          };

          const v = valueAfter(row, c);
          /* On a boxed form the cell to the right is the NEXT BOX'S CAPTION,
             not this box's value — the value is printed on the line below.
             Reading across gave "01 Apellido Paterno o raz\u00f3n social" the
             entity name of "02 Apellido Materno". */
          const across = v && !(boxed && BOX_CAPTION.test(v.value)) ? accept(v.value) : null;
          const cleaned = across !== null ? across
            : boxed
              // A name or an activity is words; the activity CODE printed in
              // the same column is not, and must not win the field.
              ? valueBelow(below, c, (raw) =>
                  !m.clean && !/\p{L}/u.test(raw) ? null : accept(raw))
              : null;
          if (cleaned === null) return true;   // the matcher claimed it and rejected the value

          into.set(m.key, {
            key: m.key,
            value: cleaned,
            sourceLabel: String(cell).trim(),
            confidence: exact && across !== null ? "high" : "medium",
          });
          return true;
        }
        return false;
      };

      const claimedProfile = tryList(MATCHERS, profile);
      const claimedOwnership = tryList(OWNERSHIP_MATCHERS, ownership);

      /* Nothing matched. The pair may still be an entity particular under a
         caption no matcher knows ("Registered office" in Dutch, say), so it is
         KEPT as a candidate for the AI pass — which names the field, never the
         value.

         The filters are what stop this from being a firehose. The value must
         look like a value rather than a stray number: it contains a letter, a
         date separator, or a percent sign. The caption must be six characters
         or more and contain a letter, so column codes and row numbers do not
         qualify. And no more than 40 from one grid — past that it is a data
         table, not a questionnaire. */
      if (!claimedProfile && !claimedOwnership && unmatched.length < 40) {
        const v = valueAfter(row, c);
        const value = v ? String(v.value).trim() : "";
        if (
          value && value.length <= 80 &&
          caption.length >= 6 && /\p{L}/u.test(caption) && !/^\d+$/.test(caption) &&
          (/\p{L}/u.test(value) || /[/-]\d/.test(value) || value.includes("%"))
        ) {
          unmatched.push({ caption: String(cell).trim(), norm: caption, value, src: { doc: meta?.doc ?? null } });
        }
      }
    }
  }

  return {
    profile: [...profile.values()],
    ownership: [...ownership.values()],
    categories: [...categories],
    unmatched,
  };
}

/**
 * Last-resort currency detection: a bare ISO code appearing anywhere in the
 * document, such as a column header reading "Amount (GBP)".
 */
const SYMBOL_CURRENCY: Array<[RegExp, string]> = [
  [/£/, "GBP"], [/€/, "EUR"], [/¥/, "JPY"], [/₹/, "INR"], [/₩/, "KRW"], [/₪/, "ILS"], [/₺/, "TRY"],
];

export function sniffCurrency(rows: string[][] | null): DetectedField | null {
  if (!rows) return null;
  /* A code standing alone in a cell — "CLP", "(GBP)" — is a declaration. The
     same three letters inside a sentence usually are not: a Chilean return
     names its tax registers "REX/INR/ Remanente ejercicio siguiente", and
     counting occurrences read that as Indian rupees on a Chilean filing. Both
     documents also carried a cell reading exactly "CLP", and it lost 1 to 2.
     Getting this wrong picks the wrong rate table, so every translated figure
     in the work paper is wrong. Rank a standing code above a buried one, and
     fall back to frequency only within a rank. */
  const standing = new Map<string, { n: number; src: string }>();
  const buried = new Map<string, { n: number; src: string }>();
  for (const row of rows) {
    for (const cell of row) {
      if (cell === undefined) continue;
      const text = String(cell);
      if (text.length > 60) continue;
      const bare = text.trim().replace(/^[([]+/, "").replace(/[)\]]+$/, "").trim().toUpperCase();
      for (const m of text.matchAll(/\b([A-Z]{3})\b/g)) {
        const code = m[1];
        if (!CURRENCY_CODES.includes(code)) continue;
        if (code === "USD") continue;                    // the reporting currency
        const into = bare === code ? standing : buried;
        const prev = into.get(code);
        into.set(code, { n: (prev?.n || 0) + 1, src: prev?.src || text.trim() });
      }
    }
  }
  for (const counts of [standing, buried]) {
    if (!counts.size) continue;
    const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    return { key: "currency", value: best[0], sourceLabel: best[1].src, confidence: "medium" };
  }
  // No ISO code anywhere — fall back to the currency symbol the statements use.
  const symbolCounts = new Map<string, { n: number; src: string }>();
  for (const row of rows) {
    for (const cell of row) {
      if (cell === undefined) continue;
      for (const [re, code] of SYMBOL_CURRENCY) {
        if (!re.test(String(cell))) continue;
        const prev = symbolCounts.get(code);
        symbolCounts.set(code, { n: (prev?.n || 0) + 1, src: prev?.src || String(cell).trim().slice(0, 40) });
      }
    }
  }
  if (!symbolCounts.size) return null;
  const bestSymbol = [...symbolCounts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return { key: "currency", value: bestSymbol[0], sourceLabel: bestSymbol[1].src, confidence: "medium" };
}
