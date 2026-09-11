/* Document and page classification — the anti-contamination gate.

   Every uploaded document is classified before any mapping happens, and the
   feed policy decides what each page is ALLOWED to influence. A US parent's
   Form 1120 feeds nothing; a prior-year Form 5471 feeds carry-forward
   extraction only; an invoice ledger feeds the Schedule M module only; the
   CFC's own statements feed the income statement and balance sheet. This is
   deterministic and rule-based; a Groq assist (in the store) may raise an
   unknown document to a kind, never override a confident rules result. */

import type { PdfDoc } from "./pdfText";
import { looksLikeQuestionnaire } from "./questionnaire";
import { looksLikeSalarySchedule } from "./relatedPartyLedger";
import type { ParsedDoc } from "./engine";
import { numeric } from "./engine";

export type DocKind =
  | "cfc-financial-statements"
  | "cfc-tax-return"
  | "prior-year-us-return"
  | "related-party-ledger"
  | "trial-balance"
  /** The preparer's client questionnaire — roles, wages received, the other
      shareholders. Feeds the profile only. */
  | "client-questionnaire"
  /** A month-by-month salary schedule for one related person. Feeds
      Schedule M only. */
  | "related-party-salary"
  | "terms-and-conditions"
  | "unknown";

export type PageKind =
  | "fs-cover" | "fs-trading" | "fs-pnl" | "fs-equity" | "fs-balance-sheet" | "fs-notes"
  | "ato-return" | "ato-calc-statement" | "ato-dividend-schedule" | "ato-franking"
  | "us-1120" | "us-5471-face" | "us-5471-schA" | "us-5471-schB" | "us-5471-schC"
  | "us-5471-schF" | "us-5471-schJ" | "us-5471-schM" | "us-5471-schE" | "us-5471-schH"
  | "us-5471-schI" | "us-5471-schO" | "us-5471-schP" | "us-5471-schR"
  | "us-5472" | "us-8992" | "us-statements" | "us-other"
  | "tandc" | "unknown";

export type PageInfo = { page: number; kind: PageKind; score: number };

export type DocNote = { level: "info" | "warn" | "block"; message: string };

export type DocClass = {
  fileId: string;
  fileName: string;
  kind: DocKind;
  confidence: number;                     // 0..1 — share of pages the rules could place
  method: "rules" | "groq" | "user";      // "user" = manual type override
  pages: PageInfo[];                      // one pseudo-page for grids
  statementYear: number | null;           // the year the document reports ON
  entityName: string | null;              // primary subject entity
  foreignCorpName: string | null;         // "Name of foreign corporation" on 5471 pages
  entityIds: string[];                    // ABN / EIN / reference IDs found
  duplicateOf?: string;                   // fileId of the preferred near-duplicate
  blocks5471?: Block5471[];               // one per Form 5471 in a prior-year return
  notes: DocNote[];
};

/* One client copy can staple SEVERAL filed 5471s (one per CFC) into a single
   PDF. Each face page opens a block; the block's scan range extends past its
   own 5471 pages to the page before the NEXT face, so interleaved 5472 /
   supporting-statement pages of the same copy stay attached to their CFC. */
export type Block5471 = {
  index: number;
  pages: number[];        // us-5471-* pages of this block (drives schedule extraction)
  scanFrom: number;       // extended range for holder / refID / period scans
  scanTo: number;
  facePage: number | null;
  cfcName: string | null;
  referenceIds: string[];
};

export type FeedTarget =
  | "generic-is" | "generic-bs" | "equity" | "targeted-ato"
  | "carry-forward" | "schM-ledger" | "profile" | "none";

/* ---------- page classification ---------- */

const pageText = (doc: PdfDoc, page: number, take: "head" | "foot" | "all"): string => {
  const rows = doc.rows.filter((r) => r.page === page);
  const slice = take === "head" ? rows.slice(0, 14) : take === "foot" ? rows.slice(-3) : rows;
  return slice.map((r) => r.cells.map((c) => c.text).join(" ")).join("\n").toLowerCase();
};

const SCH_TITLES: [RegExp, PageKind][] = [
  [/accumulated earnings\s*&?\s*profits/, "us-5471-schJ"],
  [/transactions between controlled foreign corporation/, "us-5471-schM"],
  [/income, war profits, and excess profits taxes/, "us-5471-schE"],
  [/current earnings and profits/, "us-5471-schH"],
  [/previously taxed earnings and profits/, "us-5471-schP"],
  [/distributions from a foreign corporation/, "us-5471-schR"],
  [/organization or reorganization of foreign corporation/, "us-5471-schO"],
  [/information return of u\.?s\.? persons/, "us-5471-face"],
];

