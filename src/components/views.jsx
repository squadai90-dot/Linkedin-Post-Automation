import { useState } from "react";
import { labelFor } from "../lib/formats.js";
import { segments } from "../lib/text.jsx";
import { svgDataUrl } from "./media.jsx";

/* ============================================================
   SECONDARY VIEWS
   ============================================================ */

export const stateClass = (s) => (s === "PUBLISHED" ? "pub" : s === "HUMAN_REVIEW" ? "rev" : s === "SCHEDULED" || s === "SENT" ? "sch" : s === "FAILED" ? "fail" : "");
export const stateLabel = (s) => (s === "SENT" ? "SENT TO MAKE" : s);

export function ContentList({ posts, open }) {
  const [filter, setFilter] = useState("All");
  const shown = posts.filter((p) => filter === "All" || p.state === filter);
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Content</h2><span className="eyebrow">{shown.length} items</span></div>
      <div className="chips" style={{ marginBottom: 18 }}>
        {["All", "HUMAN_REVIEW", "SCHEDULED", "SENT", "PUBLISHED"].map((s) => (
          <button key={s} className={"chip " + (filter === s ? "on" : "")} onClick={() => setFilter(s)}>{s === "All" ? "All" : s === "SENT" ? "sent to make" : s.replace("_", " ").toLowerCase()}</button>
        ))}
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Post</th><th>State</th><th>Date</th><th></th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.title}<div className="u-muted mono" style={{ fontSize: 11, fontWeight: 400 }}>{p.id}</div></td>
                <td><span className={"state " + stateClass(p.state)}>{stateLabel(p.state)}</span></td>
                <td className="mono" style={{ fontSize: 13 }}>{p.date}</td>
                <td><button className="btn sm" onClick={() => open(p)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CalendarView({ posts, open, start }) {
  const days = [["Mon", "31 Aug", "2026-08-31"], ["Tue", "1 Sep", "2026-09-01"], ["Wed", "2 Sep", "2026-09-02"], ["Thu", "3 Sep", "2026-09-03"], ["Fri", "4 Sep", "2026-09-04"], ["Sat", "5 Sep", "2026-09-05"], ["Sun", "6 Sep", "2026-09-06"]];
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Calendar</h2><span className="eyebrow">Week of 31 August 2026</span></div>
      <div className="cal">
        {days.map(([d, label, iso]) => {
          const items = posts.filter((p) => p.date === iso);
          return (
            <div className="cell" key={iso}>
              <div className="d">{d} · {label}</div>
              {items.map((p) => <button className={"pill " + stateClass(p.state)} key={p.id} onClick={() => open(p)}>{p.title.slice(0, 40)}</button>)}
              {items.length > 1 && <div className="u-muted" style={{ fontSize: 11 }}>Two posts on one day</div>}
              <button className="addslot" onClick={() => start(`A post to publish on ${label}`)}>+ Add</button>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Click any post to open it, or use Add to start a new one for that day.</div>
        <div className="row">{["Draft", "Review", "Approved", "Scheduled", "Published", "Failed"].map((s) => <span key={s} className="state">{s}</span>)}</div>
      </div>
    </div>
  );
}

export function Insights({ posts, analytics, discover }) {
  const top = posts.filter((p) => p.metrics)[0];
  return (
    <div style={{ paddingTop: 44 }}>
      <div className="sec-h"><span className="num">01</span><h2 className="disp">Insights</h2><span className="eyebrow">Last 30 days</span></div>
      <div className="card">
        <span className="eyebrow">Engagement vs previous period</span>
        <div className="disp" style={{ fontSize: 62, marginTop: 10 }}>+24%</div>
        {top && (
          <>
            <div className="eyebrow" style={{ margin: "26px 0 6px" }}>Top post</div>
            <div style={{ fontWeight: 600 }}>{top.title}</div>
            <div className="kpi">{Object.entries(top.metrics).map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{v.toLocaleString()}</b></div>)}</div>
          </>
        )}
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 7 }}>What the learning engine sees</div>
        <div>{analytics?.why?.[0] || "Evidence-led posts are outperforming your average. Treat this as a likely pattern, not a proven cause."}</div>
        <div className="eyebrow" style={{ margin: "16px 0 7px" }}>Next recommendation</div>
        <div>{analytics?.next || "Scan for this week's stories and pick one with an open content gap."}</div>
        <button className="btn acc" style={{ marginTop: 14 }} onClick={discover}>Find this week's opportunities</button>
      </div>
    </div>
  );
}

export function PostDetail({ post, linkedin, cancel, confirm: confirmLive, start }) {
  const [confirm, setConfirm] = useState(false);
  const c = post.content;
  const full = c ? [c.hook, c.body, c.cta].filter(Boolean).join("\n\n") : "";
  const pages = post.pages || null;
  const [pi, setPi] = useState(0);
  const when = post.state === "SCHEDULED" ? `${post.date}${post.time ? ` at ${post.time}` : ""}${post.tz ? ` ${post.tz}` : ""}` : post.date;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span className={"state " + stateClass(post.state)}>{stateLabel(post.state)}</span>
        <span className="u-muted mono" style={{ fontSize: 12 }}>{post.reference ? `${post.reference}` : post.id} · {when}</span>
      </div>
      {post.topic && <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>Topic: {post.topic}{post.formats ? ` · ${labelFor(post.formats)}` : ""}</div>}

      {c ? (
        <div className="paper li" style={{ marginTop: 14 }}>
          <div className="li-top">
            <div className="li-av">A</div>
            <div>
              <div style={{ fontWeight: 700 }}>{linkedin?.connected ? linkedin.org : "Acme Systems"}</div>
              <div className="u-muted" style={{ fontSize: 12.5 }}>{post.state === "SCHEDULED" ? "Scheduled" : post.date} · 🌐</div>
            </div>
          </div>
          <div className="li-body">
            {segments(full, { bold: [0, (c.hook || "").length], hl: null, fold: 0 })}
            {(c.hashtags || []).length > 0 && <div style={{ color: "#3E63DD", marginTop: 10 }}>{c.hashtags.join("  ")}</div>}
          </div>
          {post.upload ? <div className="li-visual"><img src={post.upload} alt="" /></div>
            : post.images?.length > 1 ? <div className={"li-mosaic n" + Math.min(4, post.images.length)}>{post.images.slice(0, 4).map((sv, k) => <img key={k} src={svgDataUrl(sv)} alt="" />)}</div>
            : post.image ? <div className="li-visual"><img src={svgDataUrl(post.image)} alt="" /></div>
            : pages?.length ? (
              <div className="li-visual li-doc">
                <img src={svgDataUrl(pages[Math.min(pi, pages.length - 1)])} alt="" />
                <div className="li-pager">
                  <button onClick={() => setPi(Math.max(0, pi - 1))} disabled={pi === 0}>←</button>
                  <span>{Math.min(pi, pages.length - 1) + 1} / {pages.length}</span>
                  <button onClick={() => setPi(Math.min(pages.length - 1, pi + 1))} disabled={pi >= pages.length - 1}>→</button>
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
            {post.state === "HUMAN_REVIEW" ? "Waiting on a reviewer."
              : "The full text of this post wasn't stored — it was created before Unison kept post content."}
          </div>
        </>
      )}

      {post.metrics && (
        <div className="kpi">{Object.entries(post.metrics).map(([k, v]) => <div key={k}><span className="eyebrow">{k}</span><b>{v.toLocaleString()}</b></div>)}</div>
      )}
      {post.url && <a className="srclink" href={post.url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 14 }}>View on LinkedIn <span className="ext">↗</span></a>}
      {post.viaMake && (
        <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>
          {post.state === "SENT" ? (post.unverified ? "Sent to Make, but delivery couldn't be confirmed from the browser. Check the scenario history." : "Sent to Make — LinkedIn publishing is being processed. Not yet confirmed as published.") : `Published via Make${post.confirmedBy === "manual" ? " (confirmed by you)" : ""}.`}
          {` Sent as ${post.postType}${post.mediaSent ? ` with ${post.mediaSent} media file(s)` : ""}.`}
          {(post.limits || []).map((l, i) => <div key={i} className="badge warn" style={{ marginTop: 8 }}>{l}</div>)}
        </div>
      )}
      {post.simulated && <div className="badge warn" style={{ marginTop: 14 }}>Simulated publish — nothing was sent to LinkedIn</div>}

      <div className="row" style={{ marginTop: 20, flexWrap: "wrap" }}>
        {post.state === "SCHEDULED" && !confirm && <button className="btn" onClick={() => setConfirm(true)}>Cancel scheduled post</button>}
        {post.state === "SCHEDULED" && confirm && (
          <>
            <span className="u-muted" style={{ fontSize: 13.5 }}>It won't be published at {post.time || "the scheduled time"}.</span>
            <button className="btn bad" onClick={() => cancel(post)}>Yes, cancel it</button>
            <button className="btn sm" onClick={() => setConfirm(false)}>Keep it scheduled</button>
          </>
        )}
        {post.state === "SENT" && <button className="btn acc" onClick={() => confirmLive(post, "manual")}>I've checked — it's live on LinkedIn</button>}
        {post.state === "HUMAN_REVIEW" && <button className="btn acc" onClick={() => start(post.title)}>Work on this topic</button>}
        {post.state === "PUBLISHED" && c && <button className="btn sm" onClick={() => navigator.clipboard?.writeText(full + ((c.hashtags || []).length ? "\n\n" + c.hashtags.join(" ") : ""))}>Copy text</button>}
      </div>
    </div>
  );
}
