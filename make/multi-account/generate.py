import json, sys
OUT = sys.argv[1]
DS = 193288; CONN = 10513797; HOOK = 3885267; PARSE_TYPE = 631043; POLL_TYPE = 597911
ALLOWED = ["urn:li:organization:146260120", "urn:li:organization:145298202", "urn:li:organization:145301196"]
LEGACY = "urn:li:organization:146260120"
CONN_META = {"__IMTCONN__": {"data": {"scoped": "true", "connection": "linkedin2"}, "label": "Drashti's LinkedIn connection (Drashti Makwana)"}}
DSMETA = {"restore": {"parameters": {"datastore": {"label": "Unison Scheduled Posts"}}}}
SAFE = '/[^a-zA-Z0-9 .,:;()\'_=-]/g'
HEADERS = [{"key": "Content-Type", "value": "application/json"}, {"key": "Access-Control-Allow-Origin", "value": "*"}]
nid = [100]
def i():
    nid[0] += 1; return nid[0]

def respond(body, status=200):
    return {"id": i(), "module": "gateway:WebhookRespond", "version": 1, "parameters": {},
            "mapper": {"body": body, "status": status, "headers": HEADERS}, "metadata": {"advanced": True}}

def add(key, data, overwrite=True):
    return {"id": i(), "module": "datastore:AddRecord", "version": 1, "parameters": {"datastore": DS},
            "mapper": {"key": key, "data": data, "overwrite": overwrite}, "metadata": DSMETA}

def upd(key, data):
    return {"id": i(), "module": "datastore:UpdateRecord", "version": 1, "parameters": {"datastore": DS},
            "mapper": {"key": key, "data": data}, "metadata": DSMETA}

def ignore():
    return {"id": i(), "module": "builtin:Ignore", "version": 1, "mapper": {}}

def li(module, mapper):
    return {"id": i(), "module": f"linkedin:{module}", "version": 2, "parameters": {"__IMTCONN__": CONN},
            "mapper": mapper, "metadata": {"restore": {"parameters": CONN_META}, "advanced": True}}

NOW = '{{parseNumber(formatDate(now; "X"); ".")}}'
DUR = '{{switch(%s; "1 day"; "ONE_DAY"; "3 days"; "THREE_DAYS"; "1 week"; "SEVEN_DAYS"; "2 weeks"; "FOURTEEN_DAYS"; "SEVEN_DAYS")}}'

def allowed_groups(urn_expr, extra):
    return [extra + [{"a": urn_expr, "b": u, "o": "text:equal"}] for u in ALLOWED]

