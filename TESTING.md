# Unison Content OS — test results

Everything below is either an actual end-to-end test or is marked as not
tested. Nothing is inferred from a module being valid, a scenario being
active, or a webhook answering `200`. Run on **2026-09-24** against the live
Make scenarios and the **Unison Content OS Test** page
(`urn:li:organization:146260120`).

Labels: **PASS** actually tested end to end, with the id LinkedIn returned ·
**FAIL** tested and failed · **BLOCKED** cannot be tested here, with the
reason · **NOT TESTED** no test was performed.

## Final state of every post type

| Post Type | Immediate | Scheduled | Evidence |
|---|---|---|---|
| Text | **PASS** | **PASS** | Scheduled: `urn:li:share:7508849111392178176`. Immediate: `urn:li:share:7508197870823485442`, `urn:li:share:7508197874028138496` |
| Image | **PASS** | **PASS** | Scheduled: `urn:li:share:7508814445381505025`. Immediate: `urn:li:share:7508197880621551616` |
| Video | **BLOCKED here** | **PASS** | Scheduled: `urn:li:ugcPost:7508848961080852483` — a real H.264 MP4 carried through the data store, uploaded by the scenario, accepted by LinkedIn. Immediate uses the same module and mapping but starts at the webhook, which this session cannot reach |
| Poll | **PASS** | **PASS** | Scheduled: `urn:li:ugcPost:7508849114902781952`. Immediate: `urn:li:ugcPost:7508814448984354818` |
| Multi-image | **REMOVED** | **REMOVED** | Attempted properly and blocked at the binary upload — see below. Removed from Unison rather than left selectable |
| Document | **REMOVED** | **REMOVED** | Same blocker. Removed from Unison |

Article and carousel were also removed: carousel because LinkedIn has no
organic carousel API at all, article because it is no longer wanted as a
separate Unison post type.

Every immediate id above came from a post published from Unison through the
webhook by you; the scheduled ones were published by the scheduler while this
session watched. Immediate **video** is the single row without its own id,
for the reason in the next section.

## What could not be tested from here, and why

This session's network policy refuses `hook.eu1.make.com` — the proxy answers
`403` to the CONNECT, so no request of mine reaches the webhook. Everything
that *starts* at the webhook is therefore untestable here. Make's run API does
not help: `scenarios_run` with a payload does not feed a webhook trigger,
which was checked rather than assumed (a probe payload produced no record).

The scheduled half does not go through the webhook once a post is queued, so
it was tested in full by writing records into the data store and running the
scheduler. Those are real LinkedIn posts.

**To close the immediate-video row** takes about two minutes: in Unison write
a post, add **Video**, press **Publish now**, and read the LinkedIn id off the
Performance panel. Scenario A now also writes that id into the data store, so
`python3 make/dump-records.py` will show it afterwards.

## Scheduled publishing, in detail

| # | Post type | Result | Evidence |
|---|---|---|---|
| 1 | Text | **PASS** | `urn:li:share:7508849111392178176` · record `t-sched-text-02`, re-tested on the final blueprint after the route filter changed |
| 2 | Image | **PASS** | `urn:li:share:7508814445381505025` · record `p-w-muf9vpo9ud3p`, a real post scheduled from Unison and published by the scheduler. Route unchanged since |
| 3 | Video | **PASS** | `urn:li:ugcPost:7508848961080852483` · record `t-sched-video-03`, a real H.264/MP4 file. Media cleared from the record afterwards (`media=0/0B`) |
| 4 | Poll | **PASS** | `urn:li:ugcPost:7508849114902781952` · record `t-sched-poll-02`, built from `content.poll` on the Posts API and read back from LinkedIn's `x-restli-id` header |

### The two video failures before it, and what they were

Two earlier scheduled-video tests came back
`PROCESSING_FAILED — Uploaded file is corrupted`. Both times the file really
was corrupt, and both times **the corruption was mine**: the base64 had to be
typed into a Make API call by hand, and a run of near-identical characters lost
16 characters once and 80 characters the time before. Both were caught by
hashing the stored value against the source file, not by guessing.

The lesson is worth keeping: LinkedIn accepts a damaged video, spends about a
minute transcoding it and only then fails it. If a video ever fails this way,
compare a hash of the stored base64 against the file **before** touching the
scenario. The pipeline was never the problem.

## Scheduling behaviour

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

262 unit tests (`npm test`) and 34 browser tests (`npx playwright test`) pass.

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

## Not tested, and honest about it

- **Immediate video** — blocked by this session's network policy, as above.
  Two minutes in a browser closes it.
- **Behaviour at LinkedIn's rate limit** — cannot be provoked without
  deliberately flooding the page, which you asked me not to do. The handling
  is in place: a 429 lands on the error route, is recorded with LinkedIn's
  message, and does not stop other posts.
- **An expired LinkedIn connection** — the current one runs to 2027-09-22.
  An expired token surfaces as a 401 through the same error route.
- **A browser that records H.264** — this container's Chromium cannot, so the
  MP4 branch of the recorder is exercised by the codec-preference list and by
  the scheduled-video test's real MP4, not by recording one here. Chrome and
  Edge on a normal machine take that branch.

## State of the data store

`python3 make/dump-records.py` prints it one readable line per record.

Test records left behind: `t-sched-text-02`, `t-sched-poll-02`,
`t-sched-video-03`. None is `queued`, so the scheduler ignores them; they hold
no media and they are the evidence behind the table above. Delete them
whenever you like.

**One record wants your decision.** `p-w-mucmzs59y8ua` is an image post you
published on 2026-09-22. It is done — it has its LinkedIn id — but it is still
holding **398 KB of base64**, which is 38% of the whole 1 MB store. That is
dead weight in the queue every scheduled post has to fit around, and it
predates the fix that clears media after publishing. Clearing it is a change
to your data, so I have left it: say the word and it goes.

Posts sent to the test page during this session: one scheduled text, one
scheduled poll and one scheduled video. The two failed video attempts created
no post.

## Operations budget

Make's free plan allows 1,000 operations a month. **460 used, 540 left**,
resetting **2026-10-03**. The scheduler spends 24 a day checking the queue, so
about 216 of those 540 go on queue checks over the next nine days and the rest
is yours for publishing.

Steady state after the reset is 720 a month for the queue checks, leaving
roughly 280 — about 70 scheduled posts. Each immediate post now costs one
operation more than before, for the record that keeps its LinkedIn id; a text
post is 4 operations instead of 3.

If the team will post more than that, or wants publishing nearer the minute
than the hour, the Make plan is the thing to change, not the scenarios.
