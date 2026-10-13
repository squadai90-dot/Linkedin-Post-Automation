# Publishing to several LinkedIn Pages

Unison can publish one approved post to any combination of the LinkedIn
Company Pages the team's LinkedIn connection administers, immediately or on a
schedule, with a separate result for every Page. This document covers how it
works, how to turn it on for the **test** deployment, how to test it, what to
do when something goes wrong, and how it would move to production.

> **Superseded on 13 October 2026 by [UNIFIED-PUBLISHING.md](UNIFIED-PUBLISHING.md)
> and [CUTOVER.md](CUTOVER.md).** The final design is two unified scenarios
> that replace the production pair, because the Free plan allows only two
> active scenarios. This file still describes the Unison side, which is
> unchanged in principle. Its Make sections describe the 12 October test
> scenarios. Two corrections apply to them:
>
> - **Do not activate** test scenario 7904894 in this organization. Both
>   active slots are production; a third active scenario is not allowed.
>   Use Run once with the no-data-store test copy instead
>   (UNIFIED-PUBLISHING.md, *Isolated testing*).
> - **Do not run** test scheduler 7904912, and do not Run once the current
>   7904894 blueprint. Both write test records into the production data
>   store, which is no longer permitted.
>
> The three requests that waited in the test webhook's queue on 13 October
> have since been removed (queue 0, no run). **Real multi-Page publishing is
> still not confirmed.**

---

## 1. What the user sees

In the **Publish** step, once a post is approved:

```
PUBLISH TO LINKEDIN                       Select all   Clear selection
Publish to 3 Pages
[✓] U   Unison Content OS Test
[✓] U2  Unison Content OS Test 2
[✓] U3  Unison Content OS Test 3
```

- A new post starts with **one Page** ticked — the first on the list — so a
  user who never touches the picker publishes exactly as before.
- **Publish now** and **Schedule post** are disabled while no Page is ticked.
- After publishing, each Page shows its own result:

  | Result | Means | Sent again by Retry? |
  |---|---|---|
  | *Published* + link | LinkedIn returned a post id (urn) for this Page | Never |
  | *Scheduled in Make* | Make stored the job for its due time | Never |
  | *Waiting in Make — not run yet* | Make answered with its default "Accepted": the scenario did **not** run (switched off or busy) and the request is in the webhook queue. It will post when the scenario runs. | Never |
  | *Sent — not confirmed* / *Unknown — check the Page* | Make answered without a result, an error without a reason, a timeout, or the page was closed mid-send. LinkedIn may have the post. | Never — only after someone checks |
  | *Failed* + LinkedIn's reason, *Refused* | The scenario said LinkedIn refused it, or the Page is not allowed | Yes |

- **Retry failed Pages** sends only to *Failed* and *Refused* Pages. A Page
  whose outcome is unknown or waiting is never resent automatically, because
  resending is how one Page ends up with two posts.
- For an unknown or waiting Page there is **Not on LinkedIn? Allow resend**.
  Use it only after checking the Page (and, for *Waiting in Make*, deleting the
  request from the webhook queue in Make); it turns that Page into *Failed* so
  Retry can send it.
- The chosen Pages are saved with the post. Reopening a draft or a scheduled
  post brings the same Pages back. A Page that has since been removed from the
  server's list is reported, and **no other Page is used in its place**.
- **Settings → LinkedIn** lists the Pages this deployment can publish to.

If the server has no Page list (every deployment that has not opted in,
including production today), none of this appears and publishing is unchanged.

---

## 2. How a post reaches each Page

### Who decides what

| Part | Decides |
|---|---|
| Unison (browser) | Which Pages the user ticked, by **id** only |
| `api/publish-to.js` (server) | Whether those ids are allowed; stamps each job with the Page's organization URN from the server's own list. A URN sent by the browser is discarded. |
| Make test scenario | Re-checks the URN against the three allowed Pages, then calls LinkedIn |
| LinkedIn connection in Make | The **same** connection production uses ("Drashti's LinkedIn connection"). It administers all three test Pages — checked through Make's own Company list: `Unison Content OS Test` (urn:li:organization:146260120), `Unison Content OS Test 2` (145298202), `Unison Content OS Test 3` (145301196). |

