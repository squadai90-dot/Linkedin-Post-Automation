import { useState, useEffect, useRef, useMemo } from "react";
import mammoth from "mammoth";
import { STORE_KEY, persistentStore } from "./lib/store.js";
import { P, S } from "./lib/pointer.js";
import { friendlyError, askJSON, JSON_RULE, fb } from "./lib/ai.js";
import { EMPTY_CONNECTION, withDerived, linkedinService, readCallbackParams } from "./lib/linkedin.js";
import { MAKE_CONFIG, makeLinkedInService } from "./lib/publish.js";
import { FORMAT_BY_ID, normalizeFormats, visualOf, labelFor, composeFormat, EMPTY_ASSETS, compactAssets, idle } from "./lib/formats.js";
import { SEED_POSTS, NAV, DEFAULT_VOICE, SEED_TEAM, DEFAULT_PROFILE } from "./lib/seed.js";
import { now } from "./lib/util.js";
import { tplPage, svgToPng } from "./lib/brand.js";
import { createMediaEngine } from "./lib/media.js";
import { CursorField } from "./components/ambient.jsx";
import { Header, MobileRail, Rail } from "./components/chrome.jsx";
import { PipelineScene } from "./components/scene3d.jsx";
import { Dashboard, CreateFlow, DraftsList } from "./components/dashboard.jsx";
import { Discover } from "./components/discover.jsx";
import { Workspace, EmptyWorkspace } from "./components/workspace.jsx";
import { ContentList, CalendarView, Insights, PostDetail } from "./components/views.jsx";
import { SourcesPanel, AuditPanel, VersionPanel, NotesPanel } from "./components/panels.jsx";
import { Modal, LinkedInFlow, DiffView } from "./components/modals.jsx";
import { Settings } from "./components/settings.jsx";
import { VoiceStudio } from "./components/voice.jsx";

/* ============================================================
   ROOT
   ============================================================ */

