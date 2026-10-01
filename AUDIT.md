# Unison Content OS — audit report

Date: 1 October 2026 · Commit audited: `737f060` · Auditor: automated review with
every finding reproduced by running the application.

This report says what was inspected, what was found, what was fixed, what was
deliberately left alone, and which tests were actually executed. Where a claim
could not be verified in this environment, it says so instead of implying it.

---

## 1. The publishing system was not touched

This was the first constraint and it was enforced mechanically, not by care.
Every protected file was hashed **before** any change and again **after**:

| File | SHA-256 (first 16) | Changed? |
|---|---|---|
| `src/lib/publish.js` | `1bd9325e2b3f26c3…` | **No** |
| `src/lib/linkedin.js` | `2540793ef6054777…` | **No** |
| `src/lib/linkedinAuth.js` | `496015c26e2f5307…` | **No** |
| `src/lib/media.js` | `c6017abfcefca42d…` | **No** |
| `src/lib/image.js` | `9c26dbeed60e1ae4…` | **No** |
| `api/publish.js` | `fa9d7f81282f4e87…` | **No** |
| `api/linkedin.js` | `7e20a9a46b8b7184…` | **No** |
| `src/App.jsx` | `0b04c60ed9fed149…` | **No** |
| `tests/publish-contract.test.js` | `aafbca7cbe7fc64b…` | **No** |
| `make/README.md` | `660e748f5dc8fcb0…` | **No** |

Both hash sets are identical, and `git diff` over those paths is empty. The
publishing contract test (8 assertions on payload fields, poll shape, webhook,
organisation URN, media budget and poll limits) passed before and after.

**How Canva reaches LinkedIn without changing anything.** A finished design is
turned into an ordinary `File` and passed to the existing `attachUpload`. That
sets `assets.upload`, which makes `collectMedia` return early exactly as it
already did for a file the user picked from disk. No new publishing route, no
altered payload, no second implementation.

### One real bug that was NOT fixed, because the fix is in a protected file

**`src/lib/media.js:302` cuts headlines mid-word.**

```js
headline: (ctx.hook || "").slice(0, 60)
```

A raw character cut. With the topic *"Audit turnaround fell 38% after we moved
first-pass prep offshore"*, every branded image renders **"…after we moved fi"**.
The project already has `clip()` in `src/lib/visual.js`, which cuts at a
sentence, clause or word boundary and strips a dangling word — this one line
bypasses it.

- **Severity:** High. It is visible on every generated image, not only in the
  new design panel, which is simply where it became obvious.
- **The fix is one line:** `headline: clip(ctx.hook || "", 60)`.
- **Not applied.** `src/lib/media.js` is on the protected list. Per the brief,
  it is documented rather than changed. It needs your go-ahead.

---

## 2. What was inspected

| Area | How |
|---|---|
| Structure, imports, dependencies | Every relative import in `src/` and `api/` resolved programmatically |
| API routes | Frontend call sites compared against the files in `api/` |
| Environment variables | Every `process.env.*` read by `api/` compared against `.env.example` |
| UI, desktop | All 6 views and all 6 Settings tabs driven in Chromium at 1440×900 |
| UI, mobile | The same at 393×851, including the burger menu and the composer |
| AI text | Generation run with no key, confirming the labelled fallback path |
| Image | Panel, render, style picker, AI button state, download, upload |
| Video | Storyboard, scene list, encoder, export, design panel |
| Poll | Question and options generated from the post, limits displayed |
| Canva | OAuth round trip, template listing, dataset, autofill, export, download |
| Draft persistence | Full page reload, draft compared character by character |
| Backend | Method guards, health checks, token gate, error shape, every `fetch()` traced to its source |
| Security | Source, build output and browser storage scanned for credentials |

---

## 3. Findings

