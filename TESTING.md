# Unison Content OS — test results

Everything below is either an actual end-to-end test or is marked as not
tested. Nothing is inferred from a module being valid, a scenario being
active, or a webhook answering `200`. Last run **2026-09-25** against the live
Make scenarios and the **Unison Content OS Test** page
(`urn:li:organization:146260120`).

Labels: **PASS** actually tested end to end, with the id LinkedIn returned ·
**FAIL** tested and failed · **BLOCKED** cannot be tested here, with the
reason · **NOT TESTED** no test was performed.

## Final state of every post type

Tested **2026-09-25** on the live **Unison Content OS Test** page
(`urn:li:organization:146260120`). Every row below was produced by pressing
the buttons in Unison — no seeded records, no replayed payloads, no hand-built
JSON. Each id is what LinkedIn returned.

| Post Type | Immediate | Scheduled | Immediate URN | Scheduled URN |
|---|---|---|---|---|
| Text | **PASS** | **PASS** | `urn:li:share:7509146380729409536` | `urn:li:share:7509156810465894401` |
| Image | **PASS** | **PASS** | `urn:li:share:7509148286042333184` | `urn:li:share:7509156816866664448` |
| Video | **PASS** | **PASS** | `urn:li:ugcPost:7509151527782154240` | `urn:li:ugcPost:7509156849212948480` |
| Poll | **PASS** | **PASS** | `urn:li:ugcPost:7509151850521255936` | `urn:li:ugcPost:7509156852409126912` |
| Multi-image | **REMOVED** | **REMOVED** | — | — |
| Document | **REMOVED** | **REMOVED** | — | — |

The four scheduled posts were queued by the real UI between 07:10 and 07:32
UTC and published together by a **genuine automatic scheduler run** at
07:48:16 (`authorId: null` — the timer, not a person). Nothing was forced.

Media survived both handoffs intact and was cleared afterwards:

| Record | In the store while queued | After publishing |
|---|---|---|
| `p-w-mugmi70sngg9` image | 1 × `image/png`, 399,956 chars base64 | cleared |
| `p-w-mugmogs511yq` video | 2 × media, `video/mp4`, 427,856 chars | cleared |
| `p-w-mugn4odql3el` poll | question + 4 options + `1 week` | cleared |

## Why scheduled publishing had stopped

Scenario B's **timer was dead**, and everything about it looked healthy.

Updating a scheduled scenario's blueprint through the Make API silently stops
its schedule. `isActive` stays `true`, `isinvalid` stays `false`, `isPaused`
stays `false`, and `nextExec` keeps showing a plausible time an hour out. It
simply never fires.

The tell is in the execution history. An automatic run carries
`authorId: null`; a manual one carries a user id. After the blueprint edit on
**2026-09-24 11:06** every execution had a user id on it. The last genuine
automatic run was **09:07 that morning** — twenty-two hours earlier. Four real
scheduled posts sat correctly queued, correctly dated and correctly due, and
nothing came to collect them.

Re-armed by pushing the *schedule* rather than the blueprint:

```
scenarios_update(scenarioId: 7524924, scheduling: {type: "indefinitely", interval: 3600})
```

The next automatic run fired three seconds later and published all four.

**`isActive: true` is not evidence that a scheduled scenario runs.** After any
change to scenario B, list its executions and look for one with
`authorId: null` dated after the edit.

## Immediate Poll was not broken

It was reported as failing; it was not. The poll pressed in the UI at
**07:28:33** ran to completion — 8 operations, `status: 1` — and published as
`urn:li:ugcPost:7509151850521255936`. The Posts API body is built by
`json:CreateJSON` against a data structure, with the options collected by the
Iterator/Aggregator pair, the organization as author, `commentary`,
`content.poll.question`, `content.poll.options` and
`content.poll.settings.duration`. Nothing was changed for this pass.

## The outage this pass found

Every post between **2026-09-24 12:27** and **2026-09-25 06:33** silently
failed. Unison said "Sent to Make — waiting for LinkedIn to confirm"; nothing
reached LinkedIn.