The LinkedIn modules already take the Company as a mapped value, so one
connection publishes to whichever Page a job names. No extra LinkedIn
authorisation and no Make Enterprise feature is needed.

### Immediate ("Publish now")

```
Unison ─┬─ POST /api/publish-to {post, ["test-1"], fanout}  ─► Make test webhook ─► LinkedIn Page 1
        ├─ POST /api/publish-to {post, ["test-2"], fanout}  ─► Make test webhook ─► LinkedIn Page 2
        └─ POST /api/publish-to {post, ["test-3"], fanout}  ─► Make test webhook ─► LinkedIn Page 3
           (one after another; each answer is shown as it arrives)
```

One request per Page keeps every request within a Vercel function's time
limit (a video upload to three Pages is three uploads) and gives each Page its
own answer.

### Scheduled ("Hand to Make for …")

```
Unison ─► POST /api/publish-to {post, ["test-1","test-3"]} ─► Make test webhook
             Make stores the post ONCE      key  mt:<postId>              status mtparent
             and one job per Page           key  mt:<postId>~test-1       status mtqueued
                                            key  mt:<postId>~test-3       status mtqueued

Make test scheduler (run on demand) ─► each due mtqueued job:
   claim (mtpublishing) ─► read the parent's content/media ─► post to that job's Page
   ─► mtpublished + LinkedIn urn   |   mtfailed + LinkedIn's reason
   A job still claimed 45 minutes later is marked mtstuck, never re-posted.
   Two days after the due time the parent (which holds the media) is deleted.
```

Media is stored once, not once per Page, because Make's data store holds 1 MB
for the whole team.

---

## 3. What was built

### Unison

| File | What |
|---|---|
| `api/_destinations.js` | The server's Page list (`LINKEDIN_DESTINATIONS`), validation, job keys. Not deployed as a function (leading underscore). |
| `api/destinations.js` | `GET` — the Page list for the picker. Never returns the webhook URL. |
| `api/publish-to.js` | `POST` — validates Page ids, stamps the URN, forwards to `MAKE_MULTI_WEBHOOK_URL`, de-duplicates repeats, passes Make's answer back. |
| `src/lib/destinations.js` | Selection, per-Page results, retry logic, the two send functions. |
| `src/components/destinations.jsx` | The picker and the results list. |
| `src/App.jsx` | Page selection state, saved with the session, drafts and posts; `publishToPages`; a three-line branch at the top of the Make section of `publishNow` that is taken only when the server has a Page list. |
| `src/components/workspace.jsx`, `settings.jsx`, `styles.css`, `src/lib/store.js` | Picker placement, results, Settings list, styles, saving the selection. |
| `make/multi-account/*.json`, `generate.py` | The two test blueprints exactly as uploaded to Make, and the script that produced them. |

### Make (team "My Team")

| Created | Id | State |
|---|---|---|
| Scenario **Unison LinkedIn Publisher - Multi Account Test** | 7904894 | **Inactive** |
| Scenario **Unison Scheduled Publisher - Multi Account Test** | 7904912 | **Inactive**, on-demand schedule |
| Webhook **Unison LinkedIn Publisher - Multi Account Test Webhook** | 3885267 | Attached to 7904894 only |
| Data structure **Unison Publish Payload - Multi Account Test** | 631043 | Used only by 7904894's Parse JSON |

Not changed: both production scenarios (7482325, 7524924), their webhook
(3744886), the data structure 584788, the LinkedIn connection, and the
production data store's existing records.

### Isolation from production

Your Make plan (Free) allows **one** data store, so the test scenarios use the
production store `Unison Scheduled Posts` (193288), kept apart by key and
status:

| | Production | Multi-account test |
|---|---|---|
| Record keys | `p-…` (Unison post ids) | always start `mt:` |
| Statuses written | queued, publishing, published, failed, stuck, unsupported | mtparent, mtqueued, mtpublishing, mtpublished, mtfailed, mtstuck — plus `published`/`failed` on `mt:` keys for immediate posts |
| Picked up by | production scheduler: `queued`, `publishing` | test scheduler: `mtqueued`, `mtpublishing`, `mtparent` |

