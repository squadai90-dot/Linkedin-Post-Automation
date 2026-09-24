# The two Make scenarios

Unison does not hold a LinkedIn credential. Two Make scenarios do the
publishing, and this folder holds their blueprints so they can be read,
reviewed and restored without opening Make.

| File | Scenario | ID | Trigger |
|---|---|---|---|
| `scenario-a-linkedin-publisher.json` | Unison LinkedIn Publisher | 7482325 | Webhook (instant) |
| `scenario-b-scheduled-publisher.json` | Unison Scheduled Publisher | 7524924 | Timer, hourly |

Shared by both:

- **Data store** `Unison Scheduled Posts` (193288), structure
  `Unison Publish Payload` (584788). 1 MB for the whole team.
- **Connection** `Drashti's LinkedIn connection` (10513797).
- **Company page** `urn:li:organization:146260120` — Unison Content OS Test.
  Every route falls back to it when the payload carries no `companyUrn`.

`dump-records.py` prints the data store as one line per record. A raw listing
is mostly base64 and unreadable; this shows what state each post is in and
reports its media as a size.

## A — Unison LinkedIn Publisher

Webhook → Parse JSON (against the data structure) → Router, seven routes.
Every route ends in a **Webhook response**, so the browser learns what
actually happened rather than Make's default "Accepted".

| Route | Condition | Does | Answers |
|---|---|---|---|
| Text | `now` + text | `CreateTextShare` | `200 {status:"published", urn, url}` |
| Image | `now` + image | `CreateCompanyImagePost` | `200 {status:"published", urn, url}` |
| Video | `now` + video | `createOrganizationVideoPost` | `200 {status:"published", urn, url}` |
| Poll | `now` + poll | Iterator → Aggregator → `POST /rest/posts` | `200 {status:"published", urn}` |
| Withdrawn type | `now` + multi\|document\|carousel\|article | Stores the whole post | `200 {status:"unsupported"}` |
| Scheduled | `scheduled` | Stores it with `dueAt`, `status:"queued"` | `200 {status:"queued", dueAt}` |
| Nothing matched | any other mode or type | nothing | `422 {status:"rejected"}` |

The four publishing routes each end with a **`datastore:AddRecord`** after the
response, writing `status: "published"` and the `publishedUrn` LinkedIn
returned. It costs one operation per post and carries no media. Without it an
immediate post left no trace anywhere but the browser that sent it, so there
was no way to answer "did that actually go out, and what is its id?" later.
The write is deliberately *after* the response: the reply Unison is waiting on
must not depend on a data store that might be full.

The withdrawn-type route is not dead code. Unison no longer offers article,
carousel, multi-image or document, but a copy of the app saved before that
change still can, and a post from one must not vanish. It is stored with its
text and media, and the reply tells the sender to update Unison.

Each LinkedIn call carries an **error handler**: write a `failed` record to
the data store with LinkedIn's own message, then `Skip`. Swallowing the error
matters — Make switches a scenario off after three consecutive errors, so
without this one refused post would stop publishing for everyone. The two
data-store writes get a bare `Skip`: reporting a failed write by writing to
the same store is circular, and a full store is exactly when the second write
would fail too.

> **A Webhook response module cannot sit in an error route.** Make accepts the
> blueprint — `scenarios_update` even returns `isinvalid: false` — and then
> refuses to initialise the scenario when a payload arrives:
> *Scenario validation failed - 6 problem(s) found*, one per handler. It then
> switches itself off, the webhook queues every post, and nothing reaches
> LinkedIn while Unison is told only that Make has the request. It cost a
> production outage on 2026-09-24. Record a refusal in the data store instead.
>
> The corollary: **`isinvalid: false` on a push does not mean the blueprint is
> valid.** Make validates properly at initialisation. After any change to this
> scenario, force a run and check the execution is `status: 1` — a broken
> blueprint gives `status: 3`, 0 operations, `BlueprintValidationError`.

Make hands a failure to its error route under the **failed module's own id**:
`{{40.error.message}}`, not `{{error.message}}`. The global form silently
resolves to nothing, which is why early failure notes were blank.

Every response sets `Access-Control-Allow-Origin: *`, which is what lets
Unison read the reply when it posts to the webhook straight from the browser.

`dueAt` is computed once, here, from `scheduledDate + scheduledTime` in the
payload's own `timezone`:

```
{{parseNumber(formatDate(parseDate(2.scheduledDate + " " + 2.scheduledTime;
  "YYYY-MM-DD HH:mm"; 2.timezone); "X"); ".")}}
```

`parseNumber(…; ".")` is not decoration. Make stores an unparsed value as
text, and `dueAt` is compared with a **number** operator in scenario B — text
`"1790078880"` never matches, so every scheduled post sat in the queue.

## B — Unison Scheduled Publisher

Search records → Router, six routes: the recovery route, one per supported
post type, and a catch-all for a record queued by an older copy of Unison
carrying a type that no longer exists. The trigger's filter is two OR groups:

```
status = queued     AND dueAt    <= now
status = publishing AND attemptAt <= now - 45 minutes
```

