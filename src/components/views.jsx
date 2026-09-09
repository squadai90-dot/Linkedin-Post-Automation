import { useState, useMemo } from "react";
import { labelFor } from "../lib/formats.js";
import { segments } from "../lib/text.jsx";
import { svgDataUrl } from "./media.jsx";
import { todayISO, monthGrid, weekDays, addDays, fmtMonth, fmtLong, fmtDay, sameMonth, DAY_SHORT, isDue, relativeTime } from "../lib/dates.js";

/* ============================================================
   SECONDARY VIEWS
   ============================================================ */

export const stateClass = (s) => (s === "PUBLISHED" ? "pub" : s === "HUMAN_REVIEW" ? "rev" : s === "SCHEDULED" || s === "SENT" ? "sch" : s === "FAILED" ? "fail" : "");
export const stateLabel = (s) => (s === "SENT" ? "SENT TO MAKE" : s === "HUMAN_REVIEW" ? "IN REVIEW" : s);
export const postDue = (p) => p.state === "SCHEDULED" && isDue(p.date, p.time || "09:00", p.tz || "UTC");

/* Visuals for a post record: the snapshot (current) or the legacy fields. */
export function postVisuals(post) {
  const a = post.snapshot?.assets;
  if (a) {
    const images = (a.images || []).map((x) => x.svg || x.url).filter(Boolean);
    const pages = (a.doc?.pages || []).map((x) => x.svg).filter(Boolean);
    const slides = (a.carousel || []).map((x) => x.svg).filter(Boolean);
    return { upload: post.upload || null, images, image: images[0] || null, pages: pages.length ? pages : slides.length ? slides : null, urls: (a.images || []).filter((x) => x.kind === "url").map((x) => x.url) };
  }
  return { upload: post.upload || null, images: post.images || (post.image ? [post.image] : []), image: post.image || null, pages: post.pages || null, urls: [] };
}

const asImgSrc = (s) => (typeof s === "string" && /^(https?:|data:)/.test(s) ? s : svgDataUrl(s));

