import { useState, useRef, useMemo, useEffect } from "react";
import { LinkBadge } from "./linkbadge.jsx";
import { FORMAT_BY_ID } from "../lib/formats.js";
import { REJECT_REASONS } from "../lib/seed.js";
import { pad, tierLabel, host, LI_LIMIT, LI_FOLD } from "../lib/util.js";
import { locateClaim, segments } from "../lib/text.jsx";
import { useNarrow } from "../hooks.js";
import { AssetPreview, MediaSection } from "./media.jsx";
import { TIMEZONES, localTimezone, countryForTimezone, isDue, todayISO } from "../lib/dates.js";
import { grammarCheck, applyReplacement, holidayOn } from "../lib/freeApis.js";

/* ============================================================
   WORKSPACE — only the stages the chosen format needs
   ============================================================ */

const LOCKED_STAGES = ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"];
const DONE_STAGES = ["SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"];

/* ---------- grammar (LanguageTool, free) ---------- */
function GrammarPanel({ draft, setDraft, pushUndo, locked, enabled, notify }) {
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checkedFor, setCheckedFor] = useState("");
  const full = `${draft.hook}\n\n${draft.body}\n\n${draft.cta}`;
  const stale = matches && checkedFor !== full;

  const check = async () => {
    setBusy(true);
    try {
      const m = await grammarCheck(full);
      setMatches(m); setCheckedFor(full);
      if (!m.length) notify?.("No grammar or spelling issues found.", { tone: "ok" });
    } catch (e) {
      setMatches(null);
      notify?.(`Grammar check unavailable: ${e.message}`, { tone: "warn" });
    } finally { setBusy(false); }
  };

  /* Map an offset in the combined text back onto hook / body / cta. A match
     that lands on a paragraph break, or straddles two fields, belongs to no
     single field — applying it there would splice text at a negative offset
     and silently mangle the draft, so it is refused instead. */
  const fieldFor = (m) => {
    const bounds = [["hook", 0, draft.hook.length], ["body", draft.hook.length + 2, draft.hook.length + 2 + draft.body.length]];
    bounds.push(["cta", bounds[1][2] + 2, bounds[1][2] + 2 + draft.cta.length]);
    const end = m.offset + m.length;
    const hit = bounds.find(([, start, stop]) => m.offset >= start && end <= stop);
    return hit ? { field: hit[0], base: hit[1] } : null;
  };

  const apply = (m, value) => {
    const at = fieldFor(m);
    if (!at) { notify?.("That suggestion spans a paragraph break — edit it by hand.", { tone: "warn" }); setMatches(matches.filter((x) => x !== m)); return; }
    const { field, base } = at;
    const local = { ...m, offset: m.offset - base };
    pushUndo("grammar fix");
    const next = { ...draft, [field]: applyReplacement(draft[field], local, value) };
    setDraft(next);
    const delta = value.length - m.length;
    const remaining = matches.filter((x) => x !== m).map((x) => (x.offset > m.offset ? { ...x, offset: x.offset + delta } : x));
    setMatches(remaining);
    setCheckedFor(`${next.hook}\n\n${next.body}\n\n${next.cta}`);
  };

  if (!enabled) return null;
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow">Grammar &amp; spelling</span>
        <button className="btn sm" disabled={busy || locked} onClick={check}>{busy ? "Checking…" : matches ? "Check again" : "Check grammar"}</button>
      </div>
      {matches && matches.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {stale && <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 6 }}>The text changed since this check.</div>}
          {matches.slice(0, 8).map((m, i) => (
            <div key={i} className="gram">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13 }}><span className="mono" style={{ background: "rgba(243,180,76,.25)", borderRadius: 3, padding: "0 3px" }}>{m.text || "…"}</span> <span className="u-muted">{m.message}</span></div>
              </div>
              <div className="row" style={{ flex: "none" }}>
                {fieldFor(m) && m.replacements.slice(0, 2).map((r) => <button key={r} className="btn sm" disabled={locked} onClick={() => apply(m, r)}>{r}</button>)}
                <button className="btn sm" onClick={() => setMatches(matches.filter((x) => x !== m))}>Ignore</button>
              </div>
            </div>
          ))}
          {matches.length > 8 && <div className="u-muted" style={{ fontSize: 12.5 }}>{matches.length - 8} more — fix these first.</div>}
        </div>
      )}
      {matches && matches.length === 0 && <div className="u-muted" style={{ fontSize: 12.5, marginTop: 6 }}>Clean — no issues found by LanguageTool.</div>}
    </div>
  );
}