export default function UnisonContentOS() {
  const [theme, setTheme] = useState("dark");
  const [view, setView] = useState("home");
  const [drawer, setDrawer] = useState(null);
  const [modal, setModal] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [liStart, setLiStart] = useState(0);          // which step the LinkedIn flow opens on
  const [settingsTab, setSettingsTab] = useState("models");
  const [restored, setRestored] = useState(false);
  const [bg3d, setBg3d] = useState(true);

  const [idea, setIdea] = useState("");
  const [stage, setStage] = useState("IDEA");
  const [steps, setSteps] = useState([]);
  const [opps, setOpps] = useState(null);
  const [oppBusy, setOppBusy] = useState(false);
  const [research, setResearch] = useState(null);
  const [angles, setAngles] = useState(null);
  const [angle, setAngle] = useState(null);
  const [draft, setDraft] = useState(null);
  const [verification, setVerification] = useState(null);
  const [quality, setQuality] = useState(null);
  const [dupDismissed, setDupDismissed] = useState(false);
  const [media, setMedia] = useState(null);
  const [formats, setFormats] = useState(["text"]);
  const fmt = useMemo(() => composeFormat(formats), [formats]);
  const format = visualOf(formats) || "text";          // the attachment type, for renderers that need one
  const [workId, setWorkId] = useState(null);           // identity of the post being worked on
  const [drafts, setDrafts] = useState([]);              // unfinished posts, auto-saved
  const [seedIdea, setSeedIdea] = useState("");
  const [recBusy, setRecBusy] = useState(false);
  const [recFormat, setRecFormat] = useState(null);
  const [assets, setAssets] = useState(EMPTY_ASSETS);
  const [mstate, setMstate] = useState({});          // per-task idle/generating/success/error
  const [versions, setVersions] = useState([]);
  const [schedule, setSchedule] = useState({ date: "2026-09-02", time: "09:30", tz: "Asia/Kolkata" });
  const [publishState, setPublishState] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [publishError, setPublishError] = useState(null);
  const [publishVia, setPublishVia] = useState(null);      // "make" | "api" — which route the last publish took
  const [publishUnverified, setPublishUnverified] = useState(false);
  const [sentKeys, setSentKeys] = useState([]);            // idempotency: posts already handed to Make
  const [makeCompany, setMakeCompany] = useState({ name: "", urn: "" });
  const [relay, setRelay] = useState({ relay: false, checked: false });
  useEffect(() => { makeLinkedInService.health().then((r) => setRelay({ ...r, checked: true })); }, []);
  const [analytics, setAnalytics] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [openClaim, setOpenClaim] = useState(null);
  const [openPost, setOpenPost] = useState(null);
  const [undoStack, setUndoStack] = useState([]);

  const [tone, setTone] = useState("Confident");
  const [pov, setPov] = useState("Strong opinion");
  const [length, setLength] = useState("Medium");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);

  const [conn, setConn] = useState(EMPTY_CONNECTION);
  const [liMeta, setLiMeta] = useState({ reachable: false, mode: "unknown", apiVersion: null, scopes: [] });
  const linkedin = useMemo(() => withDerived(conn), [conn]);
  const [failMode, setFailMode] = useState(false);
  const [searchOn, setSearchOn] = useState(true);
  const [notes, setNotes] = useState([{ t: "09:14", text: "3 posts are waiting for your review." }]);
  const [audit, setAudit] = useState([]);
  const [posts, setPosts] = useState(SEED_POSTS);
  const [team, setTeam] = useState(SEED_TEAM);
  const [usage, setUsage] = useState({ calls: 0, fails: 0, searches: 0, inTok: 0, outTok: 0, byEngine: {} });

  const abortRef = useRef(null);
  const runRef = useRef(0);
  const cacheRef = useRef({});

  /* pointer + scroll, no re-render */
  useEffect(() => {
    const pm = (e) => { P.px = e.clientX; P.py = e.clientY; P.x = e.clientX / window.innerWidth; P.y = e.clientY / window.innerHeight; };
    const sc = () => {
      S.y = window.scrollY;
      const max = document.body.scrollHeight - window.innerHeight;
      S.p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    };
    window.addEventListener("pointermove", pm, { passive: true });
    window.addEventListener("scroll", sc, { passive: true });
    sc();
    return () => { window.removeEventListener("pointermove", pm); window.removeEventListener("scroll", sc); };
  }, []);

  /* ---------- persistence ---------- */
  useEffect(() => {
    (async () => {
      try {
        const r = await persistentStore.get(STORE_KEY);
        if (r?.value) {
          const d = JSON.parse(r.value);
          d.theme && setTheme(d.theme);
          d.idea && setIdea(d.idea);
          d.stage && setStage(d.stage);
          d.steps && setSteps(d.steps);
          d.research && setResearch(d.research);
          d.angles && setAngles(d.angles);
          d.angle && setAngle(d.angle);
          d.draft && setDraft(d.draft);
          d.verification && setVerification(d.verification);
          d.quality && setQuality(d.quality);
          d.media && setMedia(d.media);
          (d.formats || d.format) && setFormats(normalizeFormats(d.formats || d.format));
          d.workId && setWorkId(d.workId);
          d.drafts && setDrafts(d.drafts);
          d.sentKeys && setSentKeys(d.sentKeys);
          d.makeCompany && setMakeCompany(d.makeCompany);
          d.assets && setAssets({ ...EMPTY_ASSETS, ...d.assets });
          d.versions && setVersions(d.versions);
          d.schedule && setSchedule(d.schedule);
          d.analytics && setAnalytics(d.analytics);
          d.voice && setVoice(d.voice);
          d.profile && setProfile(d.profile);

          d.posts && setPosts(d.posts);
          d.team && setTeam(d.team);
          d.notes && setNotes(d.notes);
          d.audit && setAudit(d.audit);
          d.usage && setUsage(d.usage);
          d.opps && setOpps(d.opps);
          if (typeof d.searchOn === "boolean") setSearchOn(d.searchOn);
          if (typeof d.bg3d === "boolean") setBg3d(d.bg3d);
          if (d.idea) setView("workspace");
        }
      } catch (e) { /* first run */ }
      setRestored(true);
    })();
  }, []);

  const saveTimer = useRef(null);
  useEffect(() => {
    if (!restored) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await persistentStore.set(STORE_KEY, JSON.stringify({
          theme, idea, stage, steps, research, angles, angle, draft, verification, quality,
          media, formats, workId, drafts, versions, schedule, analytics, voice, profile, sentKeys, makeCompany,
          posts, team, notes, audit, usage, opps, searchOn, bg3d,
          assets: compactAssets(assets),
        }));
      } catch (e) { /* over quota or unavailable */ }
    }, 700);
  }, [restored, theme, idea, stage, steps, research, angles, angle, draft, verification, quality,
      media, formats, workId, drafts, versions, schedule, analytics, voice, profile, sentKeys, makeCompany, posts, team, notes, audit, usage, opps, searchOn, bg3d, assets]);

  /* ---------- drafts ----------
     Anything in progress is a draft until it is scheduled or published. The
     snapshot is written continuously, so leaving the workspace — to start a
     new post, open another one or visit any other tab — never loses work. */
  const FINISHED = ["SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"];
  const finishedNow = FINISHED.includes(stage) && publishState !== "FAILED";
  const snapshotWork = () => ({
    id: workId, title: idea, idea, formats, stage, steps, research, angles, angle, draft, verification, quality,
    media, assets: compactAssets(assets), versions, schedule, tone, pov, length, undoStack, savedAt: new Date().toISOString(),
  });
  useEffect(() => {
    if (!restored || !workId || !idea) return;
    if (finishedNow) { setDrafts((d) => d.filter((x) => x.id !== workId)); return; }
    const snap = snapshotWork();
    setDrafts((d) => {
      const i = d.findIndex((x) => x.id === workId);
      if (i < 0) return [snap, ...d];
      const next = [...d]; next[i] = snap; return next;
    });
  }, [restored, workId, idea, formats, stage, steps, research, angles, angle, draft, verification, quality, media, assets, versions, schedule, tone, pov, length]);

  /* Clears the workspace without touching the drafts list. */
  function clearWork() {
    abortRef.current?.abort(); runRef.current += 1;
    setWorkId(null); setIdea(""); setStage("IDEA"); setResearch(null); setAngles(null); setAngle(null);
    setDraft(null); setVerification(null); setQuality(null); setMedia(null); setFormats(["text"]);
    setAssets(EMPTY_ASSETS); setMstate({}); setVersions([]); setPublishState(null); setAttempts([]);
    setAnalytics(null); setSteps([]); setAudit([]); setUndoStack([]); setBusy(false);
    setDupDismissed(false); setOpenClaim(null); setPublishError(null); setPublishVia(null); setPublishLimits([]); setPublishKind(null); setPublishFramed(false); setPublishUnverified(false); lastPayloadRef.current = null; autoRef.current = "";
  }

  function openDraft(d) {
    abortRef.current?.abort(); runRef.current += 1;
    setWorkId(d.id); setIdea(d.idea); setFormats(normalizeFormats(d.formats || "text"));
    setSteps((d.steps || []).map((s) => ({ ...s, status: s.status === "active" ? "done" : s.status })));
    setResearch(d.research || null); setAngles(d.angles || null); setAngle(d.angle || null);
    setDraft(d.draft || null); setVerification(d.verification || null); setQuality(d.quality || null);
    setMedia(d.media || null); setAssets({ ...EMPTY_ASSETS, ...(d.assets || {}) }); setMstate({});
    setVersions(d.versions || []); if (d.schedule) setSchedule(d.schedule);
    d.tone && setTone(d.tone); d.pov && setPov(d.pov); d.length && setLength(d.length);
    setUndoStack(d.undoStack || []); setPublishState(null); setAttempts([]); setAnalytics(null);
    setBusy(false); setDupDismissed(false); setOpenClaim(null); autoRef.current = `${d.idea}|${normalizeFormats(d.formats || "text").join("+")}`;
    // a job that was mid-flight when the draft was parked settles to the last completed stage
    const s = d.stage || "IDEA";
    if (["RESEARCHING", "DRAFT", "AI_REVIEW"].includes(s)) setStage(d.draft ? "HUMAN_REVIEW" : d.angles ? "RESEARCH_COMPLETE" : "RESEARCHING");
    else setStage(s);
    setView("workspace"); setNavOpen(false); setModal(null); setOpenPost(null);
    window.scrollTo({ top: 0 });
    if (!d.research) runDiscovery(d.idea, d.formats || "text", d.id);
  }

  const removeDraft = (id) => {
    setDrafts((d) => d.filter((x) => x.id !== id));
    if (id === workId) { clearWork(); if (view === "workspace") setView("drafts"); }
  };

  /* "Cancel" on the post you're editing: the draft goes away with it. */
  function cancelWork() {
    const id = workId;
    clearWork();
    if (id) setDrafts((d) => d.filter((x) => x.id !== id));
    setView("drafts");
    notify("Draft discarded.");
  }

  /* Ask our own API what is true, and handle a return trip from LinkedIn. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await linkedinService.status();
      if (!alive) return;
      setLiMeta({ reachable: st.reachable, mode: st.mode, apiVersion: st.apiVersion, scopes: st.scopes });
      setConn(st.connection);

      const cb = readCallbackParams();
      if (!cb) return;
      if (cb.result === "authorized") {
        setModal("linkedin");                    // authorised — now choose a Page
        notify("LinkedIn authorised. Choose the Company Page to connect.");
      } else if (cb.result === "denied") {
        setConn((c) => ({ ...c, status: "disconnected", error: "Authorization was cancelled on LinkedIn." }));
        notify("LinkedIn authorization was cancelled.");
      } else if (cb.result === "unavailable") {
        notify("Real LinkedIn authorization isn't configured, so Unison stayed in prototype mode.");
      } else if (cb.result === "error") {
        const why = cb.reason === "invalid_state" ? "The authorization response failed a security check."
          : cb.reason === "exchange_failed" ? "LinkedIn rejected the authorization exchange."
          : "Authorization failed.";
        setConn((c) => ({ ...c, status: "error", error: why }));
        notify(why);
      }
    })();
    return () => { alive = false; };
  }, []);

  const logAudit = (text) => setAudit((l) => [...l, { t: now(), text }]);
  const notify = (text) => setNotes((n) => [{ t: now(), text }, ...n].slice(0, 10));

  const track = (name) => ({ inChars, outChars, ok, searched }) =>
    setUsage((u) => {
      const inTok = Math.round(inChars / 4), outTok = Math.round(outChars / 4);
      const e = u.byEngine[name] || { calls: 0, inTok: 0, outTok: 0 };
      return {
        calls: u.calls + 1, fails: u.fails + (ok ? 0 : 1), searches: u.searches + (searched ? 1 : 0),
        inTok: u.inTok + inTok, outTok: u.outTok + outTok,
        byEngine: { ...u.byEngine, [name]: { calls: e.calls + 1, inTok: e.inTok + inTok, outTok: e.outTok + outTok } },
      };
    });

  const railIndex = useMemo(() => {
    const stages = fmt.stages;
    let reached = "research";
    if (research) reached = "angle";
    if (angles) reached = "angle";
    if (draft) reached = "draft";
    if (assets.poll && stages.includes("poll")) reached = "poll";
    if (assets.article && stages.includes("article")) reached = "article";
    if (assets.images.length || assets.video || assets.doc || assets.carousel.length) reached = stages.includes("media") ? "media" : "slides";
    if (verification && stages.includes("evidence")) reached = "evidence";
    if (quality) reached = "health";
    if (["APPROVED", "SCHEDULED", "PUBLISHING", "FAILED", "PUBLISHED", "ANALYZING"].includes(stage)) reached = "schedule";
    const i = stages.indexOf(reached);
    return i < 0 ? 0 : i;
  }, [fmt, research, angles, draft, assets, verification, quality, stage]);

  const setStep = (key, status) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, status } : x)));

  const newRun = () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    runRef.current += 1;
    return { id: runRef.current, signal: abortRef.current.signal };
  };

  const pushUndo = (label) => setUndoStack((s) => [...s.slice(-9), { label, at: now(), draft, verification }]);
  const undo = () => {
    setUndoStack((s) => {
      const last = s[s.length - 1];
      if (!last) return s;
      setDraft(last.draft); setVerification(last.verification);
      logAudit(`Undid — ${last.label}`);
      return s.slice(0, -1);
    });
  };

  /* ---------- engines ---------- */

  async function runOpportunities() {
    setView("discover"); setNavOpen(false); setOppBusy(true); setOpps(null);
    window.scrollTo({ top: 0 });
    const { id, signal } = newRun();
    logAudit("Opportunity scan started");

    const shape = `{"items":[{"headline":"under 11 words","summary":"under 16 words","publisher":"","url":"https://…","date":"YYYY-MM-DD","score":0,"whyNow":"under 16 words","gap":"open|adjacent|covered","angle":"Contrarian|Educational|Industry insight|Data-driven"}]}`;
    const brief = `Industry: ${profile.industry}. Audience: ${profile.audience}. Watch terms: ${profile.keywords}.
Already published: ${JSON.stringify(posts.slice(0, 6).map((x) => x.title))}
Score 0-100 for how worth posting each is this week. gap = "open" if the Page has not covered it, "adjacent" if loosely related, "covered" if already posted. Sort by score, highest first.`;

    try {
      // pass 1 — live search
      let r = searchOn ? await askJSON({
        system: `You are the content opportunity engine. ${JSON_RULE}`,
        user: `Find 4 real stories this company could post about this week. Search the web and return each real URL.
${brief}
${shape}
Be terse. The whole reply must fit in 400 words.`,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        fallback: () => null, track: track("Discovery"), signal,
      }) : null;
      if (id !== runRef.current) return;

      // pass 2 — no search, so nothing competes for the response budget
      if (!r || !(r.items || []).length) {
        r = await askJSON({
          system: `You are the content opportunity engine. ${JSON_RULE}`,
          user: `List 5 themes this company could post about this week, from what you already know. Leave url empty.
${brief}
${shape}
Be terse.`,
          fallback: () => fb.opportunities(), track: track("Discovery"), signal,
        });
        if (id !== runRef.current) return;
        if (!r.degraded) r.degraded = searchOn ? "no-search" : "off";
      }

      setOpps(r);
      logAudit(`Opportunity scan returned ${(r.items || []).length} stories`);
    } catch (e) { if (e?.name !== "AbortError") setOpps(fb.opportunities()); }
    setOppBusy(false);
  }

  async function runDiscovery(topic, chosenFormats, existingId) {
    const list = normalizeFormats(chosenFormats || formats);
    setFormats(list);
    setWorkId(existingId || "w-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    setView("workspace"); setNavOpen(false); setModal(null); setOpenPost(null);
    setIdea(topic); setStage("RESEARCHING"); setBusy(true);
    setResearch(null); setAngles(null); setAngle(null); setDraft(null); setVerification(null);
    setQuality(null); setMedia(null); setAssets(EMPTY_ASSETS); setMstate({});
    setAnalytics(null); setPublishState(null); setAttempts([]); setVersions([]); setAudit([]);
    setDupDismissed(false); setUndoStack([]); autoRef.current = "";
    logAudit("Research started");
    window.scrollTo({ top: 0 });

    const { id, signal } = newRun();
    const key = topic.trim().toLowerCase();
    const cached = cacheRef.current[key];

    setSteps([
      { key: "search", label: cached ? "Reusing research from this session" : searchOn ? "Searching the live web" : "Web search is off — using known context", status: "active" },
      { key: "company", label: "Checking company sources", status: "pending" },
      { key: "compare", label: "Comparing industry reports", status: "pending" },
      { key: "insight", label: "Identifying useful insights", status: "pending" },
      { key: "angles", label: "Building content angles", status: "pending" },
    ]);

    try {
      const shape = `{"sources":[{"title":"","publisher":"","date":"YYYY-MM-DD","tier":1,"note":"under 14 words","url":"https://…"}],
"claims":[{"text":"factual claim","sourceIndex":0}],
"insights":["under 18 words"],"freshness":"Breaking|Recent|Evergreen|Historical","risks":["under 14 words"]}
Tier 1 = official/primary, 2 = major publication, 3 = industry press, 4 = blogs/social (discovery only).`;

      let r = cached;
      if (!r && searchOn) {
        r = await askJSON({
          system: `You are the discovery engine of a B2B content platform. ${JSON_RULE}`,
          user: `Research this for a LinkedIn company page post: "${topic}".
Search the web and return the real URL of every source.
${shape}
Give 3 sources, 2 claims, 3 insights. Be terse — the whole reply must fit in 400 words.`,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          fallback: () => null, track: track("Discovery"), signal,
        });
        if (id !== runRef.current) return;
      }
      if (!r || !(r.sources || []).length) {
        r = await askJSON({
          system: `You are the discovery engine of a B2B content platform. ${JSON_RULE}`,
          user: `Research this for a LinkedIn company page post: "${topic}", from what you already know. Leave url empty.
${shape}
Give 3 sources, 2 claims, 3 insights. Be terse.`,
          fallback: () => fb.research(topic), track: track("Discovery"), signal,
        });
        if (id !== runRef.current) return;
        if (!r.degraded) r.degraded = searchOn ? "no-search" : "off";
      }
      if (!cached && !r.degraded) cacheRef.current[key] = r;

      setStep("search", "done"); setStep("company", "done"); setStep("compare", "done");
      setResearch(r);
      setStep("insight", "done"); setStep("angles", "active");
      logAudit(`Discovery returned ${(r.sources || []).length} sources${cached ? " (cached)" : ""}`);

      const a = await askJSON({
        system: `You are the content intelligence engine. ${JSON_RULE}`,
        user: `Topic: "${topic}".
Insights: ${JSON.stringify((r.insights || []).slice(0, 3))}
Produce 4 distinct LinkedIn content angles and recommend exactly one.
{"angles":[{"type":"Contrarian|Educational|Industry insight|Data-driven","headline":"under 14 words","rationale":"one line","recommended":false}],"reason":"why the recommended angle, 1-2 sentences"}`,
        fallback: () => fb.angles(topic), track: track("Intelligence"), signal,
      });
      if (id !== runRef.current) return;
      if (!(a.angles || []).some((x) => x.recommended) && a.angles?.length) a.angles[0].recommended = true;
      setAngles(a); setStep("angles", "done"); setStage("RESEARCH_COMPLETE");
    } catch (e) { if (e?.name !== "AbortError") console.warn(e); }
    if (id === runRef.current) setBusy(false);
  }

  async function runWriter(selected, feedback) {
    setAngle(selected); setStage("DRAFT"); setBusy(true); setOpenClaim(null);
    if (draft) pushUndo(feedback ? "rewrite" : "regenerate");
    logAudit(feedback ? `Rewrite requested — ${feedback}` : `Angle selected — ${selected.type}`);
    const { id, signal } = newRun();
    const keepMedia = !!media;   // only ask the media engine once per topic

    try {
      const d = await askJSON({
        system: `You are the brand writer engine. ${JSON_RULE}`,
        user: `Write a LinkedIn company page post.
Topic: ${idea}
Angle: ${selected.type} — ${selected.headline}
Claims available: ${JSON.stringify((research?.claims || []).map((c, i) => ({ i, text: c.text })))}
Voice profile (0-100): professional ${voice.professional}, conversational ${voice.conversational}, technical ${voice.technical}, opinionated ${voice.opinionated}, humour ${voice.humour}, emoji ${voice.emoji}.
CTA style: ${voice.cta}. Paragraphs: ${voice.paragraphs}. Hashtags: ${voice.hashtags}.
Never use: ${voice.avoid.join(", ")}. Prefer: ${voice.prefer.join(", ")}.
Controls: tone=${tone}, point of view=${pov}, length=${length}
${formats.includes("poll") ? "This post carries a LinkedIn poll. Set up the question in the body and make the CTA invite readers to vote — do not list the options in the text." : ""}
${formats.includes("article") ? "This post introduces a long-form article; the CTA should point readers to it." : ""}
${formats.includes("carousel") ? "This post introduces a slide carousel; the CTA should tell readers to swipe through." : ""}
${formats.includes("video") ? "This post has a short video attached; refer to it once." : ""}
${feedback ? `Reviewer feedback to fix: ${feedback}` : ""}
No corporate clichés, no motivational filler, no headings.
Claims must be quoted verbatim from the post text so they can be highlighted.
{"hook":"one line","body":"2-4 short paragraphs separated by \\n\\n","cta":"one line","hashtags":["#Tag"],"claims":[{"text":"sentence copied exactly from the post","sourceIndex":0}]}`,
        fallback: () => fb.draft(idea), track: track("Brand writer"), signal,
      });
      if (id !== runRef.current) return;

      setDraft(d);
      setVersions((v) => [...v, { n: v.length + 1, label: feedback ? "AI revised" : "AI generated", author: "Unison", at: now(), snapshot: d }]);
      setStage("AI_REVIEW");

      const jobs = [
        askJSON({
          system: `You are the trust engine. ${JSON_RULE}`,
          user: `Check each claim against the sources. Copy each claim exactly as it appears in the post.
Post claims: ${JSON.stringify(d.claims || [])}
Sources: ${JSON.stringify((research?.sources || []).map((s, i) => ({ i, title: s.title, publisher: s.publisher, tier: s.tier, url: s.url })))}
green = clearly supported, yellow = needs human review, red = unsupported or contradicted.
{"claims":[{"claim":"","status":"green","source":"publisher name","url":"source url or empty","confidence":"High|Medium|Low","note":"one line"}],"unresolved":["one line"]}`,
          fallback: fb.verify, track: track("Trust"), signal,
        }),
        askJSON({
          system: `You are the content quality engine. ${JSON_RULE}`,
          user: `Assess this LinkedIn post.
Hook: ${d.hook}
Body: ${d.body}
CTA: ${d.cta}
Previously published titles: ${JSON.stringify(posts.map((p) => p.title))}
{"checks":[{"label":"Evidence verified","pass":true},{"label":"Brand aligned","pass":true},{"label":"Strong opening","pass":true},{"label":"No unsupported statistics","pass":true},{"label":"No duplicate content","pass":true},{"label":"Low AI-style language","pass":true}],
"slop":["specific phrase to fix"],"duplicate":{"similar":false,"days":0,"title":""},
"detail":{"hook":0,"readability":0,"brand":0,"originality":0,"evidence":0}}
Scores 0-100. Only list slop phrases that are really present.`,
          fallback: fb.quality, track: track("Trust"), signal,
        }),
      ];
      if (!keepMedia) jobs.push(askJSON({
        system: `You are the media engine. ${JSON_RULE}`,
        user: `Suggest a format for this post. Answer with one id from: text, image, video, document, multi, poll, article, carousel.
Post: ${d.hook} ${d.body}
{"format":"","reason":"one sentence","concept":"one sentence describing the visual"}`,
        fallback: fb.media, track: track("Media"), signal,
      }));

      const [ver, q, m] = await Promise.all(jobs);
      if (id !== runRef.current) return;
      setVerification(ver); setQuality(q);
      if (m) setMedia(m);   // a suggestion only — the user's chosen format wins
      setStage("HUMAN_REVIEW");
      logAudit("Claims verified and quality check completed");
    } catch (e) { if (e?.name !== "AbortError") console.warn(e); }
    if (id === runRef.current) setBusy(false);
  }

  /* "Let Unison pick the format": the idea text goes to the reasoning model,
     which chooses the components that suit it (every post is written text;
     it may add one visual and/or a poll, article or carousel) and says why in
     one sentence. If the model is unreachable the answer is plain text. */
  async function recommendFormat(text, apply) {
    setRecBusy(true);
    const r = await askJSON({
      capability: "reasoning",
      system: `You choose the best LinkedIn post composition for an idea. ${JSON_RULE}`,
      user: `Idea: "${text}"
Every post is written text. Choose up to two extra components that genuinely help this idea, from: image, multi, video, document, poll, article, carousel.
At most one of image, multi, video, document. Prefer nothing extra over a weak fit.
Rules of thumb: a debatable question or a choice → poll; a number or a single claim → image; a step-by-step or a list → document or carousel; a deep explanation → article; a demo or a story → video.
{"formats":["poll"],"why":"one short sentence"}`,
      fallback: () => ({ formats: [], why: "A written post is the safest default." }),
      track: track("Intelligence"),
    });
    const picked = normalizeFormats((r.formats || (r.format ? [r.format] : [])).filter((f) => FORMAT_BY_ID[f]));
    setRecFormat(picked);
    apply?.(picked);
    notify(`Unison suggests ${labelFor(picked)} — ${r.why}`);
    setRecBusy(false);
  }

  /* ---------- media actions ----------
     Thin wrappers over the media engine. Each owns one slice of assets, so
     regenerating an image never touches the text and regenerating slide 3
     never touches slides 1, 2 or 4. */

  const engineRef = useRef(null);
  if (!engineRef.current) engineRef.current = createMediaEngine({ track: track("Media"), log: logAudit });
  const engine = engineRef.current;

  const ctxOf = () => ({ hook: draft?.hook || idea, body: draft?.body || "" });
  const mset = (k, v) => setMstate((m) => ({ ...m, [k]: { ...idle(), ...v } }));
  const patchAssets = (patch) => setAssets((a) => ({ ...a, ...patch }));

  async function run(key, fn) {
    mset(key, { status: "generating" });
    try {
      await fn();
      mset(key, { status: "success" });
    } catch (e) {
      if (e?.name === "AbortError") return mset(key, { status: "idle" });
      console.warn("[unison] media task failed:", key, e);
      mset(key, { status: "error", error: friendlyError(e) });
    }
  }

  const makeImage = (variant = 0) => run("image", async () => {
    const a = await engine.image(ctxOf(), { variant });
    patchAssets({ images: [a], upload: null });
  });

  const makeImageSet = (count = 3) => run("multi", async () => {
    const set = await engine.imageSet(ctxOf(), { count });
    patchAssets({ images: set, upload: null });
  });

  const retile = (i) => run("tile-" + i, async () => {
    const next = await engine.retile(assets.images[i], ctxOf());
    setAssets((a) => ({ ...a, images: a.images.map((x, j) => (j === i ? next : x)) }));
  });

  const addTile = () => run("multi", async () => {
    const [t] = await engine.imageSet(ctxOf(), { count: 1 });
    setAssets((a) => ({ ...a, images: [...a.images, t].slice(0, 4) }));
  });

  const makeVideo = () => run("video", async () => {
    const previous = assets.video?.url;
    const a = await engine.video(ctxOf());
    if (previous) URL.revokeObjectURL(previous);       // the old encode is dead weight
    mset("encode", { status: "idle" });
    patchAssets({ video: a, upload: null });
  });

  /* Encoding is real-time capture, so it is a deliberate action rather than
     something that happens behind the Generate button. */
  const exportVideo = () => run("encode", async () => {
    const cur = assets.video;
    if (!cur?.storyboard?.length) throw new Error("Nothing to encode yet.");
    if (cur.url) URL.revokeObjectURL(cur.url);
    const file = await engine.encodeVideo(cur, { onProgress: (p) => mset("encode", { status: "generating", progress: p }) });
    setAssets((a) => ({ ...a, video: { ...a.video, blob: file.blob, url: file.url, mime: file.mime } }));
    logAudit("Video encoded to WebM");
  });

  const makeDocument = (pages = 5) => run("doc", async () => {
    const d = await engine.document(ctxOf(), { pages });
    patchAssets({ doc: d });
  });

  const makeCarousel = (slides = 6) => run("carousel", async () => {
    const c = await engine.carousel(ctxOf(), { slides });
    patchAssets({ carousel: c });
  });

  const reslide = (i) => run("slide-" + i, async () => {
    const next = await engine.reslide(assets.carousel[i], i, assets.carousel.length, ctxOf());
    setAssets((a) => ({ ...a, carousel: a.carousel.map((x, j) => (j === i ? next : x)) }));
  });

  const moveItem = (listKey, from, to) => setAssets((a) => {
    const list = [...a[listKey]];
    if (to < 0 || to >= list.length) return a;
    const [x] = list.splice(from, 1);
    list.splice(to, 0, x);
    return { ...a, [listKey]: listKey === "carousel" ? engine.renumber(list) : list };
  });

  const dropItem = (listKey, i) => setAssets((a) => {
    const list = a[listKey].filter((_, j) => j !== i);
    return { ...a, [listKey]: listKey === "carousel" ? engine.renumber(list) : list };
  });

  const editSlide = (i, patch) => setAssets((a) => {
    const list = a.carousel.map((s, j) => (j === i ? { ...s, ...patch } : s));
    return { ...a, carousel: engine.renumber(list) };
  });

  const editDocPage = (i, patch) => setAssets((a) => {
    const pages = a.doc.pages.map((s, j) => (j === i ? { ...s, ...patch } : s));
    return { ...a, doc: { ...a.doc, pages: pages.map((pg, k) => ({ ...pg, svg: tplPage(k + 1, pages.length, pg.heading, pg.body) })) } };
  });

  const makePoll = () => run("poll", async () => {
    const r = await askJSON({
      capability: "writing",
      system: `You write LinkedIn polls that sit underneath a written post. ${JSON_RULE}`,
      user: `Write the poll for this LinkedIn post. It is one component of the post, so the question must follow on from what the post says and ask the reader to take a position.
Topic: ${idea}
Post:
${draft ? `${draft.hook}\n${draft.body}\n${draft.cta}` : "(not written yet)"}
The question must be under 140 characters and read naturally. Give 3 or 4 options, each 30 characters or fewer. No "Other" and no "All of the above".
{"question":"","options":["",""]}`,
      fallback: () => ({ question: "What actually slows your content down?", options: ["Finding a topic", "Getting approval", "Checking the facts", "Finding the time"] }),
      track: track("Writing"),
    });
    const opts = (r.options || []).slice(0, 4).map((o) => String(o).slice(0, 30)).filter(Boolean);
    patchAssets({
      poll: {
        question: String(r.question || "").slice(0, 140) || "What is holding your team back?",
        options: opts.length >= 2 ? opts : ["Finding a topic", "Getting approval", "Checking the facts"],
        duration: assets.poll?.duration || "1 week",
      },
    });
  });

  const makeArticle = () => run("article", async () => {
    const r = await askJSON({
      capability: "writing",
      system: `You write long-form LinkedIn articles. ${JSON_RULE}`,
      user: `Write an article on: ${idea}
Angle: ${angle?.headline || "your choice"}
Voice (0-100): professional ${voice.professional}, conversational ${voice.conversational}, technical ${voice.technical}, opinionated ${voice.opinionated}.
Never use: ${voice.avoid.join(", ")}.
Four sections, each body 50-70 words. No headings inside the body text.
{"title":"under 12 words","standfirst":"one sentence","sections":[{"heading":"under 6 words","body":""}],"conclusion":"2 sentences","cta":"one line"}`,
      fallback: () => ({
        title: idea, standfirst: "Why this matters now.",
        sections: [{ heading: "The problem", body: "" }, { heading: "What changed", body: "" }, { heading: "How to think about it", body: "" }, { heading: "What to do", body: "" }],
        conclusion: "", cta: "",
      }),
      track: track("Writing"),
    });
    const sections = (r.sections || []).filter((x) => x && x.heading);
    patchAssets({ article: { ...r, title: r.title || idea, sections: sections.length ? sections : [{ heading: "The problem", body: "" }, { heading: "What changed", body: "" }] } });
  });

  const editArticle = (patch) => setAssets((a) => ({ ...a, article: { ...a.article, ...patch } }));

  /* Once the copy is ready, the asset the chosen format needs is produced
     automatically — picking "Image" should give you an image, not a button.
     Fires once per idea+format so a text rewrite never regenerates media, and
     removing an asset doesn't summon it back. */
  const autoRef = useRef("");
  useEffect(() => {
    if (!idea || stage !== "HUMAN_REVIEW") return;
    const key = `${idea}|${fmt.id}`;
    if (autoRef.current === key) return;
    autoRef.current = key;
    const starters = {
      image: [() => makeImage(0), () => assets.images.length || assets.upload],
      multi: [() => makeImageSet(3), () => assets.images.length || assets.upload],
      video: [makeVideo, () => assets.video || assets.upload],
      document: [() => makeDocument(5), () => assets.doc],
      carousel: [() => makeCarousel(6), () => assets.carousel.length],
      poll: [makePoll, () => assets.poll],
      article: [makeArticle, () => assets.article],
    };
    const todo = fmt.list.filter((f) => starters[f] && !starters[f][1]());
    if (!todo.length) return;
    logAudit(`Auto-generating ${todo.map((f) => FORMAT_BY_ID[f].label.toLowerCase()).join(", ")}`);
    todo.forEach((f) => starters[f][0]());
  }, [idea, fmt, stage]);

  /* ---------- document ingestion ---------- */

  async function readDocText(file) {
    if (/\.docx$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      const out = await mammoth.extractRawText({ arrayBuffer: buf });
      return out.value || "";
    }
    if (/\.(txt|md|csv|json)$/i.test(file.name)) return file.text();
    if (/\.pdf$/i.test(file.name)) {
      // best effort only: uncompressed text operators. Compressed PDFs need a
      // server-side parser, and we say so rather than returning nonsense.
      const buf = new Uint8Array(await file.arrayBuffer());
      let raw = "";
      for (let i = 0; i < buf.length; i++) raw += String.fromCharCode(buf[i]);
      const hits = [...raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1"));
      const text = hits.join(" ").replace(/\s+/g, " ").trim();
      if (text.length < 120) throw new Error("pdf-compressed");
      return text;
    }
    throw new Error("unsupported");
  }

  const ingestDocument = (file) => run("sourceDoc", async () => {
    let text;
    try {
      text = await readDocText(file);
    } catch (e) {
      const why = e.message === "pdf-compressed"
        ? "This PDF stores its text compressed, which needs a server-side parser. Try a .docx or paste the text."
        : "That file type can't be read here. Use .docx, .txt, .md or .csv.";
      throw new Error(why);
    }
    const clipped = text.slice(0, 6000);
    const r = await askJSON({
      capability: "documentUnderstanding",
      system: `You extract usable material from a business document. ${JSON_RULE}`,
      user: `Document: ${file.name}
---
${clipped}
---
{"summary":"under 25 words","facts":["under 18 words"],"stats":["figure with context, under 14 words"],"insights":["under 18 words"],"claims":["a claim the document supports, under 18 words"]}
Give up to 4 of each. Only include what the document actually says.`,
      fallback: undefined,
      track: track("Document"),
    });
    const doc = { name: file.name, size: file.size, chars: text.length, ...r, at: now() };
    patchAssets({ sourceDoc: doc });
    setResearch((prev) => {
      const src = { title: file.name, publisher: "Uploaded document", date: new Date().toISOString().slice(0, 10), tier: 1, note: r.summary || "Uploaded by you.", url: "", uploaded: true };
      if (!prev) return { sources: [src], claims: (r.claims || []).map((c) => ({ text: c, sourceIndex: 0 })), insights: r.insights || [], freshness: "Primary", risks: [] };
      return { ...prev, sources: [src, ...(prev.sources || [])], claims: [...(r.claims || []).map((c) => ({ text: c, sourceIndex: 0 })), ...(prev.claims || [])] };
    });
    logAudit(`Document ingested — ${file.name}`);
    notify(`${file.name} added as a source.`);
  });

  const attachUpload = (file) => {
    const r = new FileReader();
    r.onload = () => patchAssets({ upload: { name: file.name, data: r.result, type: file.type }, images: [], video: null });
    r.readAsDataURL(file);
  };

  async function runLearning(metrics) {
    setStage("ANALYZING");
    const a = await askJSON({
      system: `You are the learning engine. Explain performance as likely reasons, never as proven cause. ${JSON_RULE}`,
      user: `Post: ${draft?.hook}
Metrics: ${JSON.stringify(metrics)}
Page average impressions: 9800, average reactions: 240.
{"headline":"one sentence with the comparison","why":["likely reason","likely reason","likely reason"],"next":"one recommendation"}`,
      fallback: fb.performance, track: track("Learning"),
    });
    setAnalytics({ ...a, metrics });
    logAudit("Performance summary generated");
  }

  /* ---------- actions ---------- */

  const claimsBlocking = (verification?.claims || []).some((c) => c.status === "red");

  function approve() {
    if (claimsBlocking) return;
    setVersions((v) => [...v, { n: v.length + 1, label: "Approved", author: "You", at: now(), snapshot: draft }]);
    setStage("APPROVED"); logAudit("Reviewer approved"); notify("Post approved. Choose a time to publish.");
  }
  function reject(reason) { logAudit(`Reviewer rejected — ${reason}`); runWriter(angle, reason); }

  /* Everything a post needs to be re-opened later, without the working state. */
  const postRecord = (extra) => ({
    title: draft?.hook?.slice(0, 60) || idea, topic: idea, workId, formats,
    content: draft ? { hook: draft.hook, body: draft.body, cta: draft.cta, hashtags: draft.hashtags || [] } : null,
    poll: assets.poll, image: assets.images[0]?.svg || null, images: assets.images.map((x) => x.svg),
    upload: assets.upload && !assets.upload.type.startsWith("video") ? assets.upload.data : null,
    pages: assets.doc?.pages?.map((x) => x.svg) || (assets.carousel.length ? assets.carousel.map((x) => x.svg) : null),
    time: schedule.time, tz: schedule.tz, ...extra,
  });

  function confirmSchedule() {
    setStage("SCHEDULED");
    setPosts((p) => [postRecord({ id: "p-" + Math.floor(Math.random() * 900 + 100), state: "SCHEDULED", date: schedule.date }), ...p]);
    logAudit(`Scheduled for ${schedule.date} ${schedule.time} ${schedule.tz}`);
    notify(`Scheduled for ${schedule.date} at ${schedule.time}.`);
  }

  /* Cancelling removes the publishing job. If that post is the one open in the
     workspace, it steps back to Approved so nothing goes out at the old time. */
  function cancelScheduled(post) {
    setPosts((p) => p.filter((x) => x.id !== post.id));
    if (post.workId && post.workId === workId && stage === "SCHEDULED") { setStage("APPROVED"); setAttempts([]); }
    setOpenPost(null);
    logAudit(`Schedule cancelled — ${post.title}`);
    notify(post.workId && post.workId === workId
      ? `"${post.title}" will not be published. It's back in Approved if you want to reschedule it.`
      : `"${post.title}" will not be published. Start it again from Home if you want to reschedule it.`);
  }

  /* The final post text exactly as it appears in the preview — hook, body,
     CTA and hashtags — assembled from the approved draft. */
  const finalPostText = () => draft
    ? `${draft.hook}\n\n${draft.body}\n\n${draft.cta}${(draft.hashtags || []).length ? "\n\n" + draft.hashtags.join(" ") : ""}`.trim()
    : idea;

  /* What this post is, for LinkedIn's purposes. A poll, article or carousel
     defines the post type; otherwise the attachment does; otherwise text. */
  const postTypeOf = () => {
    if (assets.poll || formats.includes("poll")) return "poll";
    if (assets.article || formats.includes("article")) return "article";
    if (assets.carousel.length || formats.includes("carousel")) return "carousel";
    if (assets.upload) return assets.upload.type.startsWith("video") ? "video" : "image";
    if (assets.video) return "video";
    if (assets.doc) return "document";
    if (assets.images.length > 1) return "multi";
    if (assets.images.length === 1) return "image";
    return "text";
  };

  const dataUrlParts = (u) => { const m = /^data:([^;]+);base64,(.*)$/.exec(u || ""); return m ? { mimeType: m[1], data: m[2] } : null; };
  const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

  /* Rasterises the media engine's assets into something a webhook can carry.
     Returns the media list plus any limitation that means the post should
     not be described as carrying that media. */
  async function collectMedia(postType) {
    const media = []; const limits = [];
    const png = async (svg, filename, altText, extra = {}) => {
      const parts = dataUrlParts(await svgToPng(svg, 1200, 630));
      media.push({ kind: "image", filename, mimeType: parts.mimeType, data: parts.data, altText: altText || "", width: 1200, height: 630, ...extra });
    };
    if (assets.upload) {
      const parts = dataUrlParts(assets.upload.data);
      if (parts) media.push({ kind: assets.upload.type.startsWith("video") ? "video" : "image", filename: assets.upload.name, mimeType: parts.mimeType, data: parts.data, altText: "" });
      else limits.push("The uploaded file couldn't be read for sending.");
      return { media, limits };
    }
    if (postType === "image" && assets.images[0]) await png(assets.images[0].svg, "unison-image.png", assets.images[0].brief?.subject);
    if (postType === "multi") for (let i = 0; i < assets.images.length; i++) await png(assets.images[i].svg, `unison-image-${i + 1}.png`, assets.images[i].brief?.subject, { index: i });
    if (postType === "video") {
      const v = assets.video;
      if (!v?.blob) limits.push("The video hasn't been encoded yet — use Export in the Media step first. Only the storyboard exists so far.");
      else if (v.blob.size > 6 * 1024 * 1024) limits.push(`The encoded video is ${(v.blob.size / 1048576).toFixed(1)} MB, more than can be sent from the browser in one request.`);
      else media.push({ kind: "video", filename: "unison-video.webm", mimeType: v.mime || v.blob.type || "video/webm", data: await blobToBase64(v.blob), altText: v.brief?.subject || "", seconds: v.seconds || null, sizeBytes: v.blob.size });
      if (v?.poster) await png(v.poster, "unison-video-poster.png", v.brief?.subject, { role: "poster" });
    }
    if (postType === "document" && assets.doc?.pages?.length) {
      for (let i = 0; i < assets.doc.pages.length; i++) await png(assets.doc.pages[i].svg, `unison-document-page-${i + 1}.png`, assets.doc.pages[i].heading, { kind: "document-page", index: i, of: assets.doc.pages.length });
      limits.push("LinkedIn document posts need a PDF. The pages are sent as images; the scenario has to assemble them into a PDF before LinkedIn will accept a document post.");
    }
    if (postType === "carousel" && assets.carousel.length) {
      for (let i = 0; i < assets.carousel.length; i++) await png(assets.carousel[i].svg, `unison-slide-${i + 1}.png`, assets.carousel[i].heading, { kind: "slide", index: i, of: assets.carousel.length });
    }
    return { media, limits };
  }

  /* Everything the scenario needs, from live state — nothing placeholder. */
  async function buildPublishPayload(postId) {
    const postType = postTypeOf();
    const { media, limits } = await collectMedia(postType);
    const payload = {
      source: MAKE_CONFIG.source,
      postId,
      idempotencyKey: postId,          // stable per post, so Make can drop a repeat
      postType,
      content: finalPostText(),
      company: linkedin.org || makeCompany.name || MAKE_CONFIG.company.name || null,
      companyUrn: linkedin.organizationUrn || makeCompany.urn || MAKE_CONFIG.company.urn || null,
      scheduledDate: stage === "SCHEDULED" || stage === "PUBLISHING" ? schedule.date : null,
      scheduledTime: stage === "SCHEDULED" || stage === "PUBLISHING" ? schedule.time : null,
      timezone: schedule.tz || "Asia/Kolkata",
      media,
      poll: postType === "poll" && assets.poll
        ? { question: assets.poll.question, options: (assets.poll.options || []).filter(Boolean), duration: assets.poll.duration }
        : null,
    };
    if (postType === "article" && assets.article) payload.article = assets.article;
    return { payload, limits };
  }

  const publishingRef = useRef(false);   // hard guard against a second click landing mid-request
  const lastPayloadRef = useRef(null);   // kept so a manual "send anyway" resends exactly the same body
  const [publishLimits, setPublishLimits] = useState([]);
  const [publishKind, setPublishKind] = useState(null);   // why the last send failed, for the recovery UI
  const [publishFramed, setPublishFramed] = useState(false);

  /* Sends this post once and once only, without a readable response. Offered
     only after the browser refused the normal request, and only on a click. */
  async function sendAnyway() {
    const payload = lastPayloadRef.current;
    if (!payload || publishingRef.current) return;
    publishingRef.current = true;
    setPublishState("SENDING"); setStage("PUBLISHING"); setPublishError(null); setPublishKind(null);
    setAttempts((a) => [...a, { label: "Sending without delivery confirmation", status: "ok" }]);
    try {
      const r = await makeLinkedInService.sendUnverified(payload);
      setSentKeys((k) => (k.includes(payload.postId) ? k : [...k, payload.postId]));
      setAttempts((a) => [...a, { label: "Sent — delivery not confirmable from the browser", status: "ok" }, { label: "Publishing through LinkedIn", status: "pending" }]);
      setPublishState("SENT"); setPublishUnverified(true);
      setPosts((p) => [postRecord({ id: payload.postId, state: "SENT", date: new Date().toISOString().slice(0, 10), viaMake: true, postType: payload.postType, mediaSent: payload.media.length, limits: publishLimits, sentAt: r.at, unverified: true }), ...p.filter((x) => x.id !== payload.postId)]);
      logAudit("Sent to Make without delivery confirmation");
      notify("Sent. The browser can't read Make's reply, so check the scenario to confirm it arrived.");
    } catch (e) {
      setAttempts((a) => [...a, { label: "This page can't make outside requests", status: "failed" }]);
      setPublishState("FAILED"); setStage("FAILED"); setPublishKind("sandbox");
      setPublishError("This preview can't make outside requests, so nothing was sent. Open Unison from its own address (your deployed version) and publish from there.");
    } finally {
      publishingRef.current = false;
    }
  }

  /* Sent in full, with a note where LinkedIn itself constrains what the
     scenario can do with it. These are notes, not blocks — nothing is
     downgraded to another format. */
  const TYPE_NOTES = {
    document: "LinkedIn document posts need a PDF. The pages are sent as images; the Make scenario has to assemble them into a PDF before LinkedIn will accept a document post.",
    carousel: "LinkedIn has no organic carousel API. The slides are sent as images for the scenario to post or export — LinkedIn will not render them as a swipeable carousel.",
    article: "LinkedIn Articles can't be created through the API. The article is sent with the post so the scenario can store or route it, but LinkedIn will only publish the written post.",
  };

  async function publishNow() {
    if (publishingRef.current || ["PREPARING", "SENDING"].includes(publishState) || stage === "PUBLISHED") return;
    const idem = "unison-" + Math.random().toString(36).slice(2, 10);
    setAttempts([]); setPublishError(null); setPublishLimits([]); setPublishKind(null); setPublishUnverified(false);
    const step = (label, status) => setAttempts((a) => [...a, { label, status, idem }]);
    const postId = workId || idem;

    /* ---- real publishing through Unison's own API (unchanged) ---- */
    if (liMeta.mode === "real" && conn.status === "connected") {
      setStage("PUBLISHING"); setPublishState("SENDING"); setPublishVia("api");
      step("Sending to Unison API", "ok");
      try {
        const body = finalPostText();
        const payload = { commentary: body, format: format === "image" && assets.images[0] ? "image" : "text" };
        if (payload.format === "image") {
          payload.image = await svgToPng(assets.images[0].svg, 1200, 630);
          payload.altText = assets.images[0].brief?.subject || "";
        }
        const r = await linkedinService.publish(payload);
        step("LinkedIn confirmed the post", "ok");
        setPublishState("PUBLISHED"); setStage("PUBLISHED");
        logAudit(`Published to LinkedIn — ${r.post.urn}`);
        notify("Published to LinkedIn.");
        setPosts((p) => [postRecord({ id: r.post.urn, url: r.post.url, state: "PUBLISHED", date: schedule.date, real: true }), ...p]);
        setTimeout(() => runLearning({ impressions: 0, reactions: 0, comments: 0, shares: 0, clicks: 0 }), 800);
      } catch (e) {
        step(e.code === "cannot_publish" ? "Page permission check" : "LinkedIn rejected the request", "failed");
        setPublishState("FAILED"); setStage("FAILED");
        setPublishError(e.message || "LinkedIn rejected the request.");
        if (e.code === "not_authorized") setConn((c) => ({ ...c, status: "expired" }));
        logAudit(`Publishing failed — ${e.code || e.status || "unknown"}`);
        notify("Publishing failed. Nothing was posted.");
      }
      return;
    }

    /* ---- publishing through Make ----
       Make delivers to LinkedIn. A 2xx from the webhook means Make has the
       post; only an explicit confirmation in Make's reply means LinkedIn has
       it. The stages are reported exactly as far as they are known. */
    const postType = postTypeOf();
    if (sentKeys.includes(postId)) {
      setPublishState("SENT");
      notify("This post has already been sent to Make. It won't be sent again.");
      return;
    }
    publishingRef.current = true;
    setStage("PUBLISHING"); setPublishState("PREPARING"); setPublishVia("make");
    step("Preparing", "ok");
    try {
      if (failMode) throw Object.assign(new Error("Simulated failure."), { kind: "simulated" });
      const { payload, limits } = await buildPublishPayload(postId);
      if (TYPE_NOTES[postType]) limits.push(TYPE_NOTES[postType]);
      setPublishLimits(limits);
      lastPayloadRef.current = payload;
      setPublishState("SENDING");
      step("Sending to Make", "ok");
      const r = await makeLinkedInService.publish(payload);
      setSentKeys((k) => (k.includes(postId) ? k : [...k, postId]));
      step(r.duplicate ? "Already delivered — not sent again" : r.fallback ? "Sent to Make" : "Sent to Make via the publishing service", "ok");
      const sentRecord = postRecord({
        id: postId, state: "SENT", date: new Date().toISOString().slice(0, 10), viaMake: true,
        postType, mediaSent: payload.media.length, limits, sentAt: r.at, reference: r.urn || null, url: r.url || null,
      });
      if (r.published) {
        step("Publishing through LinkedIn", "ok"); step("Published", "ok");
        setPublishState("PUBLISHED"); setStage("PUBLISHED");
        setPosts((p) => [{ ...sentRecord, state: "PUBLISHED", publishedAt: r.at }, ...p.filter((x) => x.id !== postId)]);
        logAudit(`Published to LinkedIn via Make${r.urn ? ` — ${r.urn}` : ""}`);
        notify("Published to LinkedIn.");
      } else {
        step("Publishing through LinkedIn", "pending");
        setPublishState("SENT");
        setPosts((p) => [sentRecord, ...p.filter((x) => x.id !== postId)]);
        logAudit(`Sent to Make — ${postType} post${payload.media.length ? `, ${payload.media.length} media file(s)` : ""}`);
        notify("Sent to Make — LinkedIn publishing is being processed.");
      }
    } catch (e) {
      let kind = e?.kind || null;
      let label = "Make did not accept the post";
      if (kind === "relay-error") label = "The publishing service rejected the post";
      if (kind === "network") {
        /* Work out which of the two blocks this actually is before saying
           anything about it. */
        const d = await makeLinkedInService.diagnose();
        kind = d.networkAllowed ? "cors" : "sandbox";
        label = d.networkAllowed ? "Make's reply couldn't be read" : "This page can't make outside requests";
        setPublishFramed(!!d.framed);
      } else if (kind === "timeout") label = "Make didn't respond in time";
      else if (kind === "too-large") label = "Post too large to send";
      step(label, "failed");
      setPublishState("FAILED"); setStage("FAILED");
      setPublishKind(kind);
      setPublishError(kind === "relay-error" ? (e?.message || "The publishing service couldn't pass the post on. Please try again.")
        : kind === "empty" ? "There is no post text to publish."
        : kind === "simulated" ? "Simulated failure (Settings → Simulate a publishing failure). Nothing was sent."
        : kind === "too-large" ? "The post and its media are too large to send in one request. Reduce the media and try again."
        : kind === "timeout" ? "Make didn't answer in time. The post may already have reached it — check the scenario before sending again."
        : kind === "cors" ? "Make received the request but didn't allow this page to read the reply, so Unison can't confirm what happened. Sending without confirmation will get the post through."
        : kind === "sandbox" ? "This preview can't reach the publishing service, so nothing was sent — LinkedIn and Make are fine, the preview just can't make outside requests. Publish from the deployed version and this post will go straight through."
        : "Unable to publish to LinkedIn. Please try again.");
      logAudit(kind === "sandbox" ? "Publishing paused — preview environment can't reach the publishing service" : `Publishing failed — ${kind || "unknown"}${e?.status ? " " + e.status : ""}`);
      notify(kind === "sandbox" ? "Not sent — this preview can't reach the publishing service. Your post is saved." : "Publishing failed. Nothing was posted.");
    } finally {
      publishingRef.current = false;
    }
  }

  /* LinkedIn success confirmed after the fact — either the scenario reported
     it, or the user checked the Company Page. Recorded with the reason. */
  function confirmPublished(post, how = "manual") {
    setPosts((p) => p.map((x) => (x.id === post.id ? { ...x, state: "PUBLISHED", publishedAt: new Date().toISOString(), confirmedBy: how } : x)));
    if (post.workId && post.workId === workId && publishState === "SENT") { setPublishState("PUBLISHED"); setStage("PUBLISHED"); setAttempts((a) => [...a.map((s) => (s.status === "pending" ? { ...s, status: "ok" } : s)), { label: "Published", status: "ok", idem: a[0]?.idem }]); }
    setOpenPost(null);
    logAudit(`Marked as published on LinkedIn (${how === "manual" ? "confirmed by you" : "reported by Make"}) — ${post.title}`);
  }

  /* Real mode: the server confirms the Page. Prototype mode: we mark the
     connection simulated and never call it connected. */
  async function finishConnect(org) {
    if (liMeta.mode === "real") {
      try {
        const r = await linkedinService.select(org.urn);
        setConn({ ...EMPTY_CONNECTION, ...r.connection, mode: "real" });
        logAudit(`LinkedIn Page connected — ${r.connection.organizationName}`);
        notify(`${r.connection.organizationName} connected.`);
      } catch (e) {
        setConn((c) => ({ ...c, status: "error", error: e.message }));
        notify(e.message || "Could not connect that Page.");
      }
      return;
    }
    setConn({
      ...EMPTY_CONNECTION,
      status: "simulated",
      mode: "simulation",
      organizationUrn: org.urn,
      organizationId: String(org.urn).split(":").pop(),
      organizationName: org.name,
      followers: org.followers,
      roles: [org.role],
      permissions: org.canPublish === false ? [] : ["PUBLISH", "READ_ANALYTICS"],
      connectedAt: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
    });
    logAudit(`Prototype LinkedIn connection — ${org.name}`);
    notify(`${org.name} connected in prototype mode. Publishing is simulated.`);
  }

  const openLinkedIn = (startAt = 0) => { setLiStart(startAt); setModal("linkedin"); };
  const manageConnection = () => { setSettingsTab("connections"); setModal("settings"); };
  const disconnectLinkedIn = async () => {
    if (liMeta.mode === "real") { try { await linkedinService.disconnect(); } catch (e) { /* clear locally anyway */ } }
    setConn({ ...EMPTY_CONNECTION, mode: liMeta.mode });
    logAudit("LinkedIn disconnected");
    notify("LinkedIn disconnected. Publishing is locked until you reconnect.");
  };

  /* "New post": the current work is already saved as a draft, so just clear
     the workspace and go to the composer. */
  function reset() {
    clearWork();
    setView("home");
  }

  async function wipe() {
    try { await persistentStore.delete(STORE_KEY); } catch (e) {}
    cacheRef.current = {};
    reset(); setDrafts([]); setOpps(null); setPosts(SEED_POSTS); setTeam(SEED_TEAM); setNotes([]);
    setUsage({ calls: 0, fails: 0, searches: 0, inTok: 0, outTok: 0, byEngine: {} });
    setConn({ ...EMPTY_CONNECTION, mode: liMeta.mode });
    setModal(null); notify("Saved session cleared.");
  }

  const appProps = {
    idea, stage, steps, research, angles, angle, draft, setDraft, verification, setVerification,
    quality, dupDismissed, setDupDismissed, media, format, formats, fmt, versions, schedule, setSchedule, publishState, attempts, publishError, publishVia,
    assets, patchAssets, mstate, makeImage, makeImageSet, retile, addTile, makeVideo, makeDocument,
    makeCarousel, reslide, moveItem, dropItem, editSlide, editDocPage, makePoll, makeArticle, editArticle,
    ingestDocument, attachUpload, exportVideo,
    analytics, busy, tone, setTone, pov, setPov, length, setLength, showDetail, setShowDetail,
    openClaim, setOpenClaim, linkedin, claimsBlocking, runWriter, approve, reject, confirmSchedule,
    publishNow, runDiscovery, setDrawer, setModal, reset, cancelWork, setFailMode, undoStack, pushUndo, undo,
    publishLimits, publishKind, publishFramed, publishUnverified, sendAnyway, getLastPayload: () => lastPayloadRef.current, confirmPublished, workId, posts, relay,
  };

  return (
    <div className="unison" data-t={theme}>
      <CursorField theme={theme} />

      <Header {...{ view, setView, setDrawer, setModal, notes, linkedin, liMeta, relay, theme, setTheme, navOpen, setNavOpen, openLinkedIn, manageConnection, disconnectLinkedIn, draftCount: drafts.length }} />

      {navOpen && (
        <div className="sheet">
          {NAV.map(([id, label]) => (
            <button key={id} onClick={() => { setNavOpen(false); setView(id); }}>{label}{id === "drafts" && drafts.length ? ` (${drafts.length})` : ""}</button>
          ))}
          <button onClick={() => { setNavOpen(false); openLinkedIn(linkedin.connected ? 1 : 0); }}>
            {linkedin.viaWorkflow ? "LinkedIn publishing ready" : linkedin.connected ? `LinkedIn · ${linkedin.org}` : "Connect LinkedIn"}
          </button>
          <button onClick={() => { setNavOpen(false); setModal("voice"); }}>Brand voice</button>
          <button onClick={() => { setNavOpen(false); setModal("settings"); }}>Settings</button>
        </div>
      )}

      <PipelineScene theme={theme} level={bg3d ? 0.16 : 0} />
      {idea && <MobileRail index={railIndex} stages={fmt.stages} />}
      <div className="wrap">
        <Rail index={railIndex} active={busy} started={!!idea} fmt={fmt} />
        <main>
          {view === "home" && (
            <Dashboard
              posts={posts} linkedin={linkedin} schedule={schedule} setModal={setModal}
              drafts={drafts} activeId={idea ? workId : null}
              onEditDraft={openDraft} onRemoveDraft={removeDraft}
              onDiscover={runOpportunities}
              setView={setView} open={setOpenPost}
              composer={
                <CreateFlow
                  onStart={(f, t) => runDiscovery(t, f)}
                  recommend={recommendFormat} recommending={recBusy} recommended={recFormat}
                  seed={seedIdea} clearSeed={() => setSeedIdea("")}
                />
              }
            />
          )}
          {view === "discover" && (
            <Discover opps={opps} busy={oppBusy} rerun={runOpportunities} start={(t) => { setSeedIdea(t); setView("home"); }} profile={profile} setProfile={setProfile} />
          )}
          {view === "drafts" && <DraftsList drafts={drafts} activeId={idea ? workId : null} onEdit={openDraft} onRemove={removeDraft} onResume={() => setView("workspace")} onCreate={() => setView("home")} />}
          {view === "workspace" && (idea ? <Workspace {...appProps} /> : <EmptyWorkspace onCreate={() => setView("home")} drafts={drafts.length} onDrafts={() => setView("drafts")} />)}
          {view === "content" && <ContentList posts={posts} open={setOpenPost} />}
          {view === "calendar" && <CalendarView posts={posts} open={setOpenPost} start={(t) => { setSeedIdea(t); setView("home"); }} />}
          {view === "insights" && <Insights posts={posts} analytics={analytics} discover={runOpportunities} />}
        </main>
      </div>

      {drawer && (
        <>
          <div className="scrim" onClick={() => setDrawer(null)} />
          <aside className="drawer">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
              <div className="disp" style={{ fontSize: 24 }}>
                {{ sources: "Sources", audit: "Activity", versions: "Versions", notes: "Notifications" }[drawer]}
              </div>
              <button className="btn sm" onClick={() => setDrawer(null)}>Close</button>
            </div>
            {drawer === "sources" && <SourcesPanel research={research} />}
            {drawer === "audit" && <AuditPanel log={audit} />}
            {drawer === "versions" && <VersionPanel versions={versions} setDraft={setDraft} pushUndo={pushUndo} />}
            {drawer === "notes" && <NotesPanel notes={notes} clear={() => setNotes([])} />}
          </aside>
        </>
      )}

      {modal === "settings" && (
        <Modal wide onClose={() => { setModal(null); setSettingsTab("models"); }} title="Settings">
          <Settings {...{ usage, linkedin, liMeta, relay, disconnectLinkedIn, openLinkedIn, setModal, searchOn, setSearchOn, failMode, setFailMode, makeCompany, setMakeCompany, team, setTeam, theme, setTheme, schedule, setSchedule, notes, setNotes, notify, profile, setProfile, wipe, bg3d, setBg3d, initialTab: settingsTab }} />
        </Modal>
      )}
      {modal === "voice" && (
        <Modal wide onClose={() => setModal(null)} title="Brand voice">
          <VoiceStudio voice={voice} setVoice={setVoice} track={track} />
        </Modal>
      )}
      {modal === "linkedin" && (
        <Modal onClose={() => setModal(null)} title={liStart === 1 ? "Switch Company Page" : "Connect LinkedIn"}>
          <LinkedInFlow startAt={liStart} mode={liMeta.mode} connection={conn} scopes={liMeta.scopes}
            onDone={(org) => { finishConnect(org); setModal(null); }} />
        </Modal>
      )}
      {modal === "diff" && (
        <Modal wide onClose={() => setModal(null)} title="What changed">
          <DiffView versions={versions} />
        </Modal>
      )}
      {openPost && (
        <Modal onClose={() => setOpenPost(null)} title={openPost.state === "SCHEDULED" ? "Scheduled post" : openPost.state === "PUBLISHED" ? "Published post" : "Post"}>
          <PostDetail post={openPost} linkedin={linkedin} cancel={cancelScheduled} confirm={confirmPublished} start={(t) => { setOpenPost(null); runDiscovery(t, "text"); }} />
        </Modal>
      )}
    </div>
  );
}