/* Titles that open a financial statement, in the languages the rest of this
   file already reads. Anchored at the start of a line. */
const STATEMENT_TITLE = new RegExp(
  "^(balance sheet|statement of financial position|balance general|balance de situaci\u00f3n|"
  + "estado de situaci\u00f3n financiera|estado de situacion financiera|balan\u00e7o|balanco|"
  + "bilan\\b|bilanz|bilancio|balans|"
  + "income statement|profit (and|or|&) loss|compte de profits et pertes|compte de r\u00e9sultat|"
  + "compte de resultat|statement of comprehensive income|statement of financial performance|"
  + "estado de resultados?|cuenta de resultados|demonstra\u00e7\u00e3o do resultado|"
  + "demonstracao do resultado|conto economico|winst- en verliesrekening|"
  + "gewinn- und verlustrechnung|erfolgsrechnung)\\b",
);

/** Rows that read as a caption followed by an amount — the shape of a statement. */
function amountRowCount(doc: PdfDoc, page: number): number {
  let n = 0;
  for (const r of doc.rows) {
    if (r.page !== page || r.cells.length < 2) continue;
    const first = r.cells[0].text.trim();
    const last = r.cells[r.cells.length - 1].text.trim();
    if (!/\p{L}/u.test(first)) continue;
    if (/^\(?-?[\d.,\u00a0 ']+\)?$/.test(last) && /\d/.test(last)) n++;
  }
  return n;
}

function looksLikeStatementPage(doc: PdfDoc, page: number): boolean {
  const head = doc.rows.filter((r) => r.page === page).slice(0, 14);
  const titled = head.some((r) => STATEMENT_TITLE.test(r.cells.map((c) => c.text).join(" ").trim().toLowerCase()));
  return titled && amountRowCount(doc, page) >= 5;
}

function classifyPdfPage(doc: PdfDoc, page: number, opts?: { assumeFsBand?: boolean }): PageInfo {
  const head = pageText(doc, page, "head");
  const foot = pageText(doc, page, "foot");
  const all = pageText(doc, page, "all");
  const mk = (kind: PageKind, score: number): PageInfo => ({ page, kind, score });

  // US federal forms — headers are unambiguous.
  if (/form\s*5472\b/.test(head)) return mk("us-5472", 3);
  if (/form\s*8992\b/.test(head) || /\(form 8992\)/.test(head)) return mk("us-8992", 3);
  if (/federal supporting statements/.test(head)) return mk("us-statements", 3);
  if (/form\s*5471\b|\(form 5471\)/.test(head)) {
    for (const [re, kind] of SCH_TITLES) if (re.test(head)) return mk(kind, 3);
    // Standalone schedule pages name themselves: "Schedule J (Form 5471)".
    const sm = /schedule ([a-z])(?:-1)?\s*\(form 5471\)/.exec(head);
    if (sm && "abcefhijmopr".includes(sm[1])) return mk(("us-5471-sch" + sm[1].toUpperCase()) as PageKind, 3);
    // Core-form continuations name their schedules in the body band.
    if (/schedule c\b.*income statement|income statement.*schedule c\b/s.test(all)) return mk("us-5471-schC", 2);
    if (/schedule f\b.*balance sheet|balance sheet.*schedule f\b/s.test(all)) return mk("us-5471-schF", 2);
    if (/schedule i\b|summary of shareholder/.test(head)) return mk("us-5471-schI", 2);
    if (/schedule b\b|u\.?s\.? shareholders of foreign corporation/.test(all)) return mk("us-5471-schB", 2);
    if (/schedule a\b|stock of the foreign corporation/.test(all)) return mk("us-5471-schA", 2);
    return mk("us-5471-face", 2);
  }
  if (/form\s*1120\b|\(form 1120\)/.test(head) || /u\.?s\.? corporation income tax return/.test(head)) return mk("us-1120", 3);
  if (/form\s*(851|1125-e|1125e|7004|4562)\b/.test(head)) return mk("us-other", 2);

  // Australian company tax return (HandiTax prints a banded header).
  if (/company tax return\s*\d{4}/.test(head)) return mk("ato-return", 3);
  if (/franking account/.test(head)) return mk("ato-franking", 3);
  if (/dividend and interest schedule/.test(head)) return mk("ato-dividend-schedule", 3);
  if (/calculation statement/.test(head)) return mk("ato-calc-statement", 2);

  // Statutory financial statements: entity + company-number band, section
  // title. UK statutory accounts print "Company No. SC240721" and Companies
  // House registration lines — all count as the band.
  const fsBand = opts?.assumeFsBand
    || /\babn\b|\bacn\b|\ba\.\s?b\.\s?n\.?\b|company\s+(no\.?\s|number|registration)|registered\s+(number|office)|companies house/.test(head)
    // Non-Anglo company/tax identifiers. Without these a Colombian, Mexican,
    // Brazilian or French statement never enters the band, so its pages
    // classify as "unknown" and never reach the mapper at all — the entity
    // then shows "0 lines" with nothing extracted to explain it.
    || /\bnit\b|\bru[tc]\b|\brfc\b|\bcuit\b|\bcnpj\b|\bnif\b|\bcif\b|\bsiren\b|\bsiret\b|\bkvk\b|\bcoc\b|c\.?o\.?c\.?\s*:|\bust-?idnr\b|\bche-?\d/.test(head)
    || /page \d+ of \d+|p\u00e1gina \d+ de \d+|p\u00e1gina \d+\/\d+/.test(foot)
    // A statement can also prove itself by its own SHAPE. Everything above
    // demands a registration number or a page footer, which small practices
    // simply do not print: a Swiss client's accounts carry only the company
    // name, its address and "BILAN AU 31 DECEMBRE 2024", so the title was
    // never even read and the whole document classified as unknown — nothing
    // from it reached the work paper. A title STARTING a line of its own, over
    // a page of label-and-amount rows, is a statement whatever the letterhead
    // omits. The title must start the line: "…which includes the balance sheet
    // and income statement" is prose about one, not one.
    || looksLikeStatementPage(doc, page);
  if (fsBand) {
    // Cover/administrative pages mention every section name — test them first.
    if (/\bcontents\b|directors'? (statement|report)|accountants'? report|compilation report|independent auditor/.test(head)) return mk("fs-cover", 3);
    // Under an ASSUMED band (statutory second pass) a titled notes page wins
    // before the statement tests — note prose mentions "balance sheet" freely.
    if (opts?.assumeFsBand && /accounting policies|notes to the (accounts|financial statements)/.test(head)) return mk("fs-notes", 2);
    if (/trading account/.test(head)) return mk("fs-trading", 3);
    // A balance-sheet TITLE wins over equity-movement content: a balance sheet
    // may mention retained profits in a note, but never carries the movement.
    if (/statement of financial position|balance sheet|balance general|estado de situaci\u00f3n financiera|estado de situacion financiera|balan\u00e7o patrimonial|balanco patrimonial|balan\u00e7o|balanco|bilan\b|bilancio|balans|bilanz/.test(head)) return mk("fs-balance-sheet", 3);
    // Equity movements need the strong anchor — a P&L-titled page carrying the
    // retained-profits roll-forward is the equity statement, not a P&L.
    if (/statement of changes in equity/.test(head) || /opening retained (profits|earnings)|retained (profits|earnings) at the (beginning|start)|movements? in equity/.test(all)) return mk("fs-equity", 3);
    if (/statement of financial performance|profit (and|or) loss|income statement|statement of comprehensive income|estado de resultados?|estado de ganancias y p\u00e9rdidas|estado de ganancias y perdidas|cuenta de resultados|demonstra\u00e7\u00e3o do resultado|demonstracao do resultado|compte de profits et pertes|compte de r\u00e9sultat|compte de resultat|erfolgsrechnung|conto economico|winst- en verliesrekening|gewinn- und verlustrechnung/.test(head)) return mk("fs-pnl", 3);
    if (/accounting policies|notes to /.test(head)) return mk("fs-notes", 2);
    if (/financial statements/.test(head)) return mk("fs-cover", 2);
  }
  // Accounting-software exports (QuickBooks and friends): no statutory band,
  // but an EXACT statement title plus a period line in the first rows.
  const head5 = doc.rows.filter((r) => r.page === page).slice(0, 5)
    .map((r) => r.cells.map((c) => c.text).join(" ").trim().toLowerCase());
  const periodLine = /^(as of .*\d{4}|(january|february|march|april|may|june|july|august|september|october|november|december)[^]{0,40}\d{4}|all dates|a (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[^]{0,40}\d{4}|al \d{1,2} de [a-z\u00e1\u00e9\u00ed\u00f3\u00fa]+ de \d{4}|(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[^]{0,40}\d{4})$/;
  if (head5.some((t) => periodLine.test(t))) {
    if (head5.some((t) => /^(balance sheet|balance general|balan\u00e7o)(\s*[-–]\s*\d{4})?$/.test(t))) return mk("fs-balance-sheet", 2);
    if (head5.some((t) => /^(profit (and|&) loss|income statement|statement of activity|estado de resultados?)(\s*[-–]\s*\d{4})?$/.test(t))) return mk("fs-pnl", 2);
  }
  if (/terms\s*(&|and)\s*conditions|letter of engagement|engagement terms/.test(head)) return mk("tandc", 2);
  return mk("unknown", 0);
}

/** Kinds that legitimately continue onto anchor-less following pages. */
const CONTINUABLE = new Set<PageKind>([
  "us-5471-schJ", "us-5471-schE", "us-5471-schM", "us-5471-schP",
  "fs-balance-sheet", "fs-pnl", "fs-trading", "fs-equity",
  "us-statements", "ato-return", "tandc",
]);

export function classifyPages(doc: PdfDoc): PageInfo[] {
  // Pass 1 — page-local rules.
  const out: PageInfo[] = [];
  for (let p = 1; p <= doc.pageCount; p++) out.push(classifyPdfPage(doc, p));
  // Pass 2 — statutory accounts print the company number on SOME pages only
  // (UK accounts: cover + balance sheet). Once any page proves the document
  // is statutory FS, re-test the unknown pages with the band assumed so the
  // titled sections (P&L account, equity, notes) classify by their own name
  // instead of blindly continuing the previous page's kind.
  if (out.some((p) => p.kind.startsWith("fs-"))) {
    for (let i = 0; i < out.length; i++) {
      if (out[i].kind !== "unknown") continue;
      const info = classifyPdfPage(doc, out[i].page, { assumeFsBand: true });
      if (info.kind !== "unknown") out[i] = info;
    }
  }
  // Pass 3 — anchor-less continuation pages inherit the previous kind.
  for (let i = 1; i < out.length; i++) {
    if (out[i].kind === "unknown" && CONTINUABLE.has(out[i - 1].kind)) {
      out[i] = { page: out[i].page, kind: out[i - 1].kind, score: 1 };
    }
  }
  return out;
}

/* ---------- years, entities, ids ---------- */

const YEAR_ANCHORS: RegExp[] = [
  /company tax return\s*(\d{4})/,
  /for the year ended[^\d]*\d{1,2}? ?\w* (\d{4})/,
  /year ended 31 december (\d{4})/,
  /as at \d{1,2} \w+ (\d{4})/,
  /for calendar year (\d{4})/,
  /tax year beginning[^]*?(\d{4})/,
  // US-order software exports: "As of December 31, 2024" / "January - December
  // 2024" / "January 1-December 31, 2024".
  /as of (?:january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2},? (\d{4})/,
  /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{0,2}\s*[-–]\s*(?:january|february|march|april|may|june|july|august|september|october|november|december)?\s*\d{0,2},?\s*(\d{4})/,
];

export function detectStatementYear(doc: PdfDoc, pages: PageInfo[]): number | null {
  const votes = new Map<number, number>();
  for (const pi of pages) {
    const head = pageText(doc, pi.page, "head");
    for (const re of YEAR_ANCHORS) {
      const m = re.exec(head);
      if (m) {
        const y = parseInt(m[1], 10);
        if (y >= 2000 && y <= 2035) votes.set(y, (votes.get(y) || 0) + 2);
      }
    }
    // A bare year cell in the header band is a weak vote (form-corner boxes).
    const rows = doc.rows.filter((r) => r.page === pi.page).slice(0, 6);
    for (const r of rows) for (const c of r.cells) {
      if (/^(20\d{2})$/.test(c.text.trim())) {
        const y = parseInt(c.text, 10);
        if (y >= 2000 && y <= 2035) votes.set(y, (votes.get(y) || 0) + 1);
      }
    }
  }
  let best: number | null = null;
  let bestVotes = 0;
  for (const [y, v] of votes) if (v > bestVotes) { best = y; bestVotes = v; }
  return best;
}

const COMPANY_SUFFIX = /\b(pty\.?\s*ltd|ltd|limited|inc|llc|corp(oration)?|gmbh|sarl|bv|plc|co)\b\.?$/i;

function findCompanyNames(doc: PdfDoc, pages: number[]): string[] {
  const names: string[] = [];
  for (const p of pages) {
    const rows = doc.rows.filter((r) => r.page === p).slice(0, 12);
    for (const r of rows) {
      const t = r.cells.map((c) => c.text).join(" ").trim();
      if (t.length < 70 && COMPANY_SUFFIX.test(t) && /[A-Za-z]{3}/.test(t) && !/statement|report|schedule|form\b/i.test(t)) {
        names.push(
          t.replace(/^name of (company|entity|corporation)\s*/i, "").replace(/\s*\(.*\)\s*$/, "").trim(),
        );
      }
    }
  }
  return names;
}

function mostFrequent(list: string[]): string | null {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s, (counts.get(s) || 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [s, c] of counts) if (c > n) { best = s; n = c; }
  return best;
}

/* A name candidate row must be a value, not a bled-in caption from the form's
   right column ("BME01 b(3) Previous reference ID number(s), if any"). */
const NAME_CANDIDATE_REJECT = /reference id|identif\w* number|previous reference|^instructions|^[a-z0-9]{2,12}\s+b\(\d\)/i;

/** "BME01 b(3) Previous reference ID number(s)…" → "BME01": a reference-ID
    VALUE glued to the next caption in the form's right column. */
export function splitGluedRefId(t: string): string | null {
  const m = /^([A-Z][A-Z0-9]{2,19})\s+b\(\d\)/i.exec(t.trim());
  return m && /\d/.test(m[1]) ? m[1].toUpperCase() : null;
}

/** A reference-ID token: 7–9 digits, or letters+digits like BME01 / MAC2022. */
export const refIdToken = (s: string): string | null => {
  const t = s.trim();
  if (/^\d{7,9}$/.test(t)) return t;
  if (/^[A-Z][A-Z0-9]{3,19}$/i.test(t) && /\d/.test(t)) return t.toUpperCase();
  return null;
};

/** The "Name of foreign corporation" caption names the CFC on 5471 pages.
    With a pageSet the scan is block-scoped; unscoped it covers the doc. */
function findForeignCorpName(doc: PdfDoc, pageSet?: Set<number>): string | null {
  const names: string[] = [];
  const rows = pageSet ? doc.rows.filter((r) => pageSet.has(r.page)) : doc.rows;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].cells.map((c) => c.text).join(" ").toLowerCase();
    // The face's own caption ("1a Name and address of foreign corporation")
    // also announces the name — needed for a block whose face is its only page.
    if (/^name of foreign corporation/.test(t) || /^1a name and address of foreign corporation/.test(t)) {
      for (let j = i + 1; j <= i + 3 && j < rows.length; j++) {
        const next = rows[j];
        if (!next || next.page !== rows[i].page) break;
        const cand = next.cells.map((c) => c.text).find((x) => /[A-Za-z]{3}/.test(x));
        if (!cand || cand.length >= 70) continue;
        if (NAME_CANDIDATE_REJECT.test(cand.trim())) continue;   // right-column bleed
        names.push(cand.trim());
        break;
      }
    }
  }
  return mostFrequent(names);
}

/** IDs found in the document. With a pageSet the scan is block-scoped and
    collects reference-ID-caption hits ONLY — a filer EIN on an in-range 5472
    page must never become a block's reference ID. */
function findEntityIds(doc: PdfDoc, pageSet?: Set<number>): string[] {
  const ids = new Set<string>();
  const refIdOnly = !!pageSet;
  const rows = pageSet ? doc.rows.filter((r) => pageSet.has(r.page)) : doc.rows;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].cells.map((c) => c.text).join(" ");
    if (!refIdOnly) {
      const abn = /\bABN\b:?\s*([\d][\d ]{9,16}[\d])/i.exec(t);
      if (abn) ids.add(abn[1].replace(/\s+/g, ""));
      const ein = /\b(\d{2}-\d{7})\b/.exec(t);
      if (ein) ids.add(ein[1].replace("-", ""));
    }
    if (/reference id/i.test(t)) {
      // The value prints either on the caption row or on the row below it —
      // possibly glued to the b(3) caption, possibly alphanumeric (BME01).
      const near = /\b(\d{9})\b/.exec(t);
      if (near) ids.add(near[1]);
      for (const c of rows[i].cells) {
        const tok = splitGluedRefId(c.text);
        if (tok) ids.add(tok);
      }
      const next = rows[i + 1];
      if (next && next.page === rows[i].page) {
        for (const c of next.cells) {
          const tok = splitGluedRefId(c.text) || refIdToken(c.text);
          if (tok) ids.add(tok);
        }
      }
    }
  }
  return [...ids];
}

/** Split a prior-year return's 5471 pages into per-CFC blocks: every face
    page opens one. A leading faceless run of schedule pages merges into the
    first face block unless it names a distinctly different CFC. */
export function segment5471Blocks(doc: PdfDoc, pages: PageInfo[]): Block5471[] {
  const fam = pages.filter((p) => p.kind.startsWith("us-5471-")).sort((a, b) => a.page - b.page);
  if (!fam.length) return [];
  const blocks: Block5471[] = [];
  let cur: Block5471 | null = null;
  for (const p of fam) {
    if (p.kind === "us-5471-face" || !cur) {
      cur = {
        index: blocks.length,
        pages: [],
        scanFrom: 1, scanTo: doc.pageCount,   // finalized below
        facePage: p.kind === "us-5471-face" ? p.page : null,
        cfcName: null,
        referenceIds: [],
      };
      blocks.push(cur);
    }
    cur.pages.push(p.page);
  }
  // Scan ranges: block 0 reaches back to page 1 (cover sheets belong to the
  // first copy); each block ends the page before the next block's face.
  for (let k = 0; k < blocks.length; k++) {
    const next = blocks[k + 1];
    blocks[k].scanFrom = k === 0 ? 1 : (blocks[k].facePage ?? blocks[k].pages[0]);
    blocks[k].scanTo = next ? (next.facePage ?? next.pages[0]) - 1 : doc.pageCount;
  }
  for (const b of blocks) {
    b.cfcName = findForeignCorpName(doc, new Set(b.pages));
    const scan = new Set<number>();
    for (let p = b.scanFrom; p <= b.scanTo; p++) scan.add(p);
    b.referenceIds = findEntityIds(doc, scan);
  }
  // A block whose CFC name cannot be read is a continuation page the face
  // fallback mistook for a new filing — absorb it into its neighbour. Real
  // faces always carry the item-1a name; genuinely separate CFCs keep their
  // own blocks below. A leading unnamed run merges into the first NAMED block.
  if (blocks.length > 1) {
    const firstNamed = blocks.findIndex((b) => !!b.cfcName);
    if (firstNamed > 0) {
      const head = blocks.splice(0, firstNamed);
      const target = blocks[0];
      target.pages = [...head.flatMap((b) => b.pages), ...target.pages];
      target.scanFrom = head[0].scanFrom;
      target.referenceIds = [...new Set([...head.flatMap((b) => b.referenceIds), ...target.referenceIds])];
    }
    for (let k = 1; k < blocks.length; ) {
      if (!blocks[k].cfcName) {
        blocks[k - 1].pages = [...blocks[k - 1].pages, ...blocks[k].pages];
        blocks[k - 1].scanTo = blocks[k].scanTo;
        blocks[k - 1].referenceIds = [...new Set([...blocks[k - 1].referenceIds, ...blocks[k].referenceIds])];
        blocks.splice(k, 1);
      } else {
        k++;
      }
    }
  }
  // The SAME foreign corporation behind two faces (a filed copy plus a
  // reference/VOID copy, or a continuation the fallback took for a face) is
  // ONE logical unit — split, its face fields and its schedules would land in
  // different blocks. Merge adjacent same-name blocks; genuinely different
  // CFCs (the multi-entity case) keep their own.
  for (let k = 1; k < blocks.length; ) {
    const prev = blocks[k - 1];
    const curB = blocks[k];
    if (prev.cfcName && curB.cfcName && entitySimilarity(prev.cfcName, curB.cfcName) >= 0.5) {
      prev.pages = [...prev.pages, ...curB.pages];
      prev.scanTo = curB.scanTo;
      prev.referenceIds = [...new Set([...prev.referenceIds, ...curB.referenceIds])];
      blocks.splice(k, 1);
    } else {
      k++;
    }
  }
  blocks.forEach((b, i) => { b.index = i; });
  return blocks;
}

const STOPWORDS = new Set(["pty", "ltd", "limited", "inc", "llc", "corp", "corporation", "co", "gmbh", "plc", "the"]);

export function entitySimilarity(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t && !STOPWORDS.has(t)));
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

