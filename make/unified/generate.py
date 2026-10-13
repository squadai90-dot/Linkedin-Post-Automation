"""Builds the two unified replacement scenarios from one description.

    python make/unified/generate.py                 # production blueprints (for cutover review)
    python make/unified/generate.py --profile test  # the no-data-store immediate test copy
    python make/unified/generate.py --profile isolated --hook H --store S --structure P --poll-structure Q --conn C

Every LinkedIn call is the one the production scenarios 7482325 and 7524924
make today (same modules, same mappings, same connection); what changes is
around them:

  * the Page comes from the job, and only Pages on the allow-list are posted to;
  * an immediate job is looked up before it is published, so a repeated
    delivery never posts twice, and is claimed before LinkedIn is called, so a
    crash after LinkedIn answered is reported as unknown rather than retried;
  * a multi-Page scheduled post is stored once (the parent) with one job record
    per Page, under statuses the production scheduler never selects;
  * every outcome answers the webhook with JSON, including LinkedIn refusals;
  * a "status" request reports every job recorded for a post.

Single-Page requests in the production format (no destinations, no
destinationId) take exactly the routes and produce exactly the records they do
today, so api/publish.js and pending scheduled posts keep working.
"""
import argparse, json, os

ap = argparse.ArgumentParser()
ap.add_argument("--profile", choices=["production", "test", "isolated"], default="production")
ap.add_argument("--hook", type=int)
ap.add_argument("--store", type=int)
ap.add_argument("--structure", type=int)
ap.add_argument("--poll-structure", type=int)
ap.add_argument("--conn", type=int)
ap.add_argument("--out")
A = ap.parse_args()

PROFILES = {
    # Production: the production webhook is re-used at cutover (see CUTOVER.md),
    # so no URL changes anywhere; the production store, connection and poll body.
    "production": dict(hook=3744886, store=193288, structure=631043, poll=597911, conn=10513797, name="Unison LinkedIn Publisher - Unified", sname="Unison Scheduled Publisher - Unified"),
    # Test, current organization: immediate only, and it never touches the
    # production data store (the Free plan allows one store per organization).
    "test": dict(hook=3885267, store=None, structure=631043, poll=597911, conn=10513797, name="Unison LinkedIn Publisher - Unified Test (no data store)", sname=None),
    # A separate Make organization with its own webhook, store and connection.
    "isolated": dict(hook=A.hook, store=A.store, structure=A.structure, poll=A.poll_structure, conn=A.conn, name="Unison LinkedIn Publisher - Unified (isolated test)", sname="Unison Scheduled Publisher - Unified (isolated test)"),
}
P = PROFILES[A.profile]
if A.profile == "isolated" and not all([P["hook"], P["store"], P["structure"], P["poll"], P["conn"]]):
    ap.error("--profile isolated needs --hook --store --structure --poll-structure --conn")
STORE = P["store"]

ALLOWED = ["urn:li:organization:146260120", "urn:li:organization:145298202", "urn:li:organization:145301196"]
LEGACY = "urn:li:organization:146260120"      # the production fallback, unchanged
TYPES = ["text", "image", "video", "poll"]
WITHDRAWN = ["multi", "document", "carousel", "article"]

# Record statuses. Legacy single-Page records keep the production ones; a
# multi-Page job record uses its own queued/claimed pair so the production
# scheduler (which selects only queued/publishing) can never pick one up.
Q, CLAIM = "queued", "publishing"
JQ, JCLAIM = "page-queued", "page-publishing"
PARENT = "parent"