Neither scheduler can select the other's records (a unit test checks this
against both blueprints). The test scheduler is **on-demand**, not on a timer:
the Free plan's 1,000 operations a month are already mostly spent by the
production scheduler's hourly check, and a second timer would stop production
scheduling part-way through the month.

---

## 4. Payload

### Browser → `POST /api/publish-to`

```json
{
  "post": { "…the same payload api/publish.js receives today…": "" },
  "destinationIds": ["test-1"],
  "fanout": true
}
```

- `post` is unchanged from the single-Page payload (`postId`, `postType`,
  `content`, `media`, `poll`, `publishMode`, `scheduledDate`, `scheduledTime`,
  `timezone`, `submittedBy`, …). Its `company`, `companyUrn`, `destinations`
  and `linkedinAccessToken` are dropped by the server.
- `destinationIds`: exactly one for `publishMode: "now"`; all of them for
  `"scheduled"`.
- `fanout`: `true` whenever the post goes to more than one Page — including a
  retry of a single failed Page — so each Page keeps the same job key.

### Server → Make (immediate, one per Page)

The `post`, plus:

| Field | Value |
|---|---|
| `postId`, `idempotencyKey` | `<postId>` for a one-Page post; `<postId>~<destinationId>` when `fanout` |
| `parentPostId` | the post's own id |
| `destinationId` | e.g. `test-2` |
| `company`, `companyUrn` | from the server's list |
| `publishMode` | `now` |

### Server → Make (scheduled, one for all Pages)

The `post`, plus `publishMode: "scheduled"`, `companyUrn: ""`,
`parentPostId`, and `destinations: [{ id, name, organizationUrn }]`.

### Make → server → browser

Make answers per job: `{"status":"published","urn":"urn:li:share:…","url":…,"destinationId":…}`,
`{"status":"failed","stage":"linkedin","message":"LinkedIn refused the post for this Page: …"}`,
`{"status":"rejected","stage":"destination",…}` (422) or, for a schedule,
`{"status":"queued","destinations":2}`. The server reports `published` **only
when a LinkedIn urn is present**; "published" without one becomes `unknown`.

### Backward compatibility

- Deployments without the two new variables: no picker, `api/publish.js` path,
  payload byte-for-byte as before.
- With them, a one-Page post keeps its own `postId` as the job key.
- Old drafts and scheduled posts without saved Pages open with the default
  (first) Page.

---

## 5. Turning it on for the test deployment

Do this on the **UX test** Vercel project only — never on production.

1. In Make, open **Webhooks** → *Unison LinkedIn Publisher - Multi Account
   Test Webhook* and copy its address. (It is not written in this repository
   on purpose.)
2. In the test project on Vercel → **Settings → Environment Variables**
   (Production scope *of the test project*), add:

   | Name | Value |
   |---|---|
   | `MAKE_MULTI_WEBHOOK_URL` | the address from step 1 |
   | `LINKEDIN_DESTINATIONS` | see below |

   ```json
   [{"id":"test-1","name":"Unison Content OS Test","organizationUrn":"urn:li:organization:146260120"},
    {"id":"test-2","name":"Unison Content OS Test 2","organizationUrn":"urn:li:organization:145298202"},
    {"id":"test-3","name":"Unison Content OS Test 3","organizationUrn":"urn:li:organization:145301196"}]
   ```

   Optional per Page: `"logo": "https://…"` and `"enabled": false`.
3. Redeploy the test project.
4. Open the test site → **Settings → LinkedIn**: *Pages you can publish to*
   lists the three Pages.

Adding a fourth Page later: make sure the Make LinkedIn connection is an admin
of it, add its URN to the three allow-list filters in the test immediate
scenario (or regenerate with `make/multi-account/generate.py`), and add an
entry to `LINKEDIN_DESTINATIONS`. No Unison code changes.

---