The first is the due queue. The second is recovery: a record still claimed
long after the claim was taken belongs to a run that died.

Each publishing route is **claim → publish → record**:

1. `UpdateRecord` sets `status: "publishing"` and `attemptAt: now`.
2. The LinkedIn module posts, with an error handler that writes
   `status: "failed"` plus LinkedIn's own message, then `Skip`.
3. `UpdateRecord` sets `status: "published"`, `publishedUrn`, and clears
   `media` so posts already out stop filling the 1 MB store.

The claim is what prevents a duplicate. Without it, a run that publishes and
then dies before recording leaves the record `queued`, and the next run posts
it to LinkedIn a second time.

A stale claim is **never** republished. It becomes `status: "stuck"` with a
note telling whoever reads it to check the page first, because Make cannot
know whether LinkedIn got the post before the run died.

Each route's filter sits on its **first** module. That is not cosmetic: a
filter on the second module lets every record through the first one, so a
poll would be claimed by the text route on its way past.

### Why hourly, and what it costs

Make's free plan allows **1,000 operations a month**, and every check of the
queue spends one whether or not anything is due.

| Interval | Checks/month | Verdict |
|---|---|---|
| 15 minutes (Make's free-plan minimum) | 2,880 | Exhausts the plan in ~10 days |
| 30 minutes | 1,440 | Still over the plan |
| **1 hour** | **720** | Fits, with ~280 left for publishing |

So a scheduled post goes out **at its time or within the hour after it, never
before**. Unison says exactly that on the schedule panel rather than implying
the minute is exact. On a paid Make plan, set the scenario's interval to 900
seconds and `MAKE_CONFIG.schedulerIntervalMs` in `src/lib/publish.js` to
`15 * 60 * 1000` together — changing one without the other makes Unison
promise something Make does not do.

## Why multi-image and document were withdrawn rather than fixed

Both need LinkedIn's **two-step upload**: register the file, then PUT the bytes
to the URL that registration hands back. Step one works from Make. Step two
cannot be done at all with the current setup, and it was tested rather than
assumed:

```
POST /rest/images?action=initializeUpload   → succeeded, returned uploadUrl + image urn
PUT  {{uploadUrl}}                          → 405 Not Allowed (nginx HTML, not a LinkedIn API error)
```

`linkedin:MakeAPICall` takes *a path relative to `api.linkedin.com`*. Given an
absolute upload URL it still prefixes its own host, so the PUT lands on the
API gateway, which does not serve that path — hence a raw nginx 405 rather
than a LinkedIn error. The upload URL lives on a different host.

The obvious alternative, `http:ActionSendData`, can reach any host but cannot
authenticate: LinkedIn's upload URL needs `Authorization: Bearer <token>`, and
Make keeps the connection's token inside the LinkedIn app where no module can
map it.

So the blocker is not LinkedIn's API — the API supports both post types. It is
that **Make's LinkedIn connection cannot make the one call those post types
need**. Two things would unblock it, both requiring a decision rather than
code:

1. **An HTTP OAuth 2.0 connection in Make** holding a LinkedIn token of its
   own, used for the PUT while the LinkedIn app keeps doing the rest. Needs
   the LinkedIn app's client ID and secret.
2. **Unison sends its own token.** The payload already carries
   `linkedinAccessToken`, gated behind Settings → LinkedIn → *Send my LinkedIn
   token with posts*, which needs the OAuth bridge (`api/linkedin.js`)
   deployed. Make would then use `http:ActionSendData` with that token.

Neither existed, so rather than leave two options that could be chosen and
would then fail at the last step, both were **removed from Unison**. Carousel
went with them for a simpler reason: LinkedIn has **no organic carousel API**
at all, so no amount of plumbing would have changed it. Article was removed
because it is no longer wanted as a separate post type.

Unison now offers exactly four: text, image, video and poll. The held route
above stays for payloads from older copies of the app.

## Verified end to end

Every route below was run against the live LinkedIn Page and is recorded by
the id LinkedIn itself returned, not by a Make execution status. See
`TESTING.md` for the full matrix.

| Route | LinkedIn id |
|---|---|
| Scheduled text | `urn:li:share:7508849111392178176` |
| Scheduled image | `urn:li:share:7508814445381505025` |
| Scheduled video | `urn:li:ugcPost:7508848961080852483` |
| Scheduled poll | `urn:li:ugcPost:7508849114902781952` |

> A video that reaches LinkedIn with even a handful of bytes missing is
> accepted, transcoded for about a minute, and then failed with
> `PROCESSING_FAILED — Uploaded file is corrupted`. Two earlier video tests
> failed exactly that way, and both times the cause was the base64 being
> copied into the data store by hand, not the pipeline. If a video ever fails
> like this, compare a hash of the stored base64 against the file before
> touching the scenario.

## Restoring a scenario from these files

The JSON here is the blueprint only. Make's API takes `scheduling` as a
separate argument and rejects a blueprint that contains it, so scenario B's
file keeps its `scheduling` block for reference and it must be passed
separately when restoring. Updating a scenario **replaces** its blueprint
wholesale — there is no merge — and editing an active scenario can leave it
flagged invalid until it is reactivated.
