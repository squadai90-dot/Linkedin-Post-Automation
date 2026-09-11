# Form 5471 Work Paper

Populates a Form 5471 master workbook from client documents, entirely in the browser.

The tool reads trial balances and statutory accounts, maps their captions onto the
work paper's schedule lines, and writes the values into **your** master template —
preserving all 19 sheets, every formula, the styling and the hidden tabs. It does not
create a new output format, and it never computes a US-dollar figure: the template's
own formulas do that from the three exchange rates the tool supplies.

Everything runs client-side. Documents are parsed in the browser and are never uploaded.

---

## Quick start

```bash
npm install
npm start          # serves the committed dist/ on localhost
```

No install, no network? `npm start:local` (or `node scripts/serve-local.mjs`)
serves the same committed `dist/` on <http://localhost:8080> using nothing but
Node's standard library — no `npm install`, no `npx` download. Pass a port to
change it: `node scripts/serve-local.mjs 3000`.

> **Serve over HTTPS (or localhost).** Browsers block the tool's network calls
> and IndexedDB persistence from `file://` — do not open `index.html` directly.
>
> **Note on builds:** `npm run build` is intentionally a no-op. The shipped
> application is the *committed* `dist/index.html` — every fix is applied to it
> directly (see `PROJECT-NOTES.md`). `npm run build:app` would regenerate it
> from the older `src/` tree and **must not be run** unless you are porting the
> fixes back to source first.

**2026-08-21:** the app degrades gracefully when no backend is reachable
(Task management shows a friendly notice on both 404 and SPA-fallback hosts —
never a blank screen); generate buttons live only in Executive overview,
Workpaper preview, Entity workspace and Sign-off, and the Overview button
becomes **Preview format** (downloads the blank master template) until
something is processed; the full OCR panel appears only on an entity's
Documents tab (elsewhere a compact `⚠ OCR — verify` badge marks OCR-sourced
values, and Settings carries one OCR card at the bottom of Free services);
re-processing treats the **current** document set as the single source of
truth — auto-detected data from removed documents is pruned (hand-typed
values, sign-offs and saved mappings survive), and removing a file resets the
entity to "needs processing". `npm run test:all` — 7 suites, 29 layer test
groups.

`dist/index.html` is the entire application — one self-contained file with the master
template, the exchange-rate tables and all code inlined. Drop it on any static host
(HTTPS) or serve it locally.

---

## What it does

| | |
|---|---|
| **Reads** | `.xlsx` `.xlsm` `.csv` `.tsv` `.txt` and **text-layer PDFs** |
| **Maps** | 50+ multilingual keyword rules (growing as you assign captions), then an automatic AI pass |
| **Detects** | Legal name, address, country, formation date, currency, ownership, categories |
| **Rates** | IRS yearly averages (2017–2025) and US Treasury 12/31 spot rates, 151 currencies |
| **Validates** | Refuses to generate while an exchange rate is missing |
| **Writes** | Only designated input cells; flags the workbook to recalculate on open |
| **Records** | A full audit trail, exportable as JSON |
| **Reviews** | Editable mappings and exceptions, policy-driven levelling, task board |

Multiple entities are supported. Each keeps its own documents and produces its own
workbook — Form 5471 is filed per foreign corporation, so nothing is consolidated.

### PDF extraction

PDFs are parsed by pdf.js, bundled and inlined at build time — no CDN, no separate
worker file, no network access; the worker runs on the main thread. Glyph positions
are reconstructed into rows and columns, so the existing mapping engine works on
PDFs unchanged.

A dependency-free fallback parser (the browser's own `DecompressionStream` for
FlateDecode) is kept for producers pdf.js rejects. It handles compressed object
streams, text inside Form XObjects, and Identity-H CID fonts with no ToUnicode map
(recovering characters by inverting the embedded TrueType `cmap` table).

Scanned PDFs have no text layer; the tool reports that plainly and offers the
in-browser OCR card (Tesseract.js, on Document intake) to build a searchable copy.

### Review workflow

Every caption can be re-bound to a different template line from **Mapping &
adjustments** (or sent back to the review queue) — the decision persists and
survives re-processing. Exceptions in the **Exception center** can be signed
off, or **edited and resubmitted**: the linked workbook cell takes the
reviewer's number and the audit trail records old → new. **Settings ▸
Policies** holds ordered rules that decide each exception's level (or
suppress it); suppressing a blocking exception is a standing acknowledgement
and is logged on every generation. The **Multilingual evidence** table leads
with the current-year value and keeps the full multi-year figures as audit
subtext.

---

## Backend (optional)

The standalone `dist/index.html` needs no backend. Add one and the app gains
persistence (state, documents, sign-offs survive reloads and machines), the
**Task management** board (pending → in progress → completed, auto-advancing
as workpapers are processed and generated), and shared policies.

```bash
npm run build:server     # builds dist-server/server.cjs (dist/ is already committed)
DATABASE_URL=postgres://… node dist-server/server.cjs
```

> **The backend has no authentication and no tenant isolation** — every
> connected browser shares one workspace and `GET /api/workpapers` lists
> everything. Run it only on a private network for a single team. Do not
> expose it publicly until auth lands.

One service serves both the API and the app (default port 8471). Env:
`DATABASE_URL` (Postgres), optional `PORT`, `MAX_UPLOAD_MB` (default 25),
`CORS_ORIGINS` (only for split hosting). SQL migrations in
`server/migrations/` run at boot.