export function Workspace(p) {
  const {
    idea, stage, steps, research, angles, angle, draft, setDraft, verification, setVerification,
    quality, dupDismissed, setDupDismissed, media, format, formats, fmt, versions, schedule, setSchedule,
    publishState, attempts, publishError, publishVia, publishLimits, publishKind, publishFramed, publishUnverified, getLastPayload, confirmPublished, workId, posts, relay, analytics, busy, tone, setTone, pov, setPov, length, setLength,
    showDetail, setShowDetail, openClaim, setOpenClaim, linkedin, liMeta, claimsBlocking, checksStale, checksDegraded, recheck, unlock, aiInfo, runWriter,
    approve, reject, confirmSchedule, publishNow, runDiscovery, setDrawer, setModal, reset, cancelWork,
    setFailMode, undoStack, undo, pushUndo, assets, patchAssets, mstate, makeImage, makeImageSet,
    retile, addTile, makeVideo, makeDocument, makeCarousel, reslide, moveItem, dropItem, editSlide,
    editDocPage, makePoll, makeArticle, editArticle, ingestDocument, attachUpload, exportVideo, profile, notify, extras = {}, publishReady,
  } = p;

  const [rejecting, setRejecting] = useState(false);
  const [tab, setTab] = useState("post");
  const [holiday, setHoliday] = useState(null);
  const narrow = useNarrow(1120);
  const editRef = useRef(null);

  const shows = (s) => fmt.stages.includes(s);
  const n = (s) => fmt.stages.indexOf(s) + 1;
  const locked = LOCKED_STAGES.includes(stage);
  const done = DONE_STAGES.includes(stage);

  const full = draft ? `${draft.hook}\n\n${draft.body}\n\n${draft.cta}` : "";
  const tags = (draft?.hashtags || []).join(" ");
  const publishedLength = full.length + (tags ? tags.length + 2 : 0);
  const activeClaim = openClaim != null ? verification?.claims?.[openClaim] : null;
  const hl = useMemo(() => (activeClaim ? locateClaim(full, activeClaim.claim) : null), [activeClaim, full]);
  const over = shows("draft") && publishedLength > LI_LIMIT;   // never applied to articles or documents

  /* Decided once in App so the button label and the send path agree. */
  const realRoute = !!publishReady;
  const aiDown = aiInfo && !aiInfo.ready;

  useEffect(() => {
    let alive = true;
    setHoliday(null);
    if (extras.holidays === false || !schedule.date) return;
    holidayOn(schedule.date, countryForTimezone(schedule.tz)).then((h) => alive && setHoliday(h)).catch(() => {});
    return () => { alive = false; };
  }, [schedule.date, schedule.tz, extras.holidays]);

  const assetSummary = [
    assets.images.length > 1 ? `${assets.images.length} images` : assets.images.length === 1 ? "1 image" : null,
    assets.video ? (assets.video.url ? "video" : "storyboard") : null,
    assets.doc ? `${assets.doc.pages.length}-page document` : null,
    assets.carousel.length ? `${assets.carousel.length} slides` : null,
    assets.poll ? "poll" : null, assets.article ? "article" : null, assets.upload ? "uploaded file" : null,
  ].filter(Boolean).join(", ");
  const missing = fmt.list.filter((f) => ({
    image: !assets.images.length && !assets.upload, multi: assets.images.length < 2 && !assets.upload, video: !assets.video && !assets.upload,
    document: !assets.doc, carousel: !assets.carousel.length, poll: !assets.poll, article: !assets.article,
  })[f]);
  const videoNotExported = fmt.list.includes("video") && assets.video && !assets.video.url && !assets.upload;

  const mediaProps = {
    format, formats, assets, patchAssets, mstate, makeImage, makeImageSet, retile, addTile, makeVideo,
    makeDocument, makeCarousel, reslide, moveItem, dropItem, editSlide, editDocPage, makePoll,
    makeArticle, editArticle, ingestDocument, attachUpload, exportVideo, locked, extras,
  };

  const evidencePanel = !draft ? null : (
    <div className="paper" style={{ padding: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="eyebrow">Evidence</span>
        <div className="row">
          {(checksStale || checksDegraded) && <button className="btn sm" disabled={busy} onClick={recheck}>{busy ? "Checking…" : "Re-check"}</button>}
          {undoStack.length > 0 && !locked && <button className="btn sm" onClick={undo}>Undo</button>}
        </div>
      </div>
      {!verification && <div className="u-muted" style={{ fontSize: 13 }}><span className="pulse" /> Checking claims…</div>}
      {verification?.degraded && <div className="badge warn" style={{ marginBottom: 10 }}>Not checked — the AI was unavailable{verification.degradedReason ? ` (${verification.degradedReason})` : ""}. These rows are placeholders.</div>}
      {checksStale && !verification?.degraded && <div className="badge warn" style={{ marginBottom: 10 }}>The text changed since these checks ran.</div>}
      {(verification?.claims || []).map((c, i) => (
        <div key={i}>
          <div className={"ev " + (openClaim === i ? "on" : "")} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpenClaim(openClaim === i ? null : i)} onClick={() => setOpenClaim(openClaim === i ? null : i)}>
            <span className={"dot " + c.status[0]} /><span style={{ fontSize: 13.5 }}>{c.claim}</span>
          </div>
          {openClaim === i && (
            <div className="evdetail">
              <div><b>Status</b> {c.status === "green" ? "Supported" : c.status === "yellow" ? "Needs review" : "Unsupported"}</div>
              <div><b>Source</b> {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.source} ↗</a> : c.source || "—"}</div>
              <div><b>Confidence</b> {c.confidence}</div>
              <div style={{ marginTop: 6 }}>{c.note}</div>
              {!locateClaim(full, c.claim) && <div className="u-muted" style={{ marginTop: 6, fontSize: 12.5 }}>Couldn't match this claim to a sentence in the post.</div>}
              {!locked && (
                <div className="row" style={{ marginTop: 11 }}>
                  <button className="btn sm" onClick={() => {
                    pushUndo("mark as reviewed");
                    setVerification({ ...verification, claims: verification.claims.map((x, j) => j === i ? { ...x, status: "yellow", note: (x.note ? x.note + " " : "") + `Reviewed by ${profile?.userName || "a human"} — approved for publishing.`, humanReviewed: true } : x) });
                  }} disabled={c.status !== "red"}>I've checked this — keep it</button>
                  <button className="btn sm" onClick={() => {
                    pushUndo("remove claim");
                    setVerification({ ...verification, claims: verification.claims.filter((_, j) => j !== i) });
                    setOpenClaim(null);
                  }}>Remove claim</button>
                  <button className="btn sm" disabled={busy} onClick={() => runWriter(angle, `Rewrite so this claim is safer: "${c.claim}"`)}>Rewrite claim</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {(verification?.unresolved || []).map((u, i) => <div key={i} className="badge warn" style={{ marginTop: 12 }}>{u}</div>)}
    </div>
  );

  const postPanel = !draft ? null : (
    <div>
      <div className="paper li">
        <div className="li-top">
          <div className="li-av">{String(profile?.company || "U").trim()[0]?.toUpperCase() || "U"}</div>
          <div>
            <div style={{ fontWeight: 700 }}>{(linkedin.connected && linkedin.org) || profile?.company || "Your Company Page"}</div>
            {(linkedin.followers ?? profile?.followers) ? <div className="u-muted" style={{ fontSize: 12.5 }}>{Number(linkedin.followers ?? profile.followers).toLocaleString()} followers</div> : null}
            <div className="u-muted" style={{ fontSize: 12.5 }}>Now · 🌐</div>
          </div>
        </div>
        <div className="li-body">
          {segments(full, { bold: [0, draft.hook.length], hl, fold: LI_FOLD })}
          {(draft.hashtags || []).length > 0 && <div style={{ color: "#3E63DD", marginTop: 10 }}>{draft.hashtags.join("  ")}</div>}
        </div>
        <AssetPreview format={format} formats={formats} assets={assets} media={media} />
        <div className="li-bar"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
      </div>

      <div className="paper" style={{ marginTop: 13, padding: 20 }} ref={editRef}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <span className="eyebrow">{locked ? "Locked after approval" : "Edit"}</span>
          <div className="row">
            {locked && ["APPROVED", "SCHEDULED"].includes(stage) && <button className="btn sm" onClick={unlock}>Unlock to edit</button>}
            {versions.length > 1 && <button className="btn sm" onClick={() => setModal("diff")}>Compare versions</button>}
          </div>
        </div>
        {draft.degraded && <div className="badge warn" style={{ marginBottom: 10 }}>Sample text — the AI didn't respond{draft.degradedReason ? ` (${draft.degradedReason})` : ""}. Rewrite it yourself or fix the AI setup and regenerate.</div>}
        <input className="ta" aria-label="Hook" readOnly={locked} value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} />
        <textarea className="ta" aria-label="Body" style={{ marginTop: 9 }} rows={7} readOnly={locked} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        <input className="ta" aria-label="Call to action" style={{ marginTop: 9 }} readOnly={locked} value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} />
        <input className="ta" aria-label="Hashtags" style={{ marginTop: 9 }} readOnly={locked} placeholder="#hashtags separated by spaces" value={tags}
          onChange={(e) => setDraft({ ...draft, hashtags: e.target.value.split(/\s+/).filter(Boolean).map((h) => (h.startsWith("#") ? h : "#" + h)) })} />
        <div className={"u-muted " + (over ? "over" : "")} style={{ fontSize: 12.5, marginTop: 9 }}>
          {publishedLength.toLocaleString()} / {LI_LIMIT.toLocaleString()} characters including hashtags{over ? " — over LinkedIn's limit" : ""} · the dashed line marks where "see more" cuts it off
        </div>
        <GrammarPanel draft={draft} setDraft={setDraft} pushUndo={pushUndo} locked={locked} enabled={extras.languagetool !== false} notify={notify} />
      </div>
    </div>
  );

  return (
    <div style={{ paddingTop: 34 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="eyebrow">Working on</span>
            {fmt.list.map((f) => <span key={f} className="chipflat">{FORMAT_BY_ID[f].label}</span>)}
            {done && <span className="state sch">{stage === "PUBLISHED" ? "PUBLISHED" : stage === "PUBLISHING" ? (publishState === "SENT" ? "SENT" : "PUBLISHING") : stage}</span>}
          </div>
          <div className="disp" style={{ fontSize: 30, marginTop: 8, maxWidth: 680 }}>{idea}</div>
        </div>
        <div className="row">
          {undoStack.length > 0 && !locked && <button className="btn sm" onClick={undo}>Undo</button>}
          <button className="btn sm" onClick={() => setDrawer("audit")}>Activity</button>
          {!done && <button className="btn sm" onClick={cancelWork} title="Discard this draft">Discard</button>}
          <button className="btn sm" onClick={reset} title={done ? "Start another post" : "Saves this as a draft and starts another"}>New post</button>
        </div>
      </div>

      {aiDown && (
        <div className="notice warn" style={{ marginTop: 16 }}>
          <div><b>AI isn't set up</b> — {aiInfo.summary} Everything generated below is sample data until then.</div>
          <button className="btn sm" onClick={() => setModal("settings", "ai")}>Open AI settings</button>
        </div>
      )}

      {steps.length > 0 && (
        <Section n={n("research")} title="Research" engine="Discovery engine">
          <div className="card">
            {steps.map((s) => (
              <div key={s.key} className={"pstep " + s.status}>
                <span className="tick" style={s.status === "failed" ? { color: "var(--bad)" } : undefined}>{s.status === "done" ? "✓" : s.status === "active" ? <span className="pulse" /> : s.status === "failed" ? "✕" : "○"}</span>{s.label}
              </div>
            ))}
            {!busy && !research && steps.some((s) => s.status === "failed" || s.status === "active") && (
              <button className="btn sm" style={{ marginTop: 10 }} onClick={() => runDiscovery(idea, formats, workId)}>Run research again</button>
            )}
          </div>
          {research && (
            <>
              <div className="card">
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <div className="eyebrow">Sources</div><span className="badge">{research.freshness || "Recent"}</span>
                </div>
                {(research.sources || []).map((s, i) => (
                  <div className="src" key={i}>
                    <span className={"tier t" + (s.tier || 4)}>{s.background ? "Background" : `T${s.tier} · ${tierLabel(s.tier)}`}</span>
                    <div style={{ minWidth: 0 }}>
                      {s.url ? <a className="srclink" href={s.url} target="_blank" rel="noreferrer">{s.title} <span className="ext">↗</span></a> : <div style={{ fontWeight: 600 }}>{s.title}</div>}
                      <div className="u-muted" style={{ fontSize: 13 }}>{s.publisher} · {s.date}{s.uploaded ? " · your upload" : s.url ? ` · ${host(s.url)}` : " · no link available"} <LinkBadge state={s.link} /></div>
                      <div className="u-muted" style={{ fontSize: 13, marginTop: 3 }}>{s.note}</div>
                    </div>
                  </div>
                ))}
                {research.degraded && (
                  <div className="badge warn" style={{ marginTop: 12 }}>
                    {research.degraded === "sample" ? "The engine didn't respond — these are placeholders, not real sources."
                      : research.degraded === "off" ? "Web search is off, so these are recalled rather than retrieved. Verify before publishing."
                      : "Live search didn't return usable results, so these are recalled rather than retrieved. Verify before publishing."}
                  </div>
                )}
              </div>
              <div className="card">
                <div className="eyebrow" style={{ marginBottom: 10 }}>What stood out</div>
                {(research.insights || []).map((x, i) => <div key={i} style={{ padding: "5px 0" }}>— {x}</div>)}
                {(research.risks || []).length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="eyebrow" style={{ marginBottom: 7 }}>Watch out for</div>
                    {research.risks.map((x, i) => <div key={i} className="u-muted" style={{ padding: "3px 0" }}>⚠ {x}</div>)}
                  </div>
                )}
              </div>
            </>
          )}
        </Section>
      )}

      {angles && shows("angle") && (
        <Section n={n("angle")} title="Content angles" engine="Content intelligence">
          <div className="angles">
            {(angles.angles || []).map((a, i) => (
              <button key={i} className={"angle " + (angle?.headline === a.headline ? "sel" : a.recommended ? "rec" : "")} disabled={locked || busy} onClick={() => runWriter(a)} aria-pressed={angle?.headline === a.headline}>
                <div className="eyebrow">{a.recommended ? "Recommended · " : ""}{a.type}</div>
                <h4>{a.headline}</h4>
                <div className="u-muted" style={{ fontSize: 13 }}>{a.rationale}</div>
              </button>
            ))}
          </div>
          {angles.reason && <div className="card tight" style={{ marginTop: 13 }}><span className="eyebrow">Recommended because</span> <span style={{ fontSize: 14 }}>{angles.reason}</span></div>}
          {!draft && busy && <div className="u-muted" style={{ marginTop: 12 }}><span className="pulse" /> Writing…</div>}
        </Section>
      )}

      {draft && shows("draft") && (
        <Section n={n("draft")} title="Content" engine="Brand writer">
          {narrow && (
            <div className="tabs" style={{ marginBottom: 14 }}>
              <button className={tab === "post" ? "on" : ""} onClick={() => setTab("post")}>Post</button>
              <button className={tab === "evidence" ? "on" : ""} onClick={() => setTab("evidence")}>
                Evidence{verification?.claims ? ` (${verification.claims.length})` : ""}
              </button>
              <button className={tab === "controls" ? "on" : ""} onClick={() => setTab("controls")}>Controls</button>
            </div>
          )}
          <div className="editor">
            {(!narrow || tab === "controls") && (
              <div>
                <Control label="Tone" value={tone} setValue={setTone} options={["Confident", "Conversational", "Technical", "Educational", "Opinionated"]} />
                <Control label="Point of view" value={pov} setValue={setPov} options={["Strong opinion", "Balanced", "Educational", "Storytelling"]} />
                <Control label="Length" value={length} setValue={setLength} options={["Short", "Medium", "Long"]} />
                <button className="btn" style={{ width: "100%" }} disabled={busy || locked} onClick={() => runWriter(angle)}>{busy ? "Rewriting…" : "Rewrite text only"}</button>
                <button className="btn sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setModal("voice")}>Brand voice</button>
                <button className="btn sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setDrawer("versions")}>Versions ({versions.length})</button>
              </div>
            )}
            {(!narrow || tab === "post") && postPanel}
            {(!narrow || tab === "evidence") && shows("evidence") && evidencePanel}
          </div>
        </Section>
      )}

      {shows("poll") && draft && (
        <Section n={n("poll")} title="Poll" engine="Writer">
          <MediaSection {...mediaProps} format="poll" />
        </Section>
      )}

      {shows("article") && draft && (
        <Section n={n("article")} title="Article" engine="Writer">
          <MediaSection {...mediaProps} format="article" />
        </Section>
      )}

      {shows("slides") && draft && (
        <Section n={n("slides")} title="Slides" engine="Media engine">
          <MediaSection {...mediaProps} format="carousel" />
        </Section>
      )}

      {shows("media") && draft && format !== "text" && (
        <Section n={n("media")} title="Media" engine="Media engine">
          <MediaSection {...mediaProps} format={format} />
        </Section>
      )}

      {quality && shows("health") && (
        <Section n={n("health")} title="Content health" engine="Trust engine">
          <div className="card">
            {quality.degraded && <div className="badge warn" style={{ marginBottom: 10 }}>Not assessed — the AI was unavailable. These ticks are placeholders.</div>}
            {(quality.checks || []).map((c, i) => (
              <div key={i} className="chk"><span style={{ color: c.pass ? "var(--ok)" : "var(--bad)" }}>{c.pass ? "✓" : "✕"}</span><span>{c.label}</span></div>
            ))}
            <button className="btn sm" style={{ marginTop: 14 }} onClick={() => setShowDetail(!showDetail)}>{showDetail ? "Hide details" : "View details"}</button>
            {showDetail && quality.detail && (
              <div style={{ marginTop: 16 }}>
                {Object.entries(quality.detail).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 11 }}>
                    <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span style={{ textTransform: "capitalize" }}>{k}</span><span className="mono">{v}</span></div>
                    <div className="bar"><i style={{ width: `${v}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {(quality.slop || []).length > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 9 }}>Language to fix</div>
              {quality.slop.map((s, i) => <div key={i} style={{ padding: "3px 0" }}>— {s}</div>)}
              <button className="btn sm" style={{ marginTop: 11 }} disabled={busy || locked} onClick={() => runWriter(angle, `Remove this AI-sounding language: ${quality.slop.join("; ")}`)}>Rewrite more naturally</button>
            </div>
          )}
          {quality.duplicate?.similar && !dupDismissed && (
            <div className="card">
              <div className="badge warn">Similar to a post published {quality.duplicate.days} days ago</div>
              <div className="u-muted" style={{ marginTop: 7, fontSize: 13.5 }}>{quality.duplicate.title}</div>
              <div className="row" style={{ marginTop: 11 }}>
                <button className="btn sm" disabled={busy || locked} onClick={() => runWriter(angle, "Take a clearly different angle from previous posts")}>Create a new angle</button>
                <button className="btn sm" onClick={() => setDupDismissed(true)}>Continue anyway</button>
              </div>
            </div>
          )}
        </Section>
      )}

      {(quality || assets.article || assets.poll || assets.carousel.length > 0) && !["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING", "FAILED"].includes(stage) && (
        <Section n={n("approval")} title="Approval" engine="Human in the loop">
          <div className="card">
            <div className="eyebrow">Content status</div>
            <div style={{ margin: "12px 0 16px" }}>
              {claimsBlocking ? <span className="badge bad">Blocked — an unsupported claim needs fixing</span>
                : over ? <span className="badge bad">Blocked — the post is over LinkedIn's character limit</span>
                : checksDegraded ? <span className="badge warn">Not verified — the AI was unavailable for the checks</span>
                : checksStale ? <span className="badge warn">The text changed since the checks ran</span>
                : <span className="badge">Ready for approval</span>}
            </div>
            <div className="chk"><span style={{ color: checksDegraded ? "var(--warn)" : "var(--ok)" }}>{checksDegraded ? "!" : "✓"}</span> {(verification?.claims || []).length} claims {checksDegraded ? "not checked" : "checked"}</div>
            <div className="chk"><span style={{ color: (research?.sources || []).some((s) => s.tier <= 2 && s.url) ? "var(--ok)" : "var(--warn)" }}>{(research?.sources || []).some((s) => s.tier <= 2 && s.url) ? "✓" : "!"}</span> {(research?.sources || []).filter((s) => s.tier <= 2 && s.url).length} strong sources with links{research?.degraded ? " — research was not retrieved live" : ""}</div>
            <div className="chk"><span style={{ color: "var(--ok)" }}>✓</span> Brand voice applied</div>
            <div className="chk"><span style={{ color: missing.length ? "var(--bad)" : "var(--ok)" }}>{missing.length ? "✕" : "✓"}</span> {fmt.label}{assetSummary ? ` · ${assetSummary}` : ""}{missing.length ? ` — still missing: ${missing.map((f) => FORMAT_BY_ID[f].label.toLowerCase()).join(", ")}` : " ready"}</div>
            {videoNotExported && <div className="badge warn" style={{ marginTop: 12 }}>The video is only a storyboard so far — press Export in the Media step before publishing.</div>}
            {formats.includes("carousel") && <div className="badge warn" style={{ marginTop: 12 }}>Carousel exports as slides — LinkedIn has no organic carousel API.</div>}
            {formats.includes("poll") && (assets.images.length || assets.video || assets.doc || assets.upload) ? <div className="badge warn" style={{ marginTop: 12 }}>LinkedIn shows a poll instead of an attached visual on the same post. Unison keeps both; check how it lands on the Page.</div> : null}
            {!linkedin.connected && (
              <div className="row" style={{ marginTop: 14 }}>
                <span className="badge warn">No Company Page connected</span>
                <button className="btn sm" onClick={() => setModal("linkedin")}>Connect now</button>
              </div>
            )}
            <div className="row" style={{ marginTop: 20 }}>
              <button className="btn" onClick={() => { setTab("post"); editRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>Edit</button>
              {shows("draft") && <button className="btn" disabled={busy} onClick={() => runWriter(angle)}>Regenerate text</button>}
              <button className="btn" onClick={() => setRejecting(!rejecting)}>Reject</button>
              {(checksStale || checksDegraded) ? (
                <>
                  <button className="btn acc" disabled={busy || claimsBlocking || over} onClick={recheck}>{busy ? "Checking…" : "Re-check, then approve"}</button>
                  <button className="btn" disabled={claimsBlocking || over || busy} onClick={() => approve({ force: true })}>Approve anyway</button>
                </>
              ) : (
                <button className="btn acc" disabled={claimsBlocking || over || busy} onClick={() => approve()}>Approve &amp; schedule</button>
              )}
            </div>
            {rejecting && (
              <div style={{ marginTop: 16 }}>
                <div className="eyebrow" style={{ marginBottom: 9 }}>Why is this not right?</div>
                <div className="chips">{REJECT_REASONS.map((r) => <button key={r} className="chip" onClick={() => { setRejecting(false); reject(r); }}>{r}</button>)}</div>
              </div>
            )}
          </div>
        </Section>
      )}

      {["APPROVED", "SCHEDULED", "PUBLISHING", "FAILED"].includes(stage) && (
        <Section n={n("schedule")} title="Schedule" engine="Scheduler">
          <div className="card">
            {!realRoute && stage !== "PUBLISHING" && (
              <div className="notice warn" style={{ marginBottom: 14 }}>
                <div>{linkedin.simulated ? "A sample Page is connected, so publishing is a dry run." : "No publishing route is connected, so publishing is a dry run — nothing leaves this browser."}</div>
                <button className="btn sm" onClick={() => setModal("settings", "linkedin")}>Connect</button>
              </div>
            )}
            {stage === "APPROVED" ? (
              <>
                <div className="row" style={{ gap: 16 }}>
                  <div><div className="eyebrow">Date</div><input className="ta" style={{ width: 170 }} type="date" min={todayISO()} value={schedule.date} onChange={(e) => setSchedule({ ...schedule, date: e.target.value })} /></div>
                  <div><div className="eyebrow">Time</div><input className="ta" style={{ width: 130 }} type="time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} /></div>
                  <div><div className="eyebrow">Timezone</div>
                    <select className="ta" style={{ width: 220 }} value={schedule.tz} onChange={(e) => setSchedule({ ...schedule, tz: e.target.value })}>
                      {!TIMEZONES.includes(schedule.tz) && <option value={schedule.tz}>{schedule.tz}</option>}
                      {TIMEZONES.map((z) => <option key={z} value={z}>{z}{z === localTimezone() ? " (this device)" : ""}</option>)}
                    </select>
                  </div>
                </div>
                {isDue(schedule.date, schedule.time || "09:00", schedule.tz) && <div className="badge warn" style={{ marginTop: 12 }}>That time has already passed.</div>}
                {holiday && <div className="badge warn" style={{ marginTop: 12 }}>{holiday.date} is a public holiday ({holiday.name}) where this timezone is — engagement is usually lower.</div>}
                <div className="card tight" style={{ marginTop: 16 }}>
                  <span className="eyebrow">Tip</span>
                  <div className="u-muted" style={{ fontSize: 13.5, marginTop: 5 }}>Weekday mornings in the audience's timezone tend to do best for B2B Pages. Unison holds the post until you press Publish, or hands it to Make to publish at this time.</div>
                </div>
                {/* Scheduling is local state, so it never needs a connection.
                    Publishing without one is a labelled dry run. */}
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn acc" onClick={confirmSchedule}>Schedule post</button>
                  <button className="btn" onClick={() => publishNow()}>{realRoute ? "Publish now" : "Publish now (dry run)"}</button>
                  {!realRoute && <button className="btn sm" onClick={() => setModal("settings", "linkedin")}>Connect for real</button>}
                </div>
              </>
            ) : (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="mono" style={{ fontSize: 13 }}>{schedule.date} {schedule.time}</div>
                    <div className="u-muted" style={{ fontSize: 13 }}>{schedule.tz}{stage === "SCHEDULED" ? (isDue(schedule.date, schedule.time, schedule.tz) ? " · due now" : " · held in Unison until you publish") : ""}</div>
                  </div>
                  <div className="row">
                    {stage === "SCHEDULED" && <button className="btn acc" onClick={() => publishNow()}>Publish now</button>}
                    {stage === "SCHEDULED" && realRoute && linkedin.viaWorkflow && <button className="btn" onClick={() => publishNow({ scheduled: true })} title="Sends the post to Make now with the date and time, so the scenario publishes it then.">Hand to Make for {schedule.date}</button>}
                    {stage === "PUBLISHING" && publishState !== "SENT" && (
                      <button className="btn acc" disabled><span className="pulse" style={{ marginRight: 8 }} />{publishState === "PREPARING" ? "Preparing…" : "Sending to Make…"}</button>
                    )}
                    {stage === "PUBLISHING" && publishState === "SENT" && <span className="badge">Sent to Make</span>}
                  </div>
                </div>
                {stage === "SCHEDULED" && <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>Nothing runs while Unison is closed. Come back and press Publish now when it's due — it's flagged on Home — or hand it to Make to publish on time.</div>}

                {publishState === "SENT" && (
                  <div className="card tight" style={{ marginTop: 16 }}>
                    <b>Sent to Make — LinkedIn publishing is being processed.</b>
                    <div className="u-muted" style={{ marginTop: 5, fontSize: 13.5 }}>
                      {publishUnverified
                        ? "The post was sent, but this page couldn't read Make's reply, so Unison can't confirm it arrived. Check the scenario history before sending anything again."
                        : "Make has the post. Unison will only mark it Published when that is confirmed — either by Make's reply or by you after checking the Company Page."}
                    </div>
                    {publishLimits.length > 0 && publishLimits.map((l, i) => <div key={i} className="badge warn" style={{ marginTop: 10 }}>{l}</div>)}
                    <div className="row" style={{ marginTop: 12 }}>
                      {(() => { const rec = posts.find((x) => x.workId === workId && x.state === "SENT"); return rec ? <button className="btn sm" onClick={() => confirmPublished(rec, "manual")}>I've checked — it's live on LinkedIn</button> : null; })()}
                    </div>
                  </div>
                )}
                {attempts.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    {attempts.map((a, i) => (
                      <div key={i} className={"pstep " + (a.status === "pending" ? "active" : "done")}>
                        <span className="tick" style={{ color: a.status === "ok" ? "var(--accent)" : a.status === "pending" ? "var(--muted)" : "var(--bad)" }}>{a.status === "ok" ? "✓" : a.status === "pending" ? <span className="pulse" /> : "✕"}</span>{a.label}
                      </div>
                    ))}
                    <div className="u-muted mono" style={{ fontSize: 11.5, marginTop: 8 }}>post id {attempts[0]?.idem}</div>
                  </div>
                )}
                {publishState === "FAILED" && (
                  <div className="card tight" style={{ marginTop: 16, borderColor: "rgba(255,122,102,.45)" }}>
                    <b>{publishKind === "sandbox" ? "Not sent from here." : publishVia === "make" ? "Unable to publish to LinkedIn." : "Publishing failed."}</b>
                    <div className="u-muted" style={{ marginTop: 5 }}>{publishError || "LinkedIn rejected the request."} Your draft and media are safe.</div>
                    {publishLimits.length > 0 && publishLimits.map((l, i) => <div key={i} className="badge warn" style={{ marginTop: 10 }}>{l}</div>)}
                    {publishKind === "sandbox" && (
                      <div className="u-muted" style={{ fontSize: 13, marginTop: 10 }}>
                        {publishFramed
                          ? "Unison is running inside a preview frame that only allows requests to its own host. Nothing reached Make, so no post was created and nothing is duplicated."
                          : "Something on this page or in the browser is blocking outside requests — a content security policy, an extension, or the network."}
                        {" Your draft, media and schedule are saved: reopen this post from Content on the deployed version and press Publish now."}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="btn sm" onClick={() => { setFailMode(false); publishNow(); }}>Retry</button>
                      {publishKind === "sandbox" && (
                        <button className="btn sm" onClick={() => { const pl = getLastPayload(); if (pl) { navigator.clipboard?.writeText(JSON.stringify(pl, null, 2)); notify?.("Payload copied.", { tone: "ok" }); } }}>Copy payload for testing</button>
                      )}
                      {publishKind === "no-video" && <button className="btn sm" onClick={() => { setFailMode(false); unlock(); }}>Back to Media</button>}
                      {publishVia !== "make" && publishVia !== "simulated" && <button className="btn sm" onClick={() => setModal("linkedin")}>Reconnect LinkedIn</button>}
                      <button className="btn sm" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Edit draft</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>
      )}

      {["PUBLISHED", "ANALYZING"].includes(stage) && (
        <Section n={fmt.stages.length} title="Performance" engine="Learning engine">
          <div className="card">
            {publishState === "SIMULATED"
              ? <span className="badge warn">Simulated publish — nothing was sent to LinkedIn</span>
              : <span className="badge">Published to LinkedIn{linkedin.org ? ` · ${linkedin.org}` : ""}</span>}
            {!analytics && (
              <div className="u-muted" style={{ marginTop: 14, fontSize: 13.5 }}>
                {publishState === "SIMULATED" ? "No performance data for a simulated post." : "Performance numbers aren't collected automatically on this route. Open the post under Content and add the figures from LinkedIn analytics — the learning engine will explain them."}
              </div>
            )}
            {analytics && (
              <>
                <div className="disp" style={{ fontSize: 30, margin: "18px 0 4px", maxWidth: 640 }}>{analytics.headline}</div>
                <div className="kpi">{Object.entries(analytics.metrics || {}).map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{Number(v).toLocaleString()}</b></div>)}</div>
                <div style={{ marginTop: 22 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Likely reasons</div>
                  {(analytics.why || []).map((w, i) => <div key={i} style={{ padding: "3px 0" }}>— {w}</div>)}
                </div>
                <div className="card tight" style={{ marginTop: 16 }}>
                  <div className="eyebrow" style={{ marginBottom: 5 }}>What next</div>
                  <div>{analytics.next}</div>
                  <button className="btn acc sm" style={{ marginTop: 12 }} onClick={() => runDiscovery(analytics.next, formats)}>Research this</button>
                </div>
              </>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" onClick={reset}>Start the next post</button>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

export function EmptyWorkspace({ onCreate, drafts = 0, onDrafts }) {
  return (
    <div className="start">
      <div className="eyebrow">Nothing in progress</div>
      <h1 className="disp">No post open.</h1>
      <p className="u-muted" style={{ maxWidth: 460 }}>Start something new, pick a story from Discover{drafts ? `, or continue one of your ${drafts} drafts` : ""}.</p>
      <div className="row">
        <button className="btn acc" onClick={onCreate}>+ Create new content</button>
        {drafts > 0 && <button className="btn" onClick={onDrafts}>Open drafts</button>}
      </div>
    </div>
  );
}

export function Section({ n, title, engine, children }) {
  return (
    <section className="sec">
      <div className="sec-h"><span className="num">{pad(n)}</span><h2 className="disp">{title}</h2><span className="eyebrow">{engine}</span></div>
      {children}
    </section>
  );
}

export function Control({ label, value, setValue, options }) {
  return (
    <div className="ctrl">
      <span className="eyebrow">{label}</span>
      {options.map((o) => <button key={o} className={"opt " + (value === o ? "on" : "")} aria-pressed={value === o} onClick={() => setValue(o)}>{o}</button>)}
    </div>
  );
}