/* ---------- document classification ---------- */

const LEDGER_HEADERS = ["date", "details", "reference", "currency", "total"];

function looksLikeLedger(parsed: ParsedDoc, fileName: string): boolean {
  if (/expenses? by contact|by contact/i.test(fileName)) return true;
  if (parsed.sheetNames?.some((n) => /expenses? by contact/i.test(n))) return true;
  for (const row of parsed.grid.slice(0, 8)) {
    const cells = row.map((c) => String(c || "").toLowerCase().trim());
    const hits = LEDGER_HEADERS.filter((h) => cells.some((c) => c === h || c.startsWith(h + " ("))).length;
    // Generic date/reference headers are not enough — a transaction ledger
    // must carry a currency column or the Total (Source)/(USD) pair, or a
    // dated trial balance would be silently diverted away from mapping.
    const hasCurrency = cells.includes("currency");
    const hasTotals = cells.some((c) => c.startsWith("total (source)")) || cells.some((c) => c.startsWith("total (usd)"));
    if (hits >= 3 && (hasCurrency || hasTotals)) return true;
  }
  return false;
}

export function classifyParsedDoc(fileId: string, fileName: string, parsed: ParsedDoc, caseYear?: number | null): DocClass {
  const notes: DocNote[] = [];

  if (!parsed.pdf) {
    /* Grids: the questionnaire and a salary schedule are recognised by their
       own captions before the ledger test, because both would otherwise fall
       to "trial balance" and have their answers read as line items. */
    const questionnaire = looksLikeQuestionnaire(parsed.grid);
    const salary = !questionnaire && looksLikeSalarySchedule(parsed.grid);
    const ledger = !questionnaire && !salary && looksLikeLedger(parsed, fileName);
    return {
      fileId, fileName,
      kind: questionnaire ? "client-questionnaire" : salary ? "related-party-salary" : ledger ? "related-party-ledger" : "trial-balance",
      confidence: questionnaire || salary ? 0.95 : ledger ? 0.9 : 0.5,
      method: "rules",
      pages: [{ page: 1, kind: "unknown", score: 0 }],
      statementYear: null,
      entityName: null,
      foreignCorpName: null,
      entityIds: [],
      notes,
    };
  }

  const doc = parsed.pdf;
  const pages = classifyPages(doc);
  const kinds = new Set(pages.map((p) => p.kind));
  const has = (pre: string) => [...kinds].some((k) => k.startsWith(pre));

  let kind: DocKind = "unknown";
  // US-form pages dominate: a prior-year 5471 client copy often staples the
  // old financial statements behind it — those must NOT feed current mapping.
  if (has("us-")) kind = "prior-year-us-return";
  else if (has("fs-")) kind = "cfc-financial-statements";
  else if (has("ato-")) kind = "cfc-tax-return";
  else if (kinds.size === 1 && kinds.has("tandc")) kind = "terms-and-conditions";

  const statementYear = detectStatementYear(doc, pages);
  if (kind === "prior-year-us-return" && caseYear && statementYear === caseYear) {
    notes.push({ level: "warn", message: `${fileName}: a US return for the CURRENT year (${caseYear}) was uploaded — expected a prior-year reference copy.` });
  }

  const fsPages = pages.filter((p) => p.kind.startsWith("fs-") || p.kind.startsWith("ato-")).map((p) => p.page);
  const entityName = mostFrequent(findCompanyNames(doc, fsPages.length ? fsPages : pages.map((p) => p.page)));
  const classified = pages.filter((p) => p.kind !== "unknown").length;
  const blocks5471 = kind === "prior-year-us-return" ? segment5471Blocks(doc, pages) : undefined;

  return {
    fileId, fileName, kind,
    confidence: pages.length ? classified / pages.length : 0,
    method: "rules",
    pages,
    statementYear,
    entityName,
    foreignCorpName: findForeignCorpName(doc),
    entityIds: findEntityIds(doc),
    ...(blocks5471 && blocks5471.length ? { blocks5471 } : {}),
    notes,
  };
}