The scenario had been edited by hand in Make at 12:27, which put
`gateway:WebhookRespond` modules back inside the `onerror` routes. Make
accepts that on save and then refuses to initialise the scenario when a
payload arrives — six modules, six problems — and switches it off. Eight
payloads piled up in the webhook queue.

Two things came out of it:

- **Make.** The validated blueprint was restored and the scenario
  reactivated. Two of the queued payloads were kept and deliberately let
  through as the production test above; the rest were cleared so old attempts
  could not publish at random.
- **Unison.** A bare "Accepted" from Make now fails the post instead of
  reporting it as in flight. The immediate routes answer every post with an
  explicit result, so a bare acceptance means the scenario never got to its
  response — nothing was published. A reply that says `failed` or `rejected`
  outright now fails too; it used to fall through to the same waiting state.

> **If you edit either scenario in Make, never put a Webhook response inside
> an error handler.** It saves without complaint and breaks the scenario at
> the next real payload. Record the failure in the data store instead, which
> is what the restored blueprint does.

## publishMode, audited against real payloads

Taken from the webhook queue and from the data store, not from the source:

| | Immediate | Scheduled |
|---|---|---|
| `publishMode` | `"now"` | `"scheduled"` |
| `scheduledDate` / `scheduledTime` | absent / null | the chosen date and time |
| Enters the queue? | no | yes, `status: "queued"` with `dueAt` |

Immediate posts are **not** leaking into the scheduled queue. The date and
time shown next to **Publish now** belong to **Schedule post**; the panel now
says so, which is what made it look otherwise.

One real finding: Unison sends `companyUrn: null` when the Page was connected
through the Make workflow rather than by signing in. Make falls back to
`urn:li:organization:146260120`, so posts land correctly — but the fallback is
load-bearing, and it is in every route.

## Scheduling behaviour

### How close to the chosen minute a post actually goes out

Two routes, chosen on the schedule panel:

| Route | Who publishes | Delay | Make operations | Needs Unison open |
|---|---|---|---|---|
| **In-app** (default) | Unison, through the immediate route | **seconds** — it checks every 30 s | 1 (the publish itself) | Yes |
| **Hand to Make** | Scenario B, from the data store queue | **0–60 minutes after the chosen time, never before** | 1 per hourly check + 3–4 to publish | No |

The two are mutually exclusive by construction: *Hand to Make* sets
`scheduledHandoff` on the post record, and the in-app publisher skips any post
carrying it. Proven by `e2e/publish-payload.spec.js` → *publishing a scheduled
post on time*, which is two tests: a post whose minute has passed is published
with no click anywhere after a reload (and goes out as `publishMode: "now"`,
i.e. the immediate route), and a post already handed to Make is left alone for
45 seconds of live ticking without a second request leaving the browser.

Why the Make route cannot be made tighter on this plan — measured, not
assumed:

| Interval attempted | Result |
|---|---|
| `interval: 300` (5 min) | `MakeApiError: Scenario execution interval is too short` |
| `interval: 600` (10 min) | `MakeApiError: Scenario execution interval is too short` |
| `interval: 900` (15 min) | Accepted — but 2,880 checks/month against a 1,000-operation allowance |
| `interval: 3600` (1 hour) | Accepted, 720 checks/month, fits — **in use** |

The plan reports the floor itself: `license.interval: 15` minutes,
`license.operations: 1000`. Make has no event-driven trigger that could
replace the timer; its only externally-fired trigger is a webhook, and nothing
exists at the scheduled minute to call one.