CONN_META = {"__IMTCONN__": {"data": {"scoped": "true", "connection": "linkedin2"}, "label": "Drashti's LinkedIn connection (Drashti Makwana)"}}
DSMETA = {"restore": {"parameters": {"datastore": {"label": "Unison Scheduled Posts"}}}}
HEADERS = [{"key": "Content-Type", "value": "application/json"}, {"key": "Access-Control-Allow-Origin", "value": "*"}]
SAFE = '/[^a-zA-Z0-9 .,:;()\'_=-]/g'
NOW = '{{parseNumber(formatDate(now; "X"); ".")}}'
DUE = '{{parseNumber(formatDate(parseDate(2.scheduledDate + " " + 2.scheduledTime; "YYYY-MM-DD HH:mm"; 2.timezone); "X"); ".")}}'
DUR = '{{switch(%s; "1 day"; "ONE_DAY"; "3 days"; "THREE_DAYS"; "1 week"; "SEVEN_DAYS"; "2 weeks"; "FOURTEEN_DAYS"; "SEVEN_DAYS")}}'
URN = '{{ifempty(2.companyUrn; "%s")}}' % LEGACY
JOBS = '{{ifempty(length(2.destinations); 0)}}'
IST = '{{formatDate(now; "YYYY-MM-DD HH:mm"; "Asia/Kolkata")}}'

nid = [100]
def i():
    nid[0] += 1
    return nid[0]

def cond(a, o, b=None):
    c = {"a": a, "o": o}
    if b is not None:
        c["b"] = b
    return c

def filt(name, groups):
    return {"name": name, "conditions": groups}

def respond(body, status=200):
    return {"id": i(), "module": "gateway:WebhookRespond", "version": 1, "parameters": {},
            "mapper": {"body": body, "status": status, "headers": HEADERS}, "metadata": {"advanced": True}}

def add(key, data, overwrite=True):
    return {"id": i(), "module": "datastore:AddRecord", "version": 1, "parameters": {"datastore": STORE},
            "mapper": {"key": key, "data": data, "overwrite": overwrite}, "metadata": DSMETA}

def upd(key, data):
    return {"id": i(), "module": "datastore:UpdateRecord", "version": 1, "parameters": {"datastore": STORE},
            "mapper": {"key": key, "data": data}, "metadata": DSMETA}

def search(groups, limit, keep_going):
    return {"id": i(), "module": "datastore:SearchRecord", "version": 1,
            "parameters": {"datastore": STORE, "limit": limit, "continueWhenNoRes": keep_going},
            "mapper": {"sort": [], "filter": groups, "mappAbleLimit": ""}, "metadata": dict(DSMETA, advanced=True)}

def ignore():
    return {"id": i(), "module": "builtin:Ignore", "version": 1, "mapper": {}}

def router(routes):
    return {"id": i(), "module": "builtin:BasicRouter", "version": 1, "mapper": None, "routes": [{"flow": r} for r in routes]}

def li(module, mapper):
    return {"id": i(), "module": f"linkedin:{module}", "version": 2, "parameters": {"__IMTCONN__": P["conn"]},
            "mapper": mapper, "metadata": {"restore": {"parameters": CONN_META}, "advanced": True}}

