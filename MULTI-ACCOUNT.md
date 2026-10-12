# Publishing to several LinkedIn Pages

Unison can publish one approved post to any combination of the LinkedIn
Company Pages the team's LinkedIn connection administers, immediately or on a
schedule, with a separate result for every Page. This document covers how it
works, how to turn it on for the **test** deployment, how to test it, what to
do when something goes wrong, and how it would move to production.

Status on 12 October 2026: **built and tested with Make and LinkedIn mocked.
Not yet run against LinkedIn** — the two Make test scenarios are created but
switched off (see §8, *What still needs you*).

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
- After publishing, each Page shows its own result: *Published* (with a link
  to the post), *Scheduled in Make*, *Failed* (with LinkedIn's reason),
  *Sent — not confirmed*, or *Unknown — check the Page*.
- If some Pages fail, the card says **Some Pages didn't get the post** and the
  button reads **Retry failed Pages**. Retrying sends only to the Pages that
  failed; a Page that already has the post is never sent it again (its
  checkbox is locked).
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
| **Unknown — check the Page** | No answer in time (often a large video) | Look at the Page and at the test scenario's History in Make. Unison does not resend it automatically, to avoid a duplicate |
| Every Page fails at once with "not set up" | `MAKE_MULTI_WEBHOOK_URL` missing or not a Make hook | Fix the variable, redeploy |
| Image or video fails on one Page only | LinkedIn rejected the upload for that Page | The reason is on the Page's row; retry that Page only |
| Poll fails | Fewer than 2 or more than 4 options, or option over 30 characters | Fix in the Poll step; retry |
| Scheduled Pages stay "Scheduled in Make" | The test scheduler is on-demand | Run *Unison Scheduled Publisher - Multi Account Test* once from Make after the due time |
| A test job is **mtstuck** | A run was interrupted after claiming it | Check the Page; if the post is not there, set the record's status back to `mtqueued` |
| "Too much media to hold until the scheduled time" | The Free plan's 1 MB data store | Publish now, or use a smaller file |
| Retry button posts to a Page twice? | It cannot: settled Pages are skipped in the browser, repeats are answered from the server's cache, and Make keys every job | — |

---

## 8. What still needs you

These were not done because they change live Make state or publish to
LinkedIn, and the session was not permitted to:

1. **Activate** *Unison LinkedIn Publisher - Multi Account Test* (7904894).
   It is safe to activate: it listens only to its own webhook. **Check your Make
   plan first** — the Free plan's licence lists 2 scenarios, and both are
   production. If activation is refused, either upgrade the plan or pause the
   production *Scheduled* scenario only for the length of a test session (no
   scheduled posts will go out meanwhile).
2. Configure the test Vercel project (§5) and redeploy it.
3. Run the real test matrix in §9 against the three test Pages. Every test
   post text should start with "TEST —" and be deleted afterwards.
4. For scheduled tests, run *Unison Scheduled Publisher - Multi Account Test*
   (7904912) on demand after each due time. Keep it on-demand.

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

## 10. Production rollout checklist (do not start without approval)

1. All of §9 passed on the test deployment, with urns recorded.
2. Decide the production Page list and confirm the production LinkedIn
   connection administers every Page.
3. Choose one of:
   - **A (recommended):** fold the multi-account routes into the production
     scenarios: add the destination allow-list filters and the scheduled
     parent/child intake to *Unison LinkedIn Publisher*, and the `mt*`-style
     child processing (with production statuses) to *Unison Scheduled
     Publisher*. Then `MAKE_MULTI_WEBHOOK_URL` can equal the production webhook.
   - **B:** keep separate multi-account scenarios, which needs a Make plan with
     more than two active scenarios.
4. Export both production blueprints before changing anything.
5. Set `LINKEDIN_DESTINATIONS` and `MAKE_MULTI_WEBHOOK_URL` on production,
   redeploy, and publish one text post to one Page first.
6. Remember the production Vercel project builds from a different GitHub
   repository — copy the code there, or connect Vercel to this repository.
7. Watch the first scheduled multi-Page post through to the end.