| # | Case | Result | Evidence |
|---|---|---|---|
| 5 | A future post must not publish early | **PASS** | A record queued 24 h out. Scheduler run found nothing; the record was still `queued` afterwards |
| 6 | A due post publishes on the first eligible run | **PASS** | Same record with `dueAt` moved into the past: the very next run published it — 4 operations, search, claim, LinkedIn, record |
| 7 | It cannot publish twice | **PASS** | An immediate second run produced no execution at all: the search found nothing to do and the id on the record was unchanged |
| 8 | An interrupted run is recovered, not repeated | **PASS** | A record planted as `publishing` with a stale claim became `stuck` with a note telling the reader to check the page first. **Not** republished |
| 9 | Timezone is respected | **PASS** | `dueAt 1790078880` = 12:08 UTC = 17:38 Asia/Calcutta, the time that was asked for |
| 10 | A published record stops holding its media | **PASS** | Every published record above shows `media=0/0B` with the rest intact. Took three attempts — an empty array and `slice()` are both read by *Update a record* as "leave it alone"; *Add/replace* was the answer |

## Failure handling

| # | Case | Result | Evidence |
|---|---|---|---|
| 11 | LinkedIn refuses a post → recorded, not published | **PASS** | A record pointed at a page that does not exist → `failed`, note: *403: Accessing the resource is forbidden* |
| 12 | One refused post does not stop the others | **PASS** | A refused post and a good one in the same batch: the good one published, the scenario stayed active |
| 13 | A refusal does not trip Make's three-error limit | **PASS** | Two handled refusals in one run, scenario still `isActive: true`, `isinvalid: false` |
| 14 | A failure records **why** | **PASS** | LinkedIn's own words land on the record. Make exposes a failure to its error route under the failed module's id — `{{18.error.message}}`, not `{{error.message}}`, which is why earlier notes were blank |
| 15 | A withdrawn post type from an old copy of Unison is held, not dropped | **PASS** | Route filters on `multi`, `document`, `carousel`, `article` store the whole post at `unsupported` and answer with what to do about it |

## Unison, tested as code

366 unit tests (`npm test`) and 42 browser tests (`npx playwright test`, both
projects) pass.

The browser tests include `e2e/publish-payload.spec.js`, which asserts on the
**request body Unison actually sends**, not on what the screen says — written
because "Make returned 200" was never evidence that the right bytes went out.

| # | Case | Result |
|---|---|---|
| 16 | Only Image, Poll and Video can be added to a post; the four withdrawn types are not selectable | **PASS** |
| 17 | A generated video is encoded at publish time and sent as a real file, with no manual Export | **PASS** |
| 18 | The file's declared `mimeType` matches what the browser really recorded, and a non-MP4 is said so on screen | **PASS** |
| 19 | A scheduled video is re-encoded small enough to fit Make's data store, and the post says so | **PASS** |
| 20 | An image post sends exactly one PNG, with bytes | **PASS** |
| 21 | A poll sends its question and options as data, not as a picture | **PASS** |
| 22 | A text post sends no media, and its idempotency key is its post id | **PASS** |
| 23 | A bare `200`/`ok`/`Accepted` is never read as published | **PASS** |
| 24 | A queued reply is not read as published, whatever ids ride along | **PASS** |
| 25 | Each of the six Make replies maps to its own state | **PASS** |
| 26 | A dead webhook is classified as `hook-dead`, not a generic failure | **PASS** |
| 27 | Scheduled media over the store budget is refused before sending | **PASS** |
| 28 | A video gets 120 s to upload rather than 45 s | **PASS** |
| 29 | A post whose minute has passed is published by Unison itself, with no click anywhere after a reload, through the immediate route | **PASS** |
| 30 | A post already handed to Make is left alone by the in-app publisher — 45 s of live ticking, no second request | **PASS** |

## The times Content shows

Three stored moments, never one field relabelled. `publishedAt` is only ever
set from a confirmation — LinkedIn's own reply, Make answering `published`, or
the user's own "I've checked, it's live". It is never the scheduled time,
never the moment the webhook accepted the request, and never `now()` at the
click.

