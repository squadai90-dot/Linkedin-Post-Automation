# Unison Content OS — production audit (Vercel + Canva)

Date: 1 October 2026 · Starting point: `e3ee0e6` (the previous audited release)
· This round: commit `0e81151` plus the commit that adds this report.

This report covers the deployed app's real failures — AI not working on
Vercel, festival posts coming out as B2B content, placeholder research, Canva
not delivering, video never really generated — what caused each one, what was
changed, how it was tested, and what is still not proven. Anything that could
not be verified here says so.

---

## 0. Summary

| Area | Before | Now |
|---|---|---|
| AI on Vercel | With `api/ai.js` deployed the app ignores the browser key and needs `GROQ_API_KEY` on the server; when it was missing, every engine silently fell back to **invented** content | Errors name the variable, where to set it and that a redeploy is needed. **Settings → AI → Deployment check** lists every server variable (names only) and tests the Groq key for real |
| Fallbacks | Fabricated angles, "Placeholder" sources, a verification table citing the Financial Times, "28% above your Page average" | Nothing is invented. Labelled templates only where they state no facts (festival greeting, milestone, launch); otherwise a starter made of the user's own topic |
| Research | Placeholder rows; link-less "sources" from the model's memory | Only sources the search actually returned; otherwise an honest "no verified sources" with a retry; ideas labelled as the model's own. Skipped for greetings, launches and milestones, with "Research anyway" |
| Festivals | Forced into Contrarian / Industry insight angles ("The hard part of Navratri isn't the technology") | An intent layer: a festival defaults to a warm greeting, can be switched to history, recap, CSR or event; 24 occasions incl. Navratri, Uttarayan and 11 more Indian festivals and national days |
| Images | Fixed layouts; Navratri and 13 other festivals drew a generic graphic; only text fields editable | A **Design studio**: four distinct, topic-specific designs per post, festival motifs for every detectable occasion, and quick edits of words, colours, background, picture, crop, layout and type |
| Canva on Vercel | Sessions and OAuth state held in function memory (lost between requests); exports returned as base64 JSON (over Vercel's 4.5 MB cap); only Autofill (Enterprise) | Sealed HttpOnly cookies; streamed downloads; **Edit in Canva** and **bring back** on every plan; existing designs; return navigation |
| Video | AI video relay existed but was **never wired into the UI**; it returned base64 (over the cap) | Canva video templates and designs exported as MP4; AI footage from Veo or Runway; every video downloaded, checked by its bytes and played before it can be used |
| Publishing | Working | **Unchanged** — verified below |

**Is it production-ready?** The code paths are tested end to end with the
providers mocked. It is **not proven against the live services** — see §6 and
§8 for exactly what still needs a live check and what depends on your plans
and keys.

---

## 1. The publishing system was not touched

Enforced mechanically. Every protected file was hashed before any change and
again after the last one:

| File | SHA-256 (first 16) | Changed? |
|---|---|---|
| `src/lib/publish.js` | `1bd9325e2b3f26c3…` | **No** |
| `src/lib/linkedin.js` | `2540793ef6054777…` | **No** |
| `src/lib/linkedinAuth.js` | `496015c26e2f5307…` | **No** |
| `src/lib/media.js` | `c6017abfcefca42d…` | **No** |
| `src/lib/image.js` | `9c26dbeed60e1ae4…` | **No** |
| `api/publish.js` | `fa9d7f81282f4e87…` → `307b6f24dfaed2e9…` | **Yes, on 5 Oct — one header, see §9** |
| `api/linkedin.js` | `7e20a9a46b8b7184…` | **No** |
| `tests/publish-contract.test.js` | `aafbca7cbe7fc64b…` | **No** |
| `e2e/publish-payload.spec.js` | `2305b90c…` | **No** |
| `make/` (README, both scenario blueprints, dump script) | — | **No** |
| `src/App.jsx` | `0b04c60ed9fed149…` → changed | **Publishing parts: no** (below) |

`src/App.jsx` holds both publishing and non-publishing code, so it was checked
at function level: the 15 publishing functions (`updatePublish`,
`attachUpload`, `scheduleStamp`, `postRecord`, `replacePost`, `recordId`,
`confirmSchedule`, `cancelScheduled`, `collectMedia`, `buildPublishPayload`,
`simulatePublish`, `publishNow`, `confirmPublished`, `openPostInWorkspace`,
`unlock`) were extracted and hashed before and after — **all 15 identical** —
and none of the 21 changed hunks in `App.jsx` overlaps one of them.

**How designs reach LinkedIn without changing anything.** A finished design,
Canva export or AI clip becomes an ordinary `File` handed to the existing
`attachUpload`, exactly as a file picked from disk always was. No new
publishing route, no altered payload.

The protected contract test (`tests/publish-contract.test.js`, 8 assertions)
passed before and after, and the protected browser test of what Publish
sends (`e2e/publish-payload.spec.js`) passes unmodified — see §5.

### A regression from `0e81151`, found and fixed in this round

`0e81151` (already on `main`) removed the invented fallback drafts. For a
general topic with **no AI reachable**, the draft then came back empty, so
**Publish now** had nothing to send — `publishNow` correctly refuses an empty
post. Users with AI working were not affected. The full browser run caught it
(three Content-times tests and the journey test). Fixed without touching
publishing: with no AI, a general topic now starts from the user's own topic,
word for word, labelled *"this starter is only your topic … nothing was
invented"*. That is also what lets the protected publish test pass unchanged.

### Still open, because the fix is in a protected file

- **`src/lib/media.js:302` cuts generated-image headlines mid-word**
  (`(ctx.hook || "").slice(0, 60)`). One-line fix: `clip(ctx.hook || "", 60)`.
  Not applied — needs your go-ahead. The new Design studio is not affected; it
  fits text itself and warns instead of cutting silently.
- **LinkedIn access token and Make webhook address are kept in
  `localStorage`** (`src/lib/linkedinAuth.js`, `src/lib/publish.js`). Server-side
  alternatives exist (`api/linkedin.js`, `MAKE_LINKEDIN_WEBHOOK_URL`); moving
  the browser copies is a publishing change and needs your approval.

---

## 2. Root causes, and what fixed them

| # | Symptom on the deployed app | Root cause | Fix | Verified by |
|---|---|---|---|---|
| 1 | "Missing Groq key", AI unavailable | On Vercel `api/ai.js` exists, so the app uses relay mode and **only** the server's `GROQ_API_KEY`; the Settings key box is hidden. The variable was missing or the deployment predates it | Errors name `GROQ_API_KEY`, the Vercel path and the redeploy; Deployment check; server-side model list tells "set" from "valid" | `tests/diagnostics.test.js`, `tests/ai.test.js`, `e2e/groq.spec.js` |
| 2 | Placeholder sources and example rows | Fallback data dressed as research | Removed; only sources the search returned are shown | `e2e/groq.spec.js` (5 cases), `e2e/journey.spec.js` |
| 3 | Navratri post about "technology", B2B angles | The angle prompt only offered B2B angle types; no notion of a greeting | `src/lib/intent.js`: 13 intents with their own angles and writer rules; festival → greeting by default | `tests/intent.test.js` (45) |
| 4 | Festival image looked generic | No artwork for Navratri, Dussehra and 12 more occasions | Drawn motifs for **every** occasion Unison detects (25 incl. default) | `tests/designer.test.js` "exists for every occasion" |
| 5 | "Empty layouts with oversized text" | Each layout was a single headline on a slab | Every studio design pairs text with a motif, hierarchy and sign-off; overflow and contrast are flagged | `tests/designer.test.js`, `e2e/studio.spec.js` |
| 6 | Canva connection lost / OAuth fails intermittently | Sessions and the PKCE verifier lived in function memory; Vercel runs each request on any instance | Sealed (AES-256-GCM, HKDF-derived key), HttpOnly, `SameSite=Lax`, `Path=/api/canva`, `Secure` cookies | `tests/canva.test.js` (new-instance PKCE, tamper, rotation, revoke) |
| 7 | Canva exports / AI videos fail on Vercel | Files returned as base64 inside JSON — over the 4.5 MB response cap, plus a third for base64 | Streamed binary downloads, type checked by the file's own bytes | `tests/canva.test.js`, `tests/relays.test.js` |
| 8 | AI artwork could fail on Vercel | A 1536×1024 PNG can approach 4.5 MB once base64-encoded | JPEG output for gpt-image; a clear error if still too large | `tests/relays.test.js` |
| 9 | Canva did nothing useful without Enterprise | Only Autofill (Enterprise) was wired | Edit in Canva (create design + upload, any plan), bring back by export, existing designs, return navigation | `e2e/studio.spec.js` |
| 10 | "Generated video" | `generateClip` existed but no UI called it | AI footage in the video studio, with cost, progress, validation and playback | `e2e/studio.spec.js` (3 cases) |
| 11 | Design edits lost | No studio state was kept | Edits saved with the post; survive switching option, angle, intent and reload | `e2e/studio.spec.js` |

---

## 3. What changed, by area

**AI configuration** (`api/ai.js`, `src/lib/ai.js`, `src/lib/diagnostics.js`,
Settings). Keys stay on the server; `api/ai.js` returns `no_server_key` naming
the variable; `?models` lists models with the server key so the app can tell a
missing key from a rejected one. Deployment check covers AI, images, video,
Canva, publishing and the workspace, and now holds the optional relay-token
field (previously only settable through the browser console).

**Research and angles** (`src/App.jsx` `runDiscovery`, `src/lib/intent.js`,
`src/components/research.jsx`). Research runs only where it helps, keeps only
search-returned sources and remaps claims to them; failures are explained with
a retry. Angles come from the intent's own types and off-intent suggestions are
replaced.

**Festival rule.** Greeting by default; the user can choose history and
culture, celebration recap, CSR or event. The same intent drives the caption,
the studio's designs (motif, palette, brief that rules out offers and drawn
deities) and the AI footage prompt (the occasion's own scene).

**Design studio** (`src/lib/designer.js`, `src/components/studio.jsx`).
Festival: Elegant traditional, Premium corporate, Colourful celebratory,
Modern minimal. Launch: Product spotlight, Launch announcement, Feature
highlights (only when the post lists features) or Premium corporate, Modern
minimal. Milestone: Big number (only when the topic or post states one),
Thank-you card, Premium corporate, Modern minimal. Other posts: two engine
styles plus two of the existing layouts, which can be recoloured and retyped
(their arrangement is fixed and the editor says so). AI artwork prompts never
ask for words, numbers, logos — or a product picture of a product the model
has never seen.

**Canva** (`api/canva.js`, `src/lib/canva.js`). Same client ID, secret,
redirect URL and 7 scopes. New actions: create design, list designs, export
formats, raw-byte and URL asset uploads, streamed download. Every request is
queued so a single-use refresh token is never replayed.

**Video** (`api/video.js`, `src/lib/aigen.js`, `src/lib/mediacheck.js`).
Start → status → **download** (streamed, `ftyp` checked); the Google key is
only attached to a `googleapis.com` address. In the browser every file is
checked by signature, decoded, and — for video — required to have a real
duration before it is offered.

---

## 4. Requirements that could not be met as written

| Requirement | What is true | What Unison does instead |
|---|---|---|
| Search Canva's public template library | Canva's Connect API has no endpoint for it | Uses your account's brand templates and designs; says so on screen |
| Brand templates and Autofill on every plan | Canva Enterprise only | Explains the 403; Edit in Canva and existing designs work on every plan |
| Unison's words editable *as text* in Canva | `POST /v1/designs` places an uploaded image as one flat image | Change words in Unison first, or use a brand template. Canva's newer **image-to-design ("Magic Layers") import** (`POST /v1/image-to-design-imports`, `design:content:write`, per-user capability) could make layers editable; its request shape could not be confirmed from this environment, so it is **not** wired in rather than guessed |
| Place an AI clip on a Canva page via the API | Create-design accepts image assets only | The clip is uploaded to the user's Canva Uploads and the editor opens; the app says to drag it on |
| Transitions, scene timing, audio, animation set from Unison | No such Canva Connect API | Done in Canva's editor; Unison does not offer controls that would do nothing |
| Auto-return from Canva without setup | Needs *Return navigation* enabled on the integration | Optional one-time step (VERCEL-SETUP.md §6); otherwise "Bring back my Canva edits" |

---

## 5. Test results

Run in this environment on the final code. **All provider calls are mocked**;
no request reached Groq, OpenAI, Google, Runway, Canva, Make or LinkedIn.

| Suite | Command | Result |
|---|---|---|
| Lint | `npm run lint` | 0 errors (4 pre-existing warnings) |
| Unit + relay + contract | `npm test` | **598 passed** in 25 files |
| Publishing contract (protected) | `tests/publish-contract.test.js` | 8 / 8 |
| Browser, desktop + mobile | `npm run test:e2e` | **65 passed, 0 failed** (63 desktop, 2 mobile-only; the other 65 are each project's skips of tests written for the other viewport) |
| Build | `npm run build` | succeeds |
| Clean-folder check of the ZIP | extract → `npm ci` → lint → `npm test` → build → `npm run test:e2e` | All pass from the extracted folder: 0 lint errors, 598 unit, build, **65 browser tests passed** on its own server. No `node_modules`, build output, `.env*` (other than `.env.example`) or key-shaped string in the archive |

New this round: `tests/designer.test.js` (24), `tests/intent.test.js` (45),
`tests/diagnostics.test.js` (9), relay tests for streaming and host locks,
`e2e/studio.spec.js` (13: Navratri, Diwali, launch, milestone, intent switch,
Canva round trip with return navigation, brand-template refusal, a bad file,
Canva MP4, a design that cannot be MP4, AI footage, AI footage that is not a
video, video keys missing).

The video fixture is a real 2.2-second MP4 recorded by the same Chromium, so
"the browser decoded its duration" is a real check, not a mocked one.

### Mocked versus live

| Integration | Tested here | Live-tested? |
|---|---|---|
| Groq / Anthropic | Request shape, parsing, errors — mocked | **No.** Run Settings → AI → Test connection on the deployment |
| Canva OAuth, templates, Autofill, designs, uploads, exports | Every call mocked at `/api/canva`; relay unit-tested with Canva mocked | **No.** Canva is unreachable from here. The production connection has **not** been verified |
| OpenAI / Imagen / Veo / Runway | Mocked | **No.** Needs keys and a paid call |
| LinkedIn via Make | Mocked webhook; payload contract | Live-tested on 25 Sep 2026 through the **browser** path only (TESTING.md). The Vercel relay path was never live-tested and was broken — see §9 |

---

## 6. What to check on the live deployment (in this order)

1. Redeploy with `GROQ_API_KEY` set; **Settings → AI → Deployment check** —
   the AI row should be green.
2. Write one Navratri greeting end to end. Expect: intent "Festival greeting",
   research skipped with the reason, greeting angles, a greeting draft.
3. **Connect Canva** (once per person), then **Edit in Canva** on a studio
   design, change something, return, and confirm the exported image shows the
   change.
4. On a video post, **Use one of my Canva designs** with a video design;
   confirm the MP4 plays in the preview with its real duration.
5. If AI keys are set, generate one artwork and one 4-second clip and check
   the cost shown matches your provider's bill.

---

## 7. Security review (this round)

| Check | Result |
|---|---|
| Provider keys in the browser bundle | **None.** Only `VITE_*` variables reach the bundle; none should be set on Vercel |
| Canva client secret and tokens | Server only. Tokens live in an encrypted HttpOnly cookie; no response contains one; `localStorage`/`sessionStorage` checked empty of them in a real browser |
| OAuth state / PKCE verifier | Sealed cookie, 10-minute life, purpose-bound key; a tampered cookie is rejected |
| Canva refresh token reuse | Single queue per browser; rotation tested |
| Relay as an open proxy | Downloads are looked up by job id with the user's token — no client-supplied URL is fetched; URL uploads are HTTPS-only |
| Google key on video downloads | Attached only to `googleapis.com` (look-alike hosts refused) |
| Files | Type decided by the file's own bytes on the server and again in the browser; video must decode with a real duration |
| Request/response size | Uploads capped at 4.4 MB (raw bytes), downloads streamed, 200 MB ceiling |
| Relay token | Optional; now enterable in the app. Warning: it also gates publishing |
| Open findings | LinkedIn token and Make webhook in `localStorage` (protected files, §1) |
| Groq key in `.env.local` | A real key sits in the developer's local `.env.local` (git-ignored, excluded from the ZIP). **Rotate it** at console.groq.com — it has been on a developer machine in plain text |

---

## 8. Remaining dependencies (not code)

- **Canva plan** — Enterprise for brand templates/Autofill; any plan otherwise.
- **Canva integration settings** — unchanged; optional Return navigation.
- **Provider keys and budgets** — Groq free-tier limits apply to writing;
  images and video are paid per call.
- **Vercel** — redeploy after any variable change; raise *Max Duration* if
  image generation times out on a Hobby plan.
- **Live verification** — §6. Nothing in this report claims the deployed
  integration works against the real services until those checks are done.

---

## 9. 5 October 2026 — publishing from the Vercel deployment failed (fixed)

**Symptom.** A scheduled image post from `unison-content-os.vercel.app` showed
*"LinkedIn refused the post — The publishing workflow rejected the post
(500)"*. Three attempts, 11:13–11:15 UTC.

**What Make recorded.** Scenario *Unison LinkedIn Publisher* (7482325): three
failed executions, each `BundleValidationError: Validation failed for 1
parameter(s)` after 2 operations — the webhook and the Parse JSON step. No
LinkedIn module ran, and the data store holds no record for the post
(`p-w-muv5ejfe4ref`), so nothing was published or queued.

**Cause.** The scenario's first step parses `{{1.value}}`: the raw body Make
exposes for a `text/plain` request. The browser path has always sent
`text/plain`, and every earlier live post went that way. On Vercel, posts go
through `api/publish.js`, which forwarded them as `application/json`. With
the webhook's JSON pass-through off, Make splits a JSON body into fields,
`value` is empty, Parse JSON fails validation, and Make answers 500. So
**every post sent through the Vercel relay failed**, whatever its type; the
message text in the screenshot is the relay's own wording, which identifies
the path. The relay had never been live-tested; the 25 September live tests
used the browser path.

**Fix.** One header in `api/publish.js`: forward the same JSON text as
`text/plain;charset=UTF-8`, exactly as the browser path does. Payload, webhook,
scenario, data store, LinkedIn connection and every other publishing file are
unchanged. The Make scenario was **not** modified.

**Tests.** New `tests/publish-relay.test.js` (6) pins the relay to the
scenario: scenario A parses `{{1.value}}`; the relay sends `text/plain`; the
body is the whole payload as JSON text; replies and refusals pass through as
before. Two of them fail on the old code and pass on the fix. Full unit suite
604 passed; publishing browser tests (`publish-payload`, `content-times`) 11
passed. Make is mocked in all of these — **the fix is confirmed only when one
post from the redeployed site succeeds.**
