import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { STORE_KEY, persistentStore, sanitizeSession } from "./lib/store.js";
import { P, S } from "./lib/pointer.js";
import { friendlyError, askJSON, JSON_RULE, fb, corroborateSources, loadAISettings, saveAISettings, describeAI, hostedProvider, normalizeDraft, normalizeVerification, normalizeQuality, normalizeAngles, normalizeResearch } from "./lib/ai.js";
import { EMPTY_CONNECTION, withDerived, linkedinService, readCallbackParams } from "./lib/linkedin.js";
import { MAKE_CONFIG, makeLinkedInService, publishPost, publishRoute } from "./lib/publish.js";
import { FORMAT_BY_ID, normalizeFormats, visualOf, labelFor, composeFormat, EMPTY_ASSETS, compactAssets, idle } from "./lib/formats.js";
import { SEED_POSTS, NAV, DEFAULT_VOICE, SEED_TEAM, DEFAULT_PROFILE } from "./lib/seed.js";
import { now } from "./lib/util.js";
import { tplPage, svgToPng } from "./lib/brand.js";
import { createMediaEngine } from "./lib/media.js";
import { CursorField } from "./components/ambient.jsx";
import { Header, MobileRail, Rail } from "./components/chrome.jsx";
import { Toasts } from "./components/toast.jsx";
import { setBrandText } from "./lib/brand.js";
import { nextSlot, localTimezone } from "./lib/dates.js";
import { downscaleImage, readFileAsDataUrl, dataUrlBytes } from "./lib/image.js";
import { downloadBlob } from "./lib/brand.js";
import { todayISO, isDue } from "./lib/dates.js";
import { loadPublishSettings, savePublishSettings } from "./lib/publish.js";
import { workspaceHealth, pull as pullShared, push as pushShared, mergeShared, syncSummary, SYNC, resetWorkspaceProbe } from "./lib/sync.js";
import { DEFAULT_EXTRAS, hnStories, hnToOpportunities, wikiSearch, wikiToSources, fetchImageAsDataUrl } from "./lib/freeApis.js";
import {
  loadLinkedInSettings, saveLinkedInSettings, getLinkedInSettings, isLinkedInConfigured, isBridgeConfigured, toAppConnection,
  readAuthCallback, exchangeCode, connectionFromToken, fetchOrganizations, beginAuthorization, disconnectLinkedIn as disconnectBrowserLinkedIn,
} from "./lib/linkedinAuth.js";

/* A stage that was mid-flight when the state was saved settles to the last
   completed stage, so nothing ever restores as "running" with no job behind it. */
function settleStage(d) {
  const s = d.stage || "IDEA";
  if (["RESEARCHING", "DRAFT", "AI_REVIEW"].includes(s)) return d.draft ? "HUMAN_REVIEW" : d.angles ? "RESEARCH_COMPLETE" : "RESEARCHING";
  if (s === "PUBLISHING") return d.publishState === "SENT" ? "PUBLISHING" : d.publishState === "PUBLISHED" ? "PUBLISHED" : "SCHEDULED";
  if (s === "ANALYZING") return "PUBLISHED";
  return s;
}
const settleSteps = (steps) => (steps || []).map((x) => ({ ...x, status: x.status === "active" ? "done" : x.status }));
const textOf = (d) => (d ? `${d.hook}\n\n${d.body}\n\n${d.cta}` : "");
/* The state a post record maps to when it is reopened in the workspace. */
const stageOfPost = (post) => (post.state === "PUBLISHED" ? "PUBLISHED" : post.state === "SENT" ? "PUBLISHING" : post.state === "SCHEDULED" ? "SCHEDULED" : "APPROVED");

