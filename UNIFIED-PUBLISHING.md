# Two-scenario multi-Page LinkedIn publishing

This is the design, evidence and status for replacing the two production Make
scenarios with two unified scenarios. Together they publish text, image,
video and poll posts, immediately or on a schedule, to any of three LinkedIn
Company Pages.

- **Status on 13 October 2026: ready for isolated testing.** It is not yet
  ready for cutover review or for production. Both blueprints are generated
  and tested against a simulator of Make, through the real Unison relay and
  browser code. Make and LinkedIn are mocked in those tests. Nothing has been
  imported into Make, activated or published. Nothing in production was
  changed.
- **Cutover:** [CUTOVER.md](CUTOVER.md) has the cutover and rollback
  procedure. Do not start it without written approval.
- **Windows:** the Windows commands are in
  [WINDOWS-SETUP.md §9](WINDOWS-SETUP.md#9-multi-page-publishing-test-preview-push).

| Contents |
|---|
| [A. Production architecture audit](#a-production-architecture-audit) |
| [B. The two replacement blueprints](#b-the-two-replacement-blueprints) |
| [C. Application changes](#c-application-changes) |
| [D. Test evidence](#d-test-evidence) |
| [Plan limits, operations and storage](#plan-limits-operations-and-storage) |
| [LinkedIn API requirements](#linkedin-api-requirements) |
| [Isolated testing: what is possible on the Free plan](#isolated-testing-what-is-possible-on-the-free-plan) |
| [G. Readiness](#g-readiness) |

---

## A. Production architecture audit

All of this was read from Make's API on 13 October 2026, without changing
anything. **(live)** marks settings read from the running scenario. Anything
else is marked with where it came from.

### Resources

| Resource | ID | Facts (live) |
|---|---|---|
| Unison LinkedIn Publisher | 7482325 | Active, instant (webhook). Last edited 2026-09-25 06:32 UTC. 72 runs, 278 operations, 7 errors in total. `sequential: false`, `maxErrors: 3` (Make switches it off after 3 consecutive errors). |
| Unison Scheduled Publisher | 7524924 | Active, every 3600 s. Last edited 2026-09-25 07:51 UTC. 659 runs, 797 operations, 3 errors. Next run 2026-10-13 12:51 UTC. |
| Production webhook | 3744886 | Attached to 7482325. Enabled. Queue 0 of a 50-request limit. No API-key authentication, no IP restriction. |
| Data structure "Unison Publish Payload" | 584788 | 21 fields. No `destinationId`, `parentPostId` or `destinations`, so a data store record can never carry them. |
| Data store "Unison Scheduled Posts" | 193288 | Uses 584788. 33 records, 34,396 bytes of 1,048,576. **All 33 are `published`: no scheduled job is pending.** One of them is a multi-account test record: `mt:p-w-mv6b6w74uc7u~test-2`, written by the 13 October test (§ Isolated testing). |
| Poll body structure | 597911 | Used by both production poll routes. |
| LinkedIn connection | 10513797 | "Drashti's LinkedIn connection". Make's own Company list for it (12 October) returns Pages 146260120, 145298202 and 145301196. |
| Organization | 8867965 | **Free plan:** 2 active scenarios (2 in use), 1 data store, 1 MB store, 1,000 operations a month (271 used, next reset 3 November), 15-minute minimum interval, 50-request webhook queue, 5-minute run limit. |

The repository's exports `make/scenario-a-linkedin-publisher.json` and
`make/scenario-b-scheduled-publisher.json` contain the same modules, in the
same order and with the same IDs, as the live scenarios (37 and 27 modules).
The mappings below were compared against the live blueprints.

### How a post travels today (code)

1. The browser builds the payload (`buildPublishPayload` in `src/App.jsx`):
   - `postId`, and `idempotencyKey`, which equals `postId`;
   - `postType`, `content`, `company` and `companyUrn`;
   - `publishMode` (`now` or `scheduled`), plus the date, time and timezone;
   - `media[]`, holding base64 `data`, with the image or video first;
   - `poll`, with `question`, `options[]` and `duration` as text such as
     "1 week".
2. The browser sends it to `POST /api/publish` (Vercel). The relay forwards
   it as `text/plain` JSON to `MAKE_LINKEDIN_WEBHOOK_URL`. If that variable is
   not set, it uses the production webhook, which is written into
   `api/publish.js`. The relay remembers delivered keys for 24 hours, on one
   warm instance only.
3. When there is no relay, the browser posts to that same webhook itself as
   `text/plain` (`src/lib/publish.js`). This is the old fallback.
4. Make's reply is read by `readMakeReply` (`api/publish.js`):
   - **published** only when the reply carries a LinkedIn `urn:li:…`;
   - **queued** for a scheduled post;
   - **accepted** for a bare `Accepted`;
   - the scenario's own `failed`, `rejected` or `unsupported`.

### Scenario A — Unison LinkedIn Publisher (7482325), module by module (live)

| ID | Module | Purpose | Inputs, mapping | Filter | Output, next |
|---|---|---|---|---|---|
| 1 | Webhooks › Custom webhook | Receive Unison's request | hook 3744886, max 1 result | — | `value` (raw body) |
| 2 | JSON › Parse JSON | Read the payload | `{{1.value}}`, structure 584788 | — | payload fields |
| 3 | Router | 7 routes, in order | — | — | — |
| 40 | LinkedIn › Create a text post | Publish text | `content`; organization `ifempty(companyUrn; urn:li:organization:146260120)`; PUBLIC; MAIN_FEED | now + text | `id` → 70 |
| 71, 72 | Data store › Add record, then Ignore | On LinkedIn error: record `failed` with LinkedIn's message, swallow the error | key `postId` | (error handler) | **no webhook response**, so Make answers `Accepted` |
| 70 | Webhook response | Tell Unison | 200 `{status:"published", urn, url, postId, postType, mode}` | — | → 90 |
| 90 (190) | Add record (Ignore on error) | Record `published` + `publishedUrn` | key `postId`, overwrite | — | — |
| 41, 74/75, 73, 91/191 | Create a company image post | The same chain for an image | upload `toBinary(media[1].data; base64)`, `fileName`, `altText` | now + image | |
| 42, 77/78, 76, 92/192 | Create an organization video post | The same chain for a video | upload `media[1].data`, `videoName` | now + video | |
| 43 → 44 → 47 → 45 | Iterator → Array aggregator → Create JSON (597911) → LinkedIn API call | Poll | `POST /rest/posts`, `Linkedin-Version: 202605`, `X-Restli-Protocol-Version: 2.0.0`. Body: `author`, `commentary`, `content.poll` (question, options as `{text}`, duration switched to ONE_DAY / THREE_DAYS / SEVEN_DAYS / FOURTEEN_DAYS, default SEVEN_DAYS), SINGLE_VOTE. The urn comes from the `x-restli-id` header. | now + poll | → 80/81 on error, 79 response, 93/193 record |
| 46 (85), 82 | Add record `unsupported`, then response | Keep a post type Unison withdrew (multi, document, carousel, article) | stores text and media | now + one of those 4 types | 200 `unsupported` |
| 5 (185), 83 | Add record `queued`, then response | Queue a scheduled post | `dueAt = parseDate(date time; tz)` in epoch seconds; stores media and poll; key `postId` | scheduled | 200 `queued` |
| 86 | Webhook response | Say no route matched | — | anything else | 422 `rejected` |

### Scenario B — Unison Scheduled Publisher (7524924), module by module (live)

| ID | Module | Purpose | Filter / mapping |
|---|---|---|---|
| 19 | Data store › Search records | Up to 5 due jobs per run | (`queued` and `dueAt ≤ now`) or (`publishing` and `attemptAt ≤ now − 45 min`) |
| 7 | Router | — | — |
| 53 | Update record → `stuck` | A claim that went stale is reported, never republished | status = publishing |
| 54 → 9 → 30 (55/56) | claim `publishing` + `attemptAt` → text post → `published` + urn (on error `failed` + Ignore) | Text | queued + text; organization `ifempty(19.data.companyUrn; Page 1)` |
| 57 → 10 → 31 (58/59) | The same chain for an image. 31 re-adds the record **without media**, which frees store space. | Image | queued + image |
| 60 → 12 → 32 (61/62) | The same chain for a video, also re-added without media | Video | queued + video |
| 63 → 20 → 50 → 66 → 18 → 51 (64/65) | The same chain for a poll, with the same Posts API body as Scenario A | Poll | queued + poll |
| 52 | Update record → `unsupported` | A withdrawn type | queued + one of those 4 types |

A scheduled post never answers anyone. Unison only knows it was queued. A
`stuck` or `failed` job needs a person to look at it in Make.

### What the audit found

1. **Both production scenarios already post to the job's `companyUrn`**, and
   fall back to Page 1 when it is empty. They do not check that URN against
   any list. The smallest safe change is therefore around the LinkedIn
   modules, not inside them: an allow-list, per-Page job keys, and per-Page
   job records. The modules and their mappings are reused unchanged.
2. **A LinkedIn refusal on an immediate post is answered `Accepted`.** The
   error handler ends in Ignore before any webhook response runs, so Unison
   shows "sent, not confirmed" for a definite failure.
3. **Make never checks for a duplicate on an immediate post.** If the same
   request is delivered twice, it is published twice. Only the relay's
   per-instance cache stands in the way.
4. **Nothing is claimed before LinkedIn is called on an immediate post.**
   Suppose LinkedIn publishes and the run then dies. Nothing records that, so
   nothing stops a second post.
5. **The hourly scheduler spends about 744 of the 1,000 monthly operations
   while idle** (1 operation per run).
6. The production webhook URL is written into `api/publish.js` (fallback) and
   `src/lib/publish.js` (browser fallback). Both files are protected and
   were not changed. This is why the cutover re-uses webhook 3744886 instead
   of issuing a new one.

### Single-Page today and multi-Page unified

| | Production today | Unified replacement |
|---|---|---|
| Who chooses the Page | `companyUrn` from the browser, unchecked | the browser names Page **ids**; the server stamps the URN from `LINKEDIN_DESTINATIONS`; Make checks it against a 3-Page allow-list |
| Immediate, several Pages | — | one request per Page; key `post~page` |
| Immediate repeat delivery | posts again | answered from the record: `published` with the first urn, or `unknown` |
| Crash after LinkedIn posts | invisible; a resend posts again | the record stays `publishing`; a resend answers `unknown`; the scheduler marks it `stuck` 45 min later |
| LinkedIn refusal (immediate) | `Accepted` | `{status:"failed", stage:"linkedin", message}` |
| Scheduled, several Pages | — | one request carrying the post once: a **parent** record (content + media) and one **Page job** per Page (`post~page`, status `page-queued`) |
| Scheduled status in Unison | "queued", then silence | **Check status in Make** reads every record for the post |
| Single-Page requests (`api/publish.js` format) | — | same routes, same records, same answers (plus three extra fields in the answer). This is proved against the production blueprints (§D). |
| Pending production jobs | — | run by the unified scheduler exactly as production would run them |

**Reused unchanged:**
- all LinkedIn modules and their mappings;
- connection 10513797;
- data store 193288 and structure 584788;
- poll body structure 597911 and API version 202605;
- the `dueAt` / `attemptAt` / 45-minute stale-claim scheme;
- the `failed` / `stuck` / `unsupported` statuses and notes;
- the withdrawn-type handling;
- the hourly interval;
- webhook 3744886.

**Changed:**
- Allow-list filters.
- Look-up and claim before an immediate publish.
- JSON answers on every path, including LinkedIn refusals and a full data
  store.
- Scheduled multi-Page intake: a parent and Page jobs.
- The scheduler reads each Page job's post from its parent. This is the one
  extra operation per job.
- The parent record is deleted a day after it is due.
- A `status` request.
- The parse structure is 631043, which adds `destinationId`, `parentPostId`
  and `destinations`.

---

## B. The two replacement blueprints

`make/unified/generate.py` writes both from one description:

| File | Scenario | Trigger |
|---|---|---|
| `make/unified/unified-immediate-publisher.json` | Unison LinkedIn Publisher - Unified | webhook 3744886 (re-used at cutover) |
| `make/unified/unified-scheduled-publisher.json` | Unison Scheduled Publisher - Unified | every 3600 s |
| `make/unified/test/unified-immediate-publisher.test.json` | Unified Test (no data store) | test webhook 3885267 |

```text
python make/unified/generate.py                     # the two production blueprints
python make/unified/generate.py --profile test      # the no-data-store immediate test copy
python make/unified/generate.py --profile isolated --hook H --store S --structure P --poll-structure Q --conn C
```

### Immediate (webhook → parse → router)

Routes, in order:

1. **Now · withdrawn type.** Exactly as production.
2. **Now · allowed Page**, which requires now, one of the 4 types, and one of
   the 3 URNs:
   - Search the store by `idempotencyKey`, continuing when nothing is found.
   - Then branch:
     - already `published` → answer `published`, `duplicate: true`, with the
       stored urn;
     - `publishing` or `stuck` → answer `unknown`, stage `make-claim`;
     - otherwise → **claim** (a record with status `publishing`;
       `failed`, stage `make-store`, if the store refuses it), then route by
       type to the production LinkedIn module.
   - Success answers `published` with the urn, then records `published`.
   - A refusal records `failed`, then answers `failed`, stage `linkedin`.
3. **Now · not an allowed Page** → 422 `rejected`, stage `destination`.
4. **Scheduled · one Page** (no `destinations`, allowed URN) → the
   production record and answer, byte for byte.
5. **Scheduled · one Page · not allowed** → 422.
6. **Scheduled · several Pages:**
   - write the parent: status `parent`, content, media and poll, key `postId`;
   - an Iterator over `destinations` writes one job per allowed Page: key
     `postId~pageId`, status `page-queued`, the Page's URN and name;
   - an Aggregator counts them;
   - answer `queued` with `destinations: n`. The relay reports a count
     lower than requested as a failure.
7. **Status:**
   - Search the store by `postId`, up to 20 records.
   - Aggregator → Transform to JSON.
   - Answer `{status:"report", jobs:[{key, status, companyUrn, publishedUrn, note, …}]}`.
8. **Nothing matched** → 422.

### Scheduled (hourly)

The search selects:
- `queued` or `page-queued` jobs whose `dueAt ≤ now`;
- `publishing` or `page-publishing` jobs claimed more than 45 minutes ago;
- `parent` records more than a day past due.

The limit is 5 per run, as in production. The router then has these routes:
- The two stale-claim kinds become `stuck`.
- Per type:
  - claim the job, as `publishing` or `page-publishing`;
  - Get the post record by the job's `postId`: the job itself for a
    single-Page post, its parent for a Page job;
  - check "the post is there" (content not empty);
  - call the production LinkedIn module with the job's URN;
  - record `published` + urn, or `failed` + LinkedIn's message.
  - Image and video records are re-written without media, as in production.
- Withdrawn types become `unsupported`.
- A parent a day past due is deleted.

The production scheduler selects only `queued` and `publishing`, so **it can
never run a Page job**. If both schedulers ever saw the same store, the Page
jobs would be safe. A unit test runs the production blueprint against Page
jobs to prove it.

### Data store

| Record | Key | Status flow | Holds |
|---|---|---|---|
| Single-Page scheduled (production format) | `postId` | `queued` → `publishing` → `published` / `failed`; stale claim → `stuck` | the post, with media until published |
| Immediate attempt | `postId`, `postId~page` or `postId~page~rN` | `publishing` → `published` / `failed`; stale → `stuck` | the post's text and the Page; no media |
| Parent | `postId` | `parent`, deleted a day after due | content, media, poll |
| Page job | `postId~page` | `page-queued` → `page-publishing` → `published` / `failed`; stale → `stuck` | the Page and the schedule; no content |

Identity and idempotency:
- A post and Page pair always has the same key, `postId~page`.
- Sending the same scheduled request again overwrites the same records. It
  does not add jobs.
- An immediate resend after a person has checked LinkedIn gets `~r1`, `~r2`
  and so on, so it is not answered from the unfinished attempt.
- LinkedIn's Posts API has **no idempotency key**, so the claim record is the
  only guard against a second post. A crash between LinkedIn answering and
  the claim being written cannot happen, because the claim is written first.
  A crash between LinkedIn answering and the result being written leaves
  `publishing`. That surfaces as `unknown`, then `stuck`, and is never
  republished automatically.
- **The claim is not an atomic compare-and-set.** Make's data store has none.
  Two runs that read `queued` at the same instant could both publish. Make
  does not overlap runs of one scheduled scenario. The cutover rule "never
  two schedulers active at once" closes the remaining gap. It is a rule, not
  a mechanism.

Retention and cleanup:
- Parents are deleted automatically a day after they are due.
- Published and failed records are kept, as production keeps them: about
  0.6–1 KB each with no media, so roughly 900 more post-Pages before the 1 MB
  store is full.
- Delete records older than 60 days by hand in Make (Data stores → Unison
  Scheduled Posts) when the store passes 70%. Never delete a `queued`,
  `page-queued`, `parent`, `publishing`, `page-publishing` or `stuck` record.
- Scheduled media is capped by the app at 60% of the store
  (`SCHEDULED_MEDIA_BUDGET`). A multi-Page post stores its media once, in
  the parent.

### Manual setup after import (each is part of CUTOVER.md)

1. **Webhook:**
   - Immediate production: webhook 3744886, which is moved from 7482325 at
     cutover.
   - Test copy: webhook 3885267.
   - Isolated organization: a new webhook.
2. **Parse JSON structure:**
   - 631043 already exists; rename it "Unison Publish Payload - Unified" if
     you like.
   - In another organization, create it from the field list in
     `tests/helpers/make-sim.js` (`PAYLOAD_FIELDS[631043]`).
3. **Data store** 193288 and the **LinkedIn connection** 10513797 are
   selected in the blueprint. After import, open one LinkedIn module and one
   data store module to confirm Make resolved them.
4. **Poll structure** 597911 is the same one production uses.
5. **Scheduling** of the scheduled scenario: every 60 minutes.
6. Neither scenario has been imported. Import can reveal settings that the
   tests cannot see. **Do not treat either blueprint as production-ready
   until it has run in an isolated environment.**

---

## C. Application changes

All on branch `claude/website-review-improvements-ndtwl3`. Production files
(`api/publish.js`, `src/lib/publish.js`, `api/linkedin.js`, `src/lib/media.js`,
the production `make/*.json`) are **unchanged**.

| File | Why it changed |
|---|---|
| `api/publish-to.js` | Checks posts server-side before Make:<ul><li>media present, the first item is the right kind, real base64, JPG/PNG/GIF for images;</li><li>poll: 2–4 options of 30 characters or fewer, a question of 140 characters or fewer, one of the four durations;</li><li>no `~` in a post id.</li></ul>Also:<ul><li>a resent Page gets the key `~rN`;</li><li>the scheduled relay cache key includes the attempt, so a retry is not answered from cache;</li><li>reports a Make allow-list mismatch;</li><li>accepts `unknown` from Make;</li><li>adds the `{action:"status"}` report, which maps Make records to Pages **by organization URN**;</li><li>the queued wording no longer says "test".</li></ul> |
| `src/lib/destinations.js` | The canonical status vocabulary (`CANONICAL`, `canonicalState`). Two new internal states, `processing` and `cancelled`. Each result now carries `postId`, `attempt` and `resends`. `checkStatus()`. `markNotPublished` counts resends. |
| `src/components/destinations.jsx` | A **Check status in Make** button, shown while any Page is scheduled, waiting, processing or unknown. Each row carries `data-state` with the canonical status. |
| `src/components/workspace.jsx` | Passes the status check to all three results lists. |
| `src/App.jsx` | `checkDestStatus`: reads the report, updates the Pages and notifies. The queued wording no longer says "multi-account". The publishing functions are otherwise unchanged. |
| `make/unified/*` | The generator and the blueprints (§B). |
| `tests/helpers/make-sim.js` | The Make blueprint simulator. |
| `tests/unified-matrix.test.js`, `tests/unified-blueprints.test.js` | §D. |
| `e2e/multi-account.spec.js` | Status check in the browser. The queued wording is updated. |

### Status vocabulary

| Shown as (canonical) | Internal state | From |
|---|---|---|
| scheduled | `queued` | Make stored a scheduled job (`queued` / `page-queued`) |
| queued | `accepted` | Make answered a bare `Accepted`: the scenario was off, busy or out of operations, so the request waits in Make's webhook queue |
| processing | `sending`, `processing` | being sent now, or Make has claimed it (`publishing` / `page-publishing`) |
| published | `published` | **only** with LinkedIn's `urn:li:…` |
| failed | `failed`, `rejected` | LinkedIn refused it, the server or Make refused it, the store was full, or no relay was found |
| unknown | `unknown` | timeout, a 5xx without a result, a claim with no result (`stuck`), or a reload while sending |
| cancelled | `cancelled` | a Make record set to `cancelled` by hand. Unison has no cancel button; set `status` to `cancelled` in Make on a `queued` or `page-queued` record. |

Only **failed** Pages are retried. **unknown** and **queued** Pages need a
person to check LinkedIn (or Make's webhook queue) and press **Not on LinkedIn?
Allow resend** first.

---

## D. Test evidence

### Run on 13 October 2026

| Check | Result |
|---|---|
| `npx vitest run` | **781 passed**, 0 failed, 33 files. New: `unified-matrix` (86), `unified-blueprints` (8) |
| `npm run test:e2e` (desktop + mobile) | **72 passed**, 0 failed, 72 skipped (mobile copies of desktop-only tests). An earlier full run had 1 intermittent failure in `source-document.spec.js`, which does not touch publishing; see TESTING.md. |
| `npm run build` | OK |
| `npm run lint` | 0 errors (the 4 warnings were already there) |

**Mocked:** Make is replaced by `tests/helpers/make-sim.js`, which executes the
blueprint JSON: filters, formulas, data store, iterators and aggregators,
error handlers, and responses. LinkedIn is a stand-in. The relay and the
browser library run for real.

**Calibration:** the simulator gives the production immediate text post 5
operations. A real run of the same shape (webhook, parse, LinkedIn, response,
record) cost 5 operations in Make on 13 October.

### The 56 combinations — mocked: all PASS · real through the unified scenarios: none run

Each cell is one test in `tests/unified-matrix.test.js`.
- Immediate tests assert:
  - one request per chosen Page and no other;
  - exactly one LinkedIn call per Page, to the right module, with the right
    organization, content, media or poll;
  - the urn reaches the Page's result;
  - the Make record is right.
- Scheduled tests assert:
  - one request; a parent plus one job per Page;
  - no LinkedIn call a minute before the due time;
  - exactly one call per Page at the due time, and none on later runs;
  - **Check status** turns every Page `published`;
  - the parent is gone a day later.

| Mode · type | 1 | 2 | 3 | 1+2 | 1+3 | 2+3 | 1+2+3 |
|---|---|---|---|---|---|---|---|
| now · text | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| now · image | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| now · video | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| now · poll | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| scheduled · text | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| scheduled · image | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| scheduled · video | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| scheduled · poll | PASS | PASS | PASS | PASS | PASS | PASS | PASS |

**Real LinkedIn evidence that exists (not through the unified scenarios):**
- **Page 1 through the production scenarios.** Every type has been published
  in both modes. The urns are in the production store:
  - now: text `urn:li:share:7509146380729409536`, image `…7509137974236872704`,
    video `urn:li:ugcPost:7509138493772697600`, poll `…7509137969702907905`;
  - scheduled: text `urn:li:share:7509156810465894401`, image
    `…7508814445381505025`, video `urn:li:ugcPost:7509156849212948480`, poll
    `…7509139221757190144`.
- **Page 2, immediate image**, through the multi-account test scenario
  (13 October, Run once): `urn:li:share:7515662257926840321`.
- **Page 3:** no post has ever been published.
- **Video and poll on Pages 2 and 3:** never published.
- **Any multi-Page or scheduled post on Pages 2 and 3:** never published.

### Failure cases (mocked, all PASS)

| Case | What the test shows |
|---|---|
| One Page fails, others succeed | Pages 1 and 3 `published`, Page 2 `failed` with LinkedIn's message. Overall `partial`. Retry sends only Page 2. LinkedIn is called once each for Pages 1 and 3. |
| All Pages fail | all `failed`, overall `failed`, all retryable |
| Invalid Page id | 422 from the server; Make never called |
| Page on the server list but not on Make's allow-list | Make answers 422 before LinkedIn. A scheduled request reports the mismatch. No job is written for that Page. |
| Missing media / media sent as a link | 400 before Make |
| Bad base64, a WebP image, the poster before the video | 400 before Make |
| Poll with 1 or 5 options, an option over 30 characters, a question over 140, an unknown duration, an empty option | 400 before Make |
| Duplicate submission | The browser skips published Pages. The relay cache answers a repeat. With the cache gone (another instance), Make answers from its record and LinkedIn is called once. |
| Repeated webhook delivery | one LinkedIn call; the second answer is `published`, `duplicate`, with the same urn |
| Inactive scenario / Make queue | `Accepted` → canonical `queued`, not retried; both requests sit in Make's queue |
| Timeout between the relay and Make | `unknown`, not retried |
| Unstructured 5xx, or the run died after LinkedIn posted | `unknown`. A resend of the same job answers `unknown` from the claim, with one LinkedIn call. After **Allow resend**, the job goes out as `~r1`. |
| LinkedIn posted, recording the result failed | Unison still gets the urn. The record stays `publishing`. A repeat is not republished. |
| Data store full | immediate and scheduled both fail with stage `make-store`; LinkedIn is never called |
| Browser reload while sending | that Page comes back `unknown`, not resent |
| Retry after partial success (scheduled) | **Check status** shows the refused Page `failed`. Retry re-queues only that Page. Page 1 is posted once. |
| Scheduler restart mid-publish | The other Page's job is posted. The claimed one becomes `stuck` after 45 minutes and is never reposted. **Check status** shows `unknown`. |
| Future job | nothing is posted a minute early (every scheduled cell above) |
| Duplicate scheduled execution | the request sent twice and three runs back to back post each Page once |
| Old and new schedulers on the same store | The production scheduler leaves Page jobs untouched. Taking turns on one single-Page job, the two publish it once. The simultaneous case is a cutover rule (CUTOVER.md). |

### Regression (mocked, all PASS)

For each of the 4 types, a single-Page request in the production format is
sent through **both** the production blueprint and the unified one:
- **immediate:** the same LinkedIn call, the same record, and the same
  answer fields;
- **scheduled:** the same record. A job queued by production is published by
  the unified scheduler with the same LinkedIn call and the same final
  record.
- A withdrawn post type is held, not posted, exactly as production holds it.

Not verified:
- Production scenarios, webhook and data store unchanged before cutover:
  **PASS**, verified live. `lastEdit` is still 25 September, the webhook
  queue is 0, and nothing was written.
- No new production posts during this work: **PASS**. No publish was sent.

---

## Plan limits, operations and storage

Operations per run were measured with the simulator from the blueprints; Make
bills one operation per module run.

| Action | Production today | Unified |
|---|---|---|
| Immediate, 1 Page (text, image, video) | 5 | 7 |
| Immediate, 1 Page, poll | 8 | 10 |
| Immediate, 3 Pages | — | 21 (poll: 30) |
| Immediate repeat answered from the record | (posts again: 5) | 4 |
| Scheduled intake, 1 Page (production format) | 4 | 4 |
| Scheduled intake through `/api/publish-to`, 1 / 3 Pages | — | 7 / 9 |
| Scheduler, per Page job (text, image, video / poll) | 3 / 6 + search | 4 / 7 + search |
| Scheduler run with nothing due | 1 | 1 |
| Status check | — | 6 |
| Retry of one failed Page | — | the same as one Page |

The monthly budget is 1,000 operations:
- The idle scheduler uses about 744 a month (24 × 31), unchanged from today.
- That leaves about 250 for publishing.
- Examples: about 35 single-Page immediate posts, or 11 three-Page
  immediate posts, or about 11 three-Page scheduled image posts (9 for the
  request, 12 for the three jobs, plus a search).
- **The Free plan is tight for three Pages.** Running the scheduler every 2
  hours would halve the idle cost. Unison's "goes out within the hour"
  promise would then need `schedulerIntervalMs` changed, which is not
  changed here.

When operations run out:
- Make stops running every scenario until the reset (3 November).
- Webhook requests queue, up to 50, and Make answers `Accepted`. Unison
  shows **queued — waiting in Make**, and they post when operations return.
  Past 50, Make refuses them.
- Scheduled jobs wait and go out late.

When the store is full:
- A new immediate post fails before LinkedIn is called (`make-store`).
- A scheduled post is refused.
- Nothing is lost silently.

What an inactive scenario does with its webhook (seen in Make on 13 October):
- Requests are queued and answered `Accepted`.
- Activating the scenario runs the whole queue.
- **Run once** runs one queued request.

---

## LinkedIn API requirements

Microsoft Learn could not be reached from this session. Figures marked † come
from search results that quote LinkedIn's Microsoft Learn pages.

| Type | API (what Make's module calls) | Limits | Permissions |
|---|---|---|---|
| Text | Posts API | commentary up to 3,000 characters (Unison's existing limit) | `w_organization_social`, and the member must be an admin of the Page. Make's Company list for connection 10513797 shows all three Pages. |
| Image | Images API (initialize upload + upload) + Posts API | JPG, PNG, GIF. The relay now refuses other types. | as above |
| Video | Videos API (initialize, upload parts, finalize) + Posts API | MP4, 75 KB–500 MB, 3 s–30 min †. A smaller ceiling applies first: the app's media limits for a Vercel function body (VERCEL-SETUP.md §7). | as above |
| Poll | Posts API with `content.poll` | question ≤ 140 characters, 2–4 options of ≤ 30 characters, duration ONE_DAY / THREE_DAYS / SEVEN_DAYS / FOURTEEN_DAYS †. A poll has no media. | as above |

Other points:
- There is no idempotency key in the Posts API. Any duplicate-content
  refusal LinkedIn may apply is undocumented and is not relied on.
- No limitation was found that rules out any of the 56 combinations.
- Whether Pages 2 and 3 accept video and poll uploads from this connection
  is **not verified**.

Sources:
- [Poll API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/poll-post-api?view=li-lms-2023-06)
- [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2024-11)
- [LinkedIn video format requirements (swat.io)](https://help.swat.io/en/articles/11979602-linkedin-videos-format-requirements)
- [Company Page posting via API (postproxy)](https://postproxy.dev/how-to/post-to-linkedin-company-page/)
- [LinkedIn API errors (bundle.social)](https://bundle.social/linkedin-api/errors)

---

## Isolated testing: what is possible on the Free plan

The current organization has both active slots in use and one data store,
which is the production one. Any live test there either uses the production
store or needs a third active scenario. Both are ruled out. The options:

1. **Immediate tests in this organization, with no data store.**
   - Import `make/unified/test/unified-immediate-publisher.test.json` into
     the existing inactive test scenario 7904894, on test webhook 3885267.
   - Point the test Vercel project's `MAKE_MULTI_WEBHOOK_URL` at that
     webhook.
   - Publish a labelled `TEST —` post.
   - The request waits in the queue, and Unison shows **queued**. Then press
     **Run once** in Make, once per Page request.
   - This needs no third active slot and touches no production data. It
     costs 4 operations per Page.
   - It cannot test the look-up, the claim, scheduling or status, because all
     of them need a store.
   - Unison never receives the result, since the webhook was answered at
     queue time. Check the Make run and the Page, then **Check status**
     (which says "not available in this test copy").
2. **A second, separate Make organization (Free) for the full test.** It has
   its own 2 active slots, its own data store, and 1,000 operations.
   - Before relying on it, someone who administers the three Pages must
     authorise a new LinkedIn connection in that organization.
   - LinkedIn normally allows a second token for the same member and app.
     It was **not verified** that this leaves connection 10513797
     untouched. Watch the next production run afterwards.
   - Generate its blueprints with `--profile isolated` and that
     organization's IDs.
   - This is the only way to test scheduling, claims and status live before
     cutover.
3. **Supervised verification at cutover**, with your approval, following
   the steps in CUTOVER.md.

Things in Make that the new rules ask you to clean up, or to approve me
cleaning up. Nothing has been deleted.
- **Scenario 7904894's current blueprint** (the 12 October test copy) writes
  `mt:` records into the production store. Replace it with the no-store test
  copy before any further Run once.
- **Scenario 7904912**, the old test scheduler, writes `mt*` records into
  the production store. Do not run it. Delete it when convenient.
- **Record `mt:p-w-mv6b6w74uc7u~test-2`** in the production store is from
  the 13 October test. It is `published`, and no scheduler selects it. It is
  harmless, but it is test data in production; delete it in Make if you
  approve.
- The 13 October requests in test webhook 3885267's queue are **gone**:
  - the queue is 0;
  - the test scenario has one run in total (the 06:38 Run once);
  - so they were removed, not run.

---

## G. Readiness

| Item | Status |
|---|---|
| Production audit (both scenarios, webhook, structure, store, connection, plan) | **PASS — verified** (live, read-only) |
| Production unchanged during this work | **PASS — verified** |
| Two replacement blueprints generated | **PASS — verified** (structure tests). The four new module types were validated with Make's module validator. |
| Blueprints imported and run in Make | **NOT VERIFIED — needs live or manual testing** |
| 56 combinations, mocked | **PASS — verified** (mocked) |
| 56 combinations on LinkedIn through the unified scenarios | **NOT VERIFIED — needs live or manual testing** |
| Failure, retry and idempotency behaviour | **PASS — verified** (mocked) |
| Single-Page and pending-job compatibility with production | **PASS — verified** (mocked, against the production blueprints) |
| Accurate per-Page status, including scheduled status | **PASS — verified** (mocked and browser) |
| Pages 2 and 3 accept video and poll from connection 10513797 | **NOT VERIFIED — needs live or manual testing** |
| Live scheduled or multi-Page test in the current organization | **BLOCKED — cannot proceed safely.** It would need the production store or a third active scenario. Use option 1 or 2 above. |
| Simultaneous-scheduler race | **BLOCKED — cannot proceed safely** by mechanism. It is avoided by the cutover rule. |
| Test app repository `drashtirmakwana15-rgb/unison-content-os-ux-test` and its Vercel variables | **NOT VERIFIED.** That repository is not reachable from this session. The push and preview commands are in WINDOWS-SETUP.md §9. |
| Cutover | Not started. Needs your approval. |

**Verdict: ready for isolated testing.** It becomes ready for cutover review
once option 2 (or option 1 plus the scheduled parts at a supervised cutover)
has passed with recorded urns. Production follows only after that and your
explicit approval.
