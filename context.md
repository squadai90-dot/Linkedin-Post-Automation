# context.md

Persistent memory for this project. Read before any change; update after any
meaningful change. See `CLAUDE.md` for the rule.

## Project

Form 5471 work paper (`form-5471-workpaper`, v2.1.0). Populates a Form 5471
master workbook from client documents entirely in the browser. No backend is
required to use the app.

Mirror of `jaynilagrawal1103-lang/5471-work-paper`. Work branch:
`claude/funny-keller-xiwwbz`.

## Layout

- `dist/index.html` — the shipped app, one self-contained ~3.2 MB file, no
  external scripts or stylesheets. It is committed as reviewed.
- `src/`, `layer-src/` — sources. Some session fixes live in `dist/` only and
  are not yet ported back to `src/`. See `PROJECT-NOTES.md`.
- `server/` — optional Fastify server plus an AI proxy. Not needed to run the app.
- `scripts/` — build, bundle, and local-serve scripts.
- `tests/` — plain `node` `.cjs` tests, one npm script each.

## Commands

- `npm run start:local` — serve `dist/` on http://localhost:8080, Node stdlib
  only, no install and no network. Optional port argument.
- `npm run bundle` — write `dist-bundle/5471-work-paper-local.zip`: `dist/`, the
  server, `start.sh`, `start.cmd`, `README.txt`. `dist-bundle/` is gitignored.
- `npm run build` — intentionally a no-op that keeps the reviewed `dist/`. Use
  `build:full-DESTRUCTIVE` only after porting fixes to `src/`.
- `npm run test:all` — the full test chain (49 suites, 1,275 assertions).
  Needs `npm i` first, and `npm run build:server` once (test:aikey reads
  `dist-server/server.cjs`).

Node 18 or newer. Verified on Node 22.

## Decisions

- Every engine rule lands in BOTH trees: `src/prototype/wp/*` and a surgical
  patch to `dist/index.html` (EN9-prefixed identifiers, paired
  `/*EN9NAME-BEGIN*/…/*EN9NAME-END*/` sentinels, anchored on unique minified
  strings). Ten suites eval those regions, so never run `npm run build:app`
  or `build:full-DESTRUCTIVE` — esbuild strips the sentinels.
- A dist patch must be valid in its syntactic context: the `autoFillRates`
  rate block is a comma expression, so a `var` declaration there breaks the
  whole bundle. Check with `npx esbuild` on the extracted script (lines
  449-1091) before running the suite.
- Mapping rules live in `DEFAULT_RULES` (engine.ts) and the identical `P1`
  literal in dist; regenerate the dist literal from src rather than editing
  it by hand, escaping non-ASCII as uppercase `\uXXXX` as esbuild does.

- `dist/index.html` stays committed and is the reviewed artifact; CI must not
  rebuild it.
- `scripts/serve-local.mjs` resolves `dist/` either as a sibling (unzipped
  bundle layout) or one level up (`scripts/` in the repo), so one script serves
  both layouts.
- Unknown paths fall back to `index.html` for the single-page app; a failure in
  that fallback returns HTTP 500 rather than crashing the process.

## Status

The reconciliation test's 19 findings are implemented in both trees — see the
2026-09-11 section of `PROJECT-NOTES.md` for what each one was and where it
lives. `npm run test:all` is green, and every new rule was also exercised
against the booted shipped bundle, not only against source.

Bundle and single-file delivery verified: the unzipped bundle serves the full
page on HTTP 200, and deep links fall back correctly.

## Open issues

- `dist/` and `src/` are not in parity; some fixes exist only in `dist/` (the
  OCR engine, the tie-out/Schedule E helpers, the C35 answer from the prior
  return's Item H boxes). See PROJECT-NOTES.md.
- Schedule Q fills tested-income unit 1 only; a corporation with more than one
  tested unit needs the rest by hand.