/* three.js is ~600 KB; only people who turn the ambient scene on pay for it. */
const PipelineScene = lazy(() => import("./components/scene3d.jsx").then((m) => ({ default: m.PipelineScene })));
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
  const [settingsTab, setSettingsTab] = useState("workspace");
  const [restored, setRestored] = useState(false);
  const [bg3d, setBg3d] = useState(false);          // ambient 3D scene + cursor glow; off by default for speed

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
  const [schedule, setSchedule] = useState(() => ({ ...nextSlot(), tz: localTimezone() }));
  const [publishState, setPublishState] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [publishError, setPublishError] = useState(null);
  const [publishVia, setPublishVia] = useState(null);      // "make" | "api" — which route the last publish took
  const [publishUnverified, setPublishUnverified] = useState(false);
  const [publishLimits, setPublishLimits] = useState([]);
  const [publishKind, setPublishKind] = useState(null);   // why the last send failed, for the recovery UI
  const [publishFramed, setPublishFramed] = useState(false);
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

  /* Device-level settings: AI key, LinkedIn app, publishing webhook. Kept out
     of the session blob so clearing or exporting a session never carries them. */
  const [aiSettings, setAiSettings] = useState(() => loadAISettings());
  const [aiInfo, setAiInfo] = useState(null);
  const refreshAI = useCallback(() => { describeAI().then(setAiInfo).catch(() => setAiInfo({ ready: false, summary: "AI status unavailable." })); }, []);
  useEffect(() => { refreshAI(); }, [refreshAI, aiSettings]);
  const updateAI = (patch) => setAiSettings(saveAISettings(patch));
  const [liSettings, setLiSettings] = useState(() => loadLinkedInSettings());
  const updateLinkedIn = (patch) => setLiSettings(saveLinkedInSettings(patch));
  const [pubSettings, setPubSettings] = useState(() => loadPublishSettings());
  const updatePublish = (patch) => setPubSettings(savePublishSettings(patch));
  const [extras, setExtras] = useState(DEFAULT_EXTRAS);        // free public APIs on/off (persisted with the session)
  const [setupHidden, setSetupHidden] = useState(false);       // the first-run checklist on Home

  /* Three sources of truth for the LinkedIn connection, in priority order:
     a real server-side OAuth API (if one is deployed), the browser sign-in
     configured under Settings → LinkedIn, or the prototype/Make-only state.
     `conn` and `liMeta` are derived so the rest of the app reads one shape. */
  const [baseConn, setBaseConn] = useState(EMPTY_CONNECTION);
  const [baseMeta, setBaseMeta] = useState({ reachable: false, mode: "unknown", apiVersion: null, scopes: [] });
  const [liTransient, setLiTransient] = useState(null);        // { status, error } while connecting or after an error (browser mode)
  const browserConn = useMemo(() => toAppConnection(liSettings), [liSettings]);
  const browserMode = baseMeta.mode !== "real" && (isLinkedInConfigured(liSettings) || !!browserConn);
  const liMeta = useMemo(() => (browserMode
    ? { ...baseMeta, mode: "browser", apiVersion: null, scopes: String(liSettings.scopes || "").split(/\s+/).filter(Boolean), bridge: isBridgeConfigured(liSettings) }
    : baseMeta), [browserMode, baseMeta, liSettings]);
  const conn = useMemo(() => (browserMode ? { ...EMPTY_CONNECTION, mode: "browser", ...(browserConn || {}), ...(liTransient || {}) } : baseConn), [browserMode, browserConn, liTransient, baseConn]);
  const setConn = browserMode
    ? (v) => { const next = typeof v === "function" ? v(conn) : v; setLiTransient({ status: next.status, error: next.error || null }); }
    : setBaseConn;
  const linkedin = useMemo(() => withDerived(conn), [conn]);
  /* The single answer to "will pressing Publish actually send anything?".
     Both the button label and the send path read this, so they can never
     disagree. */
  const publishReady = useMemo(
    () => makeLinkedInService.configured() && !linkedin.simulated && (linkedin.viaWorkflow || (liMeta.mode === "browser" && linkedin.connected)),
    [linkedin, liMeta.mode],
  );
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
  const workRef = useRef(null);          // the post any async job belongs to
  const oppAbortRef = useRef(null);      // Discover has its own controller so a scan never kills a draft in progress
  const oppRunRef = useRef(0);

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
        const d = r?.value ? sanitizeSession(r.value) : null;
        /* The UI is live while this resolves. If the user already started
           something, keep their work and restore only what it cannot conflict
           with. */
        const busyAlready = !!workRef.current;
        if (d) {
          d.theme && setTheme(d.theme);
          if (!busyAlready) d.idea && setIdea(d.idea);
          if (!busyAlready) d.stage && setStage(settleStage(d));
          if (!busyAlready) d.steps && setSteps(settleSteps(d.steps));
          d.tone && setTone(d.tone); d.pov && setPov(d.pov); d.length && setLength(d.length);
          if (d.publishState && ["SENT", "PUBLISHED", "FAILED", "SIMULATED"].includes(d.publishState)) {
            setPublishState(d.publishState); d.publishVia && setPublishVia(d.publishVia);
            Array.isArray(d.attempts) && setAttempts(d.attempts); d.publishError && setPublishError(d.publishError);
            Array.isArray(d.publishLimits) && setPublishLimits(d.publishLimits); d.publishKind && setPublishKind(d.publishKind);
            setPublishUnverified(!!d.publishUnverified);
          }
          if (!busyAlready) d.research && setResearch(d.research);
          if (!busyAlready) d.angles && setAngles(d.angles);
          if (!busyAlready) d.angle && setAngle(d.angle);
          if (!busyAlready) d.draft && setDraft(d.draft);
          if (!busyAlready) d.verification && setVerification(d.verification);
          if (!busyAlready) d.quality && setQuality(d.quality);
          if (!busyAlready) d.media && setMedia(d.media);
          d.formats && setFormats(normalizeFormats(d.formats));
          if (!busyAlready) d.workId && setWorkId(d.workId);
          d.drafts && setDrafts(d.drafts);
          d.sentKeys && setSentKeys(d.sentKeys);
          d.makeCompany && setMakeCompany(d.makeCompany);
          if (!busyAlready) d.assets && setAssets({ ...EMPTY_ASSETS, ...d.assets });
          if (!busyAlready) d.versions && setVersions(d.versions);
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
          if (d.extras && typeof d.extras === "object") setExtras({ ...DEFAULT_EXTRAS, ...d.extras });
          if (typeof d.setupHidden === "boolean") setSetupHidden(d.setupHidden);
          if (d.idea && !busyAlready) setView("workspace");
          if (d.workId && !busyAlready) workRef.current = d.workId;
          /* research that was cut off by a reload is started again */
          /* runDiscovery resets research itself, so restarting is always safe —
             gating on !d.research stranded a save made between research and angles. */
          if (!busyAlready && d.idea && d.workId && settleStage(d) === "RESEARCHING") setTimeout(() => runDiscovery(d.idea, d.formats || "text", d.workId), 0);
        }
      } catch (e) { /* first run */ }
      setRestored(true);
    })();
  }, []);

  const saveTimer = useRef(null);
  const storageWarnedRef = useRef(false);
  const [storageIssue, setStorageIssue] = useState(null);   // null | "partial" | "failed"

  /* ---------- optional shared workspace ----------
     When api/workspace.js is deployed, the parts of a session that belong to
     the team are one document everyone reads and writes. When it is not,
     every call below reports "off" and nothing changes. */
  const [sync, setSync] = useState({ status: "unknown", summary: "" });
  const syncTimer = useRef(null);
  const pushedRef = useRef("");
  const refreshSync = useCallback(() => setSync({ status: SYNC.status, summary: syncSummary(), version: SYNC.version, updatedBy: SYNC.updatedBy, updatedAt: SYNC.updatedAt }), []);
  useEffect(() => { setBrandText({ name: profile.company, site: profile.website }); }, [profile.company, profile.website]);
  useEffect(() => {
    if (!restored) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const full = {
        version: 2, savedAt: new Date().toISOString(),
        theme, idea, stage, steps, research, angles, angle, draft, verification, quality,
        media, formats, workId, drafts, versions, schedule, analytics, voice, profile, sentKeys, makeCompany,
        posts, team, notes, audit, usage, opps, searchOn, bg3d, extras, setupHidden, tone, pov, length,
        publishState, publishVia, attempts, publishError, publishLimits, publishKind, publishUnverified,
        assets: compactAssets(assets),
      };
      try {
        await persistentStore.set(STORE_KEY, JSON.stringify(full));
        if (storageWarnedRef.current) { storageWarnedRef.current = false; setStorageIssue(null); }
      } catch (e) {
        /* Over quota. Drop the heaviest, most reproducible parts (rendered
           media on old posts) and try once more, so text is never lost. */
        try {
          const slim = { ...full, posts: posts.map(({ image, images, pages, upload, ...rest }) => ({ ...rest, mediaDropped: !!(image || (images || []).length || pages || upload) })), drafts: drafts.map((d) => ({ ...d, assets: { ...(d.assets || {}), images: [], doc: null, carousel: [] } })) };
          await persistentStore.set(STORE_KEY, JSON.stringify(slim));
          if (!storageWarnedRef.current) { storageWarnedRef.current = true; setStorageIssue("partial"); notify("Browser storage is nearly full — text was saved, but rendered media on older posts was dropped.", { tone: "warn", ms: 8000 }); }
        } catch (e2) {
          if (!storageWarnedRef.current) { storageWarnedRef.current = true; setStorageIssue("failed"); notify("Couldn't save your session — browser storage is full or unavailable. Clear old posts under Content, or export your work.", { tone: "bad", ms: 10000 }); }
        }
      }
    }, 700);
  }, [restored, theme, idea, stage, steps, research, angles, angle, draft, verification, quality,
      media, formats, workId, drafts, versions, schedule, analytics, voice, profile, sentKeys, makeCompany, posts, team, notes, audit, usage, opps, searchOn, bg3d, extras, assets,
      tone, pov, length, publishState, publishVia, attempts, publishError, publishLimits, publishKind, publishUnverified, setupHidden]);

  /* Adopt whatever the team already has, once, on the way in. Merged rather
     than replaced: a post this browser made offline is not thrown away
     because the shared copy predates it. */
  useEffect(() => {
    if (!restored) return;
    let cancelled = false;
    (async () => {
      if (!(await workspaceHealth())) { if (!cancelled) refreshSync(); return; }
      const theirs = await pullShared();
      if (cancelled) return;
      if (theirs) {
        const merged = mergeShared({ posts, schedule, team, audit, profile, voice, makeCompany }, theirs);
        if ((merged.posts || []).length !== posts.length) setPosts(merged.posts);
        if ((merged.team || []).length !== team.length) setTeam(merged.team);
        if ((merged.audit || []).length !== audit.length) setAudit(merged.audit);
        if (theirs.schedule && !schedule.date) setSchedule(theirs.schedule);
        if (theirs.makeCompany?.urn && !makeCompany.urn) setMakeCompany(theirs.makeCompany);
        /* Someone else's company profile should not overwrite a name this
           person just typed, so only fill what is empty. */
        if (theirs.profile && !profile.company) setProfile((cur) => ({ ...theirs.profile, ...cur }));
        pushedRef.current = JSON.stringify({ posts: merged.posts, team: merged.team });
      }
      refreshSync();
      notify(SYNC.status === "ready" ? "Shared workspace connected." : "Working locally — no shared workspace.", { tone: SYNC.status === "ready" ? "ok" : undefined, ms: 4000 });
    })();
    return () => { cancelled = true; };
    // Runs once when the local session is ready; later changes go through the push below.
  }, [restored]);

  /* Send the team's half up when it changes. Debounced hard: this is a
     network write, not a keystroke log. */
  useEffect(() => {
    if (!restored || SYNC.status === "off" || SYNC.status === "unknown") return;
    const shared = { posts, schedule, team, audit, profile, voice, makeCompany };
    const fingerprint = JSON.stringify({ posts, team, schedule });
    if (fingerprint === pushedRef.current) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      const who = profile.userName || profile.userEmail || null;
      let r = await pushShared(shared, who);
      if (r.reason === "conflict") {
        /* Someone saved first. Merge their version under ours and try once
           more — never twice, or two browsers can ping-pong forever. */
        const merged = mergeShared(shared, r.theirs || {});
        setPosts(merged.posts); setTeam(merged.team); setAudit(merged.audit);
        r = await pushShared(merged, who);
        if (r.ok) notify(`Merged with ${r.by || "a teammate"}'s changes.`, { tone: "warn", ms: 6000 });
      }
      if (r.ok) pushedRef.current = fingerprint;
      else if (r.reason === "error") notify("Couldn't reach the shared workspace — your work is still saved in this browser.", { tone: "warn", ms: 6000 });
      refreshSync();
    }, 2500);
    return () => clearTimeout(syncTimer.current);
  }, [restored, posts, team, schedule, audit, profile, voice, makeCompany]);

  /* Settings offers this so nobody has to reload to see a teammate's post. */
  const syncNow = useCallback(async () => {
    resetWorkspaceProbe();
    if (!(await workspaceHealth({ force: true }))) { refreshSync(); notify("No shared workspace is deployed.", { tone: "warn" }); return; }
    const theirs = await pullShared();
    if (theirs) {
      const merged = mergeShared({ posts, schedule, team, audit, profile, voice, makeCompany }, theirs);
      setPosts(merged.posts); setTeam(merged.team); setAudit(merged.audit);
      pushedRef.current = "";
      notify("Workspace refreshed from your team.", { tone: "ok" });
    } else notify(SYNC.lastError ? `Shared workspace error: ${SYNC.lastError}` : "Nothing shared yet.", { tone: SYNC.lastError ? "bad" : undefined });
    refreshSync();
  }, [posts, schedule, team, audit, profile, voice, makeCompany, refreshSync]);

  /* ---------- drafts ----------
     Anything in progress is a draft until it is scheduled or published. The
     snapshot is written continuously, so leaving the workspace — to start a
     new post, open another one or visit any other tab — never loses work. */
  const FINISHED = ["SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"];
  const finishedNow = FINISHED.includes(stage) && publishState !== "FAILED";
  const snapshotWork = () => ({
    id: workId, title: idea, idea, formats, stage, steps, research, angles, angle, draft, verification, quality,
    media, assets: compactAssets(assets), versions: versions.slice(-6), schedule, tone, pov, length, undoStack: undoStack.slice(-3),
    audit: audit.slice(-40), analytics, savedAt: new Date().toISOString(),
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
    abortRef.current?.abort(); runRef.current += 1; workRef.current = null;
    setWorkId(null); setIdea(""); setRecFormat(null); recordIdRef.current = null; autoPublishRef.current = null; setStage("IDEA"); setResearch(null); setAngles(null); setAngle(null);
    setDraft(null); setVerification(null); setQuality(null); setMedia(null); setFormats(["text"]);
    setAssets(EMPTY_ASSETS); setMstate({}); setVersions([]); setPublishState(null); setAttempts([]);
    setAnalytics(null); setSteps([]); setAudit([]); setUndoStack([]); setBusy(false);
    setDupDismissed(false); setOpenClaim(null); setPublishError(null); setPublishVia(null); setPublishLimits([]); setPublishKind(null); setPublishFramed(false); setPublishUnverified(false); lastPayloadRef.current = null; autoRef.current = "";
  }

  function openDraft(d, opts = {}) {
    abortRef.current?.abort(); runRef.current += 1; workRef.current = d.id;
    setWorkId(d.id); setIdea(d.idea); setFormats(normalizeFormats(d.formats || "text"));
    setSteps(settleSteps(d.steps));
    setResearch(d.research || null); setAngles(d.angles || null); setAngle(d.angle || null);
    setDraft(d.draft || null); setVerification(d.verification || null); setQuality(d.quality || null);
    setMedia(d.media || null); setAssets({ ...EMPTY_ASSETS, ...(d.assets || {}) }); setMstate({});
    setVersions(d.versions || []); if (d.schedule) setSchedule(d.schedule);
    d.tone && setTone(d.tone); d.pov && setPov(d.pov); d.length && setLength(d.length);
    setUndoStack(d.undoStack || []); setAnalytics(d.analytics || null);
    setPublishState(opts.publishState || null); setPublishVia(opts.publishState ? "make" : null); setAttempts(opts.attempts || []);
    setPublishError(null); setPublishLimits(opts.limits || []); setPublishKind(null); setPublishFramed(false); setPublishUnverified(!!opts.unverified);
    setBusy(false); setDupDismissed(false); setOpenClaim(null); setAudit(d.audit || []); autoRef.current = `${d.idea}|${normalizeFormats(d.formats || "text").join("+")}`;
    // a job that was mid-flight when the draft was parked settles to the last completed stage
    /* A failed publish reopens as Approved: the retry card needs publishState,
       which a draft snapshot does not carry, so FAILED would be a dead end. */
    const settled = opts.stage || settleStage(d);
    setStage(settled === "FAILED" ? "APPROVED" : settled);
    setView("workspace"); setNavOpen(false); setModal(null); setOpenPost(null);
    window.scrollTo({ top: 0 });
    if (!opts.stage && settleStage(d) === "RESEARCHING") runDiscovery(d.idea, d.formats || "text", d.id);
  }

  /* A scheduled, sent or published post can always be reopened from its
     record — the snapshot carries everything the workspace needs. */
  function openPostInWorkspace(post, { publish = false } = {}) {
    const snap = post.snapshot || { idea: post.topic || post.title, formats: post.formats || "text", draft: post.content, assets: { ...EMPTY_ASSETS, poll: post.poll || null } };
    const id = post.workId || snap.id || post.id;
    recordIdRef.current = post.id;          // keep the row this post already has
    if (publish) autoPublishRef.current = id;
    openDraft({ ...snap, id, idea: snap.idea || post.topic || post.title, savedAt: snap.savedAt || post.scheduledAt }, {
      stage: stageOfPost(post),
      publishState: post.state === "SENT" ? "SENT" : post.state === "PUBLISHED" ? (post.simulated ? "SIMULATED" : "PUBLISHED") : null,
      limits: post.limits || [], unverified: !!post.unverified,
    });
    if (post.state === "SCHEDULED" && post.date) setSchedule((sc) => ({ ...sc, date: post.date, time: post.time || sc.time, tz: post.tz || sc.tz }));
  }
  const autoPublishRef = useRef(null);
  useEffect(() => {
    if (autoPublishRef.current && autoPublishRef.current === workId && stage === "SCHEDULED" && restored) {
      autoPublishRef.current = null;
      publishNow();
    }
  });  

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
      setBaseMeta({ reachable: st.reachable, mode: st.mode, apiVersion: st.apiVersion, scopes: st.scopes });
      setBaseConn(st.connection);

      /* Back from LinkedIn's consent screen (browser sign-in). */
      const auth = readAuthCallback();
      if (auth && st.mode !== "real") {
        if (auth.error) {
          setLiTransient({ status: "error", error: auth.description });
          notify(auth.description || "LinkedIn sign-in failed.", { tone: "bad", ms: 8000 });
          return;
        }
        setLiTransient({ status: "connecting", error: null });
        try {
          const connection = await exchangeCode(auth.code, getLinkedInSettings());
          if (!alive) return;
          const next = saveLinkedInSettings({ connection });
          setLiSettings(next); setLiTransient(null);
          const appConn = toAppConnection(next);
          if (connection.profile?.name) setProfile((p) => (p.userName ? p : { ...p, userName: connection.profile.name, userEmail: connection.profile.email || p.userEmail || "" }));
          logAudit(`LinkedIn sign-in ${connection.accessToken ? "completed" : "authorised — code received, no token bridge"}`);
          if (connection.accessToken) notify(`Signed in${connection.profile?.name ? " as " + connection.profile.name : ""}. ${appConn?.organizationName ? appConn.organizationName + " selected." : "Choose the Company Page to finish."}`, { tone: "ok" });
          else notify("LinkedIn authorised. No token bridge is set, so finish by pasting an access token or adding a bridge URL under Settings → LinkedIn.", { tone: "warn", ms: 9000 });
          setLiStart(1); setModal("linkedin");
        } catch (e) {
          if (!alive) return;
          setLiTransient({ status: "error", error: e?.message || "The token exchange failed." });
          notify(`LinkedIn sign-in failed: ${e?.message || e}`, { tone: "bad", ms: 9000 });
        }
        return;
      }

      const cb = readCallbackParams();
      if (!cb) return;
      /* `setConn` is chosen by the render that created this effect, when the
         mode was still unknown. Write to the store the freshly fetched mode
         actually names, so an error is never swallowed. */
      const setConnNow = (patch) => {
        if (st.mode === "real") setBaseConn((c) => ({ ...c, ...patch }));
        else setLiTransient((t) => ({ ...(t || {}), ...patch }));
      };
      if (cb.result === "authorized") {
        setModal("linkedin");                    // authorised — now choose a Page
        notify("LinkedIn authorised. Choose the Company Page to connect.");
      } else if (cb.result === "denied") {
        setConnNow({ status: "disconnected", error: "Authorization was cancelled on LinkedIn." });
        notify("LinkedIn authorization was cancelled.");
      } else if (cb.result === "unavailable") {
        notify("Real LinkedIn authorization isn't configured, so Unison stayed in prototype mode.");
      } else if (cb.result === "error") {
        const why = cb.reason === "invalid_state" ? "The authorization response failed a security check."
          : cb.reason === "exchange_failed" ? "LinkedIn rejected the authorization exchange."
          : "Authorization failed.";
        setConnNow({ status: "error", error: why });
        notify(why);
      }
    })();
    return () => { alive = false; };
  }, []);

  const logAudit = (text) => setAudit((l) => [...l, { t: now(), text }]);

  /* Feedback goes two places: a toast the user sees now, and the
     notifications drawer they can read later. */
  const [toasts, setToasts] = useState([]);
  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = (text, opts = {}) => {
    setNotes((n) => [{ t: now(), text }, ...n].slice(0, 20));
    const id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    setToasts((t) => [...t.slice(-4), { id, text, ...opts }]);
  };

  /* Told once. Six engines hitting the same daily wall is one piece of news,
     not six toasts. */
  const noticedRef = useRef(new Set());
  const onNotice = useCallback((n) => {
    const key = n.kind + (n.model || n.to || "");
    if (noticedRef.current.has(key)) return;
    noticedRef.current.add(key);
    if (n.kind === "downgraded") notify(`Daily limit reached on ${n.from} — continuing on ${n.to}. Output may be shorter or plainer until it resets.`, { tone: "warn", ms: 9000 });
    if (n.kind === "spent") logAudit(`Daily allowance spent on ${n.model}`);
  }, []);

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

  const pushUndo = (label) => setUndoStack((s) => [...s.slice(-9), { label, at: now(), draft, verification, quality }]);
  const undo = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((s) => s.slice(0, -1));
    setDraft(last.draft); setVerification(last.verification); if (last.quality !== undefined) setQuality(last.quality);
    logAudit(`Undid — ${last.label}`);
  };

  /* ---------- engines ---------- */

  async function runOpportunities() {
    setView("discover"); setNavOpen(false); setOppBusy(true); setOpps(null);
    window.scrollTo({ top: 0 });
    oppAbortRef.current?.abort(); oppAbortRef.current = new AbortController();
    const signal = oppAbortRef.current.signal;
    const id = ++oppRunRef.current;
    logAudit("Opportunity scan started");
    const hosted = await hostedProvider.configured();
    /* Free, keyless trending feed runs alongside the model. */
    const hnPromise = extras.hn ? hnStories(String(profile.keywords || profile.industry || "marketing").split(",")[0].trim(), { limit: 6 }).catch(() => []) : Promise.resolve([]);

    const shape = `{"items":[{"headline":"under 11 words","summary":"under 16 words","publisher":"","url":"https://…","date":"YYYY-MM-DD","score":0,"whyNow":"under 16 words","gap":"open|adjacent|covered","angle":"Contrarian|Educational|Industry insight|Data-driven"}]}`;
    const brief = `Today is ${todayISO()}. Industry: ${profile.industry}. Audience: ${profile.audience}. Watch terms: ${profile.keywords}.
Already published: ${JSON.stringify(posts.slice(0, 6).map((x) => x.title))}
Score 0-100 for how worth posting each is this week. gap = "open" if the Page has not covered it, "adjacent" if loosely related, "covered" if already posted. Sort by score, highest first.`;

    try {
      // pass 1 — live search
      const oppMeta = {};
      let r = searchOn && hosted ? await askJSON({
        meta: oppMeta,
        system: `You are the content opportunity engine. ${JSON_RULE}`,
        user: `Find 4 real stories this company could post about this week. Search the web and return each real URL.
${brief}
${shape}
Be terse. The whole reply must fit in 400 words.`,
        search: true,
        fallback: () => null, onNotice, track: track("Discovery"), signal,
      }) : null;
      if (id !== oppRunRef.current) return;

      // pass 2 — no search, so nothing competes for the response budget
      if (!r || !(r.items || []).length) {
        r = await askJSON({
          system: `You are the content opportunity engine. ${JSON_RULE}`,
          user: `List 5 themes this company could post about this week, from what you already know. Leave url empty.
${brief}
${shape}
Be terse.`,
          fallback: () => fb.opportunities(), onNotice, track: track("Discovery"), signal,
        });
        if (id !== oppRunRef.current) return;
        if (!r.degraded) r.degraded = searchOn ? "no-search" : "off";
      }

      const hn = await hnPromise;
      if (id !== oppRunRef.current) return;
      /* Same rule as research: a story link the model wrote is not evidence
         it exists. Hacker News rows come from a real feed, so they are. */
      const aiItems = corroborateSources(r.degraded === "sample" ? [] : (r.items || []), oppMeta.searchedUrls);
      const seen = new Set(aiItems.map((x) => x.url).filter(Boolean));
      const trending = hnToOpportunities(hn).map((x) => ({ ...x, link: "retrieved" })).filter((x) => !seen.has(x.url));
      const merged = { ...r, items: [...aiItems, ...trending], trending: trending.length, degraded: aiItems.length ? (r.degraded === "sample" ? undefined : r.degraded) : trending.length ? "hn-only" : r.degraded };
      setOpps(merged);
      logAudit(`Opportunity scan returned ${aiItems.length} stories${trending.length ? ` + ${trending.length} trending from Hacker News` : ""}`);
    } catch (e) { if (e?.name !== "AbortError" && id === oppRunRef.current) setOpps(fb.opportunities()); }
    if (id === oppRunRef.current) setOppBusy(false);
  }

  async function runDiscovery(topic, chosenFormats, existingId) {
    const list = normalizeFormats(chosenFormats || formats);
    setFormats(list);
    const newId = existingId || "w-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    workRef.current = newId;
    setWorkId(newId);
    setView("workspace"); setNavOpen(false); setModal(null); setOpenPost(null);
    setIdea(topic); setStage("RESEARCHING"); setBusy(true);
    setResearch(null); setAngles(null); setAngle(null); setDraft(null); setVerification(null);
    setQuality(null); setMedia(null); setAssets(EMPTY_ASSETS); setMstate({});
    setAnalytics(null); setPublishState(null); setAttempts([]); setVersions([]); setAudit([]);
    setDupDismissed(false); setUndoStack([]); setRecFormat(null); autoRef.current = "";
    setPublishError(null); setPublishVia(null); setPublishLimits([]); setPublishKind(null); setPublishUnverified(false);
    logAudit("Research started");
    window.scrollTo({ top: 0 });

    const { id, signal } = newRun();
    const key = topic.trim().toLowerCase();
    const cached = cacheRef.current[key];
    const hosted = await hostedProvider.configured();
    if (id !== runRef.current) return;
    const wikiPromise = extras.wikipedia ? wikiSearch(topic, { limit: 2 }).catch(() => []) : Promise.resolve([]);

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
      const meta = {};
      if (!r && searchOn && hosted) {
        r = await askJSON({
          meta,
          system: `You are the discovery engine of a B2B content platform. ${JSON_RULE}`,
          user: `Today is ${todayISO()}. Research this for a LinkedIn company page post: "${topic}".
Search the web and return the real URL of every source. Prefer sources from the last 90 days.
${shape}
Give 3 sources, 2 claims, 3 insights. Be terse — the whole reply must fit in 400 words.`,
          search: true,
          fallback: () => null, onNotice, track: track("Discovery"), signal,
        });
        if (id !== runRef.current) return;
      }
      if (!r || !(r.sources || []).length) {
        r = await askJSON({
          system: `You are the discovery engine of a B2B content platform. ${JSON_RULE}`,
          user: `Today is ${todayISO()}. Research this for a LinkedIn company page post: "${topic}", from what you already know. Leave url empty.
${shape}
Give 3 sources, 2 claims, 3 insights. Be terse.`,
          fallback: () => fb.research(topic), onNotice, track: track("Discovery"), signal,
        });
        if (id !== runRef.current) return;
        if (!r.degraded) r.degraded = searchOn ? "no-search" : "off";
      }
      r = normalizeResearch(r);
      /* A link the model wrote down is not the same as a link it retrieved.
         Mark each one before anyone treats a T1 row as evidence. */
      r = { ...r, sources: corroborateSources(r.sources, meta.searchedUrls) };
      if (!cached && !r.degraded) cacheRef.current[key] = r;
      /* Background reading from Wikipedia — clearly labelled, never evidence for a claim. */
      const wiki = await wikiPromise;
      if (id !== runRef.current) return;
      if (wiki.length && !r.sources.some((x) => x.background)) r = { ...r, sources: [...r.sources, ...wikiToSources(wiki)] };

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
        fallback: () => fb.angles(topic), onNotice, track: track("Intelligence"), signal,
      });
      if (id !== runRef.current) return;
      setAngles(normalizeAngles(a, topic)); setStep("angles", "done"); setStage("RESEARCH_COMPLETE");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.warn(e);
      if (id === runRef.current) { setSteps((st) => st.map((x) => (x.status === "active" ? { ...x, status: "failed", label: x.label + " — failed" } : x))); notify(`Research stopped: ${friendlyError(e)}`, { tone: "bad", ms: 8000 }); }
    }
    if (id === runRef.current) setBusy(false);
  }

  async function runWriter(selected, feedback) {
    setAngle(selected); setStage("DRAFT"); setBusy(true); setOpenClaim(null);
    if (draft) pushUndo(feedback ? "rewrite" : "regenerate");
    logAudit(feedback ? `Rewrite requested — ${feedback}` : `Angle selected — ${selected.type}`);
    const { id, signal } = newRun();
    const keepMedia = !!media;   // only ask the media engine once per topic

    try {
      const dRaw = await askJSON({
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
        fallback: () => fb.draft(idea), onNotice, track: track("Brand writer"), signal,
      });
      if (id !== runRef.current) return;

      const d = normalizeDraft(dRaw, idea);
      setDraft(d);
      setVersions((v) => [...v, { n: v.length + 1, label: feedback ? "AI revised" : "AI generated", author: "Unison", at: now(), snapshot: d }]);
      setStage("AI_REVIEW");

      const jobs = [
        ...checkJobs(d, signal),
      ];
      if (!keepMedia) jobs.push(askJSON({
        system: `You are the media engine. ${JSON_RULE}`,
        user: `Suggest a format for this post. Answer with one id from: text, image, video, document, multi, poll, article, carousel.
Post: ${d.hook} ${d.body}
{"format":"","reason":"one sentence","concept":"one sentence describing the visual"}`,
        fallback: fb.media, onNotice, track: track("Media"), signal,
      }));

      const [ver, q, m] = await Promise.all(jobs);
      if (id !== runRef.current) return;
      setVerification({ ...normalizeVerification(ver), checkedText: textOf(d) }); setQuality(normalizeQuality(q));
      if (m) setMedia(m);   // a suggestion only — the user's chosen format wins
      setStage("HUMAN_REVIEW");
      logAudit(ver?.degraded ? "Checks could not run — AI unavailable" : "Claims verified and quality check completed");
    } catch (e) {
      if (e?.name === "AbortError") return;
      console.warn(e);
      if (id === runRef.current) { setStage(draft ? "HUMAN_REVIEW" : "RESEARCH_COMPLETE"); notify(`Writing stopped: ${friendlyError(e)}`, { tone: "bad", ms: 8000 }); }
    }
    if (id === runRef.current) setBusy(false);
  }

  /* The two checks that run after every draft: evidence and quality. */
  function checkJobs(d, signal) {
    return [
      askJSON({
        system: `You are the trust engine. ${JSON_RULE}`,
        user: `Check each claim against the sources. Copy each claim exactly as it appears in the post.
Post claims: ${JSON.stringify(d.claims || [])}
Sources: ${JSON.stringify((research?.sources || []).filter((x) => !x.background).map((x, i) => ({ i, title: x.title, publisher: x.publisher, tier: x.tier, url: x.url, note: x.note })))}
Research claims (with the source index they came from): ${JSON.stringify((research?.claims || []).slice(0, 8))}
green = clearly supported by a listed source, yellow = plausible but not directly supported (needs human review), red = unsupported or contradicted. Placeholder sources with no URL support nothing.
{"claims":[{"claim":"","status":"green","source":"publisher name","url":"source url or empty","confidence":"High|Medium|Low","note":"one line"}],"unresolved":["one line"]}`,
        fallback: fb.verify, onNotice, track: track("Trust"), signal,
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
Scores 0-100. "Evidence verified" passes only if every factual statement is one of the listed claims. "No duplicate content" compares against the previously published titles. Only list slop phrases that are really present.`,
        fallback: fb.quality, onNotice, track: track("Trust"), signal,
      }),
    ];
  }

  /* Re-run evidence and quality on the current text without rewriting it. */
  async function recheck() {
    if (!draft) return;
    const { id, signal } = newRun();
    setBusy(true); setOpenClaim(null);
    logAudit("Re-checking the edited text");
    try {
      const [ver, q] = await Promise.all(checkJobs(draft, signal));
      if (id !== runRef.current) return;
      setVerification({ ...normalizeVerification(ver), checkedText: textOf(draft) }); setQuality(normalizeQuality(q));
      if (["APPROVED", "SCHEDULED"].includes(stage)) setStage("HUMAN_REVIEW");
      notify(ver?.degraded ? "Checks couldn't run — AI is unavailable." : "Checks updated for the edited text.", { tone: ver?.degraded ? "warn" : "ok" });
    } catch (e) { if (e?.name !== "AbortError") notify(`Re-check failed: ${friendlyError(e)}`, { tone: "bad" }); }
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
      onNotice, track: track("Intelligence"),
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
  if (!engineRef.current) engineRef.current = createMediaEngine({ onNotice, track: track("Media"), log: logAudit });
  const engine = engineRef.current;

  const ctxOf = () => ({ hook: draft?.hook || idea, body: draft?.body || "" });
  const mset = (k, v) => setMstate((m) => ({ ...m, [k]: { ...idle(), ...v } }));
  const patchAssets = (patch) => setAssets((a) => ({ ...a, ...patch }));

  /* Every media job remembers which post it started on. If the user opens
     another draft while it runs, the result is dropped instead of landing on
     the wrong post. */
  async function run(key, fn) {
    const started = workRef.current;
    const live = () => workRef.current === started;
    mset(key, { status: "generating" });
    try {
      await fn(live);
      if (live()) mset(key, { status: "success" });
    } catch (e) {
      if (!live()) return;
      if (e?.name === "AbortError") return mset(key, { status: "idle" });
      console.warn("[unison] media task failed:", key, e);
      mset(key, { status: "error", error: friendlyError(e) });
    }
  }

  const makeImage = (variant = 0) => run("image", async (live) => {
    const a = await engine.image(ctxOf(), { variant, photo: extras.pollinations === true });
    if (!live()) return;
    patchAssets({ images: [a], upload: null });
  });

  const makeImageSet = (count = 3) => run("multi", async (live) => {
    const set = await engine.imageSet(ctxOf(), { count });
    if (!live()) return;
    patchAssets({ images: set, upload: null });
  });

  const retile = (i) => run("tile-" + i, async (live) => {
    const tile = assets.images[i];
    const next = await engine.retile(tile, ctxOf());
    if (!live()) return;
    setAssets((a) => ({ ...a, images: a.images.map((x) => (x.id === tile.id ? next : x)) }));
  });

  const addTile = () => run("multi", async (live) => {
    const [t] = await engine.imageSet(ctxOf(), { count: 1 });
    if (!live()) return;
    setAssets((a) => ({ ...a, images: [...a.images, t].slice(0, 4) }));
  });

  const makeVideo = () => run("video", async (live) => {
    const previous = assets.video?.url;
    const a = await engine.video(ctxOf());
    if (!live()) return;
    if (previous) URL.revokeObjectURL(previous);       // the old encode is dead weight
    mset("encode", { status: "idle" });
    patchAssets({ video: a, upload: null });
  });

  /* Encoding is real-time capture, so it is a deliberate action rather than
     something that happens behind the Generate button. */
  const exportVideo = () => run("encode", async (live) => {
    const cur = assets.video;
    if (!cur?.storyboard?.length) throw new Error("Nothing to encode yet.");
    if (cur.url) URL.revokeObjectURL(cur.url);
    const file = await engine.encodeVideo(cur, { onProgress: (p) => live() && mset("encode", { status: "generating", progress: p }) });
    if (!live()) { URL.revokeObjectURL(file.url); return; }   // superseded: don't pin the blob
    setAssets((a) => ({ ...a, video: { ...a.video, blob: file.blob, url: file.url, mime: file.mime, bytes: file.blob.size } }));
    logAudit("Video encoded to WebM");
  });

  const makeDocument = (pages = 5) => run("doc", async (live) => {
    const d = await engine.document(ctxOf(), { pages });
    if (!live()) return;
    patchAssets({ doc: d });
  });

  const makeCarousel = (slides = 6) => run("carousel", async (live) => {
    const c = await engine.carousel(ctxOf(), { slides });
    if (!live()) return;
    patchAssets({ carousel: c });
  });

  const reslide = (i) => run("slide-" + i, async (live) => {
    const slide = assets.carousel[i];
    const next = await engine.reslide(slide, i, assets.carousel.length, ctxOf());
    if (!live()) return;
    setAssets((a) => ({ ...a, carousel: engine.renumber(a.carousel.map((x) => (x.id === slide.id ? { ...next, id: slide.id } : x))) }));
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

  const makePoll = () => run("poll", async (live) => {
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
      onNotice, track: track("Writing"),
    });
    const opts = (Array.isArray(r.options) ? r.options : []).slice(0, 4).map((o) => String(o).slice(0, 30)).filter(Boolean);
    if (!live()) return;
    patchAssets({
      poll: {
        question: String(r.question || "").slice(0, 140) || "What is holding your team back?",
        options: opts.length >= 2 ? opts : ["Finding a topic", "Getting approval", "Checking the facts"],
        duration: assets.poll?.duration || "1 week",
      },
    });
  });

  const makeArticle = () => run("article", async (live) => {
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
      onNotice, track: track("Writing"),
    });
    const sections = (Array.isArray(r.sections) ? r.sections : []).filter((x) => x && x.heading);
    if (!live()) return;
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
    let todo = fmt.list.filter((f) => starters[f] && !starters[f][1]());
    /* A file the user uploaded was too large to keep across a reload. Do not
       quietly generate a different picture in its place — say what happened. */
    if (assets.uploadDropped && todo.some((f) => ["image", "multi", "video"].includes(f))) {
      todo = todo.filter((f) => !["image", "multi", "video"].includes(f));
      notify(`"${assets.uploadDropped.name}" was too large to keep when the page reloaded. Upload it again in the Media step.`, { tone: "warn", ms: 9000 });
      patchAssets({ uploadDropped: null });
    }
    if (!todo.length) return;
    logAudit(`Auto-generating ${todo.map((f) => FORMAT_BY_ID[f].label.toLowerCase()).join(", ")}`);
    todo.forEach((f) => starters[f][0]());
  }, [idea, fmt, stage]);

  /* ---------- document ingestion ---------- */

  async function readDocText(file) {
    if (/\.docx$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      const { default: mammoth } = await import("mammoth");   // 400 KB, loaded on first .docx only
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

  const ingestDocument = (file) => run("sourceDoc", async (live) => {
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
      onNotice, track: track("Document"),
    });
    const doc = { name: file.name, size: file.size, chars: text.length, ...r, at: now() };
    if (!live()) return;
    patchAssets({ sourceDoc: doc });
    setResearch((prev) => {
      const src = { title: file.name, publisher: "Uploaded document", date: new Date().toISOString().slice(0, 10), tier: 1, note: r.summary || "Uploaded by you.", url: "", uploaded: true };
      if (!prev) return { sources: [src], claims: (r.claims || []).map((c) => ({ text: c, sourceIndex: 0 })), insights: r.insights || [], freshness: "Primary", risks: [] };
      return { ...prev, sources: [src, ...(prev.sources || [])], claims: [...(r.claims || []).map((c) => ({ text: c, sourceIndex: 0 })), ...(prev.claims || [])] };
    });
    logAudit(`Document ingested — ${file.name}`);
    notify(`${file.name} added as a source.`);
  });

  const attachUpload = async (file) => {
    if (!file) return;
    const isVideo = file.type.startsWith("video");
    if (isVideo && file.size > 6 * 1024 * 1024) {
      notify(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB. Videos over 6 MB can be previewed but not sent from the browser — keep it under 6 MB to publish.`, { tone: "warn", ms: 8000 });
    }
    try {
      let data = await readFileAsDataUrl(file);
      if (!isVideo) data = await downscaleImage(data);
      patchAssets({ upload: { name: file.name, data, type: isVideo ? file.type : (/^data:([^;]+)/.exec(data)?.[1] || file.type), bytes: dataUrlBytes(data) }, images: [], video: null });
      logAudit(`Uploaded ${file.name}`);
    } catch (e) {
      notify("That file couldn't be read.", { tone: "bad" });
    }
  };

  /* ---------- actions ---------- */

  const claimsBlocking = (verification?.claims || []).some((c) => c.status === "red");
  const checksStale = !!(draft && verification && verification.checkedText != null && verification.checkedText !== textOf(draft));
  const checksDegraded = !!(verification?.degraded || quality?.degraded);

  function approve({ force = false } = {}) {
    if (claimsBlocking) return;
    if ((checksStale || checksDegraded) && !force) return;
    setVersions((v) => [...v, { n: v.length + 1, label: force ? "Approved without checks" : "Approved", author: profile.userName || "You", at: now(), snapshot: draft }]);
    setStage("APPROVED"); logAudit(`${profile.userName || "Reviewer"} approved${force ? " (checks skipped)" : ""}`); notify("Post approved. Choose a time to publish.", { tone: "ok" });
  }
  /* Editing after approval means approving again. */
  function unlock() { if (["APPROVED", "SCHEDULED"].includes(stage)) { setStage("HUMAN_REVIEW"); setAttempts([]); logAudit("Unlocked for editing — approval withdrawn"); } }
  function reject(reason) { logAudit(`Reviewer rejected — ${reason}`); runWriter(angle, reason); }

  /* Everything a post needs to be re-opened later, without the working state. */
  const postRecord = (extra) => ({
    title: draft?.hook?.slice(0, 60) || idea, topic: idea, workId, formats,
    content: draft ? { hook: draft.hook, body: draft.body, cta: draft.cta, hashtags: draft.hashtags || [] } : null,
    poll: assets.poll, image: assets.images[0]?.svg || null, images: assets.images.map((x) => x.svg),
    upload: assets.upload && !assets.upload.type.startsWith("video") ? assets.upload.data : null,
    pages: assets.doc?.pages?.map((x) => x.svg) || (assets.carousel.length ? assets.carousel.map((x) => x.svg) : null),
    snapshot: snapshotWork(),           // enough to reopen the post in the workspace
    submittedBy: profile.userName || null,
    time: schedule.time, tz: schedule.tz, ...extra,
  });

  /* One record per piece of work: scheduling, then publishing, replaces the
     same row instead of leaving two entries for one post. */
  const recordIdRef = useRef(null);
  const recordId = () => {
    /* A post reopened from Content keeps its existing row id, so publishing
       replaces that row instead of adding a second one beside it. */
    if (recordIdRef.current) return recordIdRef.current;
    if (workId) return "p-" + workId;
    recordIdRef.current = "p-" + Date.now().toString(36);
    return recordIdRef.current;
  };

  function confirmSchedule() {
    if (!schedule.date || !/^\d{4}-\d{2}-\d{2}$/.test(schedule.date)) { notify("Pick a date first.", { tone: "warn" }); return; }
    if (isDue(schedule.date, schedule.time || "09:00", schedule.tz)) { notify("That time has already passed — pick a later slot, or use Publish now.", { tone: "warn" }); return; }
    setStage("SCHEDULED");
    /* One record per piece of work: rescheduling replaces, never duplicates. */
    const id = recordId();
    setPosts((p) => [postRecord({ id, state: "SCHEDULED", date: schedule.date, scheduledAt: new Date().toISOString() }), ...p.filter((x) => x.id !== id && !(workId && x.workId === workId))]);
    logAudit(`Scheduled for ${schedule.date} ${schedule.time} ${schedule.tz}`);
    notify(`Scheduled for ${schedule.date} at ${schedule.time}.`);
  }

  /* Cancelling removes the publishing job. If that post is the one open in the
     workspace, it steps back to Approved so nothing goes out at the old time. */
  function cancelScheduled(post) {
    setPosts((p) => p.filter((x) => x.id !== post.id));
    const isOpen = post.workId && post.workId === workId;
    if (isOpen && stage === "SCHEDULED") { setStage("APPROVED"); setAttempts([]); }
    else if (post.snapshot) {
      /* Not open: the approved work goes back to Drafts instead of vanishing. */
      const id = post.workId || post.id;
      setDrafts((d) => [{ ...post.snapshot, id, stage: "APPROVED", savedAt: new Date().toISOString() }, ...d.filter((x) => x.id !== id)]);
    }
    setOpenPost(null);
    logAudit(`Schedule cancelled — ${post.title}`);
    notify(isOpen ? `"${post.title}" will not be published. It's back in Approved if you want to reschedule it.`
      : post.snapshot ? `"${post.title}" will not be published. It's back in Drafts, approved and ready to reschedule.`
      : `"${post.title}" will not be published.`);
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
      const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg || "");
      const w = vb ? Number(vb[1]) : 1200, h = vb ? Number(vb[2]) : 630;
      const parts = dataUrlParts(await svgToPng(svg, w, h));
      media.push({ kind: "image", filename, mimeType: parts.mimeType, data: parts.data, altText: altText || "", width: w, height: h, ...extra });
    };
    const photo = async (img, filename, altText, extra = {}) => {
      /* AI photo: fetched into base64 when the host allows it, else sent by URL */
      try {
        const parts = dataUrlParts(await fetchImageAsDataUrl(img.url));
        media.push({ kind: "image", filename, mimeType: parts.mimeType, data: parts.data, altText: altText || "", width: img.width || 1200, height: img.height || 630, ...extra });
      } catch {
        media.push({ kind: "image", filename, mimeType: "image/jpeg", url: img.url, altText: altText || "", width: img.width || 1200, height: img.height || 630, ...extra });
        limits.push("The AI image is sent as a link for the scenario to download — it couldn't be read into the request from this browser.");
      }
    };
    if (assets.upload) {
      const parts = dataUrlParts(assets.upload.data);
      if (parts) media.push({ kind: assets.upload.type.startsWith("video") ? "video" : "image", filename: assets.upload.name, mimeType: parts.mimeType, data: parts.data, altText: "" });
      else limits.push("The uploaded file couldn't be read for sending.");
      return { media, limits };
    }
    if (postType === "image" && assets.images[0]) {
      const img = assets.images[0];
      if (img.kind === "url") await photo(img, "unison-image.jpg", img.brief?.subject); else await png(img.svg, "unison-image.png", img.brief?.subject);
    }
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
    }
    if (postType === "carousel" && assets.carousel.length) {
      for (let i = 0; i < assets.carousel.length; i++) await png(assets.carousel[i].svg, `unison-slide-${i + 1}.png`, assets.carousel[i].heading, { kind: "slide", index: i, of: assets.carousel.length });
    }
    return { media, limits };
  }

  /* Everything the scenario needs, from live state — nothing placeholder. */
  async function buildPublishPayload(postId, { scheduled = false } = {}) {
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
      publishMode: scheduled ? "scheduled" : "now",
      scheduledDate: scheduled ? schedule.date : null,
      scheduledTime: scheduled ? schedule.time : null,
      timezone: schedule.tz || localTimezone(),
      submittedBy: profile.userName || linkedin.profile?.name ? { name: profile.userName || linkedin.profile?.name, email: profile.userEmail || linkedin.profile?.email || null } : null,
      linkedinAccessToken: liSettings.sendToken && liSettings.connection?.accessToken ? liSettings.connection.accessToken : undefined,
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

  /* Sent in full, with a note where LinkedIn itself constrains what the
     scenario can do with it. These are notes, not blocks — nothing is
     downgraded to another format. */
  const TYPE_NOTES = {
    document: "LinkedIn document posts need a PDF. The pages are sent as images; the Make scenario has to assemble them into a PDF before LinkedIn will accept a document post.",
    carousel: "LinkedIn has no organic carousel API. The slides are sent as images for the scenario to post or export — LinkedIn will not render them as a swipeable carousel.",
    article: "LinkedIn Articles can't be created through the API. The article is sent with the post so the scenario can store or route it, but LinkedIn will only publish the written post.",
  };

  /* A dry run that looks like the real thing, used whenever no real
     publishing route is connected. Nothing leaves the browser. */
  function simulatePublish(postId) {
    setStage("PUBLISHING"); setPublishState("SENDING"); setPublishVia("simulated");
    setAttempts([{ label: "Simulated — nothing was sent", status: "ok", idem: postId }, { label: "Published (simulated)", status: "ok", idem: postId }]);
    setPublishState("SIMULATED"); setStage("PUBLISHED");
    setPosts((p) => [postRecord({ id: postId, state: "PUBLISHED", date: todayISO(), simulated: true, publishedAt: new Date().toISOString() }), ...p.filter((x) => x.id !== postId && !(workId && x.workId === workId))]);
    logAudit("Simulated publish — nothing was sent to LinkedIn");
    notify("Simulated publish — nothing was sent. Connect Make or LinkedIn under Settings to publish for real.", { tone: "warn", ms: 8000 });
  }

  async function publishNow({ scheduled = false } = {}) {
    if (publishingRef.current || ["PREPARING", "SENDING"].includes(publishState) || stage === "PUBLISHED") return;
    /* Never send a row that has no written post behind it — a sample or a
       legacy record would otherwise go out as its own title. */
    if (!draft || !finalPostText().trim()) {
      notify("There's no post text to publish. Open it and write the post first.", { tone: "warn" });
      return;
    }
    const postId = recordId();
    const idem = postId;
    const startedFor = workRef.current;
    const live = () => workRef.current === startedFor;
    setAttempts([]); setPublishError(null); setPublishLimits([]); setPublishKind(null); setPublishUnverified(false);
    const step = (label, status) => live() && setAttempts((a) => [...a, { label, status, idem }]);

    /* ---- real publishing through Unison's own API (unchanged) ---- */
    if (liMeta.mode === "real" && conn.status === "connected") {
      publishingRef.current = true;
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
        setPosts((p) => [postRecord({ id: postId, reference: r.post.urn, url: r.post.url, state: "PUBLISHED", date: todayISO(), real: true, publishedAt: new Date().toISOString() }),
          ...p.filter((x) => x.id !== postId && !(workId && x.workId === workId))]);
        logAudit(`Published to LinkedIn — ${r.post.urn}`);
        if (!live()) return;
        step("LinkedIn confirmed the post", "ok");
        setPublishState("PUBLISHED"); setStage("PUBLISHED");
        notify("Published to LinkedIn.", { tone: "ok" });
        setAnalytics(null);   // performance arrives later, from LinkedIn — nothing is invented here
      } catch (e) {
        if (!live()) return;
        step(e.code === "cannot_publish" ? "Page permission check" : "LinkedIn rejected the request", "failed");
        setPublishState("FAILED"); setStage("FAILED");
        setPublishError(e.message || "LinkedIn rejected the request.");
        if (e.code === "not_authorized") setConn((c) => ({ ...c, status: "expired" }));
        logAudit(`Publishing failed — ${e.code || e.status || "unknown"}`);
        notify("Publishing failed. Nothing was posted.", { tone: "bad" });
      } finally {
        publishingRef.current = false;
      }
      return;
    }

    /* ---- publishing through Make ----
       Make delivers to LinkedIn. A 2xx from the webhook means Make has the
       post; only an explicit confirmation in Make's reply means LinkedIn has
       it. The stages are reported exactly as far as they are known. */
    const postType = postTypeOf();
    /* Only a real route may send anything: the Make workflow, or a browser
       sign-in with a Page selected. A sample Page or no connection is a dry run. */
    if (!publishReady) { simulatePublish(postId); return; }
    if (sentKeys.includes(postId)) {
      setPublishState("SENT");
      notify("This post has already been sent to Make. It won't be sent again — mark it live if you've checked LinkedIn.", { tone: "warn" });
      return;
    }
    publishingRef.current = true;
    setStage("PUBLISHING"); setPublishState("PREPARING"); setPublishVia("make");
    step("Preparing", "ok");
    try {
      if (failMode) throw Object.assign(new Error("Simulated failure."), { kind: "simulated" });
      const { payload, limits } = await buildPublishPayload(postId, { scheduled });
      if (postType === "video" && !payload.media.some((m) => m.kind === "video")) throw Object.assign(new Error("No video file to send."), { kind: "no-video" });
      if (TYPE_NOTES[postType]) limits.push(TYPE_NOTES[postType]);
      if (!live()) return;
      setPublishLimits(limits);
      lastPayloadRef.current = payload;
      setPublishState("SENDING");
      /* Decided before the send so the progress copy names the path the post
         actually takes, rather than naming Make for one that never sees it. */
      const route = await publishRoute(payload);
      step(route === "linkedin" ? "Posting to LinkedIn" : scheduled ? "Handing to Make with the schedule" : "Sending to Make", "ok");
      /* Snapshot the record before the round trip: if the user opens another
         draft meanwhile, the result is still filed against the right post. */
      const baseRecord = postRecord({ id: postId, viaMake: route !== "linkedin", postType, mediaSent: payload.media.length, limits, scheduledHandoff: scheduled });
      const r = await publishPost(payload);
      const viaLinkedIn = r.route === "linkedin";
      setSentKeys((k) => (k.includes(postId) ? k : [...k, postId]));
      if (!live()) {
        setPosts((p) => [{ ...baseRecord, state: r.published ? "PUBLISHED" : "SENT", date: scheduled ? schedule.date : todayISO(), sentAt: r.at, unverified: !!r.unverified, reference: r.urn || null, url: r.url || null }, ...p.filter((x) => x.id !== postId && !(workId && x.workId === workId))]);
        return;
      }
      step(viaLinkedIn ? "LinkedIn accepted the post" : r.duplicate ? "Already delivered — not sent again" : r.unverified ? "Sent — Make's reply couldn't be read from this browser" : r.fallback ? "Sent to Make" : "Sent to Make via the publishing service", "ok");
      if (r.unverified) setPublishUnverified(true);
      const sentRecord = postRecord({
        id: postId, state: "SENT", date: scheduled ? schedule.date : todayISO(), viaMake: !viaLinkedIn, scheduledHandoff: scheduled,
        postType, mediaSent: payload.media.length, limits, sentAt: r.at, reference: r.urn || null, url: r.url || null, unverified: !!r.unverified,
      });
      if (r.published) {
        step("Publishing through LinkedIn", "ok"); step("Published", "ok");
        setPublishState("PUBLISHED"); setStage("PUBLISHED");
        setPosts((p) => [{ ...sentRecord, state: "PUBLISHED", publishedAt: r.at }, ...p.filter((x) => x.id !== postId && !(workId && x.workId === workId))]);
        logAudit(`Published to LinkedIn${viaLinkedIn ? " directly" : " via Make"}${r.urn ? ` — ${r.urn}` : ""}`);
        notify("Published to LinkedIn.");
      } else {
        step(scheduled ? `Make will publish on ${schedule.date} at ${schedule.time}` : "Publishing through LinkedIn", "pending");
        setPublishState("SENT");
        setPosts((p) => [sentRecord, ...p.filter((x) => x.id !== postId && !(workId && x.workId === workId))]);
        logAudit(`Sent to Make — ${postType} post${payload.media.length ? `, ${payload.media.length} media file(s)` : ""}${r.unverified ? " (reply unreadable)" : ""}`);
        notify(r.unverified ? "Sent to Make. The reply couldn't be read from this browser, so check the scenario before sending again." : scheduled ? "Handed to Make with the schedule." : "Sent to Make — LinkedIn publishing is being processed.", { tone: r.unverified ? "warn" : "ok" });
      }
    } catch (e) {
      if (!live()) return;
      let kind = e?.kind || null;
      let label = "Make did not accept the post";
      if (kind === "relay-error") label = "The publishing service rejected the post";
      if (kind === "sandbox") { label = "This page can't make outside requests"; setPublishFramed(!!e.framed); }
      else if (kind === "timeout") label = "Make didn't respond in time";
      else if (kind === "too-large") label = "Post too large to send";
      else if (kind === "no-video") label = "No video file to send";
      else if (kind === "relay-missing") { kind = "sandbox"; label = "No publishing service is deployed here"; }
      step(label, "failed");
      setPublishState("FAILED"); setStage("FAILED");
      setPublishKind(kind);
      setPublishError(kind === "relay-error" ? (e?.message || "The publishing service couldn't pass the post on. Please try again.")
        : kind === "empty" ? "There is no post text to publish."
        : kind === "simulated" ? "Simulated failure (Settings → Simulate a publishing failure). Nothing was sent."
        : kind === "too-large" ? "The post and its media are too large to send in one request. Reduce the media and try again."
        : kind === "no-video" ? "This is a video post but there is no video file yet. Export the video in the Media step (or upload one), then publish."
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
  /* Browser sign-in helpers handed to the LinkedIn modal. */
  const browserLinkedIn = {
    settings: liSettings,
    begin: () => { try { beginAuthorization(getLinkedInSettings()); } catch (e) { notify(e.message, { tone: "bad" }); } },
    /* A token pasted from the developer portal's token generator. */
    useToken: async (token, expiresIn) => {
      const cur = getLinkedInSettings().connection || {};
      let connection = connectionFromToken({ accessToken: String(token).trim(), expiresIn: Number(expiresIn) || 60 * 24 * 3600, profile: cur.profile, organizations: cur.organizations, via: "token" });
      const next = saveLinkedInSettings({ connection });
      setLiSettings(next); setLiTransient(null);
      logAudit("LinkedIn access token added manually");
      if (isBridgeConfigured(next)) {
        try { const orgs = await fetchOrganizations(connection, next); const n2 = saveLinkedInSettings({ connection: { ...connection, organizations: orgs, selectedUrn: orgs.length === 1 ? orgs[0].urn : connection.selectedUrn } }); setLiSettings(n2); return n2.connection; }
        catch (e) { notify(`Token saved, but the bridge couldn't list your Pages: ${e.message}`, { tone: "warn", ms: 8000 }); }
      }
      return connection;
    },
    loadOrgs: async () => {
      const s = getLinkedInSettings();
      const orgs = await fetchOrganizations(s.connection, s);
      const next = saveLinkedInSettings({ connection: { ...s.connection, organizations: orgs } });
      setLiSettings(next);
      return orgs;
    },
    /* A Page typed in by hand when no bridge can list them. */
    addOrg: (org) => {
      const s = getLinkedInSettings();
      const cur = s.connection || { status: "authorized", organizations: [] };
      const orgs = [...(cur.organizations || []).filter((o) => o.urn !== org.urn), org];
      setLiSettings(saveLinkedInSettings({ connection: { ...cur, organizations: orgs } }));
      return orgs;
    },
  };

  async function finishConnect(org) {
    if (liMeta.mode === "browser") {
      const cur = getLinkedInSettings().connection || { status: "authorized", organizations: [], obtainedAt: new Date().toISOString() };
      const orgs = (cur.organizations || []).some((o) => o.urn === org.urn) ? cur.organizations : [...(cur.organizations || []), org];
      const next = saveLinkedInSettings({ connection: { ...cur, organizations: orgs, selectedUrn: org.urn } });
      setLiSettings(next); setLiTransient(null);
      if (!makeCompany.name && !makeCompany.urn) setMakeCompany({ name: org.name || "", urn: org.urn || "" });
      logAudit(`LinkedIn Page selected — ${org.name}`);
      notify(`${org.name} selected as the Company Page.`, { tone: "ok" });
      return;
    }
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
  const openSettings = (tab) => { setSettingsTab(tab || "workspace"); setModal("settings"); };
  /* Components call setModal("settings", "ai") to land on a tab. */
  const openModal = (m, tab) => { if (m === "settings" && tab) setSettingsTab(tab); setModal(m); };
  /* Something real happens on Publish only on these routes. */

  /* Performance numbers are typed in from LinkedIn analytics; the learning
     engine explains them on request and the explanation lives on the post. */
  function saveMetrics(post, metrics) {
    setPosts((p) => p.map((x) => (x.id === post.id ? { ...x, metrics, sample: false, analytics: null } : x)));
    setOpenPost((o) => (o && o.id === post.id ? { ...o, metrics, sample: false, analytics: null } : o));
    logAudit(`Performance numbers added — ${post.title}`);
    notify("Numbers saved.", { tone: "ok" });
  }
  async function explainPost(post) {
    const text = post.content ? `${post.content.hook}\n${post.content.body}` : post.title;
    const others = posts.filter((x) => x.id !== post.id && x.metrics && Number(x.metrics.impressions) > 0);
    const avg = (k) => (others.length ? Math.round(others.reduce((a, x) => a + (Number(x.metrics[k]) || 0), 0) / others.length) : null);
    notify("Asking the learning engine…");
    const a = await askJSON({
      system: `You are the learning engine. Explain performance as likely reasons, never as proven cause. ${JSON_RULE}`,
      user: `Post: ${text.slice(0, 1200)}
Metrics: ${JSON.stringify(post.metrics)}
${others.length ? `Page average across ${others.length} other posts: impressions ${avg("impressions")}, reactions ${avg("reactions")}, comments ${avg("comments")}.` : "No other posts have numbers yet, so compare against typical B2B Company Page benchmarks and say so."}
{"headline":"one sentence with the comparison","why":["likely reason","likely reason","likely reason"],"next":"one recommendation"}`,
      fallback: fb.performance, onNotice, track: track("Learning"),
    });
    const analytics = { ...a, metrics: post.metrics, at: new Date().toISOString() };
    setPosts((p) => p.map((x) => (x.id === post.id ? { ...x, analytics } : x)));
    setOpenPost((o) => (o && o.id === post.id ? { ...o, analytics } : o));
    if (post.workId && post.workId === workRef.current) setAnalytics(analytics);
    logAudit(`Performance explained — ${post.title}${a.degraded ? " (sample explanation — AI unavailable)" : ""}`);
    if (a.degraded) notify("The AI was unavailable, so this is a sample explanation.", { tone: "warn" });
  }
  const manageConnection = () => { setSettingsTab("linkedin"); setModal("settings"); };
  const disconnectLinkedIn = async () => {
    if (liMeta.mode === "real") { try { await linkedinService.disconnect(); } catch (e) { /* clear locally anyway */ } }
    if (liMeta.mode === "browser") { setLiSettings(disconnectBrowserLinkedIn()); setLiTransient(null); }
    else setBaseConn({ ...EMPTY_CONNECTION, mode: baseMeta.mode });
    logAudit("LinkedIn disconnected");
    notify("LinkedIn disconnected.");
  };

  /* Portable copy of the team's work — for backups, moving devices, or QA. */
  function exportSession() {
    const data = { app: "unison-content-os", version: 2, exportedAt: new Date().toISOString(), posts, drafts, team, profile, voice, schedule, makeCompany, extras, usage, sentKeys };
    downloadBlob(JSON.stringify(data, null, 2), `unison-session-${todayISO()}.json`, "application/json");
    notify("Session exported.", { tone: "ok" });
  }
  async function importSession(file) {
    try {
      const d = JSON.parse(await file.text());
      if (!d || typeof d !== "object" || (d.app && d.app !== "unison-content-os")) throw new Error("not a Unison export");
      if (Array.isArray(d.posts)) setPosts(d.posts);
      if (Array.isArray(d.drafts)) setDrafts(d.drafts);
      if (Array.isArray(d.team)) setTeam(d.team);
      if (d.profile) setProfile({ ...DEFAULT_PROFILE, ...d.profile });
      if (d.voice) setVoice({ ...DEFAULT_VOICE, ...d.voice });
      if (d.schedule) setSchedule(d.schedule);
      if (d.makeCompany) setMakeCompany(d.makeCompany);
      if (d.extras) setExtras({ ...DEFAULT_EXTRAS, ...d.extras });
      if (Array.isArray(d.sentKeys)) setSentKeys(d.sentKeys);
      logAudit(`Session imported from ${file.name}`);
      notify(`Imported ${(d.posts || []).length} posts and ${(d.drafts || []).length} drafts.`, { tone: "ok" });
    } catch (e) { notify("That file isn't a Unison session export.", { tone: "bad" }); }
  }

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
    setBaseConn({ ...EMPTY_CONNECTION, mode: baseMeta.mode }); setLiTransient(null);
    setProfile(DEFAULT_PROFILE); setVoice(DEFAULT_VOICE); setExtras(DEFAULT_EXTRAS); setMakeCompany({ name: "", urn: "" }); setSentKeys([]);
    setModal(null); notify("Saved session cleared. Your AI key and LinkedIn sign-in were kept.", { tone: "ok" });
  }

  const appProps = {
    idea, stage, steps, research, angles, angle, draft, setDraft, verification, setVerification,
    quality, dupDismissed, setDupDismissed, media, format, formats, fmt, versions, schedule, setSchedule, publishState, attempts, publishError, publishVia,
    assets, patchAssets, mstate, makeImage, makeImageSet, retile, addTile, makeVideo, makeDocument,
    makeCarousel, reslide, moveItem, dropItem, editSlide, editDocPage, makePoll, makeArticle, editArticle,
    ingestDocument, attachUpload, exportVideo,
    analytics, busy, tone, setTone, pov, setPov, length, setLength, showDetail, setShowDetail,
    openClaim, setOpenClaim, linkedin, liMeta, claimsBlocking, checksStale, checksDegraded, recheck, unlock, aiInfo, runWriter, approve, reject, confirmSchedule,
    publishNow, runDiscovery, setDrawer, reset, cancelWork, setFailMode, undoStack, pushUndo, undo,
    publishLimits, publishKind, publishFramed, publishUnverified, getLastPayload: () => lastPayloadRef.current, confirmPublished, workId, posts, relay, profile, notify, extras, publishReady,
    setModal: openModal,
  };

  return (
    <div className="unison" data-t={theme}>
      {bg3d && <CursorField theme={theme} />}

      <Header {...{ view, setView, setDrawer, setModal, notes, linkedin, liMeta, relay, theme, setTheme, navOpen, setNavOpen, openLinkedIn, manageConnection, disconnectLinkedIn, draftCount: drafts.length, profile, openSettings }} />

      {navOpen && (
        <div className="sheet">
          {NAV.map(([id, label]) => (
            <button key={id} onClick={() => { setNavOpen(false); setView(id); }}>{label}{id === "drafts" && drafts.length ? ` (${drafts.length})` : ""}</button>
          ))}
          <button onClick={() => { setNavOpen(false); if (linkedin.viaWorkflow || !linkedin.connected && liMeta.mode !== "browser") openSettings("linkedin"); else openLinkedIn(linkedin.connected ? 1 : 0); }}>
            {linkedin.viaWorkflow ? "LinkedIn · publishing via Make" : linkedin.connected ? `LinkedIn · ${linkedin.org}` : "Connect LinkedIn"}
          </button>
          <button onClick={() => { setNavOpen(false); setModal("voice"); }}>Brand voice</button>
          <button onClick={() => { setNavOpen(false); setTheme(theme === "dark" ? "light" : "dark"); }}>Switch to {theme === "dark" ? "light" : "dark"} theme</button>
          <button onClick={() => { setNavOpen(false); openSettings(); }}>Settings</button>
        </div>
      )}

      {bg3d && <Suspense fallback={null}><PipelineScene theme={theme} level={0.16} /></Suspense>}
      {idea && <MobileRail index={railIndex} stages={fmt.stages} />}
      <div className="wrap">
        <Rail index={railIndex} active={busy} started={!!idea} fmt={fmt} />
        <main>
          {view === "home" && (
            <Dashboard
              posts={posts} linkedin={linkedin} schedule={schedule} setModal={setModal} profile={profile}
              drafts={drafts} activeId={idea ? workId : null}
              onEditDraft={openDraft} onRemoveDraft={removeDraft}
              onDiscover={runOpportunities}
              setView={setView} open={setOpenPost} publish={(p) => openPostInWorkspace(p, { publish: true })}
              aiInfo={aiInfo} publishReady={publishReady} openSettings={openSettings}
              setupHidden={setupHidden} hideSetup={() => setSetupHidden(true)}
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
          {view === "content" && <ContentList posts={posts} open={setOpenPost} publish={(p) => openPostInWorkspace(p, { publish: true })} onCreate={() => setView("home")} />}
          {view === "calendar" && <CalendarView posts={posts} open={setOpenPost} start={(t, iso) => { if (iso) setSchedule((s) => ({ ...s, date: iso })); setSeedIdea(t); setView("home"); }} />}
          {view === "insights" && <Insights posts={posts} analytics={analytics} discover={runOpportunities} openPost={setOpenPost} />}
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
        <Modal wide onClose={() => { setModal(null); setSettingsTab("workspace"); }} title="Settings">
          <Settings {...{ usage, linkedin, liMeta, relay, disconnectLinkedIn, openLinkedIn, setModal, searchOn, setSearchOn, failMode, setFailMode, makeCompany, setMakeCompany, team, setTeam, theme, setTheme, schedule, setSchedule, notes, setNotes, notify, profile, setProfile, wipe, bg3d, setBg3d, initialTab: settingsTab,
            aiSettings, updateAI, aiInfo, refreshAI, liSettings, updateLinkedIn, pubSettings, updatePublish, extras, setExtras, exportSession, importSession, storageIssue, posts,
            sync, syncNow }} />
        </Modal>
      )}
      {modal === "voice" && (
        <Modal wide onClose={() => setModal(null)} title="Brand voice">
          <VoiceStudio voice={voice} setVoice={setVoice} track={track} />
        </Modal>
      )}
      {modal === "linkedin" && (
        <Modal onClose={() => setModal(null)} title={liStart === 1 ? "Switch Company Page" : "Connect LinkedIn"}>
          <LinkedInFlow startAt={liStart} mode={liMeta.mode} connection={conn} scopes={liMeta.scopes} browser={browserLinkedIn}
            openSettings={() => { setSettingsTab("linkedin"); setModal("settings"); }} notify={notify}
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
          <PostDetail post={openPost} linkedin={linkedin} company={profile.company} cancel={cancelScheduled} confirm={confirmPublished} start={(t) => { setOpenPost(null); runDiscovery(t, "text"); }}
            open={(p) => openPostInWorkspace(p)} publish={(p) => openPostInWorkspace(p, { publish: true })} remove={(p) => { setPosts((all) => all.filter((x) => x.id !== p.id)); setOpenPost(null); logAudit(`Removed — ${p.title}`); notify("Post removed."); }}
            saveMetrics={saveMetrics} explain={explainPost} />
        </Modal>
      )}
      <Toasts items={toasts} dismiss={dismissToast} />
    </div>
  );
}