## 6. Windows: run and test locally

```powershell
cd path\to\Unison-Content-OS
npm ci
npm test                     # unit tests (no network)
npm run build:e2e
npx playwright install chromium
npm run test:e2e             # browser tests; Make and LinkedIn are mocked
npm run dev                  # http://localhost:5173
```

`npm run dev` has no `/api` functions, so the picker stays hidden locally
(single-Page behaviour). To see it locally run `npx vercel dev` with the two
variables in `.env.local` — and point `MAKE_MULTI_WEBHOOK_URL` at the **test**
webhook only.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No picker in the Publish step | The server has no Page list, or no multi webhook | Set both variables on the test project, redeploy, check Settings → LinkedIn |
| Settings shows "Skipped …" warnings | An entry in `LINKEDIN_DESTINATIONS` has a bad id or URN | Ids: lower-case letters, digits, dashes. URNs: `urn:li:organization:<digits>` |
| A Page says **Refused** | The server or the Make filter does not allow it | Add it to both (§5) |
| A Page says **Failed — … 403** | The LinkedIn connection is not an admin of that Page, or LinkedIn refused the content | Make → Connections → the LinkedIn connection → reauthorise as a Page admin; check the Page's admin list |
| **Unknown — check the Page** | No answer in time (often a large video), or Make failed without a reason | Look at the Page. If the post is not there, **Not on LinkedIn? Allow resend**, then **Retry failed Pages** |
| **Waiting in Make — not run yet** | The test scenario was switched off or busy when the request arrived; Make queued it and replied "Accepted" | Run the scenario once in Make (it then posts that request) — or delete the request from the webhook queue in Make, then **Not on LinkedIn? Allow resend** and retry. Never both. |
| One Page published and the next says *Waiting in Make* | The scenario was run with **Run once**, which handles one request and stops | In this organization, press Run once again for each waiting request (one per Page). Unison shows them as waiting; check the Pages, then **Check status in Make** |
| Every Page fails at once with "not set up" | `MAKE_MULTI_WEBHOOK_URL` missing or not a Make hook | Fix the variable, redeploy |
| Image or video fails on one Page only | LinkedIn rejected the upload for that Page | The reason is on the Page's row; retry that Page only |
| Poll fails | Fewer than 2 or more than 4 options, or option over 30 characters | Fix in the Poll step; retry |
| Scheduled Pages stay "Scheduled in Make" | The test scheduler is on-demand | Run *Unison Scheduled Publisher - Multi Account Test* once from Make after the due time |
| A test job is **mtstuck** | A run was interrupted after claiming it | Check the Page; if the post is not there, set the record's status back to `mtqueued` |
| "Too much media to hold until the scheduled time" | The Free plan's 1 MB data store | Publish now, or use a smaller file |
| Retry button posts to a Page twice? | It cannot: settled Pages are skipped in the browser, repeats are answered from the server's cache, and Make keys every job | — |

---

## 8. What still needs you

See UNIFIED-PUBLISHING.md, *Isolated testing* and *G. Readiness*. In short:

1. Choose how to test live: immediate only, in this organization, with the
   no-data-store test copy and Run once; or everything, in a separate Make
   organization.
2. Configure the test Vercel project (§5 here; WINDOWS-SETUP.md §9 for the
   preview) and redeploy it.
3. Run the real matrix (§9) with posts labelled "TEST —", and record every
   urn in TESTING.md.
4. Approve or decline removing the test leftovers listed in
   UNIFIED-PUBLISHING.md (scenario 7904912, and the `mt:` record in the
   production store).

---

## 9. Real LinkedIn test matrix (not yet run)

Immediate: text → Page 1; text → Pages 1+2; text → all three; image → all;
video → all; poll → all; one Page failing — temporarily delete Page 3's
condition from the test scenario's allow-list filters, publish to all three
(Pages 1 and 2 publish, Page 3 is refused), restore the condition, then
**Retry failed Pages** (only Page 3 is sent); Page 3 only; no Page selected (buttons disabled);
an unknown Page id (422); double-click Publish (one post per Page).