export function ContentList({ posts, open, publish, onCreate }) {
  const [filter, setFilter] = useState("All");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = posts.filter((p) => (filter === "All" || p.state === filter) && (!needle || `${p.title} ${p.topic || ""} ${p.id}`.toLowerCase().includes(needle)));
    const key = (p) => String(p.date || "") + String(p.time || "");
    return list.sort((a, b) => (sort === "newest" ? key(b).localeCompare(key(a)) : sort === "oldest" ? key(a).localeCompare(key(b)) : String(a.title).localeCompare(String(b.title))));
  }, [posts, filter, q, sort]);
  const due = posts.filter(postDue);

  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Content</h2><span className="eyebrow">{shown.length} of {posts.length}</span></div>
      {due.length > 0 && (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <div><b>{due.length} scheduled post{due.length > 1 ? "s are" : " is"} due.</b> Nothing publishes while Unison is closed — open one and press Publish now.</div>
          <button className="btn sm acc" onClick={() => publish(due[0])}>Publish "{due[0].title.slice(0, 32)}{due[0].title.length > 32 ? "…" : ""}"</button>
        </div>
      )}
      <div className="row" style={{ marginBottom: 14, justifyContent: "space-between" }}>
        <div className="chips" style={{ marginTop: 0 }}>
          {["All", "HUMAN_REVIEW", "SCHEDULED", "SENT", "PUBLISHED"].map((s) => (
            <button key={s} className={"chip " + (filter === s ? "on" : "")} onClick={() => setFilter(s)}>{s === "All" ? "All" : s === "SENT" ? "Sent to Make" : s === "HUMAN_REVIEW" ? "In review" : s.charAt(0) + s.slice(1).toLowerCase()}</button>
          ))}
        </div>
        <div className="row">
          <input className="ta" style={{ width: 200 }} placeholder="Search posts…" aria-label="Search posts" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="ta" style={{ width: 130 }} aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="title">Title</option></select>
        </div>
      </div>
      <div className="card">
        {shown.length === 0 ? (
          <div className="u-muted" style={{ fontSize: 13.5 }}>
            {posts.length === 0 ? <>Nothing here yet. <button className="btn sm acc" style={{ marginLeft: 8 }} onClick={onCreate}>Create the first post</button></> : "No posts match."}
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Post</th><th>State</th><th>Date</th><th></th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>
                      {p.title}
                      <div className="u-muted" style={{ fontSize: 11.5, fontWeight: 400 }}>{p.formats ? labelFor(p.formats) : ""}{p.sample ? " · sample" : ""}{p.simulated ? " · simulated" : ""}{p.submittedBy ? ` · ${p.submittedBy}` : ""}</div>
                    </td>
                    <td><span className={"state " + stateClass(p.state)}>{postDue(p) ? "DUE NOW" : stateLabel(p.state)}</span></td>
                    <td className="mono" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{p.date}{p.time && p.state === "SCHEDULED" ? ` ${p.time}` : ""}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {postDue(p) && <button className="btn sm acc" style={{ marginRight: 6 }} onClick={() => publish(p)}>Publish now</button>}
                      <button className="btn sm" onClick={() => open(p)}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function CalendarView({ posts, open, start }) {
  const [cursor, setCursor] = useState(todayISO());
  const [mode, setMode] = useState("month");
  const today = todayISO();
  const byDay = useMemo(() => { const m = {}; posts.forEach((p) => { if (p.date) (m[p.date] = m[p.date] || []).push(p); }); return m; }, [posts]);
  const rows = mode === "month" ? monthGrid(cursor) : [weekDays(cursor)];
  const step = (n) => setCursor(mode === "month" ? (() => { const d = new Date(cursor.slice(0, 4), Number(cursor.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })() : addDays(cursor, 7 * n));

  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h">
        <span className="num">01</span><h2 className="disp">Calendar</h2>
        <div className="row" style={{ marginLeft: "auto" }}>
          <button className="btn sm" onClick={() => step(-1)} aria-label="Previous">←</button>
          <span className="eyebrow" style={{ minWidth: 150, textAlign: "center" }}>{mode === "month" ? fmtMonth(cursor) : `Week of ${fmtDay(rows[0][0])}`}</span>
          <button className="btn sm" onClick={() => step(1)} aria-label="Next">→</button>
          <button className="btn sm" onClick={() => setCursor(today)}>Today</button>
          <button className="btn sm" onClick={() => setMode(mode === "month" ? "week" : "month")}>{mode === "month" ? "Week view" : "Month view"}</button>
        </div>
      </div>
      <div className="cal-head">{DAY_SHORT.map((d) => <div key={d} className="eyebrow">{d}</div>)}</div>
      {rows.map((week, wi) => (
        <div className={"cal " + (mode === "week" ? "week" : "")} key={wi}>
          {week.map((iso) => {
            const items = byDay[iso] || [];
            const dim = mode === "month" && !sameMonth(iso, cursor);
            const past = iso < today;
            return (
              <div className={"cell " + (iso === today ? "today " : "") + (dim ? "dim " : "")} key={iso}>
                <div className="d">{mode === "week" ? fmtDay(iso) : Number(iso.slice(8, 10))}{iso === today ? " · today" : ""}</div>
                {items.map((p) => <button className={"pill " + stateClass(p.state)} key={p.id} onClick={() => open(p)} title={p.title}>{postDue(p) ? "⚠ " : ""}{p.title.slice(0, 40)}</button>)}
                {items.length > 1 && <div className="u-muted" style={{ fontSize: 11 }}>{items.length} posts on one day</div>}
                {!past && <button className="addslot" onClick={() => start(`A post to publish on ${fmtLong(iso)}`, iso)}>+ Add</button>}
              </div>
            );
          })}
        </div>
      ))}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="eyebrow">Click a post to open it, or Add to start one for that day.</div>
          <div className="row">{[["In review", "rev"], ["Scheduled / sent", "sch"], ["Published", "pub"], ["Failed", "fail"]].map(([s, c]) => <span key={s} className={"state " + c}>{s}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

export function Insights({ posts, analytics, discover, openPost }) {
  const withMetrics = posts.filter((p) => p.metrics && Object.values(p.metrics).some((v) => Number(v) > 0));
  const real = withMetrics.filter((p) => !p.sample);
  const sum = (k) => withMetrics.reduce((a, p) => a + (Number(p.metrics[k]) || 0), 0);
  const top = [...withMetrics].sort((a, b) => (Number(b.metrics.impressions) || 0) - (Number(a.metrics.impressions) || 0))[0];
  const published = posts.filter((p) => p.state === "PUBLISHED").length;
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Insights</h2><span className="eyebrow">{withMetrics.length} post{withMetrics.length === 1 ? "" : "s"} with numbers</span></div>
      <div className="card">
        {withMetrics.length === 0 ? (
          <>
            <div style={{ fontWeight: 600 }}>No performance numbers yet.</div>
            <div className="u-muted" style={{ fontSize: 13.5, marginTop: 6, maxWidth: 560 }}>LinkedIn Page analytics aren't pulled automatically on the Make route. Open a published post under Content and add impressions, reactions, comments, shares and clicks — the numbers show up here and the learning engine can explain them.</div>
          </>
        ) : (
          <>
            {real.length === 0 && <div className="badge warn" style={{ marginBottom: 12 }}>Sample data — these numbers came with the demo, not from your Page.</div>}
            <div className="kpi" style={{ marginTop: 0, borderTop: 0 }}>
              {[["published", published], ["impressions", sum("impressions")], ["reactions", sum("reactions")], ["comments", sum("comments")], ["clicks", sum("clicks")]].map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{Number(v).toLocaleString()}</b></div>)}
            </div>
            {top && (
              <>
                <div className="eyebrow" style={{ margin: "26px 0 6px" }}>Top post</div>
                <button className="dash-row" onClick={() => openPost?.(top)}><span className="dot g" /><span style={{ minWidth: 0 }}>{top.title}</span><span className="mono u-muted">{Number(top.metrics.impressions || 0).toLocaleString()} impr.</span></button>
              </>
            )}
          </>
        )}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 7 }}>What the learning engine sees</div>
        <div>{analytics?.why?.[0] || (withMetrics.length ? "Open a post with numbers and press Explain to get likely reasons." : "Add performance numbers to a published post to get an explanation.")}</div>
        <div className="eyebrow" style={{ margin: "16px 0 7px" }}>Next recommendation</div>
        <div>{analytics?.next || "Scan for this week's stories and pick one with an open content gap."}</div>
        <button className="btn acc" style={{ marginTop: 14 }} onClick={discover}>Find this week's opportunities</button>
      </div>
    </div>
  );
}

const METRIC_KEYS = ["impressions", "reactions", "comments", "shares", "clicks"];

export function PostDetail({ post, linkedin, company, cancel, confirm: confirmLive, start, open, publish, remove, saveMetrics, explain }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editingMetrics, setEditingMetrics] = useState(false);
  const [m, setM] = useState(() => Object.fromEntries(METRIC_KEYS.map((k) => [k, post.metrics?.[k] ?? ""])));
  const c = post.content || post.snapshot?.draft;
  const full = c ? [c.hook, c.body, c.cta].filter(Boolean).join("\n\n") : "";
  const v = postVisuals(post);
  const [pi, setPi] = useState(0);
  const due = postDue(post);
  const when = post.state === "SCHEDULED" ? `${fmtLong(post.date)}${post.time ? ` at ${post.time}` : ""}${post.tz ? ` ${post.tz}` : ""}` : post.date;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span className={"state " + stateClass(post.state)}>{due ? "DUE NOW" : stateLabel(post.state)}</span>
        <span className="u-muted mono" style={{ fontSize: 12 }}>{post.reference ? `${post.reference}` : post.id} · {when}</span>
      </div>
      {(post.topic || post.formats) && <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>{post.topic ? `Topic: ${post.topic}` : ""}{post.formats ? ` · ${labelFor(post.formats)}` : ""}{post.submittedBy ? ` · by ${post.submittedBy}` : ""}</div>}
      {post.sample && <div className="badge warn" style={{ marginTop: 12 }}>Sample post that came with the demo — remove it when you're done exploring.</div>}

      {c ? (
        <div className="paper li" style={{ marginTop: 14 }}>
          <div className="li-top">
            <div className="li-av">{String((linkedin?.connected && linkedin.org) || company || "U").trim()[0]?.toUpperCase()}</div>
            <div>
              <div style={{ fontWeight: 700 }}>{(linkedin?.connected && linkedin.org) || company || "Your Company Page"}</div>
              <div className="u-muted" style={{ fontSize: 12.5 }}>{post.state === "SCHEDULED" ? "Scheduled" : post.date} · 🌐</div>
            </div>
          </div>
          <div className="li-body">
            {segments(full, { bold: [0, (c.hook || "").length], hl: null, fold: 0 })}
            {(c.hashtags || []).length > 0 && <div style={{ color: "#3E63DD", marginTop: 10 }}>{c.hashtags.join("  ")}</div>}
          </div>
          {v.upload ? <div className="li-visual"><img src={v.upload} alt="" /></div>
            : v.images.length > 1 ? <div className={"li-mosaic n" + Math.min(4, v.images.length)}>{v.images.slice(0, 4).map((sv, k) => <img key={k} src={asImgSrc(sv)} alt="" />)}</div>
            : v.image ? <div className="li-visual"><img src={asImgSrc(v.image)} alt="" /></div>
            : v.pages?.length ? (
              <div className="li-visual li-doc">
                <img src={asImgSrc(v.pages[Math.min(pi, v.pages.length - 1)])} alt="" />
                <div className="li-pager">
                  <button onClick={() => setPi(Math.max(0, pi - 1))} disabled={pi === 0} aria-label="Previous page">←</button>
                  <span>{Math.min(pi, v.pages.length - 1) + 1} / {v.pages.length}</span>
                  <button onClick={() => setPi(Math.min(v.pages.length - 1, pi + 1))} disabled={pi >= v.pages.length - 1} aria-label="Next page">→</button>
                </div>
              </div>
            ) : null}
          {post.poll && (
            <div className="li-poll">
              <div style={{ fontWeight: 600, marginBottom: 10 }}>{post.poll.question}</div>
              {(post.poll.options || []).filter(Boolean).map((o, k) => <div className="li-opt" key={k}>{o}</div>)}
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>{post.poll.duration}</div>
            </div>
          )}
          <div className="li-bar"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
        </div>
      ) : (
        <>
          <div className="disp" style={{ fontSize: 26, margin: "14px 0 6px" }}>{post.title}</div>
          <div className="u-muted" style={{ marginTop: 10, fontSize: 13.5 }}>
            {post.state === "HUMAN_REVIEW" ? "Waiting on a reviewer. There is no text stored for this item — work on the topic to write it." : "The full text of this post wasn't stored."}
          </div>
        </>
      )}

      {post.metrics && !editingMetrics && (
        <div className="kpi">{METRIC_KEYS.filter((k) => post.metrics[k] != null && post.metrics[k] !== "").map((k) => <div key={k}><span className="eyebrow">{k}</span><b>{Number(post.metrics[k]).toLocaleString()}</b></div>)}</div>
      )}
      {editingMetrics && (
        <div className="card tight" style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Numbers from LinkedIn analytics</div>
          <div className="row">
            {METRIC_KEYS.map((k) => <div key={k}><div className="eyebrow" style={{ marginBottom: 4 }}>{k}</div><input className="ta" style={{ width: 110 }} inputMode="numeric" value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value.replace(/[^\d]/g, "") })} /></div>)}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn acc sm" onClick={() => { saveMetrics(post, Object.fromEntries(METRIC_KEYS.map((k) => [k, Number(m[k]) || 0]))); setEditingMetrics(false); }}>Save</button>
            <button className="btn sm" onClick={() => setEditingMetrics(false)}>Cancel</button>
          </div>
        </div>
      )}
      {post.analytics && !editingMetrics && (
        <div className="card tight" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 600 }}>{post.analytics.headline}</div>
          {(post.analytics.why || []).map((w, i) => <div key={i} className="u-muted" style={{ fontSize: 13, marginTop: 4 }}>— {w}</div>)}
          {post.analytics.next && <div style={{ marginTop: 8, fontSize: 13.5 }}><span className="eyebrow">Next</span> {post.analytics.next}</div>}
        </div>
      )}
      {post.url && <a className="srclink" href={post.url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 14 }}>View on LinkedIn <span className="ext">↗</span></a>}
      {post.viaMake && (
        <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>
          {post.state === "SENT" ? (post.unverified ? "Sent to Make, but delivery couldn't be confirmed from the browser. Check the scenario history." : post.scheduledHandoff ? `Handed to Make to publish on ${post.date}${post.time ? " at " + post.time : ""}. Not yet confirmed as published.` : "Sent to Make — LinkedIn publishing is being processed. Not yet confirmed as published.") : `Published via Make${post.confirmedBy === "manual" ? " (confirmed by you)" : ""}.`}
          {` Sent as ${post.postType}${post.mediaSent ? ` with ${post.mediaSent} media file(s)` : ""}.`}
          {(post.limits || []).map((l, i) => <div key={i} className="badge warn" style={{ marginTop: 8 }}>{l}</div>)}
        </div>
      )}
      {post.simulated && <div className="badge warn" style={{ marginTop: 14 }}>Simulated publish — nothing was sent to LinkedIn</div>}
      {post.mediaDropped && <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>Rendered media for this post was dropped to free up browser storage.</div>}

      <div className="row" style={{ marginTop: 20, flexWrap: "wrap" }}>
        {post.state === "SCHEDULED" && <button className={"btn " + (due ? "acc" : "")} onClick={() => publish(post)}>Publish now</button>}
        {(post.state === "SCHEDULED" || post.state === "SENT" || post.state === "PUBLISHED") && post.snapshot && <button className="btn" onClick={() => open(post)}>Open in workspace</button>}
        {post.state === "SCHEDULED" && !confirmCancel && <button className="btn" onClick={() => setConfirmCancel(true)}>Cancel schedule</button>}
        {post.state === "SCHEDULED" && confirmCancel && (
          <>
            <span className="u-muted" style={{ fontSize: 13.5 }}>It goes back to Drafts, approved.</span>
            <button className="btn bad" onClick={() => cancel(post)}>Yes, cancel it</button>
            <button className="btn sm" onClick={() => setConfirmCancel(false)}>Keep it scheduled</button>
          </>
        )}
        {post.state === "SENT" && <button className="btn acc" onClick={() => confirmLive(post, "manual")}>I've checked — it's live on LinkedIn</button>}
        {post.state === "HUMAN_REVIEW" && <button className="btn acc" onClick={() => start(post.title)}>Work on this topic</button>}
        {post.state === "PUBLISHED" && !post.simulated && !editingMetrics && <button className="btn sm" onClick={() => setEditingMetrics(true)}>{post.metrics ? "Edit numbers" : "Add performance numbers"}</button>}
        {post.state === "PUBLISHED" && post.metrics && !post.simulated && explain && <button className="btn sm" onClick={() => explain(post)}>{post.analytics ? "Explain again" : "Explain performance"}</button>}
        {post.state === "PUBLISHED" && c && <button className="btn sm" onClick={() => navigator.clipboard?.writeText(full + ((c.hashtags || []).length ? "\n\n" + c.hashtags.join(" ") : ""))}>Copy text</button>}
        {remove && (post.sample || post.state === "HUMAN_REVIEW" || post.simulated || post.state === "PUBLISHED") && (confirmRemove
          ? <><button className="btn bad sm" onClick={() => remove(post)}>Yes, remove</button><button className="btn sm" onClick={() => setConfirmRemove(false)}>Keep</button></>
          : <button className="btn sm" onClick={() => setConfirmRemove(true)}>Remove</button>)}
      </div>
      {post.savedAt && <div className="u-muted" style={{ fontSize: 11.5, marginTop: 12 }}>Updated {relativeTime(post.savedAt)}</div>}
    </div>
  );
}
