# Cutover: replace the two production scenarios with the unified pair

**Do not start this without written approval.** Nothing here has been done.
The two replacement scenarios must first pass an isolated test with recorded
LinkedIn urns: option 2 in [UNIFIED-PUBLISHING.md](UNIFIED-PUBLISHING.md#isolated-testing-what-is-possible-on-the-free-plan),
or option 1 plus the supervised steps 12–13 below.

Constraints this procedure works within:

- **Two active scenarios at most.** At no point are three active.
- **Never two schedulers active at once.** The production scheduler (7524924)
  and the unified one share the data store. Make has no atomic claim, so two
  of them reading the same due job at the same instant could both post it.
- **Pending scheduled jobs are preserved.** The unified scheduler runs
  production-format records exactly as production would (proved in
  `tests/unified-matrix.test.js`, "regression"). No migration is needed. The
  production scheduler never selects a unified Page job.
- **No webhook URL changes.** The unified immediate scenario takes over
  webhook 3744886, which `api/publish.js` and the browser fallback already
  use.

Allow 30–45 minutes. Choose a window with no scheduled post due in the next
two hours and nobody publishing.

---

## Before the window

1. **Record the starting state.** Write each item down.
   - In Make → Scenarios, both production scenarios are **On**, with their
     last-edit dates (25 September).
   - Export both blueprints (⋯ → Export blueprint) and keep the files. The
     repository's `make/scenario-a-linkedin-publisher.json` and
     `make/scenario-b-scheduled-publisher.json` are the same as of
     13 October.
   - In Make → Data stores → *Unison Scheduled Posts*, write down every record
     whose status is not `published`: its key, status and `dueAt`. Run
     `python make/dump-records.py` against an export if that is easier.
   - Webhooks → *Unison LinkedIn Publisher Webhook* (3744886): the queue is 0.
2. **Deploy the application code with the feature off.**
   - Merge the reviewed branch to the production repository and deploy.
   - Leave `LINKEDIN_DESTINATIONS` and `MAKE_MULTI_WEBHOOK_URL` **unset** on
     production. Without them the app publishes exactly as before, through
     `api/publish.js`.
   - Publish one ordinary single-Page post as a check, and confirm its urn.
   - **Stop** if it does not publish as before.
3. **Import the two scenarios, inactive.**
   - In Make → Create a new scenario → ⋯ → Import blueprint, import
     `make/unified/unified-scheduled-publisher.json`. Name it *Unison
     Scheduled Publisher - Unified*. Do not switch it on.
   - Import `make/unified/unified-immediate-publisher.json` the same way. Name
     it *Unison LinkedIn Publisher - Unified*.
     - If Make will not attach webhook 3744886 (it is in use by 7482325),
       leave the webhook module empty for now.
     - Do not create a new webhook for it.
   - In each scenario:
     - open one LinkedIn module and confirm the connection is *Drashti's
       LinkedIn connection*;
     - open one data store module and confirm *Unison Scheduled Posts*;
     - open the Parse JSON module and confirm *Unison Publish Payload - Multi
       Account Test* (631043).
   - **Stop** if Make reports a missing module or connection.

## Scheduler swap

4. Wait until no record is `publishing`; a running scheduler may hold one.
5. **Switch off** *Unison Scheduled Publisher* (7524924). Active scenarios: 1.
6. **Switch on** *Unison Scheduled Publisher - Unified*. Active scenarios: 2.
   Set its schedule to every 60 minutes, as production.
7. Check the scheduler:
   - After its first scheduled run, open the run in History. It should be one
     search with no results (1 operation), or due jobs published exactly as
     production would publish them.
   - **Stop and roll back the scheduler (R3)** if the run errors, or a job is
     posted twice, or posted to the wrong Page.

## Webhook swap (the only moment requests queue)

8. Check the queue of webhook 3744886 is 0. Then **switch off** *Unison
   LinkedIn Publisher* (7482325). From now until step 10, immediate posts
   queue in Make. Unison shows them as **queued — waiting in Make**.
9. Move the webhook:
   - In 7482325, open the Webhooks module and choose **Add** to create a
     placeholder webhook named *retired - do not use*. Save. This frees
     3744886 without deleting anything.
   - In *Unison LinkedIn Publisher - Unified*, open the Webhooks module,
     choose *Unison LinkedIn Publisher Webhook* (3744886) and save.
   - **Stop and roll back (R2)** if Make will not let you choose it.
10. **Switch on** *Unison LinkedIn Publisher - Unified*. Active scenarios:
    2, both unified. Any requests that queued during steps 8–9 run now. They
    are production-format requests, so the unified scenario handles them as
    production would.
11. Make sure the old scenarios stay off. Only the two unified scenarios
    should show **On**.

## Supervised verification, with your approval for each post

12. Feature still off; this is the existing single-Page path.
    - Publish one text post. The answer should carry an urn, and the data
      store should hold a `published` record.
    - **Stop and roll back (R2)** if the answer is `Accepted` or has no urn.
13. Turn the feature on:
    - Set `LINKEDIN_DESTINATIONS` (the three Pages) and
      `MAKE_MULTI_WEBHOOK_URL` = the URL of webhook 3744886 on the
      production Vercel project, then redeploy.
    - Using posts labelled `TEST —`, with your approval for each:
      1. text now to Page 2;
      2. image now to Pages 2 + 3;
      3. a poll scheduled 10 minutes ahead to all three Pages. Wait for the
         hourly run, then press **Check status in Make**.
    - Record every urn in TESTING.md. Delete the test posts afterwards if you
      wish.
    - **Stop and roll back (R1, then R2/R3 as needed)** on any of these:
      - a Page shows Published without an urn;
      - a Page is posted twice;
      - a Page is posted that was not chosen;
      - a job sits in `page-queued` after its due run;
      - a run errors twice in a row.

## Stop conditions at any point

- More than two scenarios are On, or both schedulers are On.
- The production scenarios' blueprints differ from the exported files
  before you start (someone changed them). Re-audit first.
- A data store record is `publishing` and you are about to switch
  schedulers.
- Fewer than 150 operations are left this month. A three-Page test needs
  about 60.
- The data store is over 70% full.
- Any answer of `Accepted` while the unified immediate scenario is On. That
  means it was off, busy, or out of operations.

---

## Rollback

Each part can be rolled back on its own. None of them needs data to be moved
back, because both generations share the same records.

**R1 — turn the multi-Page feature off.** On production Vercel, remove
`LINKEDIN_DESTINATIONS` and `MAKE_MULTI_WEBHOOK_URL`, then redeploy. Unison
goes back to single-Page publishing through `api/publish.js`. The unified
scenarios still handle that format.

**R2 — give the webhook back to the production immediate scenario.**
1. Switch off *Unison LinkedIn Publisher - Unified*.
2. In it, change the Webhooks module to the placeholder or the test webhook,
   then save.
3. In *Unison LinkedIn Publisher* (7482325), choose webhook 3744886 again,
   then save.
4. Switch 7482325 on. Requests that queued meanwhile run on production.
5. Records the unified scenario left `publishing` are marked `stuck` by
   whichever scheduler is on, after 45 minutes. Nothing is reposted.

**R3 — give scheduling back to the production scheduler.**
1. Switch off the unified scheduler **first**, then switch 7524924 on. Never
   both on.
2. Production-format jobs carry on as before.
3. Page jobs (`page-queued`) are **not** run by the production scheduler. For
   each one:
   - either re-schedule that Page from Unison after R1, as a single-Page
     post;
   - or set its status to `cancelled`.
4. Delete their `parent` records once no Page job refers to them.
5. Page jobs left `page-publishing` must be checked on LinkedIn by hand.

**Full rollback** is R1, then R2, then R3. Afterwards:
- 7482325 and 7524924 are On, holding webhook 3744886 and the original
  blueprints;
- the unified scenarios are Off, and can be deleted later;
- `LINKEDIN_DESTINATIONS` and `MAKE_MULTI_WEBHOOK_URL` are unset.

Then compare the scenario blueprints with the exported files.

## After a successful cutover

- Keep 7482325 and 7524924 **Off but not deleted** for two weeks.
- Delete test scenarios 7904894 and 7904912 and test webhook 3885267, unless
  you want them for later tests. 7904912 must never be run; it writes test
  statuses into the production store.
- Add a note to TESTING.md with the date, the urns, and the operation count
  for the first week.