/* ---------- near-duplicate detection ---------- */

function valueFingerprint(parsed: ParsedDoc, pages: Set<number> | null): Set<number> {
  const out = new Set<number>();
  const add = (raw: string) => {
    // Cells with letters are captions/codes; parsing their digit residue
    // ("Item 8J") pollutes the fingerprint and inflates similarity.
    if (/[A-Za-z]{2,}/.test(raw)) return;
    const n = numeric(raw);
    if (n !== null && Math.abs(n) >= 100) out.add(Math.round(Math.abs(n)));
  };
  if (parsed.pdf && pages) {
    for (const r of parsed.pdf.rows) {
      if (!pages.has(r.page)) continue;
      for (const c of r.cells) add(c.text);
    }
  } else {
    for (const row of parsed.grid) for (const c of row) add(String(c ?? ""));
  }
  return out;
}

/** Pages whose contents actually feed mapping — the comparison surface. */
const feedablePages = (cls: DocClass): Set<number> | null => {
  const pages = new Set(
    cls.pages.filter((p) => p.kind.startsWith("ato-") || p.kind.startsWith("fs-")).map((p) => p.page),
  );
  return pages.size ? pages : null;
};

/** Mark documents that duplicate another's feedable content: the standalone
    AU return vs the client-copy composite, a re-uploaded statements PDF, or
    the same trial-balance workbook twice. The wider document wins. */
