import { useState, useRef, useMemo } from "react";
import { FORMAT_BY_ID } from "../lib/formats.js";
import { REJECT_REASONS } from "../lib/seed.js";
import { pad, tierLabel, host, LI_LIMIT, LI_FOLD } from "../lib/util.js";
import { locateClaim, segments } from "../lib/text.jsx";
import { useNarrow } from "../hooks.js";
import { AssetPreview, MediaSection } from "./media.jsx";

/* ============================================================
   WORKSPACE — only the stages the chosen format needs
   ============================================================ */

export function Workspace(p) {
  const {
    idea, stage, steps, research, angles, angle, draft, setDraft, verification, setVerification,
    quality, dupDismissed, setDupDismissed, media, format, formats, fmt, versions, schedule, setSchedule,
    publishState, attempts, publishError, publishVia, publishLimits, publishKind, publishFramed, publishUnverified, sendAnyway, getLastPayload, confirmPublished, workId, posts, relay, analytics, busy, tone, setTone, pov, setPov, length, setLength,
    showDetail, setShowDetail, openClaim, setOpenClaim, linkedin, claimsBlocking, runWriter,
    approve, reject, confirmSchedule, publishNow, runDiscovery, setDrawer, setModal, reset, cancelWork,
    setFailMode, undoStack, undo, pushUndo, assets, patchAssets, mstate, makeImage, makeImageSet,
    retile, addTile, makeVideo, makeDocument, makeCarousel, reslide, moveItem, dropItem, editSlide,
    editDocPage, makePoll, makeArticle, editArticle, ingestDocument, attachUpload, exportVideo,
  } = p;

  const [rejecting, setRejecting] = useState(false);
  const [tab, setTab] = useState("post");
  const narrow = useNarrow(1120);
  const editRef = useRef(null);

  const shows = (s) => fmt.stages.includes(s);
  const n = (s) => fmt.stages.indexOf(s) + 1;

  const full = draft ? `${draft.hook}\n\n${draft.body}\n\n${draft.cta}` : "";
  const activeClaim = openClaim != null ? verification?.claims?.[openClaim] : null;
  const hl = useMemo(() => (activeClaim ? locateClaim(full, activeClaim.claim) : null), [activeClaim, full]);
  const over = shows("draft") && full.length > LI_LIMIT;   // never applied to articles or documents

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

  const mediaProps = {
    format, formats, assets, patchAssets, mstate, makeImage, makeImageSet, retile, addTile, makeVideo,
    makeDocument, makeCarousel, reslide, moveItem, dropItem, editSlide, editDocPage, makePoll,
    makeArticle, editArticle, ingestDocument, attachUpload, exportVideo,
  };

  const evidencePanel = !draft ? null : (
    <div className="paper" style={{ padding: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="eyebrow">Evidence</span>
        {undoStack.length > 0 && <button className="btn sm" onClick={undo}>Undo</button>}
      </div>
      {!verification && <div className="u-muted" style={{ fontSize: 13 }}>Checking claims…</div>}
      {(verification?.claims || []).map((c, i) => (
        <div key={i}>
          <div className={"ev " + (openClaim === i ? "on" : "")} onClick={() => setOpenClaim(openClaim === i ? null : i)}>
            <span className={"dot " + c.status[0]} /><span style={{ fontSize: 13.5 }}>{c.claim}</span>
          </div>
          {openClaim === i && (
            <div className="evdetail">
              <div><b>Status</b> {c.status === "green" ? "Supported" : c.status === "yellow" ? "Needs review" : "Unsupported"}</div>
              <div><b>Source</b> {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.source} ↗</a> : c.source}</div>
              <div><b>Confidence</b> {c.confidence}</div>
              <div style={{ marginTop: 6 }}>{c.note}</div>
              {!locateClaim(full, c.claim) && <div className="u-muted" style={{ marginTop: 6, fontSize: 12.5 }}>Couldn't match this claim to a sentence in the post.</div>}
              <div className="row" style={{ marginTop: 11 }}>
                <button className="btn sm" onClick={() => {
                  pushUndo("replace source");
                  const src = research?.sources?.[0];
                  setVerification({ ...verification, claims: verification.claims.map((x, j) => j === i ? { ...x, status: "green", source: src?.publisher || "Company newsroom", url: src?.url || "", confidence: "High", note: "Source replaced with the highest-tier source available." } : x) });
                }}>Replace source</button>
                <button className="btn sm" onClick={() => {
                  pushUndo("remove claim");
                  setVerification({ ...verification, claims: verification.claims.filter((_, j) => j !== i) });
                  setOpenClaim(null);
                }}>Remove claim</button>
                <button className="btn sm" onClick={() => runWriter(angle, `Rewrite so this claim is safer: "${c.claim}"`)}>Rewrite claim</button>
              </div>
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
          <div className="li-av">A</div>
          <div>
            <div style={{ fontWeight: 700 }}>{linkedin.connected ? linkedin.org : "Acme Systems"}</div>
            <div className="u-muted" style={{ fontSize: 12.5 }}>12,480 followers</div>
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
          <span className="eyebrow">Edit</span>
          {versions.length > 1 && <button className="btn sm" onClick={() => setModal("diff")}>Compare versions</button>}
        </div>
        <input className="ta" value={draft.hook} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} />
        <textarea className="ta" style={{ marginTop: 9 }} rows={7} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        <input className="ta" style={{ marginTop: 9 }} value={draft.cta} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} />
        <div className={"u-muted " + (over ? "over" : "")} style={{ fontSize: 12.5, marginTop: 9 }}>
          {full.length.toLocaleString()} / {LI_LIMIT.toLocaleString()} characters{over ? " — over LinkedIn's limit" : ""} · the dashed line marks where "see more" cuts it off
        </div>
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
          </div>
          <div className="disp" style={{ fontSize: 30, marginTop: 8, maxWidth: 680 }}>{idea}</div>
        </div>
        <div className="row">
          {undoStack.length > 0 && <button className="btn sm" onClick={undo}>Undo</button>}
          <button className="btn sm" onClick={() => setDrawer("audit")}>Activity</button>
          {!["SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"].includes(stage) && (
            <button className="btn sm" onClick={cancelWork} title="Discard this draft">Cancel</button>
          )}
          <button className="btn sm" onClick={reset} title={["SCHEDULED", "PUBLISHING", "PUBLISHED", "ANALYZING"].includes(stage) ? "Start another post" : "Saves this as a draft and starts another"}>New post</button>
        </div>
      </div>

      {steps.length > 0 && (
        <Section n={n("research")} title="Research" engine="Discovery engine">
          <div className="card">
            {steps.map((s) => (
              <div key={s.key} className={"pstep " + s.status}>
                <span className="tick">{s.status === "done" ? "✓" : s.status === "active" ? <span className="pulse" /> : "○"}</span>{s.label}
              </div>
            ))}
          </div>
          {research && (
            <>
              <div className="card">
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <div className="eyebrow">Sources</div><span className="badge">{research.freshness || "Recent"}</span>
                </div>
                {(research.sources || []).map((s, i) => (
                  <div className="src" key={i}>
                    <span className={"tier t" + (s.tier || 4)}>T{s.tier} · {tierLabel(s.tier)}</span>
                    <div style={{ minWidth: 0 }}>
                      {s.url ? <a className="srclink" href={s.url} target="_blank" rel="noreferrer">{s.title} <span className="ext">↗</span></a> : <div style={{ fontWeight: 600 }}>{s.title}</div>}
                      <div className="u-muted" style={{ fontSize: 13 }}>{s.publisher} · {s.date}{s.uploaded ? " · your upload" : s.url ? ` · ${host(s.url)}` : " · no link available"}</div>
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
              <button key={i} className={"angle " + (angle?.headline === a.headline ? "sel" : a.recommended ? "rec" : "")} onClick={() => runWriter(a)}>
                <div className="eyebrow">{a.recommended ? "Recommended · " : ""}{a.type}</div>
                <h4>{a.headline}</h4>
                <div className="u-muted" style={{ fontSize: 13 }}>{a.rationale}</div>
              </button>
            ))}
          </div>
          {angles.reason && <div className="card tight" style={{ marginTop: 13 }}><span className="eyebrow">Recommended because</span> <span style={{ fontSize: 14 }}>{angles.reason}</span></div>}
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
                <button className="btn" style={{ width: "100%" }} disabled={busy} onClick={() => runWriter(angle)}>{busy ? "Rewriting…" : "Rewrite text only"}</button>
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
              <button className="btn sm" style={{ marginTop: 11 }} onClick={() => runWriter(angle, `Remove this AI-sounding language: ${quality.slop.join("; ")}`)}>Rewrite more naturally</button>
            </div>
          )}
          {quality.duplicate?.similar && !dupDismissed && (
            <div className="card">
              <div className="badge warn">Similar to a post published {quality.duplicate.days} days ago</div>
              <div className="u-muted" style={{ marginTop: 7, fontSize: 13.5 }}>{quality.duplicate.title}</div>
              <div className="row" style={{ marginTop: 11 }}>
                <button className="btn sm" onClick={() => runWriter(angle, "Take a clearly different angle from previous posts")}>Create a new angle</button>
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
                : <span className="badge">Ready for approval</span>}
            </div>
            <div className="chk"><span style={{ color: "var(--ok)" }}>✓</span> {(verification?.claims || []).length} claims checked</div>
            <div className="chk"><span style={{ color: "var(--ok)" }}>✓</span> {(research?.sources || []).filter((s) => s.tier <= 2).length} strong sources</div>
            <div className="chk"><span style={{ color: "var(--ok)" }}>✓</span> Brand voice applied</div>
            <div className="chk"><span style={{ color: missing.length ? "var(--bad)" : "var(--ok)" }}>{missing.length ? "✕" : "✓"}</span> {fmt.label}{assetSummary ? ` · ${assetSummary}` : ""}{missing.length ? ` — still missing: ${missing.map((f) => FORMAT_BY_ID[f].label.toLowerCase()).join(", ")}` : " ready"}</div>
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
              <button className="btn acc" disabled={claimsBlocking || over || busy} onClick={approve}>Approve &amp; schedule</button>
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
            {stage === "APPROVED" ? (
              <>
                <div className="row" style={{ gap: 16 }}>
                  <div><div className="eyebrow">Date</div><input className="ta" style={{ width: 170 }} type="date" value={schedule.date} onChange={(e) => setSchedule({ ...schedule, date: e.target.value })} /></div>
                  <div><div className="eyebrow">Time</div><input className="ta" style={{ width: 130 }} type="time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value })} /></div>
                  <div><div className="eyebrow">Timezone</div>
                    <select className="ta" style={{ width: 180 }} value={schedule.tz} onChange={(e) => setSchedule({ ...schedule, tz: e.target.value })}>
                      <option>Asia/Kolkata</option><option>America/New_York</option><option>Europe/London</option><option>Asia/Dubai</option>
                    </select>
                  </div>
                </div>
                <div className="card tight" style={{ marginTop: 16 }}>
                  <span className="eyebrow">Recommended · Tuesday 9:30 AM</span>
                  <div className="u-muted" style={{ fontSize: 13.5, marginTop: 5 }}>Your Page has historically seen more early-week engagement. You can override this.</div>
                </div>
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn acc" disabled={!linkedin.connected} onClick={confirmSchedule}>Schedule post</button>
                  {!linkedin.connected && <button className="btn sm" onClick={() => setModal("linkedin")}>Connect a Page first</button>}
                </div>
              </>
            ) : (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="mono" style={{ fontSize: 13 }}>{schedule.date} {schedule.time}</div>
                    <div className="u-muted" style={{ fontSize: 13 }}>{schedule.tz} · queued as a publishing job</div>
                  </div>
                  {stage === "SCHEDULED" && <button className="btn acc" onClick={publishNow}>Publish now</button>}
                  {stage === "PUBLISHING" && publishState !== "SENT" && (
                    <button className="btn acc" disabled><span className="pulse" style={{ marginRight: 8 }} />{publishState === "PREPARING" ? "Preparing…" : "Sending to Make…"}</button>
                  )}
                  {stage === "PUBLISHING" && publishState === "SENT" && <span className="badge">Sent to Make</span>}
                </div>

                {publishState === "SENT" && (
                  <div className="card tight" style={{ marginTop: 16 }}>
                    <b>Sent to Make — LinkedIn publishing is being processed.</b>
                    <div className="u-muted" style={{ marginTop: 5, fontSize: 13.5 }}>
                      {publishUnverified
                        ? "The post was sent, but this page can't read Make's reply, so Unison can't confirm it arrived. Check the scenario history before sending anything again."
                        : "Make has the post and is passing it to LinkedIn. Unison will only mark it Published when that is confirmed — either by Make's reply or by you after checking the Company Page."}
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
                    <div className="u-muted mono" style={{ fontSize: 11.5, marginTop: 8 }}>idempotency key {attempts[0]?.idem}</div>
                  </div>
                )}
                {publishState === "FAILED" && (
                  <div className="card tight" style={{ marginTop: 16, borderColor: "rgba(255,122,102,.45)" }}>
                    <b>{publishKind === "sandbox" ? "Not sent from this preview." : publishVia === "make" ? "Unable to publish to LinkedIn." : "Publishing failed."}</b>
                    <div className="u-muted" style={{ marginTop: 5 }}>{publishError || "LinkedIn rejected the request."} Your draft and media are safe.</div>
                    {publishLimits.length > 0 && publishLimits.map((l, i) => <div key={i} className="badge warn" style={{ marginTop: 10 }}>{l}</div>)}
                    {publishKind === "sandbox" && (
                      <div className="u-muted" style={{ fontSize: 13, marginTop: 10 }}>
                        {publishFramed
                          ? "Unison is running inside a preview frame that only allows requests to its own host, and no publishing service is deployed behind it. Nothing reached Make, so no post was created and nothing is duplicated."
                          : "Something on this page or in the browser is blocking outside requests — a content security policy, an extension, or the network."}
                        {" Your draft, media and schedule are saved: reopen this post from Drafts on the deployed version and press Publish now."}
                      </div>
                    )}
                    <div className="row" style={{ marginTop: 12 }}>
                      {publishKind === "cors" ? (
                        <>
                          <button className="btn acc sm" onClick={sendAnyway} title="Sends this post once. The reply can't be read, so delivery is confirmed in Make, not here.">Send without confirmation</button>
                          <button className="btn sm" onClick={() => { setFailMode(false); publishNow(); }}>Retry</button>
                        </>
                      ) : (
                        <button className="btn sm" onClick={() => { setFailMode(false); publishNow(); }}>Retry</button>
                      )}
                      {publishKind === "sandbox" && (
                        <button className="btn sm" onClick={() => { const pl = getLastPayload(); if (pl) navigator.clipboard?.writeText(JSON.stringify(pl, null, 2)); }}>Copy payload for testing</button>
                      )}
                      {publishVia !== "make" && <button className="btn sm" onClick={() => setModal("linkedin")}>Reconnect LinkedIn</button>}
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
            {publishVia === "make" && !analytics && (
              <div className="u-muted" style={{ marginTop: 14, fontSize: 13.5 }}>Performance figures aren't collected through the Make route. Check the post on your Company Page.</div>
            )}
            {publishVia !== "make" && !analytics && <div className="u-muted" style={{ marginTop: 14 }}><span className="pulse" /> Collecting analytics from LinkedIn…</div>}
            {analytics && (
              <>
                <div className="disp" style={{ fontSize: 30, margin: "18px 0 4px", maxWidth: 640 }}>{analytics.headline}</div>
                <div className="kpi">{Object.entries(analytics.metrics).map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{v.toLocaleString()}</b></div>)}</div>
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
      {options.map((o) => <button key={o} className={"opt " + (value === o ? "on" : "")} onClick={() => setValue(o)}>{o}</button>)}
    </div>
  );
}