| # | Case | Result |
|---|---|---|
| 36 | An immediate post shows a **Published** time and no scheduled line at all | **PASS** |
| 37 | A post handed to Make shows **Scheduled** and **Sent to Make**, and **Published — Not yet confirmed** | **PASS** |
| 38 | A scheduled post Unison publishes itself shows both times, they differ, and the gap is stated | **PASS** |
| 39 | Publishing replaces the scheduled row without losing the minute it was scheduled for | **PASS** |
| 40 | Make taking and publishing a post in one round trip is one event, not two identical stamps | **PASS** (unit) |
| 41 | A row saved by an older build still reads, from its date, time and zone | **PASS** (unit) |
| 42 | A post with no recorded time shows no time rather than a guess | **PASS** (unit) |
| 43 | Times render in the post's own zone, with the abbreviation that zone is known by (IST, EDT, BST) | **PASS** (unit) |

Covered by `e2e/content-times.spec.js` and `tests/posts.test.js`.

Note: the sample posts that ship with the demo carry a date but no publication
time, because none of them was ever published. They show the date alone rather
than being given a fabricated minute.

## Content intelligence and visual choice

Ten posts run through the real pipeline — classify, decide, render, gate. Two
are deliberately flawed, to prove the gate is real rather than decorative.

| # | Post | Read as | Country | Visual chosen | Gate |
|---|---|---|---|---|---|
| 1 | Monthly close explainer | How something works | — | Process steps | PASS |
| 2 | Making Tax Digital, 6 April 2026 | Tax or regulatory update | UK | Statistic card, £50,000, Source: gov.uk | PASS |
| 3 | 1099 / W-9 vendor data | Tax or regulatory update | US | Fact card, Source: irs.gov | PASS |
| 4 | Self Assessment, October vs January | Tax or regulatory update | UK | Fact card, Source: gov.uk | PASS |
| 5 | Australian year end, 30 June | Season readiness | AU | Process steps, "Australian · ATO" | PASS |
| 6 | Diwali greeting | Festival or occasion | — | Occasion graphic — diyas, rangoli, its own palette | PASS |
| 7 | Turnaround case study | Result or case study | US | Statistic card, **9 days** (the result, not the 14 it improved on) | PASS + warns the figure has no source on it |
| 8 | Hiring, three offices | Hiring | US | Open roles, CTA under them | PASS |
| **9** | **CONTROL** — invented 38% + filler | — | — | — | **BLOCKED ×2**: unsourced figure; "in today's fast-paced", "game-changer", "cutting-edge solutions" |
| **10** | **CONTROL** — HMRC and IRS in one post | — | US+UK | — | **BLOCKED**: mixed jurisdiction |

Before this pass, all ten produced the same four rotating layouts, chosen by
`variant % 4` with no reference to the post at all.

### Bugs this testing found, and fixed

Each was caught by running the cases and looking at the output, not by
reasoning about the code:

| Symptom | Cause |
|---|---|
| A monthly-close post classified as a US tax update | `"irs"` matched inside **"first"**. `"cra"` matched inside "scramble", `"bas"` inside "based", `"ato"` inside "automation". Terms now match on word boundaries |
| An Australian year-end checklist classified as regulatory | The cue `"act"` matched **"actually"**. Cues under five characters now need a whole-word match |
| A UK tax post classified as a **New Year greeting** | `"2026"` was an alias for New Year. Bare years removed |
| A properly sourced £50,000 reported as invented | The figure was captured as `"£50,000."` — with the sentence's full stop — so it never matched the research |
| A four-step checklist rendered as a comparison | One step contained "rather than". Sequence is now tested first, and a comparison must be structurally two-sided |
| Three festival graphics all rendered in Diwali's colours | Every template defines `id="occ"`; two on one page collide. Each render now gets its own id namespace |
| The Eid crescent did not draw | Two arcs cancelling. Now a masked disc |
| Headlines cut mid-clause ("…and the first cohort is") | Character-count truncation. Now cuts at a sentence or clause boundary and never ends on a dangling word |
| Steps showed "1." twice — the writer's and the template's | The writer's numbering is now stripped |
| A hiring graphic captioned "US · IRS" | The regulator is now named only where it is genuinely the authority |
| A case study captioned `Source: irs.gov` | The source is only filled where that authority really is the source. Otherwise empty — and the gate then asks for a real one |
| A statistic card showing **14 days** when the post was about falling **to 9** | "from X to Y" now resolves to Y |
| The gate passed a figure with no source visible | It checked the field, not whether the template draws it |

