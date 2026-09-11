/* Related-party invoice ledger ("Expenses by Contact" export).

   Summarizes the counterparty's spend with the entity: functional-currency
   invoices and credit notes net into the Schedule M services figure; USD
   "Cash Paid" rows are surfaced for review and NEVER become balance-sheet
   writes (the class of bug that once put US$47,418 into the cash line).
   Returns plain facts; the store materializes writes and review items. */

import { numeric } from "./engine";

export type LedgerRow = {
  date: string;                    // "1/16/24"
  details: string;
  reference: string;
  currency: string;
  source: number | null;           // functional-currency amount
  usd: number | null;
};

export type LedgerSummary = {
  counterparty: string | null;
  subjectEntity: string | null;    // whose ledger this is about (title row)
  currency: string | null;         // dominant non-USD currency
  invoicesFunctional: number;      // invoices + credit notes, functional ccy
  invoiceCount: number;
  creditNoteCount: number;
  cashPaidUSD: { date: string; amount: number }[];
  ledgerTotalUSD: number | null;   // the file's own grand total, if present
  rows: LedgerRow[];
  warnings: string[];
};

/** Excel serial date → "m/d/yy". */
export function serialToDate(n: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
}

const HEADERS = ["date", "details", "reference", "currency"];

export function summarizeLedger(grid: string[][], fileName: string): LedgerSummary | null {
  // Locate the header row and map columns by name, not position.
  let headerIdx = -1;
  const colOf: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const cells = grid[i].map((c) => String(c || "").toLowerCase().trim());
    const hits = HEADERS.filter((h) => cells.includes(h)).length;
    if (hits >= 3) {
      headerIdx = i;
      cells.forEach((c, idx) => {
        if (c === "date") colOf.date = idx;
        else if (c === "details") colOf.details = idx;
        else if (c === "reference") colOf.reference = idx;
        else if (c === "currency") colOf.currency = idx;
        else if (/^total \(source\)/.test(c)) colOf.source = idx;
        else if (/^total \(usd\)/.test(c) || c === "total") colOf.usd = idx;
      });
      break;
    }
  }
  if (headerIdx < 0) return null;

  const out: LedgerSummary = {
    counterparty: null,
    subjectEntity: null,
    currency: null,
    invoicesFunctional: 0,
    invoiceCount: 0,
    creditNoteCount: 0,
    cashPaidUSD: [],
    ledgerTotalUSD: null,
    rows: [],
    warnings: [],
  };

  // Title block: "Expenses by Contact - <subject>" then the counterparty name.
  for (const row of grid.slice(0, headerIdx)) {
    const t = row.map((c) => String(c || "")).join(" ").trim();
    if (!t) continue;
    const m = /expenses? by contact\s*[-–]\s*(.+)$/i.exec(t);
    if (m) out.subjectEntity = m[1].trim();
    else if (!out.counterparty && /[A-Za-z]{3}/.test(t) && !/for the period|expenses? by contact/i.test(t)) {
      out.counterparty = t;
    }
  }

  const ccyCounts = new Map<string, number>();
  for (const row of grid.slice(headerIdx + 1)) {
    const cell = (i: number | undefined) => (i === undefined ? "" : String(row[i] ?? "").trim());
    const details = cell(colOf.details);
    const dateRaw = cell(colOf.date);
    if (/^total/i.test(details) || (/^total/i.test(dateRaw) && !details)) {
      out.ledgerTotalUSD = numeric(cell(colOf.usd));
      continue;
    }
    if (!details && !dateRaw) continue;

    const serial = numeric(dateRaw);
    const date = serial !== null && serial > 20000 && serial < 80000 ? serialToDate(serial) : dateRaw;
    const currency = cell(colOf.currency).toUpperCase();
    let source = numeric(cell(colOf.source));
    const usd = numeric(cell(colOf.usd));

    // Belt for extractors that drop a credit note's minus sign.
    if (/credit note/i.test(details) && source !== null && source > 0) {
      source = -source;
      out.warnings.push(`Credit note ${cell(colOf.reference)} arrived positive — sign restored.`);
    }

    const r: LedgerRow = { date, details, reference: cell(colOf.reference), currency, source, usd };
    out.rows.push(r);

    if (/cash paid/i.test(details)) {
      if (usd !== null) out.cashPaidUSD.push({ date, amount: usd });
      continue;                     // never a mapped amount, review-only
    }
    if (/invoice|credit note/i.test(details) && currency && currency !== "USD" && source !== null) {
      out.invoicesFunctional += source;
      if (/credit note/i.test(details)) out.creditNoteCount++;
      else out.invoiceCount++;
      ccyCounts.set(currency, (ccyCounts.get(currency) || 0) + 1);
    }
  }

  let best: string | null = null;
  let n = 0;
  for (const [c, v] of ccyCounts) if (v > n) { best = c; n = v; }
  out.currency = best;
  out.invoicesFunctional = Math.round(out.invoicesFunctional * 100) / 100;
  if (!out.rows.length) out.warnings.push(`${fileName}: ledger header found but no data rows parsed.`);
  return out;
}

