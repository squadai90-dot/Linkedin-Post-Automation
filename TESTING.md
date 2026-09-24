# Unison Content OS — test results

Everything below is either an actual end-to-end test or is marked as not
tested. Nothing is inferred from a module being valid or a scenario being
active. Run on **2026-09-24** against the live Make scenarios and the
**Unison Content OS Test** page (`urn:li:organization:146260120`).

Labels: **PASS** actually tested end to end · **FAIL** tested and failed ·
**BLOCKED** cannot be tested here, with the reason ·
**NOT TESTED** no test was performed.

## The one thing blocking the immediate half

This session runs in a sandbox whose network policy refuses
`hook.eu1.make.com` — the proxy answers `403` to the CONNECT, so no request
of mine can reach the webhook. Everything that starts at the webhook is
therefore **BLOCKED here and must be tested from a browser**, which takes
about five minutes: see *Immediate publishing — your five-minute check*.

The scheduled half does not go through the webhook once a post is queued, so
it was tested in full by writing records into the data store and running the
scheduler. Those results are real LinkedIn posts.

## Scheduled publishing

| # | Post type | Result | Evidence |
|---|---|---|---|
| 1 | Text | **PASS** | `urn:li:share:7508794230853582848` · re-tested on the final blueprint (earlier pass: `…7508756712405929985`) |
| 2 | Article | **PASS** | `urn:li:share:7508756911819956227` · record `t-sched-article-01` → `published`, article body still on the record |
| 3 | Image | **PASS** | `urn:li:share:7508766855591997440` · record `t-sched-image-01`, real base64 PNG uploaded by the scenario (earlier passes: `…7508760940100833280`, `…7508766041884221440`) |
| 4 | Poll | **PASS** | `urn:li:ugcPost:7508794234217517058` · re-tested on the final blueprint; urn read from LinkedIn's `x-restli-id` header (earlier pass: `…7508760528153071616`) |
| 5 | Video | **FAIL, on my test file** | The route ran end to end and LinkedIn gave a real verdict on real bytes: `PROCESSING_FAILED — Uploaded file is corrupted`. The file *was* corrupt: 80 characters were lost transcribing 42,140 characters of base64 into the test record, confirmed by hashing the stored value against the original. So the base64 → binary → upload → LinkedIn path works; what is unproven is a **good** video reaching the feed. Needs one real upload from Unison |
| 6 | Multi-image | **BLOCKED** | Tested, not assumed: `initializeUpload` succeeds, the binary PUT returns `405 Not Allowed`. Make's LinkedIn module only calls `api.linkedin.com`; the upload URL is on another host. See `make/README.md` |
| 7 | Document | **BLOCKED** | Same two-step upload as multi-image, same 405. Held at `unsupported` with its reason |
| 8 | Carousel | **PASS as held** | Record `t-sched-carousel-01` → `unsupported` with the reason on the record |

"Held" is the correct outcome, not a failure: LinkedIn's API cannot create
those three from a single call. See the post-type table in the README.

## Scheduling behaviour

| # | Case | Result | Evidence |
|---|---|---|---|
| 9 | A future post must not publish early | **PASS** | `t-sched-text-01` queued for `dueAt` 24 h out. Scheduler run `b9987144…` found nothing; the record was still `queued` afterwards |
| 10 | A due post publishes on the first eligible run | **PASS** | Same record, `dueAt` moved into the past. The very next run `b7927b86…` published it — 4 operations: search, claim, LinkedIn, record |
| 11 | It cannot publish twice | **PASS** | An immediate second run, `f0d71453…`, produced no execution at all: the search found nothing to do, and the urn on the record was unchanged |
| 12 | An interrupted run is recovered, not repeated | **PASS** | `t-sched-stuck-01` planted as `publishing` with a stale claim → became `stuck` with a note telling the reader to check the page first. **Not** republished |
| 13 | Timezone is respected | **PASS** | `dueAt 1790078880` = 12:08 UTC = 17:38 Asia/Calcutta, the time that was asked for |
| 14 | A published record stops holding its media | **PASS** | `t-sched-image-01` after publishing: `media=0/0B`, everything else on the record intact. Took three attempts — an empty array and `slice()` are both read by *Update a record* as "leave it alone"; *Add/replace* was the answer |

