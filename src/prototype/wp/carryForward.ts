/* Carry-forward extraction from a prior-year Form 5471 (reference copy).

   Reads only pages the classifier marked as 5471-family, and only when the
   "Name of foreign corporation" on those pages is this work paper's entity.
   Returns plain facts; the store decides what becomes a cell write and what
   becomes a review item. Never touches the 1120/5472 pages — those describe
   the US parent. */

import { numeric, numericCell } from "./engine";
import type { ParsedDoc } from "./engine";
import type { PdfRow } from "./pdfText";
import { refIdToken, splitGluedRefId, type Block5471, type DocClass, type PageKind } from "./classify";

export type SourcedValue = { value: number; page: number; rowText: string };

export type CarryForward = {
  /** Prior-year Schedule J line 14 — the opening E&P for the current year. */
  openingEP?: SourcedValue;
  /** Prior-year Schedule F column (b) — closing USD balances as filed. */
  priorClosingUSD: Partial<Record<
    "cash" | "ar" | "oca" | "totalAssets" | "ap" | "ocl" | "re"
    // Schedule F lines that were read but never captured, so the
    // beginning-of-year column could not be completed from the prior return.
    | "depreciable" | "accumDep" | "commonStock" | "totalLiabCap"
    // Lines the map never covered at all. A Chilean CFC filed US$1,367,778 on
    // line 19 -- 49% of its balance sheet -- and column (a) came out short by
    // exactly that, so it could not balance.
    | "badDebts" | "inventories" | "loansToShareholders" | "land"
    | "otherAssets" | "loansFromShareholders" | "otherLiabilities"
    | "preferredStock" | "paidInSurplus" | "treasuryStock",
    SourcedValue
  >>;
  shares?: { classOfShares: string; boy: number; eoy: number; page: number };
  /** Schedule B Part II — every direct shareholder with real names and
      BOY/EOY share counts (the template ships demo rows A/B/C/D otherwise).
      `single` marks a row where only ONE count printed — taken as BOY = EOY
      and flagged for the preparer to confirm. */
  holders?: { name: string; classOfShares: string; boy: number; eoy: number; page: number; single?: boolean; pct?: number; fromPartI?: boolean; truncated?: boolean }[];
  /** Schedule B Part I — U.S. shareholders. The ONLY place the SSN and the
      pro rata subpart F percentage appear; Part II carries neither. Kept
      separate from `holders` because the same person often appears in both
      (directly and through a trust) and merging would double-count. */
  usHolders?: { name: string; classOfShares: string; boy: number; eoy: number; page: number; single?: boolean; pct?: number }[];
  /** False when this block has a face page but no Schedule B at all — common
      for a second 5471 filed as page 1 only. Distinguishes "nothing filed"
      from "we failed to read it". */
  hasScheduleB?: boolean;
  /** Item H — "Person(s) on whose behalf this return is filed", with the
      Shareholder / Officer / Director boxes. On a page-1-only 5471 this is the
      only shareholder-ish data in the document. */
  itemH?: { name: string; isShareholder: boolean; isOfficer: boolean; isDirector: boolean }[];
  holderName?: string;
  /** Filer's SSN-shaped ID, already masked at extraction — never stored raw. */
  filerIdMasked?: string;
  pctVoting?: number;
  categories: string[];                 // "1a", "4", "5a"
  categoriesRaw?: string;               // the checkbox row, for the review item
  referenceIds: string[];
  formed?: string;
  functionalCurrency?: string;
  countryInc?: string;
  activity?: string;
  activityCode?: string;                // f — principal business activity code
  principalPlace?: string;              // e — principal place of business
  cfcName?: string;
  cfcAddress: string[];                 // street / suburb lines as printed
  /** Item 2d — the person with custody of the books and records. Unlike the
      questionnaire fields this is a BLOCK: the caption wraps over three lines
      and the value rows sit BELOW it, so `valueAfter` (right-of-caption) can
      never see it. Extracted with the same look-ahead used for item 1a. */
  booksPerson?: string;
  booksAddress: string[];               // up to 2 lines, as printed
  /** Annual accounting period as printed on the face, "MM/DD/YYYY". A
      non-December end month is a fiscal year — calendar rate tables do not
      apply and the store must leave the rates blank for manual entry. */
  periodBegin?: string;
  periodEnd?: string;
  priorTaxAccruedFunctional?: SourcedValue;   // Sch E — for E-1 redetermination review
  /** Schedule J/E/H/P "Separate Category" code as filed: GEN, PAS, FB, 901j,
      RBT, 951A. The template ships with FB pre-selected, which is the rare
      case; a work paper that inherits the filed code is right by default. */
  separateCategory?: string;
  /** The exchange rate the prior filing itself states — Schedule H line 5e
      ("Enter exchange rate used for line 5d") or the Schedule M header. When
      it differs from the rate table the opening column will not tie to the
      prior filing's functional-currency figures, and the preparer should be
      told by how much rather than left to discover it. */
  priorRate?: SourcedValue;
  /** Captions from the return's attached statements ("STATEMENT 10 — OTHER
      CURRENT ASSETS: SUB-CONTRACTOR"), keyed like priorClosingUSD, each tied
      to its Schedule F line by the statement's own total. */
  statementCaptions?: Partial<Record<"oca" | "otherAssets" | "ocl" | "otherLiabilities", { label: string; page: number; statement: string }>>;
  /** Schedule R as filed with the explicit "NONE" row — no distributions. */
  schRNone?: { page: number; date?: string };
};

const pagesOfKind = (cls: DocClass, ...kinds: PageKind[]): Set<number> =>
  new Set(cls.pages.filter((p) => kinds.includes(p.kind)).map((p) => p.page));

const intersect = (a: Set<number>, b?: Set<number>): Set<number> =>
  b ? new Set([...a].filter((x) => b.has(x))) : a;

/* ---------- geometry-aware helpers for the face grid ----------
   The 5471 face is a two-column form: values print in the LEFT column under
   their caption, while the RIGHT column carries its own caption/value pairs.
   Flat row text bleeds the columns together — "BME01 b(3) Previous reference
   ID number(s)" landing in the legal-name harvest is exactly that bug — so
   these helpers keep the x-geometry pdfText already extracts. */

const rowsOnPagesGeo = (parsed: ParsedDoc, pages: Set<number>): PdfRow[] =>
  parsed.pdf ? parsed.pdf.rows.filter((r) => pages.has(r.page)) : [];

/** A cell that is a form caption, not a value. */
/* ---------- item 2d caption detection (wrap-independent) ----------
   Every tax package wraps this caption at a different point, so the phrase
   "person (or persons) with custody" may straddle a line break. Matching a
   single row is therefore unreliable; we join a short window instead. */