/* ---------- a related party's salary schedule ----------

   A one-page document listing what the corporation paid one person, month by
   month, with a total: "January 2024 – KYD $2,500.00 … Year end bonus – KYD
   $20,000.00 / Total: KYD $72,067.40". When the person is the US shareholder
   (or a relative) it is a Schedule M transaction — compensation PAID — and the
   total will match a P&L wage caption to the cent, which is how the two are
   tied together. Read as printed; nothing is inferred beyond the arithmetic. */

export type SalarySchedule = {
  fileName: string;
  /** The heading's subject ("W. Justin Thompson – 2024 Salary" → the name). */
  person: string | null;
  currency: string | null;
  lines: { label: string; amount: number }[];
  /** The document's own total, when it prints one. */
  statedTotal: number | null;
  /** Sum of the lines — compared against statedTotal, never substituted. */
  sumOfLines: number;
  warnings: string[];
};

const MONTH_LINE = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;
const AMOUNT_TAIL = /([A-Z]{3})?\s*\$?\s*(-?\(?[\d.,]+\)?)\s*$/;

/** Six or more month lines carrying amounts, and a total. */
export function looksLikeSalarySchedule(grid: string[][]): boolean {
  const lines = grid.map((r) => r.map((c) => String(c ?? "").trim()).filter(Boolean).join(" ")).filter(Boolean);
  const months = lines.filter((l) => MONTH_LINE.test(l) && AMOUNT_TAIL.test(l) && numeric((AMOUNT_TAIL.exec(l) || [])[2] || "") !== null).length;
  const total = lines.some((l) => /^total\b/i.test(l));
  const salary = lines.some((l) => /salary|wages|remuneration|payroll/i.test(l));
  return months >= 6 && total && salary;
}

export function summarizeSalary(grid: string[][], fileName: string): SalarySchedule | null {
  if (!looksLikeSalarySchedule(grid)) return null;
  const out: SalarySchedule = { fileName, person: null, currency: null, lines: [], statedTotal: null, sumOfLines: 0, warnings: [] };
  const text = grid.map((r) => r.map((c) => String(c ?? "").trim()).filter(Boolean).join(" ")).filter(Boolean);
  const currencies = new Map<string, number>();
  for (const line of text) {
    // "W. Justin Thompson – 2024 Salary": the heading names the person.
    if (!out.person && /salary|wages|remuneration/i.test(line) && !AMOUNT_TAIL.test(line.replace(/\b(19|20)\d{2}\b/g, ""))) {
      out.person = line.replace(/\s*[–—-]\s*(19|20)?\d{0,4}\s*(salary|wages|remuneration).*$/i, "").trim() || null;
      continue;
    }
    const m = AMOUNT_TAIL.exec(line);
    if (!m) continue;
    const amount = numeric(m[2]);
    if (amount === null) continue;
    if (m[1]) currencies.set(m[1].toUpperCase(), (currencies.get(m[1].toUpperCase()) || 0) + 1);
    const label = line.slice(0, m.index).replace(/[\s–—:-]+$/, "").trim();
    if (/^total\b/i.test(label)) { out.statedTotal = amount; continue; }
    out.lines.push({ label, amount });
  }
  out.sumOfLines = Math.round(out.lines.reduce((n, l) => n + l.amount, 0) * 100) / 100;
  if (currencies.size) out.currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (currencies.size > 1) out.warnings.push(`more than one currency on the schedule: ${[...currencies.keys()].join(", ")}`);
  if (out.statedTotal !== null && Math.abs(out.statedTotal - out.sumOfLines) > 0.01) {
    out.warnings.push(`the lines sum to ${out.sumOfLines} but the schedule states ${out.statedTotal}`);
  }
  return out;
}