**Railway**: create a project with a Postgres plugin, set the build command
to `npm ci && npm run build:server` and the start command to `npm run start:server`,
and reference the plugin's `DATABASE_URL`. A static Netlify/Pages build can
attach to it via Settings ▸ Tool configuration ▸ Backend URL.

**Sign-in is deliberately absent for now** — one shared workspace, task
assignees are plain names. The schema and the auth seam are ready for
Microsoft Entra ID: registering a *Web* app (redirect
`https://<host>/api/auth/oidc/callback`) and adding the OIDC routes turns on
per-user isolation without restructuring.

---

## What it does not calculate

By design, and for three different reasons.

**Arithmetic that belongs to the template** — USD columns, subtotals, cross-schedule
links, rounding. One source of truth; if the tool also computed these, two answers
could exist for the same cell.

**Judgment** — filer category, book-to-tax adjustments, E&P, Subpart F and GILTI,
foreign tax credit, previously taxed E&P, functional currency determination.

**Data the documents don't contain** — prior-year carryovers, and text in scanned
images until you run them through the OCR card. (Fiscal / non-calendar year ends now
get OFX daily rates over the actual period.)

`docs/5471-workpaper-user-guide.docx` covers the concepts, but **predates the current UI** (tab numbering and stage counts have changed) — the in-app copy is authoritative.

---

## Where data lands in the template

| Content | Cells |
|---|---|
| Client, entity, addresses, activity, currency | `Basic Information` B1:B4, B11:B27 |
| Ownership facts | `Basic Information` C33:C40 |
| Filing categories 1a–5c | `Basic Information` B42:B50 |
| Exchange rates | `Basic Information` C59:C61 |
| Income statement, local currency | `Income Statement` F7:F59 |
| Balance sheet, local currency | `Balance Sheet` D10:D62 and F10:F62 |

Plus a generated **Provenance** sheet listing every AI-placed figure and every
exchange rate with its source. Nothing else is touched.

---

## Optional services

None are required; all are keyless except Groq.

| Provider | Use | Free allowance |
|---|---|---|
| MyMemory | Translation | 5,000 characters/day |
| Lingva | Translation fallback | none published |
| OFX | Historical daily FX — period averages and last-published-on-or-before date lookups (10-day search), tried first | none published |
| Frankfurter (ECB) | Historical FX, after OFX | none published |
| ExchangeRate-API | Live FX, latest only | none published |
| Groq | Translation and automatic mapping of leftover captions | your own API key |

Keys are entered by the user at runtime and are never bundled into the build.

When a Groq API key is present, processing ends with an automatic AI pass that maps
leftover trial-balance captions to schedule lines and unrecognised entity-particular
captions (e.g. "company formation date") to profile fields, each with a model-reported
confidence. It runs in one pass: anything unresolved on the first attempt is re-asked
with its amounts, year tags and source document, and everything the model can place is
booked — low-confidence results are booked *and* raised as review exceptions to verify,
rather than handed back for a second manual AI round. Only captions the model rejects
twice (subtotals, totals, non-financial rows) and rows with no unambiguous current-year
figure return for manual assignment. Settings ▸ AI platform ▸ "Automatic AI mapping"
turns this off. Without a key the pass is skipped silently and the tool remains fully
offline.

Exchange rates follow a fixed chain: (1) the bundled IRS yearly-average / US Treasury
12/31 tables; (2) OFX daily data — a period average for C59 and the last daily rate published on or
before the requested date (searching back 10 days) for C60/C61 and dividend payment dates, always
labelled with the resolved date; (3) the other configured live providers; (4) manual
entry. Every rate displays its source (IRS / Treasury / OFX / ECB / Manual) throughout
the app. Fiscal-year entities skip the calendar tables but do receive the OFX steps
over their actual fiscal period, flagged for review.

(HTTPS reminder moved to Quick start.)

---

## Project layout

```
assets/master-template.xlsx     the Form 5471 master workbook, inlined at build time
scripts/build.mjs               bundles and inlines everything into dist/index.html
src/entry.tsx                   mounts the app
src/prototype/Shell.tsx         navigation shell (16 tabs; src/ is behind dist — see PROJECT-NOTES.md)
src/prototype/PrototypeApp.tsx  view routing
src/prototype/wp/
  store.ts                      state, actions, validation, generation
  engine.ts                     template cell map, mapping rules, spreadsheet reader
  pdfText.ts                    PDF text extraction
  detectProfile.ts              entity-detail detection
  fxRates.ts                    IRS and Treasury rate tables
  providers.ts                  translation and live-rate providers
  xlsxPatch.ts                  template-preserving OOXML cell writer
src/styles/                     base and application stylesheets
docs/                           user guide
```

### Replacing the master template

Drop your own workbook at `assets/master-template.xlsx` and rebuild. If its layout
differs, update the cell coordinates in `src/prototype/wp/engine.ts` — they are
declared in one place at the top of the file.

---

## Deploying

Any static host. `dist/` is the publish directory.

- **Netlify** — drag `dist/` onto <https://app.netlify.com/drop>, or connect the repo (`netlify.toml` included)
- **Vercel** — import the repo (`vercel.json` included)
- **GitHub Pages** — commit `dist/` and serve from the branch, or use an Actions workflow

---

## Notes

- Work persists in this browser (IndexedDB) and restores when you reopen the page.
- Deep links work: `?view=fx`, `?view=entities`.
- Eleven `#DIV/0!` cells on Schedule E and Entity Structure exist in the master
  template before the tool touches it; they divide by inputs a preparer supplies.