### Covered by tests

`tests/intel.test.js` (37) and `tests/quality.test.js` (17). Every bug above
has a test named after the symptom, so it cannot come back quietly.

## The uploaded document, audited

The question asked was whether *Upload a document* does anything, and if not,
to remove it. It does — it was just invisible, and it did nothing at all when
the AI layer was unavailable. Kept, and made to show its work.

What it does now, end to end: the file's text is read in the browser
(`.docx` via mammoth, `.txt/.md/.csv/.json` directly, uncompressed PDFs on a
best-effort basis), material is extracted from it, and that material becomes
**a tier-1 source at the top of Sources** and **claims in `research.claims`,
which is the list handed to the writer** — plus the file name and its figures,
named as the user's own document, in the writer's prompt.

| # | Case | Result |
|---|---|---|
| 31 | With no AI configured at all, the upload still lands: tier-1 source, claims quoted from the document's own sentences, and the panel says "Read without AI" rather than passing them off as analysis | **PASS** |
| 32 | With a model behind it, the document's insight appears in *What stood out* under **From your document**, beside the engine's own | **PASS** |
| 33 | The writer's prompt names the file and carries its figures | **PASS** |
| 34 | The document survives a reload — once, not twice | **PASS** |
| 35 | Re-uploading, or re-running research on the same post, does not stack the same document up twice, and the other sources' claims keep pointing at the right row | **PASS** (unit) |

Covered by `e2e/source-document.spec.js` and `tests/doc.test.js`.

## Not tested, and honest about it

- **Behaviour at LinkedIn's rate limit** — cannot be provoked without
  deliberately flooding the page. The handling is in place: a 429 lands on the
  error route, is recorded with LinkedIn's message, and does not stop other
  posts.
- **An expired LinkedIn connection** — the current one runs to 2027-09-22. An
  expired token surfaces as a 401 through the same error route.
- **A browser that records H.264** — this container's Chromium cannot, so the
  MP4 branch of the recorder is covered by the codec-preference list rather
  than by recording one here. The user's own machine takes that branch: the
  video posts above were `video/mp4`.

## State of the data store

Fourteen records, every one `published` with its LinkedIn id, and **no media
on any of them** — the scheduled image and video cleared their base64 as they
published. Nothing is `queued`, so nothing can go out unexpectedly.

It peaked at **85% of the 1 MB store** while the scheduled image (400 KB) and
video (487 KB) were both waiting. That is the real ceiling on this plan: two
media posts queued at once very nearly fills it, and a third would be refused.
Unison already refuses a single scheduled post over ~600 KB before sending,
but it cannot see what is already in the store. If you queue media posts in
batches, publish them before adding more. `python3 make/dump-records.py`
prints the store one line per record, with a total.

## Operations budget

Make's free plan allows 1,000 operations a month. **573 used, 427 left**,
resetting **2026-10-03**. The scheduler spends 24 a day checking the queue, so
about 190 of those 427 go on queue checks over the remaining eight days and
the rest is yours for publishing.

The scheduler was briefly set to 15 minutes to observe a genuine automatic run
during this pass, then put back to hourly. Fifteen minutes is 2,880 operations
a month — it would exhaust the plan in about four days and stop publishing
altogether. Hourly, at 720 a month, is the only interval this plan affords.

Steady state after the reset is 720 a month for the queue checks, leaving
roughly 280 — about 70 scheduled posts. Each immediate post now costs one
operation more than before, for the record that keeps its LinkedIn id; a text
post is 4 operations instead of 3.

If the team will post more than that, or wants publishing nearer the minute
than the hour, the Make plan is the thing to change, not the scenarios.