Scheduled: the same types to 1, 1+3 and all three Pages; reopen the post and
check the Pages; run the scheduler before the due time (nothing happens) and
after (each Page published once); run it twice (no duplicates); an old
single-Page scheduled post through production (unchanged); check that no
`mt:` record appears in the production scheduler's history.

Record each LinkedIn urn in TESTING.md.

---

## 10. Production rollout

Replaced by [CUTOVER.md](CUTOVER.md): two unified scenarios take over both
production slots and the production webhook, with stop conditions and
rollback.

---

## 11. 13 October test: why Test 3 did not publish

**What was observed.** An image post was published to Test 2 and Make's
image module returned a LinkedIn post id for urn:li:organization:145298202.
Test 3 (145301196) showed *Sent — not confirmed* and has no post.

**What the evidence shows** (read from Make on 13 October, nothing changed or
replayed):

| Time (UTC) | Request in the test webhook | What happened |
|---|---|---|
| 06:35:34 | `p-w-mv6b3d7qf3vl~test-2` (first post, Test 2) | Queued — scenario off |
| 06:35:36 | `p-w-mv6b3d7qf3vl~test-3` (first post, Test 3) | Queued — scenario off |
| 06:38:35 | `p-w-mv6b6w74uc7u~test-2` (second post, Test 2) | Run by a manual **Run once**, published (execution 60d86236…, 5 operations) |
| 06:38:38 | `p-w-mv6b6w74uc7u~test-3` (second post, Test 3) | Arrived 1 s after that single run ended — queued |

The scenario is inactive and the three queued requests are still in the
webhook queue.

**Root cause.** The test scenario was not running when the Test 3 requests
arrived. Make accepts requests for a scenario that is off (or busy), queues
them, and answers with its default text `Accepted` instead of the scenario's
own reply. **Run once** handles exactly one request, so the Test 2 job of the
second post ran and the Test 3 job, sent the moment Test 2's answer came back,
was queued.

**Ruled out, with evidence.**
- *Unison's payload.* The queued Test 3 request carries
  `destinationId: "test-3"`, `companyUrn: "urn:li:organization:145301196"`,
  `company: "Unison Content OS Test 3"`, `postId` and `idempotencyKey`
  `p-w-mv6b6w74uc7u~test-3`, `parentPostId`, `postType: "image"` and the
  image. That is exactly what the relay is built to send, and a unit test now
  rebuilds it field for field.
- *Make's routing and filters.* The live blueprint (fetched 13 October) matches
  the repository: the image route's filter accepts all three URNs and maps the
  Company from `companyUrn`. A test evaluates the filters for every Page and
  post type: each job matches exactly one route, image jobs reach the image
  module, and the Company resolves to that job's Page.
- *Authorization.* Not involved: the Test 3 request never reached a LinkedIn
  module. (Make's Company list for the connection does include Test 3.)

**What was wrong in Unison, and fixed.** Unison did not claim Test 3 was
published, but it could not tell *queued, not run* from *ran, no answer*, and
its retry rule would have resent some outcomes that may already have reached
LinkedIn:

| Before | After |
|---|---|
| Make's bare "Accepted" → *Sent — not confirmed* | → *Waiting in Make — not run yet*, with the reason, never retried |
| Make 500 without a result → *Failed*, retried | → *Unknown*, not retried (LinkedIn may have the post) |
| A relay timeout page (non-JSON 504) → *Failed*, retried | → *Unknown*, not retried |
| A Page still *Sending* when the page was closed → retried on reopen | → *Unknown* on reopen, not retried |
| No way to resend an unknown Page after checking | **Not on LinkedIn? Allow resend** (with a warning about Make's queue) |
| Retry only from the failure card | **Retry failed Pages** also in the results list, counting only failed/refused Pages |

The Make blueprint copy in the repository now records `sequential: false`,
matching the live scenario.

**Still to confirm on LinkedIn** (clearly labelled "TEST —" posts, scenario
switched on, queue cleared first): image to Test 2 + Test 3, and image to all
three Pages — each Page must show *Published* with its own link.

