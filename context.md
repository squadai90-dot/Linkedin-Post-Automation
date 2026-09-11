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
- `npm run test:all` — the full test chain.

Node 18 or newer. Verified on Node 22.

## Decisions

- `dist/index.html` stays committed and is the reviewed artifact; CI must not
  rebuild it.
- `scripts/serve-local.mjs` resolves `dist/` either as a sibling (unzipped
  bundle layout) or one level up (`scripts/` in the repo), so one script serves
  both layouts.
- Unknown paths fall back to `index.html` for the single-page app; a failure in
  that fallback returns HTTP 500 rather than crashing the process.

## Status

Bundle and single-file delivery verified: unzipped bundle serves the full
3,277,489-byte page on HTTP 200, and deep links fall back correctly.

## Open issues

- `dist/` and `src/` are not in parity; some fixes exist only in `dist/`.