## Failure handling

| # | Case | Result | Evidence |
|---|---|---|---|
| 15 | LinkedIn refuses a post → recorded, not published | **PASS** | `t-sched-fail-01` (a company page that does not exist) → `failed`, note: *403: Accessing the resource is forbidden. Please check your permissions for this resource* |
| 16 | One refused post does not stop the others | **PASS** | In run `5d94cf40…` the refused post and the article were in the same batch. The article published; the scenario stayed active |
| 17 | A refusal does not trip Make's three-error limit | **PASS** | Two handled refusals in one run, scenario still `isActive: true`, `isinvalid: false` |
| 18 | A failure records **why** | **PASS** | LinkedIn's own words land on the record. Make exposes a failure to its error route under the failed module's id — `{{18.error.message}}`, not `{{error.message}}`, which is why earlier notes were blank |

## Unison, tested as code

262 unit tests pass (`npm test`), including the publishing contract:

| # | Case | Result |
|---|---|---|
| 19 | A bare `200`/`ok`/`Accepted` is never read as published | **PASS** |
| 20 | A queued reply is not read as published, whatever ids ride along | **PASS** |
| 21 | Each of the six replies maps to its own state | **PASS** |
| 22 | A dead webhook is classified as `hook-dead`, not a generic failure | **PASS** |
| 23 | Scheduled media over the store budget is refused before sending | **PASS** |
| 24 | A video gets 120 s to upload rather than 45 s | **PASS** |

## Immediate publishing — BLOCKED here, your five-minute check

All six immediate routes and the webhook contract are **BLOCKED** from this
session for the network reason above. They are built, valid and active, and
the blueprints are in `make/`. To confirm them yourself:

1. Open Unison → **Settings → Publishing**. Paste
   `https://hook.eu1.make.com/mkm7o4tvytb4cgfs91se3qnjy5pvucge` into
   **Make webhook URL** and press **Test webhook**. It must say the webhook
   is live. *(This step matters: the address saved in your browser is the old
   one, whose scenario was deleted — that is the whole of "Make did not
   accept the post".)*
2. Write a short post, choose **Text**, press **Publish now**. Expect
   **Published** with a LinkedIn post id, not "sent".
3. Repeat with **Image**, then **Poll**, then **Video**.
4. Choose **Carousel** and publish. Expect **NOT PUBLISHED** with the reason
   — that is the correct result, not a bug.
5. Schedule a text post a few minutes out. Expect **Queued in Make**, and the
   post to appear within the hour.

Report what each one says and I will take it from there.

## Not tested, and honest about it

- **Scheduled video** — no video file could be made here.
- **All six immediate routes** — blocked by this session's network policy.
- **Behaviour at LinkedIn's rate limit** — cannot be provoked without
  deliberately flooding the page, which you asked me not to do. The handling
  is in place: a 429 lands on the error route, is recorded with LinkedIn's
  message, and does not stop other posts.
- **An expired LinkedIn connection** — the current one runs to 2027-09-22.
  An expired token surfaces as a 401 through the same error route.

## Test records left in the data store

`t-sched-text-01`, `t-sched-article-01`, `t-sched-image-01`,
`t-sched-poll-01`, `t-sched-carousel-01`, `t-sched-fail-01`,
`t-sched-stuck-01`. They are harmless — none is `queued`, so the scheduler
ignores all of them — and they are the evidence behind the table above.
Deleting them is a destructive change to the live store, so I have left them
for you to approve. `python3 make/dump-records.py` prints the store in one
readable line per record.

Six real posts went to the test page during this run: one text, one article,
one poll and three images (the image route was re-run twice while proving the
media-clearing fix).

## Operations budget

324 of Make's 1,000 monthly operations used at the end of this run, 676 left,
resetting 2026-10-03. At the hourly interval the scheduler spends 24 a day, so
216 of those 676 go on checking the queue over the next nine days and the rest
is yours for publishing. Steady state after the reset is 720 a month for the
queue checks, leaving roughly 280 — about 70 scheduled posts — for publishing.

If the team will post more than that, or wants publishing nearer the minute,
the Make plan is the thing to change, not the scenarios.