### Fixed

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **High** | **No way back from Canva's editor.** "Open in Canva" let the user edit a design, but the only way to produce a file was autofill→export, which rebuilds the design from Unison's fields and silently discards everything done in Canva. | Added **"Bring back my Canva edits"**, which exports the existing design by id without re-running autofill. Covered by an e2e test asserting autofill runs once while export runs twice on the same design id. |
| 2 | **Medium** | **Broken sentences shown to users.** Reasons were assembled by dropping a category label into `It is a ___ post.`, producing *"It is a how something works post."*, *"It is a what we offer post."* and *"It is a event or webinar post"* (wrong article). The two fallbacks had the same fault: *"A numbered steps suits this post."* | Each pillar and each layout now has its own written sentence. A test drives six posts across six pillars and rejects the label-jamming shapes and any `a` before a vowel. |
| 3 | **Medium** | **The preview stated a size it did not produce.** It printed `1200 × 627 (landscape) or square` — the shapes it *accepts* — beside a file that is actually 1200 × 630, and beside Canva exports of unknown size. | The file is now measured and its own dimensions reported. Byte size is computed from the base64 payload instead of estimated. |
| 4 | **Medium** | **A dropped Canva session surfaced mid-render.** `refreshConnection()` existed and was never called, so a session the relay had lost was discovered halfway through a long operation. | Called when the design panel mounts, so "connect again" is said up front. |
| 5 | **Medium** | **Ten backend environment variables were undocumented**, including `MAKE_LINKEDIN_WEBHOOK_URL`, every `*_TIMEOUT_MS`, `GOOGLE_IMAGE_USD`, `RUNWAY_VIDEO_MODEL` and `RUNWAY_API_VERSION`. | All added to `.env.example` with explanations. A re-check confirms nothing `api/` reads is now undocumented. |
| 6 | **Medium (security)** | **The Google API key was appended to a URL taken from a provider response.** `api/video.js` read the download address out of Google's job result and attached `key=…` to it without checking the host. | The host is verified as `*.googleapis.com` over HTTPS before the key is attached. Two tests: one proves a non-Google address is refused with no download attempted, one proves the normal path still works and the key never returns to the browser. |
| 7 | **Low** | Dead export `isConnected()`, duplicating `connectionState()`. | Removed. |

### Found and deliberately not changed

| # | Severity | Finding | Why not |
|---|---|---|---|
| 8 | **High** | `src/lib/media.js:302` cuts headlines mid-word (section 1). | Protected file. One-line fix supplied; awaiting your approval. |
| 9 | **High (security)** | **A LinkedIn access token is persisted in `localStorage`** under `unison:linkedin:v1` (`src/lib/linkedinAuth.js:73`). Any script running on the page origin, or anyone with the browser profile, can read it. | `linkedinAuth.js` is protected. Fixing it properly means moving the token server-side, which is a change to the authentication flow. |
| 10 | **Medium (security)** | **The Make webhook URL is persisted in `localStorage`** under `unison:publish:v1` when it differs from the default. Whoever holds that URL can post to the company page. | `src/lib/publish.js` is protected. `MAKE_LINKEDIN_WEBHOOK_URL` on the server already avoids this and is now documented. |
| 11 | **Medium (by design)** | **The AI API key is in `localStorage`** under `unison:ai:v1`, and `VITE_GROQ_API_KEY` is inlined into any build made with it. | Accepted, documented trade-off for a frontend-only app. `api/ai.js` is the secure alternative. Unchanged, restated in the README. |

### Checked and found sound

- Every relative import resolves. No missing files, no broken paths.
- All 7 frontend `/api/*` calls have a matching file in `api/`; none is orphaned.
- No `TODO`, `FIXME` or stub left in shipped source.
- No button with an empty handler; no dead navigation.
- No `console.log` in shipped source except one gated on `MAKE_CONFIG.debug`.
- No horizontal overflow on any view at 1440×900 or 393×851.
- Mobile navigation works through the burger menu; the composer is reachable.
- Draft persistence restores a draft **identically** after a full reload.
- No runtime or console errors in any view, on either viewport.
- Every documented path and npm script in the README exists.
- Only `api/canva.js` lets a client name a URL, and it is host-locked to
  `canva.com` over HTTPS — verified with four hostile inputs including
  `canva.com.evil.test`.
- No credential of any kind in tracked source, the build output, or
  `unison-content-os.html`.

### A note on the brief's wording