export function markDuplicates(classes: DocClass[], parsedByFile: Map<string, ParsedDoc>): void {
  // Prior-year returns are excluded: their figures legitimately overlap the
  // statements' comparative columns, and their feed policy already contains them.
  const candidates = classes.filter((c) =>
    !c.duplicateOf &&
    (c.kind === "cfc-financial-statements" || c.kind === "cfc-tax-return" ||
     c.kind === "trial-balance" || c.kind === "related-party-ledger"));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.duplicateOf || b.duplicateOf) continue;
      if (a.statementYear && b.statementYear && a.statementYear !== b.statementYear) continue;
      const pa = parsedByFile.get(a.fileId);
      const pb = parsedByFile.get(b.fileId);
      if (!pa || !pb) continue;
      // A PDF with no feedable pages has nothing to duplicate — never fall
      // back to fingerprinting its whole text.
      if (pa.pdf && !feedablePages(a)) continue;
      if (pb.pdf && !feedablePages(b)) continue;
      const fa = valueFingerprint(pa, pa.pdf ? feedablePages(a) : null);
      const fb = valueFingerprint(pb, pb.pdf ? feedablePages(b) : null);
      if (fa.size < 5 || fb.size < 5) continue;   // too little data to judge
      let inter = 0;
      for (const v of fa) if (fb.has(v)) inter++;
      const jaccard = inter / (fa.size + fb.size - inter);
      // The smaller fingerprint fully contained in the larger also counts —
      // a standalone return IS a page-range of the composite.
      const containment = inter / Math.min(fa.size, fb.size);
      if (jaccard >= 0.8 || containment >= 0.9) {
        const [keep, dup] = a.pages.length >= b.pages.length ? [a, b] : [b, a];
        dup.duplicateOf = keep.fileId;
        dup.notes.push({
          level: "info",
          message: `${dup.fileName} duplicates the content of ${keep.fileName} — the wider document is used; the duplicate feeds nothing.`,
        });
      }
    }
  }
}