/** Words that only ever belong to the 2d caption, never to a name or address.
    Used to walk past the caption regardless of where it wrapped. */
export const isBooksCaptionText = (t: string): boolean =>
  /name and address|corporate department|if applicable|\(or\s*$|^persons?\)|person\s*\(or|with custody|custody of|books and records|of the foreign|foreign corporation|location of such|if different|^and\b|^the location/i
    .test(t.trim());

/** True when row `ri` starts the 2d caption. Looks at the joined text of this
    row and the next few, so the match does not depend on the wrap position. */
export function isBooksCaptionStart(
  face: Array<{ page: number; cells: string[] }>, ri: number, r: { page: number; cells: string[] },
): boolean {
  const head = r.cells.join(" ").replace(/\s+/g, " ").trim();
  // The 2d caption is NOT necessarily at the start of the row: 2c's wrapped
  // tail ("…agent in country") prints on the same line in many packages. Search
  // anywhere in the row instead of anchoring at position 0.
  if (!/name and address\s*\(including corporate department/i.test(head)) return false;
  let win = head;
  for (let k = ri + 1; k <= ri + 3 && k < face.length; k++) {
    if (face[k].page !== r.page) break;
    win += " " + face[k].cells.join(" ");
  }
  win = win.replace(/\s+/g, " ");
  // Distinguishes 2d from 2c ("statutory or resident agent"), which shares the
  // "Name and address" opening.
  return /custody of the books and records/i.test(win);
}

/** Fragments of the form's own scaffolding — enumerators like "(a) …",
    "(b) …", "(i) …", and table headers. These appear directly beneath an EMPTY
    2d box (Schedule A begins there), and must never be mistaken for a
    custodian's name or address. */
export const isFormStructure = (t: string): boolean => {
  const v = t.trim();
  if (/^\(?\s*(?:[a-z]|i{1,3}|iv|v)\s*\)/i.test(v)) return true;          // (a) (b) (i) (ii)
  if (/number of shares|description of each class|accounting period|issued and outstanding/i.test(v)) return true;
  if (/^(beginning|end) of annual/i.test(v)) return true;
  if (/^for paperwork reduction|^see instructions|^form \d{3,}/i.test(v)) return true;
  return false;
};

export const looksLikeCaption = (t: string): boolean =>
  /reference id|identif\w* number|previous reference|^instructions|country under whose laws|^[b-d]\(?\d?\)?\s|^\(?see instructions/i.test(t.trim());

/** "09/05/08 CAYMAN ISLANDS" → date + trailing place (2-digit years allowed).
    Search, not anchor: a wrapped caption fragment ("incorporation") can
    precede the date in the joined column text. */
export function splitGluedDatePlace(t: string): { date: string; place?: string } | null {
  const m = /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b\s*(.*)$/.exec(t.trim());
  if (!m) return null;
  return { date: m[1].replace(/-/g, "/"), place: m[2].trim() || undefined };
}

/** BOY/EOY share counts in all three shapes the returns print:
    ["40.000 40.000"] · ["100.000100.000"] (glued) · ["100.000", "100.000"]. */
export function parseSharePair(cells: string[]): { boy: number; eoy: number } | null {
  const nums: number[] = [];
  for (const raw of cells.flatMap((c) => String(c || "").trim().split(/\s+/)).filter(Boolean)) {
    const glued = /^(\d[\d,]*\.\d{3})(\d[\d,]*\.\d{3})$/.exec(raw);
    if (glued) {
      const a = numeric(glued[1]);
      const b = numeric(glued[2]);
      if (a !== null && b !== null) { nums.push(a, b); continue; }
    }
    const n = numericCell(raw);
    if (n !== null) nums.push(n);
  }
  if (nums.length < 2 || nums[0] < 0 || nums[1] < 0) return null;
  return { boy: nums[0], eoy: nums[1] };
}


export type ParsedPeriod = { begin?: string; end?: string };

/* Dates on the face print as "MM-DD-YYYY", "MM/DD/YYYY", the software's
   "MM-DD , 2023" (year comma-split, sometimes "20 23"), or month names
   ("JAN 1 , 2023"). */
const DATE_PART = String.raw`(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/,]\s*((?:19|20)\s?\d{2})`;
const DATE_MN = String.raw`([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s*((?:19|20)\s?\d{2})`;
const PERIOD_RE = new RegExp(
  `annual accounting period[^]{0,240}?beginning\\s*${DATE_PART}\\s*,?\\s*(?:and\\s*)?ending\\s*${DATE_PART}`, "i");
const PERIOD_END_ONLY_RE = new RegExp(
  `annual accounting period[^]{0,240}?ending\\s*${DATE_PART}`, "i");
const PERIOD_MN_RE = new RegExp(
  `annual accounting period[^]{0,240}?beginning\\s*${DATE_MN}\\s*,?\\s*(?:and\\s*)?ending\\s*${DATE_MN}`, "i");
const PERIOD_END_ONLY_MN_RE = new RegExp(
  `annual accounting period[^]{0,240}?ending\\s*${DATE_MN}`, "i");

const MONTH_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const monthNum = (w: string): number | null => MONTH_NUM[w.slice(0, 3).toLowerCase()] ?? null;

const numYear = (y: string): number => Number(y.replace(/\s+/g, ""));
const validDate = (m: number, d: number, y: number): boolean =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100;
const fmtDate = (m: string | number, d: string, y: string): string =>
  `${String(Number(m)).padStart(2, "0")}/${String(Number(d)).padStart(2, "0")}/${numYear(y)}`;

/** Parse the face's "annual accounting period ... beginning MM-DD-YYYY, and
    ending MM-DD-YYYY" line. The caption and the dates can sit several rows
    apart (form-header rows interleave), so each anchor row is joined with up
    to four following rows. Returns null when nothing parses — never guesses. */
export function parseAccountingPeriod(rows: { page: number; cells: string[] }[]): ParsedPeriod | null {
  const windows: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!/annual accounting period/i.test(rows[i].cells.join(" "))) continue;
    let text = rows[i].cells.join(" ");
    windows.push(text);
    for (let j = i + 1; j <= i + 4 && j < rows.length; j++) {
      if (rows[j].page !== rows[i].page) break;
      text += " " + rows[j].cells.join(" ");
      windows.push(text);
    }
  }
  // The FILER's own tax year prints right below the corporation's period —
  // a row join must never let it masquerade as the accounting period.
  const clean = windows.map((t) => t.replace(/filer'?s tax year[^]*$/i, ""));
  for (const text of clean) {
    const m = PERIOD_RE.exec(text);
    if (m && validDate(+m[1], +m[2], numYear(m[3])) && validDate(+m[4], +m[5], numYear(m[6]))) {
      return { begin: fmtDate(m[1], m[2], m[3]), end: fmtDate(m[4], m[5], m[6]) };
    }
    const n = PERIOD_MN_RE.exec(text);
    if (n) {
      const bm = monthNum(n[1]);
      const em = monthNum(n[4]);
      if (bm && em && validDate(bm, +n[2], numYear(n[3])) && validDate(em, +n[5], numYear(n[6]))) {
        return { begin: fmtDate(bm, n[2], n[3]), end: fmtDate(em, n[5], n[6]) };
      }
    }
  }
  for (const text of clean) {
    const e = PERIOD_END_ONLY_RE.exec(text);
    if (e && validDate(+e[1], +e[2], numYear(e[3]))) {
      return { end: fmtDate(e[1], e[2], e[3]) };
    }
    const en = PERIOD_END_ONLY_MN_RE.exec(text);
    if (en) {
      const em = monthNum(en[1]);
      if (em && validDate(em, +en[2], numYear(en[3]))) return { end: fmtDate(em, en[2], en[3]) };
    }
  }
  return null;
}

const rowsOnPages = (parsed: ParsedDoc, pages: Set<number>): { page: number; cells: string[] }[] => {
  if (!parsed.pdf) return [];
  return parsed.pdf.rows
    .filter((r) => pages.has(r.page))
    .map((r) => ({ page: r.page, cells: r.cells.map((c) => c.text) }));
};

/** The x of Schedule F's column (b), inferred from the rows that print BOTH
    columns. Needed because a line where only ONE column is filled gives no
    other clue which column it is: the Chilean CFC prints 101,437 on line 6 in
    column (a) only, and reading "the last number on the row" carried a 2022
    opening balance into the 2024 opening column. Total assets proves it —
    2,788,678 already balances without that figure. */
function columnBAnchor(rows: PdfRow[]): number | null {
  const rights: number[] = [];
  for (const r of rows) {
    const nums = r.cells.filter((c) => numericCell(c.text) !== null);
    if (nums.length >= 2) rights.push(nums[nums.length - 1].x0);
  }
  if (rights.length < 3) return null;           // too little evidence to judge
  rights.sort((a, b) => a - b);
  return rights[Math.floor(rights.length / 2)]; // median resists a stray total
}

/** Money off a Schedule F caption row, taking the value that sits in column
    (b). A value outside that column is left alone: on a filing, a line the
    preparer must fill in is safer than one carried from the wrong year. */
function matchFormLineAtColumn(
  rows: PdfRow[],
  labelRe: RegExp,
  anchorX: number | null,
  tolerance = 45,
): SourcedValue | null {
  for (const r of rows) {
    for (let i = 0; i < r.cells.length; i++) {
      const cell = (r.cells[i].text || "").trim();
      if (!cell) continue;
      const bare = cell
        .replace(/^\d{1,2}\s*[a-d]?\s+/i, "")
        .replace(/^[a-d]\s+/i, "")
        .replace(/[\s~.·•…_-]+$/, "")
        .trim();
      if (!labelRe.test(bare)) continue;
      const cands = r.cells.slice(i + 1)
        .map((c) => ({ v: numericCell(c.text), x: c.x0 }))
        .filter((c): c is { v: number; x: number } => c.v !== null);
      if (!cands.length) continue;
      // Drop the line number the form echoes to the right of the caption.
      const ln = /^(\d{1,2})[a-c]?\b/.exec(cell)
        || /^(\d{1,2})[a-c]?$/.exec((r.cells[i - 1]?.text || "").trim());
      const kept = ln && cands.length && cands[0].v === Number(ln[1]) ? cands.slice(1) : cands;
      if (!kept.length) continue;
      if (anchorX === null) {
        // No geometry to judge by — fall back to the rightmost value.
        const last = kept[kept.length - 1];
        return { value: last.v, page: r.page, rowText: r.cells.map((c) => c.text).join(" | ") };
      }
      const inColumnB = kept.filter((c) => Math.abs(c.x - anchorX) <= tolerance);
      if (!inColumnB.length) continue;          // this line filled only column (a)
      const best = inColumnB[inColumnB.length - 1];
      return { value: best.v, page: r.page, rowText: r.cells.map((c) => c.text).join(" | ") };
    }
  }
  return null;
}

/** Find the first row whose textual cell matches, and read a money value off
    it. `pick` chooses among the numeric cells right of the caption after the
    leading line-number echo is dropped. */
function matchFormLine(
  rows: { page: number; cells: string[] }[],
  labelRe: RegExp,
  pick: "first" | "last" = "last",
): SourcedValue | null {
  for (const r of rows) {
    for (let i = 0; i < r.cells.length; i++) {
      const cell = (r.cells[i] || "").trim();
      if (!cell) continue;
      /* Normalise the caption before matching. Three producer habits break an
         anchored caption regex, and each one silently loses a Schedule F line:
           "2a Trade notes and…"          the line number glued to the caption
           "b Less accumulated depreciation"  a sub-line prints its letter alone,
                                              with no digit for the rule above
           "Cash ~~~~~~~~~~~~~~~~"        the dotted/tilde leader glued on, which
                                          defeats an exact ("/^cash$/") match
         2Hats 2023 lost cash (US$13,322), accumulated depreciation (US$1,274)
         and common stock (US$4,973) to the last two. */
      const bare = cell
        .replace(/^\d{1,2}\s*[a-d]?\s+/i, "")
        .replace(/^[a-d]\s+/i, "")
        .replace(/[\s~.·•…_-]+$/, "")
        .trim();
      if (!labelRe.test(bare)) continue;
      // Strict cells only: numeric() would book the digit residue of prose
      // like "(combine lines 7 through 13)" as −713 on the legacy parser path.
      let nums = r.cells.slice(i + 1).map((c) => numericCell(c)).filter((n): n is number => n !== null);
      // IRS forms repeat the line number to the right of the caption. Strip it
      // whenever it leads, not only when a value follows it: on a line the
      // filer left blank the line number is the ONLY number on the row, and
      // taking it as the amount invents a figure that is not on the return
      // (2Hats 2023 filed no accounts payable and line 15 was read as $15).
      // A genuine amount that happens to equal its own line number is dropped
      // instead, which leaves the line blank for the preparer — the safe way
      // to be wrong.
      const ln = /^(\d{1,2})[a-c]?\b/.exec(cell) || /^(\d{1,2})[a-c]?$/.exec((r.cells[i - 1] || "").trim());
      if (ln && nums.length && nums[0] === Number(ln[1])) nums = nums.slice(1);
      if (!nums.length) continue;
      return {
        value: pick === "first" ? nums[0] : nums[nums.length - 1],
        page: r.page,
        rowText: r.cells.join(" | "),
      };
    }
  }
  return null;
}

const CATEGORY_CODES = ["1a", "1b", "1c", "2", "3", "4", "5a", "5b", "5c"];

/** Extract carry-forward facts. With `pageFilter`/`scanRange` the read is
    scoped to one 5471 block of a multi-CFC client copy; unscoped it covers
    the whole document (single-5471 behavior, unchanged). */
export function extractCarryForward(
  cls: DocClass,
  parsed: ParsedDoc,
  pageFilter?: Set<number>,
  scanRange?: { from: number; to: number },
): CarryForward {
  const out: CarryForward = { priorClosingUSD: {}, categories: [], referenceIds: [], cfcAddress: [], booksAddress: [] };
  if (!parsed.pdf) return out;

  const schJ = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schJ"), pageFilter));
  const schF = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schF"), pageFilter));
  const schE = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schE"), pageFilter));
  const schH = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schH"), pageFilter));
  const schM = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schM"), pageFilter));
  const facePages = intersect(pagesOfKind(cls, "us-5471-face", "us-5471-schA", "us-5471-schB"), pageFilter);
  const face = rowsOnPages(parsed, facePages);
  const faceGeo = rowsOnPagesGeo(parsed, facePages);   // index-aligned with `face`

  // The face's accounting-period line — fiscal years drive the FX guard.
  const period = parseAccountingPeriod(face);
  if (period) {
    out.periodBegin = period.begin;
    out.periodEnd = period.end;
  }

  // Schedule J line 14 — the single most important carry-forward number.
  out.openingEP = matchFormLine(schJ, /balance at beginning of next year/i, "first") ?? undefined;

  /* The separate-category code prints as "Separate Category (Enter code …) | GEN"
     on Schedules J, E, H and P alike; any one of them will do, J first. */
  for (const rows of [schJ, schE, schH]) {
    if (out.separateCategory) break;
    for (let i = 0; i < rows.length; i++) {
      const text = rows[i].cells.join(" ");
      if (!/separate category/i.test(text)) continue;
      const here = [text, rows[i + 1]?.cells.join(" ") || ""].join(" ");
      const m = /\b(901j|951A|GEN|PAS|FB|RBT)\b/.exec(here.replace(/\b901J\b/g, "901j"));
      if (m) { out.separateCategory = m[1]; break; }
    }
  }

  /* The rate the prior filing used. Schedule H line 5e states it outright;
     the Schedule M header repeats it ("… exchange rate used throughout this
     schedule | CAYMAN ISLANDS, DO .833000000"). Read as printed — no rounding,
     the trailing zeros are the filing's own. */
  for (const [rows, re] of [[schH, /exchange rate used/i], [schM, /exchange rate used throughout/i]] as const) {
    if (out.priorRate) break;
    for (let i = 0; i < rows.length; i++) {
      const text = rows[i].cells.join(" ");
      if (!re.test(text)) continue;
      const here = [text, rows[i + 1]?.cells.join(" ") || ""].join(" ");
      const m = /(?:^|[\s|])(\d{0,3}\.\d{3,9})(?=\s|$)/.exec(here);
      if (m) {
        const v = parseFloat(m[1]);
        if (isFinite(v) && v > 0) { out.priorRate = { value: v, page: rows[i].page, rowText: text }; break; }
      }
    }
  }

  /* Schedule F column (b). Where both columns print, the rightmost value is
     EOY; where only one prints, only its x tells us which column it is. */
  const schFGeo = rowsOnPagesGeo(parsed, intersect(pagesOfKind(cls, "us-5471-schF"), pageFilter));
  const colB = columnBAnchor(schFGeo);
  const f = (re: RegExp) => matchFormLineAtColumn(schFGeo, re, colB) ?? undefined;
  out.priorClosingUSD.cash = f(/^cash$/i);
  out.priorClosingUSD.ar = f(/^trade notes and accounts receivable/i);
  out.priorClosingUSD.oca = f(/^other current assets/i);
  out.priorClosingUSD.totalAssets = f(/^total assets/i);
  out.priorClosingUSD.ap = f(/^accounts payable/i);
  out.priorClosingUSD.ocl = f(/^other current liabilities/i);
  out.priorClosingUSD.re = f(/^retained earnings/i);
  out.priorClosingUSD.depreciable = f(/^buildings and other depreciable assets/i);
  out.priorClosingUSD.accumDep = f(/^less accumulated depreciation/i);
  out.priorClosingUSD.commonStock = f(/^common stock/i);
  out.priorClosingUSD.totalLiabCap = f(/^total liabilities and shareholders/i);
  /* Remaining Schedule F lines. Contra lines are captured as filed (positive
     on the form, printed in brackets) and negated when they are seeded. */
  out.priorClosingUSD.badDebts = f(/^less allowance for bad debts/i);
  out.priorClosingUSD.inventories = f(/^inventories/i);
  out.priorClosingUSD.loansToShareholders = f(/^loans to shareholders/i);
  out.priorClosingUSD.land = f(/^land\b/i);
  out.priorClosingUSD.otherAssets = f(/^other assets/i);
  out.priorClosingUSD.loansFromShareholders = f(/^loans from shareholders/i);
  out.priorClosingUSD.otherLiabilities = f(/^other liabilities/i);
  out.priorClosingUSD.preferredStock = f(/^preferred stock/i);
  out.priorClosingUSD.paidInSurplus = f(/^paid-in or capital surplus/i);
  out.priorClosingUSD.treasuryStock = f(/^less cost of treasury stock/i);

  /* The attached statements. Schedule F prints "Other current assets (attach
     statement)" with only the total; the caption itself sits on a STATEMENT
     page at the back of the return:
         FORM 5471   OTHER CURRENT ASSETS   STATEMENT 10
         SUB-CONTRACTOR                       -43,426.
         TOTAL TO 5471, PAGE 4, SCH F, LINE 5 -43,426.
     The hand-prepared work paper carried that caption onto the line; the tool
     had stopped at the schedule. Statement pages are outside any CFC's page
     range, so the whole document is scanned and a statement is accepted only
     when its total equals the line it claims to support. */
  const STATEMENT_LINES: [keyof NonNullable<CarryForward["statementCaptions"]>, RegExp][] = [
    ["oca", /^other current assets$/i], ["otherAssets", /^other assets$/i],
    ["ocl", /^other current liabilities$/i], ["otherLiabilities", /^other liabilities$/i],
  ];
  const everyRow = parsed.pdf.rows.map((r) => ({ page: r.page, cells: r.cells.map((c) => c.text.trim()).filter(Boolean) }));
  const HEADER_WORD = /^(description|beg\.?|end|of|annual|accounting|period|functional|currency|exchange|rate|u\.s\.|dollars|amount)$/i;
  for (const [key, titleRe] of STATEMENT_LINES) {
    const filed = out.priorClosingUSD[key]?.value;
    if (typeof filed !== "number") continue;
    for (let i = 0; i < everyRow.length; i++) {
      const head = /^form 5471\s+(.+?)\s+statement\s*(\d+)$/i.exec(everyRow[i].cells.join(" ").replace(/\s+/g, " "));
      if (!head || !titleRe.test(head[1].trim())) continue;
      let caption: { label: string; page: number; statement: string } | null = null;
      let total: number | null = null;
      for (let j = i + 1; j < Math.min(i + 40, everyRow.length); j++) {
        const cells = everyRow[j].cells;
        const joined = cells.join(" ");
        if (/^total to 5471/i.test(joined)) {
          const nums = cells.map((c) => numericCell(c)).filter((n): n is number => n !== null);
          total = nums.length ? nums[nums.length - 1] : null;
          break;
        }
        if (caption) continue;
        const hasValue = cells.some((c) => numericCell(c) !== null);
        const li = cells.findIndex((c) => /[A-Za-z]{3}/.test(c) && numericCell(c) === null && !c.split(/\s+/).every((w) => HEADER_WORD.test(w)));
        if (hasValue && li >= 0) caption = { label: cells[li], page: everyRow[j].page, statement: `Statement ${head[2]}` };
      }
      if (caption && total !== null && Math.abs(total - filed) < 1) {
        (out.statementCaptions ||= {})[key] = caption;
        break;
      }
    }
  }

  /* Schedule R. A return with no distributions files the row "1 NONE
     12/31/2023 0. 0." — read so the work paper can carry the same row
     forward when this year has none either. Any amount other than zero on
     the row means a distribution was reported, whatever the description. */
  const schR = rowsOnPages(parsed, intersect(pagesOfKind(cls, "us-5471-schR"), pageFilter));
  for (const r of schR) {
    const cells = r.cells.map((c) => c.trim()).filter(Boolean);
    if (!cells.some((c) => /^(1\s+)?none$/i.test(c))) continue;
    const amounts = cells.filter((c) => !/^\d$/.test(c)).map((c) => numericCell(c)).filter((n): n is number => n !== null);
    if (amounts.some((n) => n !== 0)) continue;
    const date = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/.exec(cells.join(" "));
    out.schRNone = { page: r.page, ...(date ? { date: date[1] } : {}) };
    break;
  }

  // Prior-year foreign tax accrued (Schedule E) — E-1 redetermination review.
  // The payor row reads: line | income | ccy | tax(functional) | rate | tax(USD).
  for (const r of schE) {
    const cells = r.cells.map((c) => c.trim());
    const ci = cells.findIndex((c) => /^[A-Z]{3}$/.test(c) && c !== "USD");
    if (ci > 0) {
      const tax = numericCell(cells[ci + 1]);
      if (tax !== null && Math.abs(tax) > 0) {
        out.priorTaxAccruedFunctional = { value: tax, page: r.page, rowText: cells.join(" | ") };
        break;
      }
    }
  }

  /* The face page is a form grid: values print on the row(s) BELOW their
     caption row, and checkbox marks are glued into cells ("1a X 1b"). */
  let booksBoxSeen = false;   // item 2d is scanned once, even when empty
  for (let ri = 0; ri < face.length; ri++) {
    const r = face[ri];
    const text = r.cells.join(" ");
    const nextRows = face.slice(ri + 1, ri + 4).filter((n) => n.page === r.page);

    // Shares: "Ordinary Shares | 120 | 120" (Schedule A / B).
    if (!out.shares) {
      const idx = r.cells.findIndex((c) => /^(ordinary|common|class [a-z]) shares?$/i.test((c || "").trim()));
      if (idx >= 0) {
        const nums = r.cells.slice(idx + 1).map((c) => numeric(c)).filter((n): n is number => n !== null);
        if (nums.length >= 2 && nums[0] >= 0 && nums[1] >= 0) {
          out.shares = { classOfShares: r.cells[idx].trim(), boy: nums[0], eoy: nums[1], page: r.page };
        }
      }
    }

    // Voting percentage: the caption wraps; the % prints on the same or next row.
    if (out.pctVoting === undefined && /stock you owned at the end|percentage of the foreign corporation'?s voting/i.test(text)) {
      for (const cand of [r, ...nextRows]) {
        const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(cand.cells.join(" "));
        if (m) { out.pctVoting = parseFloat(m[1]); break; }
      }
    }

    /* Country of incorporation: caption row, value on the next row.
       The country prints to the RIGHT of the address on this form, so the row
       reads ["VALPARAISO CHILE", "CHILE"] and taking the first match stored
       the city as the country — which then flowed into Schedule E as the
       country the tax was paid to. Take the last candidate, and where a
       package glues the whole lot into one cell ("VALPARAISO CHILE CHILE"),
       keep only the trailing word it repeats. */
    if (!out.countryInc && /country under whose laws incorporated/i.test(text)) {
      const cands = (nextRows[0]?.cells || [])
        .map((c) => c.trim())
        .filter((c) => /^[A-Za-z][A-Za-z ]{2,30}$/.test(c));
      let cand = cands.length ? cands[cands.length - 1] : undefined;
      if (cand) {
        const words = cand.split(/\s+/);
        const last = words[words.length - 1];
        if (words.length > 1 && words.slice(0, -1).some((w) => w.toUpperCase() === last.toUpperCase())) {
          cand = last;
        }
        out.countryInc = cand;
      }
    }

    // "d Date of incorporation … h Functional currency code" caption row —
    // values print on the row(s) below, one per caption COLUMN. Assign them
    // by x-overlap with the caption anchors; the old whole-row scan demanded
    // a standalone 4-digit-year date cell and missed every glued layout
    // ("09/05/08 CAYMAN ISLANDS"), losing the currency printed plainly in h.
    // The gate must tolerate a WRAPPED d caption ("d Date of" on the anchor
    // row, "incorporation" below) — the sibling captions e/g/h identify the
    // row just as well.
    if (!out.formed && /date of incorporation|principal place of business|functional currency code/i.test(text)) {
      const geoCaption = faceGeo[ri];
      const anchors: { key: "d" | "e" | "f" | "g" | "h"; x0: number }[] = [];
      if (geoCaption) {
        for (const c of geoCaption.cells) {
          const t = c.text.toLowerCase().trim();
          if (/date of incorp|^d\s+date\b/.test(t)) anchors.push({ key: "d", x0: c.x0 });
          else if (/principal place of business/.test(t)) anchors.push({ key: "e", x0: c.x0 });
          else if (/activity code/.test(t)) anchors.push({ key: "f", x0: c.x0 });
          else if (/principal business activity/.test(t)) anchors.push({ key: "g", x0: c.x0 });
          else if (/functional currency/.test(t)) anchors.push({ key: "h", x0: c.x0 });
        }
      }
      if (anchors.length >= 2) {
        anchors.sort((a, b) => a.x0 - b.x0);
        const buckets: Partial<Record<"d" | "e" | "f" | "g" | "h", string[]>> = {};
        for (let j = ri + 1; j <= ri + 4 && j < faceGeo.length; j++) {
          const geo = faceGeo[j];
          if (!geo || geo.page !== r.page) break;
          const joined = geo.cells.map((c) => c.text).join(" ");
          if (/^\d+\s+[a-z]|provide the following|schedule a\b/i.test(joined.trim())) break;   // next form section
          for (const c of geo.cells) {
            for (let k = anchors.length - 1; k >= 0; k--) {
              if (c.x0 >= anchors[k].x0 - 12) {
                (buckets[anchors[k].key] ||= []).push(c.text.trim());
                break;
              }
            }
          }
        }
        // Wrapped caption fragments ("business activity code number") land in
        // the value rows — filter them out of the place, and pull the code
        // off their tail ("… code number 493100").
        const isFragment = (c: string) =>
          /activity code|code no\.?|code number|^incorporation$|^number$|principal place|principal business|functional currency|^business activity$|^date of/i.test(c.trim());
        const dJoin = (buckets.d || []).join(" ").trim();
        const glued = dJoin ? splitGluedDatePlace(dJoin) : null;
        const eJoin = (buckets.e || [])
          .filter((c) => /^[A-Za-z][A-Za-z ,.'&-]*$/.test(c.trim()) && !isFragment(c))
          .join(" ").trim();
        if (glued) {
          out.formed = glued.date;
          const gp = glued.place && !isFragment(glued.place) ? glued.place : undefined;
          if (gp && !eJoin) out.principalPlace = gp;
        }
        if (eJoin) out.principalPlace = eJoin;
        for (const c of [...(buckets.f || []), ...(buckets.e || []), ...(buckets.g || [])]) {
          const m = /(?:^|\s)(\d{4,6})$/.exec(c.trim());
          if (m) { out.activityCode = m[1]; break; }
        }
        const gJoin = (buckets.g || []).filter((c) => /[A-Za-z]/.test(c) && !isFragment(c)).join(" ").trim();
        if (gJoin) out.activity = gJoin;
        const hTok = (buckets.h || []).find((c) => /^[A-Z]{3}$/.test(c));
        if (hTok) out.functionalCurrency = hTok;
      }
      // Legacy fallback: no geometry (grid docs) or anchors not found. Only
      // on the true d caption row — the widened gate must not let a stray
      // "functional currency" mention start a date hunt elsewhere.
      if (!out.formed && /date of incorporation/i.test(text)) {
        for (const cand of nextRows) {
          const cells = cand.cells.map((c) => c.trim()).filter(Boolean);
          const di = cells.findIndex((c) => /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(c));
          if (di < 0) continue;
          out.formed = cells[di].replace(/-/g, "/");
          const ci = cells.findIndex((c) => /^[A-Z]{3}$/.test(c) && c !== "USD");
          if (ci >= 0) {
            out.functionalCurrency = out.functionalCurrency || cells[ci];
            if (ci - 1 > di && !out.activity) out.activity = cells[ci - 1];
          }
          break;
        }
      }
    }

    // The CFC's name and address block under "1a Name and address of foreign
    // corporation". Only LEFT-column cells qualify: the right column carries
    // b(1)/b(2)/b(3) captions and values ("BME01 b(3) Previous reference ID
    // number(s)…"), which is exactly what used to land in the legal name.
    if (!out.cfcName && /^1a name and address of foreign corporation/i.test((r.cells[0] || "").trim())) {
      const geoCaption = faceGeo[ri];
      const bColX = geoCaption && geoCaption.cells.length > 1 ? geoCaption.cells[1].x0 : null;
      let lastRow = -1;   // once the country caption appears, take one more row (the city line)
      for (let j = ri + 1; j <= ri + 8 && j < face.length; j++) {
        const cand = face[j];
        if (cand.page !== r.page) break;
        const geo = faceGeo[j];
        const leftCells = geo && bColX !== null
          ? geo.cells.filter((c) => c.x0 < bColX - 8).map((c) => c.text)
          : cand.cells;
        const first = (leftCells[0] || "").trim();
        const gluedId = first ? splitGluedRefId(first) : null;
        if (gluedId) {
          if (!out.referenceIds.includes(gluedId)) out.referenceIds.push(gluedId);
        } else if (first && /[A-Za-z]/.test(first) && !looksLikeCaption(first)) {
          if (!out.cfcName) out.cfcName = first;
          else if (out.cfcAddress.length < 3 && first !== out.cfcName) out.cfcAddress.push(first);
        }
        if (/country under whose laws/i.test(cand.cells.join(" "))) {
          if (lastRow < 0) lastRow = j + 1;   // the street can share the break row; the city follows
        }
        if (lastRow >= 0 && j >= lastRow) break;
      }
    }

    // Item 2d — "Name and address … of person (or persons) with custody of the
    // books and records of the foreign corporation".
    //
    // The caption wraps differently in every vendor's PDF — one package breaks
    // it as "…applicable) of / person (or persons) with custody…", another as
    // "…applicable) of person (or / persons) with custody…". Anchoring on an
    // exact phrase inside ONE row therefore works for some clients and silently
    // reads nothing for others. So: match the caption across a JOINED window of
    // rows, and find where it ends by content, never by counting rows.
    if (!out.booksPerson && !booksBoxSeen && isBooksCaptionStart(face, ri, r)) {
      booksBoxSeen = true;
      // 2d sits in the RIGHT column of the 2c/2d band. Keep the x-geometry, or
      // the Schedule A table underneath bleeds into the harvest.
      // Anchor the column on the cell that actually holds the 2d caption. Using
      // cells[0] puts the boundary at the LEFT column whenever 2c's tail shares
      // the row, which lets left-column text through the filter.
      const geoCaption = faceGeo[ri];
      const boxCell = geoCaption?.cells.find((c) => /name and address\s*\(including/i.test(c.text))
        ?? geoCaption?.cells[0];
      const boxX = boxCell ? boxCell.x0 : null;
      const booksLines: string[] = [];
      let started = false;   // false while we are still walking the caption text
      for (let j = ri + 1; j <= ri + 12 && j < face.length; j++) {
        const cand = face[j];
        if (cand.page !== r.page) break;
        // HARD STOP at the next form section. An empty 2d box is normal, and
        // without this the scan runs on into Schedule A and harvests its
        // column headers as if they were a person's name.
        if (/^schedule\s+[a-z]\b|stock of the foreign corporation/i.test(cand.cells.join(" "))) break;
        const geo = faceGeo[j];
        const cells = geo && boxX !== null
          ? geo.cells.filter((c) => c.x0 >= boxX - 8).map((c) => c.text)
          : cand.cells;
        const first = (cells[0] || "").trim();
        if (!first) continue;
        // Still inside the wrapped caption — skip, however it happens to break.
        if (!started && isBooksCaptionText(first)) continue;
        if (!/[A-Za-z]/.test(first) || looksLikeCaption(first)) continue;
        // Structural fragments of the form itself are never a custodian name.
        if (isFormStructure(first)) continue;
        started = true;
        booksLines.push(first);
        if (booksLines.length >= 4) break;
      }
      if (booksLines.length) {
        out.booksPerson = booksLines[0];
        if (booksLines[1]) out.booksAddress.push(booksLines[1]);
        if (booksLines.length > 2) out.booksAddress.push(booksLines.slice(2).join(", "));
      }
    }

    // Filer categories: glued checkbox tokens ("1a X 1b … 4 X 5a X 5b … 5c").
    // First-win like every other face field — a later 5471's checkbox row
    // (multi-CFC copies) must not overwrite this block's categories.
    if (!out.categories.length && /category of filer/i.test(text)) {
      for (const cand of [r, ...nextRows]) {
        const tokens = cand.cells.join(" ").split(/\s+/).map((t) => t.toLowerCase());
        const found: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
          if (CATEGORY_CODES.includes(tokens[i]) && /^[x✓✔]$/.test(tokens[i + 1] || "")) found.push(tokens[i]);
        }
        if (found.length) {
          out.categories = found;
          out.categoriesRaw = cand.cells.join(" ");
          break;
        }
      }
    }
  }

  const CLASS_EXACT = /^(common|ordinary|preferred|class [a-z0-9]+)( shares?)?$/i;
  /** Same token, matched INSIDE a cell that also carries the holder's name. */
  const CLASS_INLINE = /\b(common|ordinary|preferred|class\s+[a-z0-9]+)(\s+shares?)?\b\s*$/i;
  /** The form's column width cuts long names off mid-word, usually leaving an
      unclosed bracket: "MATTHEW J METCALFE (NRA SPOU". Flagged, not guessed. */
  const TRUNCATED_NAME = /\([^)]*$/;

  /* Schedule B — BOTH parts share one row shape:
       "JOYCE C LANGAN | COMMON | 40.000 40.000"        (name-first layout)
       "87-1188632 | US | Ordinary Shares | 120 | 120"  (ID-first; name next row)
     Share counts print separated OR glued ("100.000100.000").

     Part I  = U.S. Shareholders  — carries the SSN and the pro rata % and is
               the ONLY place those appear.
     Part II = Direct Shareholders — the legal owners.
     They answer different questions and a holder can appear in one, the other,
     or both, so each is scanned separately and neither is assumed present. */
  const scanHolderRows = (from: number): NonNullable<CarryForward["holders"]> => {
    const holders: NonNullable<CarryForward["holders"]> = [];
    if (from < 0) return holders;
    const isIdish = (s2: string) =>
      /^\d{2}-\d{7}\b|^\d{3}-\d{2}-\d{4}\b/.test(s2) || /^[A-Z]{2}$/.test(s2) || !/[A-Za-z]{3}/.test(s2);
    for (let j = from + 1; j < Math.min(from + 40, face.length); j++) {
      const r = face[j];
      const joined = r.cells.join(" ").trim();
      // Section break — but the column-header wrap "…entered in Schedule A,
      // column (a)." must not end the scan before the holder rows.
      if (/^part\b|^schedule [a-z]\b(?!\s*,\s*column)|income statement/i.test(joined)) break;
      const cells = r.cells.map((c) => (c || "").trim()).filter(Boolean);
      if (cells.length < 2) continue;
      // The class of stock does NOT reliably get its own cell. When a
      // shareholder's name is long enough to run up to the column rule, the row
      // builder merges them ("MATTHEW J METCALFE (NRA SPOU COMMON"), and an
      // exact whole-cell match silently drops that holder — so short names are
      // read and long ones vanish. Match the class token ANYWHERE instead.
      let ci = cells.findIndex((c) => CLASS_EXACT.test(c));
      let className = ci >= 0 ? cells[ci] : "";
      let nameCells = ci >= 0 ? cells.slice(0, ci) : [];
      if (ci < 0) {
        const k = cells.findIndex((c) => CLASS_INLINE.test(c));
        if (k < 0) continue;
        const m = CLASS_INLINE.exec(cells[k]);
        if (!m || m.index === 0) continue;   // class-only cell would have matched above
        className = m[0].trim();
        nameCells = [...cells.slice(0, k), cells[k].slice(0, m.index).trim()].filter(Boolean);
        ci = k;   // share counts still follow this cell
      }
      let pair = parseSharePair(cells.slice(ci + 1));
      let single = false;
      if (!pair) {
        // Some returns print ONE count per holder — taken as BOY = EOY and
        // flagged, never silently: the Shareholders tab makes it editable.
        const n = numericCell(cells[ci + 1] || "");
        if (n !== null && n >= 0) { pair = { boy: n, eoy: n }; single = true; }
      }
      if (!pair) continue;
      let name = nameCells.join(" ").trim();
      if ((!name || isIdish(name)) && j + 1 < face.length) {
        // ID-first layout: the shareholder's name prints on the row below.
        const cand = (face[j + 1].cells[0] || "").trim();
        if (/[A-Za-z]{3}/.test(cand) && !looksLikeCaption(cand)) name = cand;
      }
      if (!name || isIdish(name) || /name, address|^\(a\)/i.test(name)) continue;
      // The pro rata % (Part I column (e)) prints a row or two below the name.
      let pct: number | undefined;
      for (let k = j; k <= j + 4 && k < face.length; k++) {
        const m = /(\d+(?:\.\d+)?)\s*%/.exec(face[k].cells.join(" "));
        if (m) { pct = Number(m[1]); break; }
      }
      if (!holders.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
        holders.push({
          name, classOfShares: className.replace(/\s*shares?$/i, ""),
          ...(TRUNCATED_NAME.test(name) ? { truncated: true } : {}),
          boy: pair.boy, eoy: pair.eoy, page: r.page,
          ...(pct !== undefined ? { pct } : {}),
          ...(single ? { single: true } : {}),
        });
      }
    }
    return holders;
  };

  const partII = face.findIndex((r) => /part ii\b.*direct shareholders/i.test(r.cells.join(" ")));
  const partI = face.findIndex((r) => /part i\b.*u\.?\s*s\.?\s*shareholders/i.test(r.cells.join(" ")));
  out.hasScheduleB = partI >= 0 || partII >= 0;

  const direct = scanHolderRows(partII);
  const usHolders = scanHolderRows(partI);
  if (usHolders.length) out.usHolders = usHolders;

  // Direct shareholders drive template rows 19-26. Part I holders are US
  // shareholders — often the SAME people counted through a trust — so they are
  // NOT merged into the direct rows (that would double-count ownership). They
  // seed the rows only when Part II is absent, which is better than blank.
  if (direct.length) out.holders = direct;
  else if (usHolders.length) out.holders = usHolders.map((h) => ({ ...h, fromPartI: true }));

  /* Item H — "Person(s) on whose behalf this information return is filed",
     with the Shareholder / Officer / Director check boxes. When a corporation
     is filed as page 1 only (no Schedule B), this is the sole shareholder and
     role evidence in the document, so it is read on every block. */
  {
    const hIdx = face.findIndex((r) =>
      /person\(s\)\s*on whose behalf this information return is filed/i.test(r.cells.join(" ")));
    if (hIdx >= 0) {
      const people: NonNullable<CarryForward["itemH"]> = [];
      for (let j = hIdx + 1; j <= hIdx + 10 && j < face.length; j++) {
        const joined = face[j].cells.join(" ");
        // Item H ends where the "Important:" note or item 1a begins.
        if (/^important\b|name and address of foreign corporation/i.test(joined.trim())) break;
        const first = (face[j].cells[0] || "").trim();
        if (!first || looksLikeCaption(first) || isFormStructure(first)) continue;
        // A person row carries a name; the check marks print as separate cells.
        if (!/[A-Za-z]{3}/.test(first) || /^\(\d\)|^name\b|^address\b/i.test(first)) continue;
        const name = first.replace(/\s{2,}.*$/, "").replace(/\s+/g, " ").trim();
        if (!name || /identifying|check applicable/i.test(name)) continue;
        // The three boxes print in order: Shareholder, Officer, Director.
        const marks = (joined.match(/\bX\b/g) || []).length;
        if (!people.some((q) => q.name.toLowerCase() === name.toLowerCase())) {
          people.push({ name, isShareholder: marks >= 1, isOfficer: marks >= 2, isDirector: marks >= 3 });
        }
      }
      if (people.length) out.itemH = people;
    }
  }

  // Holder: the row under "Name of person filing Form 5471". Scoped to this
  // block's extended range when segmenting a multi-CFC copy.
  const allPages = new Set(
    cls.pages
      .map((p) => p.page)
      .filter((p) => !scanRange || (p >= scanRange.from && p <= scanRange.to)),
  );
  const all = rowsOnPages(parsed, allPages);
  for (let i = 0; i < all.length; i++) {
    if (/^name of person filing/i.test((all[i].cells[0] || "").trim())) {
      const cand = (all[i + 1]?.cells[0] || "").trim();
      if (/[A-Za-z]{3}/.test(cand)) {
        out.holderName = cand.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
        break;
      }
    }
  }

  // Filer's identifying number: SSN-shaped IDs are masked at the source —
  // the raw value is never stored anywhere in the tool.
  for (const r of face) {
    const m = /\b\d{3}-\d{2}-(\d{4})\b/.exec(r.cells.join(" "));
    if (m) { out.filerIdMasked = `***-**-${m[1]}`; break; }
  }

  // Reference IDs only from "Reference ID number" captions — an EIN is a
  // 9-digit number too, and the filer's EIN must never masquerade as the
  // CFC's reference ID. The 5471 pages come first, so the CFC's own ID leads.
  // IDs are ALPHANUMERIC in practice (BME01, MAC2022) — never digits-only.
  const refIds: string[] = [...out.referenceIds];   // glued b(3) captures from the 1a harvest
  for (let i = 0; i < all.length; i++) {
    const t = all[i].cells.join(" ");
    if (!/reference id/i.test(t)) continue;
    // Value on the caption row itself: a glued "BME01 b(3)…" cell or a bare token.
    for (const c of all[i].cells) {
      const glued = splitGluedRefId(c);
      const tok = glued || refIdToken(c);
      if (tok && !refIds.includes(tok)) refIds.push(tok);
    }
    const nxt = all[i + 1];
    if (nxt && nxt.page === all[i].page) {
      for (const c of nxt.cells) {
        const tok = splitGluedRefId(c || "") || refIdToken(c || "");
        if (tok && !refIds.includes(tok)) refIds.push(tok);
      }
    }
  }
  out.referenceIds = refIds;
  return out;
}

/** One CarryForward per Form 5471 block of the document. Without block
    segmentation (older DocClass, or a grid doc) a single pseudo-block covers
    the whole document — exactly the single-5471 behavior. */
export function extractCarryForwards(
  cls: DocClass,
  parsed: ParsedDoc,
): { block: Block5471; cf: CarryForward }[] {
  const blocks: Block5471[] =
    cls.blocks5471 && cls.blocks5471.length
      ? cls.blocks5471
      : [{
          index: 0,
          pages: cls.pages.filter((p) => p.kind.startsWith("us-5471-")).map((p) => p.page),
          scanFrom: 1,
          scanTo: Number.MAX_SAFE_INTEGER,
          facePage: null,
          cfcName: cls.foreignCorpName ?? null,
          referenceIds: [],
        }];
  return blocks.map((block) => {
    const single = blocks.length === 1;
    const cf = extractCarryForward(
      cls,
      parsed,
      single ? undefined : new Set(block.pages),
      single ? undefined : { from: block.scanFrom, to: block.scanTo },
    );
    // The caption scanner (with its bleed guards) beats the face harvest —
    // a right-column reference ID must never become the legal name.
    if (block.cfcName) cf.cfcName = block.cfcName;
    return { block, cf };
  });
}