def publish_steps(kind, org, content, media1, poll, on_fail, on_ok):
    """The production LinkedIn call for one post type, then on_ok(urn) on
    success; on_fail(module_id) runs in its error handler, followed by Ignore
    so one refusal never counts towards Make switching the scenario off."""
    mods = []
    base = {"visibility": "PUBLIC", "organization": org, "feedDistribution": "MAIN_FEED", "isReshareDisabledByAuthor": False}
    if kind == "text":
        m = li("CreateTextShare", dict(base, content=content))
    elif kind == "image":
        m = li("CreateCompanyImagePost", dict(base, data='{{toBinary(%s.data; "base64")}}' % media1, method="upload",
               altText="{{%s.altText}}" % media1, content=content, fileName="{{%s.filename}}" % media1))
    elif kind == "video":
        m = li("createOrganizationVideoPost", dict(base, video='{{toBinary(%s.data; "base64")}}' % media1, method="upload",
               content=content, videoName="{{%s.filename}}" % media1))
    else:
        feeder = {"id": i(), "module": "builtin:BasicFeeder", "version": 1, "parameters": {}, "mapper": {"array": "{{%s.options}}" % poll},
                  "metadata": {"restore": {"expect": {"array": {"mode": "edit"}}}}}
        agg = {"id": i(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": feeder["id"]},
               "mapper": {"text": "{{%d.value}}" % feeder["id"]}}
        body = {"id": i(), "module": "json:CreateJSON", "version": 1, "parameters": {"type": P["poll"]}, "mapper": {
            "author": org, "content": {"poll": {"options": "{{%d.array}}" % agg["id"], "question": "{{%s.question}}" % poll,
            "settings": {"duration": DUR % ("%s.duration" % poll), "voteSelectionType": "SINGLE_VOTE"}}},
            "commentary": content, "visibility": "PUBLIC", "distribution": {"feedDistribution": "MAIN_FEED"},
            "lifecycleState": "PUBLISHED", "isReshareDisabledByAuthor": False}}
        m = li("MakeAPICall", {"url": "/rest/posts", "body": "{{%d.json}}" % body["id"], "method": "POST", "headers": [
            {"key": "Content-Type", "value": "application/json"}, {"key": "X-Restli-Protocol-Version", "value": "2.0.0"},
            {"key": "Linkedin-Version", "value": "202605"}], "sendUnencodedQueryString": False})
        mods += [feeder, agg, body]
    urn = ('{{ifempty(get(%d.headers; "x-restli-id"); %d.body.id)}}' % (m["id"], m["id"])) if kind == "poll" else "{{%d.id}}" % m["id"]
    m["onerror"] = on_fail(m["id"]) + [ignore()]
    mods.append(m)
    mods += on_ok(urn)
    return mods

def allowed(urn_expr, extra):
    return [extra + [cond(urn_expr, "text:equal", u)] for u in ALLOWED]

# ===================================================================== immediate
REC = {  # the fields production writes for an immediate post, plus the parent id
    "postId": "{{ifempty(2.parentPostId; 2.postId)}}", "source": "{{2.source}}", "company": "{{2.company}}",
    "content": "{{2.content}}", "postType": "{{2.postType}}", "timezone": "{{2.timezone}}", "companyUrn": URN,
    "publishMode": "{{2.publishMode}}", "idempotencyKey": "{{2.idempotencyKey}}",
    "submittedBy": {"name": "{{2.submittedBy.name}}", "email": "{{2.submittedBy.email}}"},
}
WHO = '"postId":"{{2.postId}}","destinationId":"{{2.destinationId}}","companyUrn":"%s","postType":"{{2.postType}}","mode":"now"' % URN

def now_route(kind):
    def fail(mid):
        msg = '{{replace(%d.error.message; "%s"; " ")}}' % (mid, SAFE)
        out = []
        if STORE:
            out.append(add("{{2.postId}}", dict(REC, note="LinkedIn refused this immediate post at %s IST: {{%d.error.message}}" % (IST, mid),
                                                  dueAt=NOW, status="failed")))
            out[-1]["onerror"] = [ignore()]
        # Production skips here and Make answers "Accepted"; a refusal is said in JSON instead.
        out.append(respond('{"status":"failed","stage":"linkedin",%s,"message":"LinkedIn refused the post for this Page: %s"}' % (WHO, msg)))
        return out
    def ok(urn):
        out = [respond('{"status":"published","urn":"%s","url":"https://www.linkedin.com/feed/update/%s/",%s}' % (urn, urn, WHO))]
        if STORE:
            out.append(add("{{2.postId}}", dict(REC, note="", dueAt=NOW, status="published", publishedUrn=urn)))
            out[-1]["onerror"] = [ignore()]   # the answer has gone; a full store must not turn it into an error
        return out
    steps = publish_steps(kind, URN, "{{2.content}}", "2.media[1]", "2.poll", fail, ok)
    steps[0]["filter"] = filt(f"Now · {kind.title()}", [[cond("{{2.postType}}", "text:equal", kind)]])
    return steps

def now_allowed():
    """Look the job up, claim it, then publish — or say why not."""
    groups = [[cond("{{2.publishMode}}", "text:equal", "now"), cond("{{2.postType}}", "text:equal", t), cond(URN, "text:equal", u)]
              for u in ALLOWED for t in TYPES]
    by_type = router([now_route(k) for k in TYPES])
    if not STORE:
        by_type["filter"] = filt("Now · allowed Page", groups)
        return [by_type]
    seen = search([[cond("idempotencyKey", "text:equal", "{{2.idempotencyKey}}")]], 1, True)
    seen["filter"] = filt("Now · allowed Page", groups)
    s = seen["id"]
    status = "{{%d.data.status}}" % s
    done = respond('{"status":"published","duplicate":true,"urn":"{{%d.data.publishedUrn}}","url":"https://www.linkedin.com/feed/update/{{%d.data.publishedUrn}}/",%s,"message":"Already on LinkedIn for this Page. Nothing was sent again."}' % (s, s, WHO))
    done["filter"] = filt("Already published · answer from the record", [[cond(status, "text:equal", "published")]])
    unsure = respond('{"status":"unknown","stage":"make-claim",%s,"message":"An earlier attempt for this Page started and did not record a result, so LinkedIn may already have the post. Nothing was sent. Check the Page."}' % WHO)
    unsure["filter"] = filt("Earlier attempt unfinished · do not publish", [[cond(status, "text:equal", CLAIM)], [cond(status, "text:equal", "stuck")]])
    claim = add("{{2.postId}}", dict(REC, note="Claimed by the immediate publisher. If this is still the status later, the run stopped after the claim: check the Page before sending again.",
                                     dueAt=NOW, attemptAt=NOW, status=CLAIM))
    claim["filter"] = filt("Not published, not in progress · claim and publish", [[
        cond(status, "text:notequal", "published"), cond(status, "text:notequal", CLAIM), cond(status, "text:notequal", "stuck")]])
    claim["onerror"] = [respond('{"status":"failed","stage":"make-store",%s,"message":"Make could not record this attempt (is the data store full?), so nothing was sent to LinkedIn."}' % WHO), ignore()]
    return [seen, router([[done], [unsure], [claim, by_type]])]

def now_withdrawn():
    groups = [[cond("{{2.publishMode}}", "text:equal", "now"), cond("{{2.postType}}", "text:equal", t)] for t in WITHDRAWN]
    r = respond('{"status":"unsupported","postId":"{{2.postId}}","postType":"{{2.postType}}","mode":"now","message":"Unison no longer offers this post type, because it could not be published to LinkedIn reliably. Nothing was published. Update your copy of Unison and send the post as text, image, video or poll — the text and media are stored in Make so nothing is lost."}')
    if not STORE:
        r["filter"] = filt("Now · A post type Unison no longer sends", groups)
        return [r]
    keep = add("{{2.postId}}", {"note": "Held, not published. This post type was removed from Unison because it could not be published end to end: LinkedIn has no organic carousel API, and multi-image and document posts need a binary upload to a host this LinkedIn connection cannot sign for. It arrived from a copy of Unison that predates that change. Nothing reached LinkedIn; the text and media are kept here.",
        "dueAt": NOW, "media": "{{2.media}}", "postId": "{{2.postId}}", "source": "{{2.source}}", "status": "unsupported", "company": "{{2.company}}",
        "content": "{{2.content}}", "postType": "{{2.postType}}", "timezone": "{{2.timezone}}", "companyUrn": URN,
        "publishMode": "{{2.publishMode}}", "idempotencyKey": "{{2.idempotencyKey}}"})
    keep["filter"] = filt("Now · A post type Unison no longer sends", groups)
    keep["onerror"] = [ignore()]
    return [keep, r]

def now_refused():
    r = respond('{"status":"rejected","stage":"destination","postId":"{{2.postId}}","destinationId":"{{2.destinationId}}","postType":"{{2.postType}}","mode":"now","message":"This Page is not on the allow-list of Pages this scenario may post to, so nothing was sent."}', 422)
    r["filter"] = filt("Now · not an allowed Page", [[cond("{{2.publishMode}}", "text:equal", "now")] + [cond("{{2.postType}}", "text:notequal", w) for w in WITHDRAWN] + [cond(URN, "text:notequal", u) for u in ALLOWED]])
    return [r]

SCHED_ONLY_STORE = '{"status":"rejected","stage":"config","postId":"{{2.postId}}","mode":"{{2.publishMode}}","message":"This test copy has no data store of its own, and test jobs may not be written to the production store, so scheduling and status cannot be tested here. Nothing was stored."}'

def sched_one():
    """A single-Page scheduled post in the production format: the record
    production writes today, byte for byte, so either scheduler can run it."""
    groups = [[cond("{{2.publishMode}}", "text:equal", "scheduled"), cond(JOBS, "number:equal", "0"), cond(URN, "text:equal", u)] for u in ALLOWED]
    if not STORE:
        r = respond(SCHED_ONLY_STORE, 422)
        r["filter"] = filt("Scheduled · one Page", groups)
        return [r]
    rec = add("{{2.postId}}", {"poll": {"options": "{{2.poll.options}}", "duration": "{{2.poll.duration}}", "question": "{{2.poll.question}}"},
        "dueAt": DUE, "media": "{{2.media}}", "postId": "{{2.postId}}", "source": "{{2.source}}", "status": Q, "company": "{{2.company}}",
        "content": "{{2.content}}", "postType": "{{2.postType}}", "timezone": "{{2.timezone}}", "companyUrn": URN, "publishMode": "{{2.publishMode}}",
        "submittedBy": {"name": "{{2.submittedBy.name}}", "email": "{{2.submittedBy.email}}"},
        "scheduledDate": "{{2.scheduledDate}}", "scheduledTime": "{{2.scheduledTime}}", "idempotencyKey": "{{2.idempotencyKey}}"})
    rec["filter"] = filt("Scheduled · one Page", groups)
    rec["onerror"] = [respond('{"status":"failed","stage":"make-store","postId":"{{2.postId}}","mode":"scheduled","message":"Make could not store this post (is the data store full?). Nothing is scheduled."}'), ignore()]
    ok = respond('{"status":"queued","postId":"{{2.postId}}","postType":"{{2.postType}}","mode":"scheduled","destinations":1,"scheduledFor":"{{2.scheduledDate}} {{2.scheduledTime}} {{2.timezone}}","message":"Queued in Make. Nothing is on LinkedIn yet."}')
    return [rec, ok]

def sched_one_refused():
    r = respond('{"status":"rejected","stage":"destination","postId":"{{2.postId}}","mode":"scheduled","message":"This Page is not on the allow-list of Pages this scenario may post to, so nothing was stored."}', 422)
    r["filter"] = filt("Scheduled · one Page · not allowed", [[cond("{{2.publishMode}}", "text:equal", "scheduled"), cond(JOBS, "number:equal", "0")] + [cond(URN, "text:notequal", u) for u in ALLOWED]])
    return [r]

def sched_many():
    """The post once (the parent, which holds content and media), then one job
    record per Page. Job keys are post~page, so sending again overwrites a job
    instead of adding a second one."""
    group = [[cond("{{2.publishMode}}", "text:equal", "scheduled"), cond(JOBS, "number:greater", "0")]]
    if not STORE:
        r = respond(SCHED_ONLY_STORE, 422)
        r["filter"] = filt("Scheduled · several Pages", group)
        return [r]
    parent = add("{{2.postId}}", {"note": "The post itself, for its Page jobs (keys {{2.postId}}~<page>). Removed a day after it is due.",
        "dueAt": DUE, "media": "{{2.media}}", "poll": {"options": "{{2.poll.options}}", "duration": "{{2.poll.duration}}", "question": "{{2.poll.question}}"},
        "postId": "{{2.postId}}", "source": "{{2.source}}", "status": PARENT, "company": "", "content": "{{2.content}}", "postType": "{{2.postType}}",
        "timezone": "{{2.timezone}}", "companyUrn": "", "publishMode": "scheduled", "scheduledDate": "{{2.scheduledDate}}", "scheduledTime": "{{2.scheduledTime}}",
        "submittedBy": {"name": "{{2.submittedBy.name}}", "email": "{{2.submittedBy.email}}"}, "idempotencyKey": "{{2.idempotencyKey}}"})
    parent["filter"] = filt("Scheduled · several Pages", group)
    parent["onerror"] = [respond('{"status":"failed","stage":"make-store","postId":"{{2.postId}}","mode":"scheduled","message":"Make could not store this post (is the data store full?). Nothing is scheduled."}'), ignore()]
    feeder = {"id": i(), "module": "builtin:BasicFeeder", "version": 1, "parameters": {}, "mapper": {"array": "{{2.destinations}}"},
              "metadata": {"restore": {"expect": {"array": {"mode": "edit"}}}}}
    f = feeder["id"]
    job = add("{{2.postId}}~{{%d.id}}" % f, {"note": "", "dueAt": DUE, "postId": "{{2.postId}}", "source": "{{2.source}}", "status": JQ,
        "company": "{{%d.name}}" % f, "postType": "{{2.postType}}", "timezone": "{{2.timezone}}", "companyUrn": "{{%d.organizationUrn}}" % f,
        "publishMode": "scheduled", "scheduledDate": "{{2.scheduledDate}}", "scheduledTime": "{{2.scheduledTime}}",
        "idempotencyKey": "{{2.postId}}~{{%d.id}}" % f})
    job["filter"] = filt("Only a Page on the allow-list", allowed("{{%d.organizationUrn}}" % f, []))
    agg = {"id": i(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": f}, "mapper": {"id": "{{%d.id}}" % f}}
    r = respond('{"status":"queued","postId":"{{2.postId}}","postType":"{{2.postType}}","mode":"scheduled","destinations":{{length(%d.array)}},"scheduledFor":"{{2.scheduledDate}} {{2.scheduledTime}} {{2.timezone}}","message":"Queued in Make, one job per Page. Nothing is on LinkedIn yet."}' % agg["id"])
    return [parent, feeder, job, agg, r]

def status_report():
    group = [[cond("{{2.publishMode}}", "text:equal", "status")]]
    if not STORE:
        r = respond(SCHED_ONLY_STORE, 422)
        r["filter"] = filt("Status · report every job for a post", group)
        return [r]
    s = search([[cond("postId", "text:equal", "{{2.postId}}")]], 20, True)
    s["filter"] = filt("Status · report every job for a post", group)
    agg = {"id": i(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": s["id"]}, "mapper": {
        k: "{{%d.%s}}" % (s["id"], v) for k, v in [("key", "key"), ("status", "data.status"), ("companyUrn", "data.companyUrn"),
        ("company", "data.company"), ("publishedUrn", "data.publishedUrn"), ("note", "data.note"), ("postType", "data.postType"),
        ("publishMode", "data.publishMode"), ("dueAt", "data.dueAt"), ("attemptAt", "data.attemptAt")]}}
    js = {"id": i(), "module": "json:TransformToJSON", "version": 1, "parameters": {"space": ""}, "mapper": {"object": "{{%d.array}}" % agg["id"]}}
    r = respond('{"status":"report","postId":"{{2.postId}}","jobs":{{%d.json}}}' % js["id"])
    return [s, agg, js, r]

def nothing():
    r = respond('{"status":"rejected","postId":"{{2.postId}}","postType":"{{2.postType}}","mode":"{{2.publishMode}}","message":"This scenario has no route for that combination of publish mode and post type, so nothing was sent to LinkedIn."}', 422)
    r["filter"] = filt("Nothing matched · say so", [
        [cond("{{2.publishMode}}", "text:notequal", m) for m in ["now", "scheduled", "status"]],
        [cond("{{2.publishMode}}", "text:equal", "now")] + [cond("{{2.postType}}", "text:notequal", t) for t in TYPES + WITHDRAWN]])
    return [r]

SCEN = {"dlq": False, "slots": None, "dataloss": False, "maxErrors": 3, "autoCommit": True, "roundtrips": 1, "sequential": False,
        "confidential": False, "freshVariables": False, "autoCommitTriggerLast": True}

immediate = {"name": P["name"], "metadata": {"instant": True, "version": 1, "designer": {"orphans": []}, "scenario": SCEN},
    "flow": [
        {"id": 1, "module": "gateway:CustomWebHook", "version": 1, "parameters": {"hook": P["hook"], "maxResults": 1}, "mapper": {}},
        {"id": 2, "module": "json:ParseJSON", "version": 1, "parameters": {"type": P["structure"]}, "mapper": {"json": "{{1.value}}"}},
        {"id": 3, "module": "builtin:BasicRouter", "version": 1, "mapper": None, "routes": [{"flow": r} for r in [
            now_withdrawn(), now_allowed(), now_refused(), sched_one(), sched_one_refused(), sched_many(), status_report(), nothing()]]},
    ]}

# ===================================================================== scheduled
nid[0] = 400
D = "19.data"
STALE = '{{parseNumber(formatDate(addMinutes(now; -45); "X"); ".")}}'

def sched_route(kind):
    """Claim, read the post (the record itself for a single-Page post, its
    parent for a Page job), publish, record the result."""
    claim = upd("{{19.key}}", {"note": "Claimed by the scheduled publisher. If it is still claimed after the claim goes stale, the run was interrupted.",
        "status": '{{if(19.data.status = "%s"; "%s"; "%s")}}' % (JQ, JCLAIM, CLAIM), "attemptAt": NOW})
    claim["filter"] = filt(kind.title(), [[cond("{{19.data.status}}", "text:equal", s), cond("{{19.data.postType}}", "text:equal", kind)] for s in (Q, JQ)])
    post = {"id": i(), "module": "datastore:GetRecord", "version": 1, "parameters": {"datastore": STORE}, "mapper": {"key": "{{19.data.postId}}", "returnWrapped": False}, "metadata": DSMETA}
    p = post["id"]
    def fail(mid):
        return [upd("{{19.key}}", {"note": 'LinkedIn refused this post at %s IST: {{%d.error.message}}' % (IST, mid), "status": "failed"})]
    def ok(urn):
        if kind in ("text", "poll"):   # as production: the record stays, marked published
            return [upd("{{19.key}}", {"note": "", "status": "published", "publishedUrn": urn})]
        keep = {k: "{{19.data.%s}}" % k for k in ["dueAt", "postId", "source", "company", "postType", "timezone", "companyUrn",
                                                  "publishMode", "scheduledDate", "scheduledTime", "idempotencyKey"]}
        keep["submittedBy"] = {"name": "{{19.data.submittedBy.name}}", "email": "{{19.data.submittedBy.email}}"}
        # Re-written without media, as production does for image and video: the bytes are no longer needed.
        return [add("{{19.key}}", dict(keep, note="", status="published", attemptAt=NOW, content="{{19.data.content}}", publishedUrn=urn))]
    steps = publish_steps(kind, '{{ifempty(19.data.companyUrn; "%s")}}' % LEGACY, "{{%d.content}}" % p, "%d.media[1]" % p, "%d.poll" % p, fail, ok)
    first = next(m for m in steps if m["module"].startswith(("linkedin:", "builtin:BasicFeeder")))
    first["filter"] = filt("The post is there to publish", [[cond("{{%d.content}}" % p, "text:notequal", "")]])
    return [claim, post] + steps

def stuck(status, back):
    u = upd("{{19.key}}", {"note": "A previous run claimed this post and did not finish. It is NOT published again automatically, because LinkedIn may already have it. Check the Company Page: if the post is not there, set status back to %s." % back,
                          "status": "stuck"})
    u["filter"] = filt("Interrupted mid-publish" + (" · Page job" if status == JCLAIM else ""), [[cond("{{19.data.status}}", "text:equal", status)]])
    return [u]

def withdrawn():
    u = upd("{{19.key}}", {"note": "Held, not published. This post type was removed from Unison because it could not be published end to end: LinkedIn has no organic carousel API, and multi-image and document posts need a binary PUT to a host Make's LinkedIn module cannot call — initializeUpload succeeds and the upload answers 405. This record was queued by a copy of Unison that predates that change. The text, the media and the schedule are all still here.",
                          "status": "unsupported"})
    u["filter"] = filt("A post type Unison no longer sends", [[cond("{{19.data.status}}", "text:equal", Q), cond("{{19.data.postType}}", "text:equal", t)] for t in WITHDRAWN])
    return [u]

def expire_parent():
    d = {"id": i(), "module": "datastore:DeleteRecord", "version": 1, "parameters": {"datastore": STORE}, "mapper": {"key": "{{19.key}}"}, "metadata": DSMETA}
    d["filter"] = filt("Parent a day past due · free the space", [[cond("{{19.data.status}}", "text:equal", PARENT)]])
    return [d]

scheduled = None
if STORE:
    scheduled = {"name": P["sname"], "metadata": {"instant": False, "version": 1, "designer": {"orphans": []}, "scenario": SCEN},
        "scheduling": {"type": "indefinitely", "interval": 3600},
        "flow": [
            {"id": 19, "module": "datastore:SearchRecord", "version": 1, "parameters": {"datastore": STORE, "limit": 5, "continueWhenNoRes": False},
             "metadata": dict(DSMETA, advanced=True), "mapper": {"sort": [], "mappAbleLimit": "", "filter": [
                [cond("status", "text:equal", Q), cond("dueAt", "number:lessorequal", NOW)],
                [cond("status", "text:equal", JQ), cond("dueAt", "number:lessorequal", NOW)],
                [cond("status", "text:equal", CLAIM), cond("attemptAt", "number:lessorequal", STALE)],
                [cond("status", "text:equal", JCLAIM), cond("attemptAt", "number:lessorequal", STALE)],
                [cond("status", "text:equal", PARENT), cond("dueAt", "number:lessorequal", '{{parseNumber(formatDate(addDays(now; -1); "X"); ".")}}')]]}},
            {"id": 7, "module": "builtin:BasicRouter", "version": 1, "mapper": None, "routes": [{"flow": r} for r in
                [stuck(CLAIM, Q), stuck(JCLAIM, JQ)] + [sched_route(k) for k in TYPES] + [withdrawn(), expire_parent()]]},
        ]}

here = os.path.dirname(os.path.abspath(__file__))
out = A.out or (here if A.profile == "production" else os.path.join(here, A.profile))
os.makedirs(out, exist_ok=True)
suffix = "" if A.profile == "production" else f".{A.profile}"
def save(obj, name):
    # utf-8 and \n on every system, so a Windows run reproduces the committed files exactly
    with open(os.path.join(out, name), "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)

save(immediate, f"unified-immediate-publisher{suffix}.json")
if scheduled:
    save(scheduled, f"unified-scheduled-publisher{suffix}.json")
print("ok", A.profile, out)