export function deriveCaseYears(classes: DocClass[]): { cy: number | null; py: number | null; dissent: number[] } {
  const votes = new Map<number, number>();
  for (const c of classes) {
    if ((c.kind === "cfc-financial-statements" || c.kind === "cfc-tax-return") && !c.duplicateOf && c.statementYear) {
      votes.set(c.statementYear, (votes.get(c.statementYear) || 0) + 1);
    }
  }
  // The NEWEST voted year is the case year: older statements in the pile are
  // reference material, and majority counting would let two stale copies
  // outvote the current file. Dissenting years are surfaced for review.
  const years = [...votes.keys()].sort((a, b) => b - a);
  const cy = years[0] ?? null;
  return { cy, py: cy ? cy - 1 : null, dissent: years.slice(1) };
}

/* ---------- the feed policy ---------- */

export function feedsForPage(cls: DocClass, pageKind: PageKind): Set<FeedTarget> {
  if (cls.duplicateOf) return new Set<FeedTarget>(["none"]);
  switch (cls.kind) {
    case "cfc-financial-statements":
    case "cfc-tax-return":
      switch (pageKind) {
        case "fs-trading":
        case "fs-pnl": return new Set<FeedTarget>(["generic-is", "profile"]);
        case "fs-balance-sheet": return new Set<FeedTarget>(["generic-bs", "profile"]);
        case "fs-equity": return new Set<FeedTarget>(["equity"]);
        case "fs-cover":
        case "fs-notes": return new Set<FeedTarget>(["profile"]);
        case "ato-return":
        case "ato-calc-statement":
        case "ato-dividend-schedule":
        case "ato-franking": return new Set<FeedTarget>(["targeted-ato"]);
        default: return new Set<FeedTarget>(["none"]);
      }
    case "prior-year-us-return":
      // Only the 5471 family pages describe the CFC; 1120/5472/8992 are the
      // parent's own filings and must feed nothing at all.
      return pageKind.startsWith("us-5471-")
        ? new Set<FeedTarget>(["carry-forward"])
        : new Set<FeedTarget>(["none"]);
    case "related-party-ledger": return new Set<FeedTarget>(["schM-ledger"]);
    case "client-questionnaire": return new Set<FeedTarget>(["profile"]);
    case "related-party-salary": return new Set<FeedTarget>(["schM-ledger"]);
    case "trial-balance": return new Set<FeedTarget>(["generic-is", "generic-bs", "profile"]);
    default: return new Set<FeedTarget>(["none"]);
  }
}

/** Pages of a document allowed to feed the given target. */
export function pagesForFeed(cls: DocClass, feed: FeedTarget): Set<number> {
  const out = new Set<number>();
  for (const p of cls.pages) if (feedsForPage(cls, p.kind).has(feed)) out.add(p.page);
  return out;
}
