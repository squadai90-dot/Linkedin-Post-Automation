/* The client questionnaire.
 *
 * Preparers send their US clients a one-sheet questionnaire about the foreign
 * corporation — Bright!Tax's "Form 5471" workbook is the one seen so far — and
 * it carries facts that appear NOWHERE in the financial statements or the
 * prior return: the filer's roles in the corporation, the wages and dividends
 * the filer personally received from it, the other shareholders with their
 * relationship and citizenship. The hand-prepared work paper used all of
 * these; the tool had never read the document.
 *
 * It is a form grid: a caption cell, then the answer somewhere to its right on
 * the same row, with more than one caption/answer pair per row ("Your Shares
 * at beginning of year: … 100 … End of the year: … 100"). Captions are matched
 * loosely, answers are taken as printed, nothing is inferred.
 */

import { numeric } from "./engine";

export type QuestionnaireHolder = {
  name: string;
  shares: number | null;
  relationship?: string;
  usCitizen?: boolean;
  address?: string[];
};

export type Questionnaire = {
  fileName: string;
  taxpayerName?: string;
  corporationName?: string;
  address: string[];
  country?: string;
  countryInc?: string;
  formed?: string;
  activity?: string;
  currency?: string;
  /** The answer as printed ("All three roles", "Shareholder and director"). */
  roles?: string;
  /** Derived from `roles`: true when it names an officer or director role. */
  isOfficer?: boolean;
  sharesOutstanding?: { boy: number | null; eoy: number | null };
  filerShares?: { boy: number | null; eoy: number | null };
  additionalHolders: QuestionnaireHolder[];
  /** "Wages you received from the company" — a related-party transaction. */
  wagesReceived?: number;
  dividendsReceived?: number;
  wagesCurrency?: string;
  bookkeeper?: string;
};

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Is this grid the questionnaire? Three of its captions are enough — no
    statement or return carries "Taxpayer Name" and "Corporation Name" and a
    question about the filer's roles or shares together. */
export function looksLikeQuestionnaire(grid: string[][]): boolean {
  const text = grid.slice(0, 60).map((r) => r.map(clean).join(" | ")).join("\n").toLowerCase();
  const marks = [
    /taxpayer name/, /corporation name/,
    /(your roles in the corporation|your shares at beginning of year|additional shareholder|wages you received)/,
  ];
  return marks.every((re) => re.test(text));
}

/** The first non-empty cell to the right of column `from`. */
function valueRight(row: string[], from: number): { value: string; col: number } | null {
  for (let c = from + 1; c < row.length; c++) {
    const v = clean(row[c]);
    if (v) return { value: v, col: c };
  }
  return null;
}

/** Index of the first cell whose text matches `re`, searching from `from`. */
function findCaption(row: string[], re: RegExp, from = 0): number {
  for (let c = from; c < row.length; c++) if (re.test(clean(row[c]))) return c;
  return -1;
}