The protected list mentions *multi-image, document, article and carousel*
publishing. Those four post types were **removed from the product in an earlier
session at your explicit request** ("I do not want partially working post types
anymore"). Unison offers **Text, Image, Video and Poll**. Nothing was re-added;
this is flagged only so the list and the product are not assumed to disagree by
accident.

---

## 4. Test results

Every line below was executed in this environment. Nothing is reported as
passing that was not run.

| Test | Result |
|---|---|
| Clean install from `package-lock.json` (`npm ci`) | **Pass** |
| Lint (`npm run lint`) | **Pass** — 0 errors, 4 pre-existing warnings |
| Unit and integration (`npm test`) | **Pass** — 507 tests, 22 files |
| Publishing contract | **Pass** — 8/8, file byte-identical |
| Relay tests, including the new host lock | **Pass** — 60 tests |
| Production build | **Pass** |
| End-to-end, desktop and mobile | **Pass** — 59 run, 59 skipped (mobile-exempt by design) |
| Canva workflow end-to-end | **Pass** — 7 cases in a real browser |

Counts before this audit: 503 unit tests. After: **507** — four added, covering
the corrected sentences, every layout having its own, and the two video
download-host cases.

### What could NOT be tested, and why

These are integration points that need credentials or network access this
environment does not have. The code is in place; it is not claimed to work.

| Not tested | Why |
|---|---|
| A live Canva call | `api.canva.com` and `www.canva.com` are denied by this environment's network policy. Every Canva test runs against a mocked Canva. |
| A live OpenAI or Google image generation | No key supplied; `api.openai.com` is denied. |
| A live Google Veo or Runway video generation | Same. |
| A live Groq completion | `api.groq.com` is denied. The Groq path is tested with the provider intercepted. |
| A real LinkedIn publish | Deliberately not run. Publishing to the live company page is not something to do as part of an audit. |
| H.264 recording in the browser | This container's Chromium cannot record H.264, so the MP4 branch of the encoder is covered by its codec list rather than by recording one. |

**Mocked vs live, stated plainly:** every provider test in this project is a
mocked test. They prove what this repository is responsible for — the request
shape, that keys stay server-side, that a client cannot steer the upstream call,
and that failures become readable messages. They do **not** prove that the
provider accepts the request. That needs one live run with a real key.

---

## 5. Canva: what works, what needs a paid plan, what is impossible

| Capability | Status |
|---|---|
| OAuth 2.0 with PKCE, tokens held server-side | Implemented. The browser receives an opaque session id and no token. |
| List the account's brand templates | Implemented (`GET /v1/brand-templates`). |
| Read a template's autofill fields | Implemented. |
| Fill text fields | Implemented. |
| Fill image and logo fields | Implemented, via asset upload first. |
| Export PNG | Implemented. |
| Export MP4 | Implemented at 1080p horizontal, so a video needs a **16:9** template. Anything else is marked unavailable rather than cropped. |
| Return from Canva's editor with your edits | **Implemented in this pass** — "Bring back my Canva edits". |
| Search Canva's public template library | **No API exists.** Only the connected account's own templates are reachable. Everything else offered is a Unison layout, labelled as one. |
| Change colours, fonts, backgrounds, scenes, transitions, timing | **No API exists.** These belong to the brand template. The panel says so and links to Canva. |
| Generate original footage from a prompt | **Not a Canva capability.** Nothing in the integration suggests it is. |

**Plan requirement.** Brand templates and autofill are **Canva Enterprise**
features; other paid plans get a limited trial while an integration is still in
development. On an account without either, Canva answers 403 and Unison shows
Canva's own words — tested.

**Still required from you:** a Canva integration at
<https://www.canva.com/developers/integrations>, its client ID and secret, a
redirect URL matching your deployment, and a backend running `api/canva.js`.
OAuth cannot be done from a page opened off your desktop.

---

## 6. Security review

| Check | Result |
|---|---|
| Credentials in tracked source | **None.** The only match is a deliberate fake in a test that asserts non-leakage. |
| Credentials in the build output or the standalone HTML | **None.** |
| Canva client secret | Posted once to your own backend, held in memory there, never stored in the browser. No route returns it. |
| Canva OAuth tokens | Server-side only. There is no route that returns one, by design. |
| Canva session handle | Kept in a module variable, written to **no** browser storage. Verified in a real browser. |
| PKCE verifier | Generated and kept server-side; never in a response or a URL. |
| Relay as an open proxy | Only `api/canva.js` accepts a client URL, host-locked to `canva.com` over HTTPS. |
| Google API key on downloads | **Fixed this pass** — host checked before the key is attached. |
| Browser-side configuration of a deployed relay | Refused unless `UNISON_RELAY_TOKEN` is set, so a public instance cannot be pointed at someone else's Canva integration. |
| Server-side validation | Every relay validates method, action and inputs, and returns structured JSON errors. |
| Upload handling | Canva asset upload validates base64 and caps at 25 MB. |
| LinkedIn access token in `localStorage` | **Open finding #9** — protected file. |
| Make webhook URL in `localStorage` | **Open finding #10** — protected file. |
| AI key in `localStorage` | Documented trade-off; `api/ai.js` is the secure alternative. |
