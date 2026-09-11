# Form 5471 Work Paper — User Guide

> **Status: interim.** This Markdown guide replaces
> `5471-workpaper-user-guide.docx`, which predates the current UI and contains
> statements that are no longer true. The facts below are verified against the
> shipped app by `scripts/check-guide.mjs` (run in `npm run test:all`), so this
> file cannot silently drift. A full illustrated regeneration is planned; until
> then the in-app copy remains authoritative for anything not covered here.

## What the tool is

The tool populates **your** Form 5471 master workbook from client documents —
trial balances and statutory accounts — entirely in the browser. It maps each
caption onto the work paper's schedule lines, writes local-currency values into
the designated input cells only, and supplies the three exchange rates. The
template's own formulas compute every US-dollar figure.

## Navigation

The app has **16 tabs**: Executive overview, Task management, Portfolio
dashboard, Entities & documents, Entity workspace, Document intake,
Multilingual evidence, Ownership & category, Mapping & adjustments, FX policy &
rates, Workpaper preview, Workpaper readiness, Exception center, Audit trail,
Review & sign-off, and Settings.

## Documents

- Reads `.xlsx` `.xlsm` `.csv` `.tsv` `.txt` and text-layer PDFs.
- **PDFs are parsed locally, in the browser** (pdf.js, bundled — no CDN, no
  upload). Scanned PDFs have no text layer; the OCR card on Document intake
  builds a searchable copy, also locally.
- A byte-identical re-upload of a document already attached to the entity is
  refused, because booking the same file twice would double every figure.
- Re-processing an entity asks for confirmation when results already exist.
  Your dismissed exceptions (sign-offs) are preserved; hand-typed schedule
  values are replaced by freshly extracted figures.

## Mapping

Processing runs multilingual keyword rules first, then — when a Groq API key
is present in Settings ▸ AI platform — one automatic AI pass over everything
the rules left behind (models: `openai/gpt-oss-120b`, falling back to
`openai/gpt-oss-20b`). Low-confidence AI results are booked **and** raised as
review exceptions; only captions the model rejects twice come back for manual
assignment. Structural subtotal/total rows detected in PDFs are dropped before
mapping so they are never double-booked.

## Exchange rates

Rates follow a fixed chain: bundled IRS yearly-average and US Treasury 12/31
tables first, then OFX daily data — a period average for the average rate, and
for date-pinned rates **the last rate published on or before the requested
date (10-day search)** — then the other configured live providers, then manual
entry. Every rate shows its source (IRS / Treasury / OFX / ECB / Manual)
throughout the app.

## Generation blockers

Generation is refused while:

1. any of the three exchange rates is missing, or
2. the balance sheet **does not balance** (assets vs liabilities + equity, per
   column). The balance block appears in the Exception center and **can be
   dismissed with a note** by the preparer — the acknowledgement is recorded in
   the audit trail and the workbook's Provenance sheet.

## Output

The generated workbook is your master template — all sheets, formulas, styling
and hidden tabs preserved — plus a **Provenance** sheet listing every value the
tool wrote (source document, rule or AI, confidence) and every exchange rate
with its source and date.