export function parseQuestionnaire(grid: string[][], fileName: string): Questionnaire {
  const q: Questionnaire = { fileName, address: [], additionalHolders: [] };
  const rows = grid.map((r) => r.map(clean));

  /** Answer to the right of the first cell matching `re` on this row. */
  const answer = (row: string[], re: RegExp): string | undefined => {
    const c = findCaption(row, re);
    if (c < 0) return undefined;
    const v = valueRight(row, c);
    return v ? v.value : undefined;
  };
  /** A second caption on the same row ("End of the year:") and its answer. */
  const answerAfter = (row: string[], first: RegExp, second: RegExp): string | undefined => {
    const c1 = findCaption(row, first);
    if (c1 < 0) return undefined;
    const c2 = findCaption(row, second, c1 + 1);
    if (c2 < 0) return undefined;
    const v = valueRight(row, c2);
    return v ? v.value : undefined;
  };
  const num = (s: string | undefined): number | null => (s === undefined ? null : numeric(s));

  /* Additional-shareholder blocks repeat: "Additional Shareholder:" then
     "Number of Shares Owned:", "Relationship to you:", "U.S. Citizen:",
     "Address:", "Country:". A block whose name line is blank is an unused
     slot on the form, not a holder. */
  let holder: QuestionnaireHolder | null = null;
  let filerAddressDone = false;

  for (const row of rows) {
    const joined = row.join(" | ");
    if (!joined.trim()) continue;

    if (/taxpayer name/i.test(joined) && !q.taxpayerName) q.taxpayerName = answer(row, /taxpayer name/i);
    if (/corporation name/i.test(joined) && !q.corporationName) q.corporationName = answer(row, /corporation name/i);
    if (/nature of business/i.test(joined) && !q.activity) q.activity = answer(row, /nature of business/i);
    if (/functional currency/i.test(joined) && !q.currency) {
      const v = answer(row, /functional currency/i);
      if (v && /^[A-Za-z]{3}$/.test(v)) q.currency = v.toUpperCase();
    }
    if (/date of incorporation/i.test(joined) && !q.formed) {
      const v = answer(row, /date of incorporation/i);
      if (v && !/country/i.test(v)) q.formed = v;
    }
    if (/country of incorporation/i.test(joined) && !q.countryInc) q.countryInc = answer(row, /country of incorporation/i);
    if (/your roles in the corporation/i.test(joined) && !q.roles) {
      const v = answer(row, /your roles in the corporation/i);
      if (v) {
        q.roles = v;
        q.isOfficer = /officer|director|all three/i.test(v);
      }
    }
    if (/outstanding company shares/i.test(joined) && !q.sharesOutstanding) {
      q.sharesOutstanding = { boy: num(answer(row, /outstanding company shares/i)), eoy: num(answerAfter(row, /outstanding company shares/i, /end of the year/i)) };
    }
    if (/your shares at beginning/i.test(joined) && !q.filerShares) {
      q.filerShares = { boy: num(answer(row, /your shares at beginning/i)), eoy: num(answerAfter(row, /your shares at beginning/i, /end of the year/i)) };
    }
    if (/wages you received/i.test(joined) && q.wagesReceived === undefined) {
      const v = num(answer(row, /wages you received/i));
      if (v !== null) q.wagesReceived = v;
    }
    if (/dividends you received/i.test(joined) && q.dividendsReceived === undefined) {
      const v = num(answer(row, /dividends you received/i));
      if (v !== null) q.dividendsReceived = v;
    }
    // "Currency:" on its own row, after the wages/dividends questions.
    if (/^currency:?$/i.test(clean(row.find((c) => /currency/i.test(c)) || "")) && q.wagesReceived !== undefined && !q.wagesCurrency) {
      const v = answer(row, /^currency:?$/i);
      if (v && /^[A-Za-z]{3}$/.test(v)) q.wagesCurrency = v.toUpperCase();
    }
    if (/accountant\/bookkeeper|using an accountant/i.test(joined)) {
      // The answer sits on the NEXT row ("entities? | No") on the form seen so far.
    }
    if (/^entities\?$/i.test(clean(row.find((c) => /entities/i.test(c)) || "")) && !q.bookkeeper) q.bookkeeper = answer(row, /entities/i);

    /* Holders. */
    if (/additional shareholder/i.test(joined)) {
      if (holder && holder.name) q.additionalHolders.push(holder);
      const name = answer(row, /additional shareholder/i);
      holder = { name: name || "", shares: null };
      continue;
    }
    if (holder) {
      if (/number of shares owned/i.test(joined)) holder.shares = num(answer(row, /number of shares owned/i));
      else if (/relationship to you/i.test(joined)) holder.relationship = answer(row, /relationship to you/i);
      else if (/u\.?s\.? citizen/i.test(joined)) {
        const v = answer(row, /u\.?s\.? citizen/i);
        if (v && /^(yes|no)$/i.test(v)) holder.usCitizen = /^yes$/i.test(v);
      } else if (/^address:?$/i.test(clean(row.find((c) => /^address/i.test(c)) || ""))) {
        const v = answer(row, /^address:?$/i);
        if (v) holder.address = [v];
      } else if (/^country:?$/i.test(clean(row.find((c) => /^country/i.test(c)) || ""))) {
        // end of the holder's address block; nothing to store beyond the name
      } else if (holder.address && holder.address.length === 1 && row.filter(Boolean).length === 1 && !/:/.test(joined)) {
        holder.address.push(row.filter(Boolean)[0]);
      }
      continue;
    }

    /* The corporation's own address: "Address:" then a bare continuation row,
       then "Country:". Only the first such block, before any holder. */
    if (!filerAddressDone) {
      if (/^address:?$/i.test(clean(row.find((c) => /^address/i.test(c)) || "")) && !q.address.length) {
        const v = answer(row, /^address:?$/i);
        if (v) q.address.push(v);
        continue;
      }
      if (q.address.length === 1 && row.filter(Boolean).length === 1 && !/:/.test(joined)) { q.address.push(row.filter(Boolean)[0]); continue; }
      if (/^country:?$/i.test(clean(row.find((c) => /^country/i.test(c)) || "")) && q.address.length && !q.country) {
        q.country = answer(row, /^country:?$/i);
        filerAddressDone = true;
      }
    }
  }
  if (holder && holder.name) q.additionalHolders.push(holder);
  if (!q.countryInc && q.country) q.countryInc = q.country;
  return q;
}
