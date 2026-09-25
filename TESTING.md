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
(`urn:li:organization:146260120`). Every id below is what LinkedIn returned.
Every immediate row was produced from **the user's own Unison payload**, taken
from the webhook queue or replayed from a real execution — not reconstructed,
not hand-seeded.

| Post Type | Immediate | Scheduled | Evidence |
|---|---|---|---|
| Text | **PASS** | **PASS** | Immediate `urn:li:share:7509139343828164608`. Scheduled `urn:li:share:7508849111392178176` |
| Image | **PASS** | **PASS** | Immediate `urn:li:share:7509137974236872704`. Scheduled `urn:li:share:7508814445381505025` — queued by the real webhook, published by the scheduler |
| Video | **PASS** | **PASS** | Immediate `urn:li:ugcPost:7509138493772697600` — the user's real 4 MB payload. Scheduled `urn:li:ugcPost:7508848961080852483` |
| Poll | **PASS** | **PASS** | Immediate `urn:li:ugcPost:7509137969702907905`. Scheduled `urn:li:ugcPost:7509139221757190144` — the complete path: Unison → webhook → data store → scheduler → LinkedIn |
| Multi-image | **REMOVED** | **REMOVED** | Not offered. `initializeUpload` succeeds; the binary PUT needs a host Make's LinkedIn module cannot call |
| Document | **REMOVED** | **REMOVED** | Same blocker |

Article and carousel are removed too. A post of any of the four withdrawn
types, sent by an older copy of Unison, is held in Make with its text and
media and answered with what to do about it — verified on 2026-09-25 by an
article payload that came back `unsupported`.

### Scheduled text and video: what exactly was proven

Both were published by the scheduler from a queued record, against the live
Page. For **poll** and **image** the record was put in the queue by the real
webhook as well, so those two are unbroken production runs end to end. For
text and video the record was seeded directly. That gap is narrower than it
sounds: the queue is filled by **one** route shared by all four types
(scenario A route 5), and that route is proven by the poll and image runs.

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

- **Pressing the buttons in your browser.** This session's network policy
  refuses `hook.eu1.make.com`, so nothing here can post to the webhook
  directly. Every immediate result above was instead produced from your own
  payloads — two taken out of the webhook queue where they had been stuck,
  three replayed from your real executions — which exercises the identical
  path from the webhook onwards. What it does not exercise is the browser's
  own request to Make. That part is now covered by the failure handling
  rather than by a test: if the request does not reach a working scenario,
  Unison says so instead of reporting the post as in flight.
- **Behaviour at LinkedIn's rate limit** — cannot be provoked without
  deliberately flooding the page, which you asked me not to do. The handling
  is in place: a 429 lands on the error route, is recorded with LinkedIn's
  message, and does not stop other posts.
- **An expired LinkedIn connection** — the current one runs to 2027-09-22.
  An expired token surfaces as a 401 through the same error route.
- **A browser that records H.264** — this container's Chromium cannot, so the
  MP4 branch of the recorder is exercised by the codec-preference list and by
  the real MP4 used in the video tests, not by recording one here. Chrome and
  Edge on a normal machine take that branch.

## State of the data store

Cleared on 2026-09-25. Six records remain, every one `published` with its
LinkedIn id and **no media at all** — nothing queued, so nothing can publish
unexpectedly. The 398 KB record that had been holding 38% of the 1 MB store
since 22 September is gone, so the scheduling queue has its full capacity
back. `python3 make/dump-records.py` prints it one line per record.

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