def publish_steps(kind, src, org, content, media1, poll, on_fail, on_ok):
    """The LinkedIn call for one post type, plus what to do on failure and on success.
    on_fail(mod_id) / on_ok(urn_expr) return module lists."""
    mods = []
    if kind == "text":
        m = li("CreateTextShare", {"content": content, "visibility": "PUBLIC", "organization": org, "feedDistribution": "MAIN_FEED", "isReshareDisabledByAuthor": False})
        urn = "{{%d.id}}" % m["id"]
    elif kind == "image":
        m = li("CreateCompanyImagePost", {"data": '{{toBinary(%s.data; "base64")}}' % media1, "method": "upload", "altText": "{{%s.altText}}" % media1,
            "content": content, "fileName": "{{%s.filename}}" % media1, "visibility": "PUBLIC", "organization": org, "feedDistribution": "MAIN_FEED", "isReshareDisabledByAuthor": False})
        urn = "{{%d.id}}" % m["id"]
    elif kind == "video":
        m = li("createOrganizationVideoPost", {"video": '{{toBinary(%s.data; "base64")}}' % media1, "method": "upload", "content": content,
            "videoName": "{{%s.filename}}" % media1, "visibility": "PUBLIC", "organization": org, "feedDistribution": "MAIN_FEED", "isReshareDisabledByAuthor": False})
        urn = "{{%d.id}}" % m["id"]
    else:  # poll: same Posts API call the production scenarios make
        feeder = {"id": i(), "module": "builtin:BasicFeeder", "version": 1, "parameters": {}, "mapper": {"array": "{{%s.options}}" % poll}, "metadata": {"restore": {"expect": {"array": {"mode": "edit"}}}}}
        agg = {"id": i(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": feeder["id"]}, "mapper": {"text": "{{%d.value}}" % feeder["id"]}}
        body = {"id": i(), "module": "json:CreateJSON", "version": 1, "parameters": {"type": POLL_TYPE}, "mapper": {
            "author": org, "content": {"poll": {"options": "{{%d.array}}" % agg["id"], "question": "{{%s.question}}" % poll,
            "settings": {"duration": DUR % ("%s.duration" % poll), "voteSelectionType": "SINGLE_VOTE"}}},
            "commentary": content, "visibility": "PUBLIC", "distribution": {"feedDistribution": "MAIN_FEED"}, "lifecycleState": "PUBLISHED", "isReshareDisabledByAuthor": False}}
        m = li("MakeAPICall", {"url": "/rest/posts", "body": "{{%d.json}}" % body["id"], "method": "POST", "headers": [
            {"key": "Content-Type", "value": "application/json"}, {"key": "X-Restli-Protocol-Version", "value": "2.0.0"}, {"key": "Linkedin-Version", "value": "202605"}],
            "sendUnencodedQueryString": False})
        mods += [feeder, agg, body]
        urn = '{{ifempty(get(%d.headers; "x-restli-id"); %d.body.id)}}' % (m["id"], m["id"])
    m["onerror"] = on_fail(m["id"]) + [ignore()]
    mods.append(m)
    mods += on_ok(urn)
    return mods

# ---------------- immediate (webhook) ----------------
P = "2"
URN = '{{ifempty(2.companyUrn; "%s")}}' % LEGACY
def imm_route(kind):
    def fail(mid):
        msg = '{{replace(%d.error.message; "%s"; " ")}}' % (mid, SAFE)
        return [add("mt:{{2.postId}}", {"note": "LinkedIn refused this immediate post: " + msg, "dueAt": NOW, "postId": "{{2.postId}}", "source": "{{2.source}}",
                    "status": "failed", "company": "{{2.company}}", "postType": "{{2.postType}}", "timezone": "{{2.timezone}}", "companyUrn": URN,
                    "publishMode": "{{2.publishMode}}", "idempotencyKey": "{{2.idempotencyKey}}"}),
                respond('{"status":"failed","stage":"linkedin","postId":"{{2.postId}}","destinationId":"{{2.destinationId}}","companyUrn":"%s","postType":"{{2.postType}}","mode":"now","message":"LinkedIn refused the post for this Page: %s"}' % (URN, msg))]
    def ok(urn):
        return [respond('{"status":"published","urn":"%s","url":"https://www.linkedin.com/feed/update/%s/","postId":"{{2.postId}}","destinationId":"{{2.destinationId}}","companyUrn":"%s","postType":"{{2.postType}}","mode":"now"}' % (urn, urn, URN)),
                add("mt:{{2.postId}}", {"note": "", "dueAt": NOW, "postId": "{{2.postId}}", "source": "{{2.source}}", "status": "published", "company": "{{2.company}}",
                    "postType": "{{2.postType}}", "timezone": "{{2.timezone}}", "companyUrn": URN, "publishMode": "{{2.publishMode}}", "publishedUrn": urn, "idempotencyKey": "{{2.idempotencyKey}}"})]
    steps = publish_steps(kind, "2", URN, "{{2.content}}", "2.media[1]", "2.poll", fail, ok)
    steps[0]["filter"] = {"name": f"Now · {kind.title()} · allowed Page", "conditions": allowed_groups(URN, [
        {"a": "{{2.publishMode}}", "b": "now", "o": "text:equal"}, {"a": "{{2.postType}}", "b": kind, "o": "text:equal"}])}
    return {"flow": steps}

def sched_intake():
    parent = add("mt:{{2.postId}}", {"note": "Parent of a multi-destination scheduled post. Holds the content and media once; one child record per Page is published by the test scheduler.",
        "dueAt": '{{parseNumber(formatDate(parseDate(2.scheduledDate + " " + 2.scheduledTime; "YYYY-MM-DD HH:mm"; 2.timezone); "X"); ".")}}',
        "media": "{{2.media}}", "poll": {"options": "{{2.poll.options}}", "duration": "{{2.poll.duration}}", "question": "{{2.poll.question}}"},
        "postId": "{{2.postId}}", "source": "{{2.source}}", "status": "mtparent", "company": "", "content": "{{2.content}}", "postType": "{{2.postType}}",
        "timezone": "{{2.timezone}}", "companyUrn": "", "publishMode": "scheduled", "scheduledDate": "{{2.scheduledDate}}", "scheduledTime": "{{2.scheduledTime}}",
        "idempotencyKey": "{{2.idempotencyKey}}"})
    parent["filter"] = {"name": "Scheduled · queue one job per Page", "conditions": [[{"a": "{{2.publishMode}}", "b": "scheduled", "o": "text:equal"}]]}
    feeder = {"id": i(), "module": "builtin:BasicFeeder", "version": 1, "parameters": {}, "mapper": {"array": "{{2.destinations}}"}, "metadata": {"restore": {"expect": {"array": {"mode": "edit"}}}}}
    f = feeder["id"]
    child = add("mt:{{2.postId}}~{{%d.id}}" % f, {"note": "", "dueAt": '{{parseNumber(formatDate(parseDate(2.scheduledDate + " " + 2.scheduledTime; "YYYY-MM-DD HH:mm"; 2.timezone); "X"); ".")}}',
        "postId": "{{2.postId}}", "source": "{{2.source}}", "status": "mtqueued", "company": "{{%d.name}}" % f, "postType": "{{2.postType}}", "timezone": "{{2.timezone}}",
        "companyUrn": "{{%d.organizationUrn}}" % f, "publishMode": "scheduled", "scheduledDate": "{{2.scheduledDate}}", "scheduledTime": "{{2.scheduledTime}}",
        "idempotencyKey": "{{2.postId}}~{{%d.id}}" % f})
    child["filter"] = {"name": "Only a Page this connection may post to", "conditions": allowed_groups("{{%d.organizationUrn}}" % f, [])}
    agg = {"id": i(), "module": "builtin:BasicAggregator", "version": 1, "parameters": {"feeder": f}, "mapper": {"id": "{{%d.id}}" % f}}
    r = respond('{"status":"queued","postId":"{{2.postId}}","postType":"{{2.postType}}","mode":"scheduled","destinations":{{length(%d.array)}},"scheduledFor":"{{2.scheduledDate}} {{2.scheduledTime}} {{2.timezone}}","message":"Queued in Make, one job per Page. Nothing is on LinkedIn yet."}' % agg["id"])
    return {"flow": [parent, feeder, child, agg, r]}

def rejected_dest():
    r = respond('{"status":"rejected","stage":"destination","postId":"{{2.postId}}","destinationId":"{{2.destinationId}}","postType":"{{2.postType}}","mode":"now","message":"This Page is not one the connected LinkedIn account may post to, so nothing was sent."}', 422)
    r["filter"] = {"name": "Now · not an allowed Page", "conditions": [[{"a": "{{2.publishMode}}", "b": "now", "o": "text:equal"}] + [{"a": URN, "b": u, "o": "text:notequal"} for u in ALLOWED]]}
    return {"flow": [r]}

def nothing():
    r = respond('{"status":"rejected","postId":"{{2.postId}}","postType":"{{2.postType}}","mode":"{{2.publishMode}}","message":"This scenario has no route for that combination of publish mode and post type, so nothing was sent to LinkedIn."}', 422)
    r["filter"] = {"name": "Nothing matched · say so", "conditions": [
        [{"a": "{{2.publishMode}}", "b": "now", "o": "text:notequal"}, {"a": "{{2.publishMode}}", "b": "scheduled", "o": "text:notequal"}],
        [{"a": "{{2.publishMode}}", "b": "now", "o": "text:equal"}] + [{"a": "{{2.postType}}", "b": t, "o": "text:notequal"} for t in ["text", "image", "video", "poll"]]]}
    return {"flow": [r]}

imm = {"name": "Unison LinkedIn Publisher - Multi Account Test", "metadata": {"instant": True, "version": 1, "scenario": {"dlq": False, "maxErrors": 3, "autoCommit": True, "roundtrips": 1, "sequential": False, "confidential": False, "dataloss": False, "freshVariables": False, "autoCommitTriggerLast": True}},
    "flow": [
        {"id": 1, "module": "gateway:CustomWebHook", "version": 1, "parameters": {"hook": HOOK, "maxResults": 1}, "mapper": {}},
        {"id": 2, "module": "json:ParseJSON", "version": 1, "parameters": {"type": PARSE_TYPE}, "mapper": {"json": "{{1.value}}"}},
        {"id": 3, "module": "builtin:BasicRouter", "version": 1, "mapper": None, "routes": [imm_route(k) for k in ["text", "image", "video", "poll"]] + [rejected_dest(), sched_intake(), nothing()]},
    ]}

# ---------------- scheduled (on demand) ----------------
nid[0] = 300
C = "19.data"
def sched_route(kind):
    claim = upd("{{19.key}}", {"note": "Claimed by the multi-account test scheduler.", "status": "mtpublishing", "attemptAt": NOW})
    claim["filter"] = {"name": kind.title(), "conditions": [[{"a": "{{19.data.status}}", "b": "mtqueued", "o": "text:equal"}, {"a": "{{19.data.postType}}", "b": kind, "o": "text:equal"}]]}
    parent = {"id": i(), "module": "datastore:GetRecord", "version": 1, "parameters": {"datastore": DS}, "mapper": {"key": "mt:{{19.data.postId}}"}, "metadata": DSMETA}
    pid = parent["id"]
    def fail(mid):
        return [upd("{{19.key}}", {"note": 'LinkedIn refused this post at {{formatDate(now; "YYYY-MM-DD HH:mm"; "Asia/Kolkata")}} IST: {{replace(%d.error.message; "%s"; " ")}}' % (mid, SAFE), "status": "mtfailed"})]
    def ok(urn):
        return [upd("{{19.key}}", {"note": "", "status": "mtpublished", "publishedUrn": urn})]
    steps = publish_steps(kind, None, "{{19.data.companyUrn}}", "{{%d.content}}" % pid, "%d.media[1]" % pid, "%d.poll" % pid, fail, ok)
    return {"flow": [claim, parent] + steps}

def stuck():
    u = upd("{{19.key}}", {"note": "A previous run claimed this job and did not finish. It is NOT published again automatically, because LinkedIn may already have it. Check the Page; if the post is not there, set status back to mtqueued.", "status": "mtstuck"})
    u["filter"] = {"name": "Interrupted mid-publish", "conditions": [[{"a": "{{19.data.status}}", "b": "mtpublishing", "o": "text:equal"}]]}
    return {"flow": [u]}

def expire():
    d = {"id": i(), "module": "datastore:DeleteRecord", "version": 1, "parameters": {"datastore": DS}, "mapper": {"key": "{{19.key}}"}, "metadata": DSMETA}
    d["filter"] = {"name": "Parent no longer needed · free the space", "conditions": [[{"a": "{{19.data.status}}", "b": "mtparent", "o": "text:equal"}]]}
    return {"flow": [d]}

sch = {"name": "Unison Scheduled Publisher - Multi Account Test", "metadata": {"instant": False, "version": 1, "scenario": {"dlq": False, "maxErrors": 3, "autoCommit": True, "roundtrips": 1, "sequential": False, "confidential": False, "dataloss": False, "freshVariables": False, "autoCommitTriggerLast": True}},
    "flow": [
        {"id": 19, "module": "datastore:SearchRecord", "version": 1, "parameters": {"datastore": DS, "limit": 5, "continueWhenNoRes": False}, "metadata": dict(DSMETA, advanced=True),
         "mapper": {"sort": [], "mappAbleLimit": "", "filter": [
            [{"a": "status", "b": "mtqueued", "o": "text:equal"}, {"a": "dueAt", "b": NOW, "o": "number:lessorequal"}],
            [{"a": "status", "b": "mtpublishing", "o": "text:equal"}, {"a": "attemptAt", "b": '{{parseNumber(formatDate(addMinutes(now; -45); "X"); ".")}}', "o": "number:lessorequal"}],
            [{"a": "status", "b": "mtparent", "o": "text:equal"}, {"a": "dueAt", "b": '{{parseNumber(formatDate(addDays(now; -2); "X"); ".")}}', "o": "number:lessorequal"}]]}},
        {"id": 7, "module": "builtin:BasicRouter", "version": 1, "mapper": None, "routes": [stuck()] + [sched_route(k) for k in ["text", "image", "video", "poll"]] + [expire()]},
    ]}

json.dump({"immediate": imm, "scheduled": sch}, open(OUT, "w"), indent=1)
print("ok")
