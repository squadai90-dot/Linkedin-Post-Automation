import { useState } from "react";
import { AI_CONFIG, MODEL_REGISTRY, AI_STATUS, ollamaProvider } from "../lib/ai.js";
import { PUBLISH_RELAY_PATH, MAKE_CONFIG } from "../lib/publish.js";
import { imageProvider, videoProvider } from "../lib/media.js";

/* ---------- settings ---------- */

export const IN_RATE = 3 / 1e6;
export const OUT_RATE = 15 / 1e6;
export const CALL_QUOTA = 60;
export const SEARCH_QUOTA = 25;

export function Settings({ usage, linkedin, liMeta, relay, disconnectLinkedIn, openLinkedIn, setModal, searchOn, setSearchOn, failMode, setFailMode, makeCompany, setMakeCompany, team, setTeam, theme, setTheme, schedule, setSchedule, notes, setNotes, notify, profile, setProfile, wipe, bg3d, setBg3d, initialTab }) {
  const [tab, setTab] = useState(initialTab || "models");
  const [invite, setInvite] = useState({ email: "", role: "Creator" });
  const cost = usage.inTok * IN_RATE + usage.outTok * OUT_RATE;
  return (
    <div>
      <div className="tabs">
        {[["models", "AI & usage"], ["connections", "Connections"], ["workspace", "Workspace"], ["publishing", "Publishing"], ["dev", "Developer"]].map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === "models" && (
        <>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Routing</div><div className="u-muted" style={{ fontSize: 13 }}>Chosen automatically per task. Details under Developer.</div></div>
            <span className="chipflat">{AI_STATUS.local === "reachable" ? "Local models" : "Hosted fallback"}</span>
          </div>
          <div className="quads">
            {[["Calls", usage.calls], ["Searches", usage.searches], ["Input tokens", usage.inTok.toLocaleString()], ["Output tokens", usage.outTok.toLocaleString()]].map(([l, v]) => (
              <div key={l}><span className="eyebrow">{l}</span><b>{v}</b></div>
            ))}
          </div>
          <div style={{ marginTop: 22 }}>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>Session call quota</span><span className="mono">{usage.calls} / {CALL_QUOTA}</span></div>
            <div className="bar"><i style={{ width: `${Math.min(100, (usage.calls / CALL_QUOTA) * 100)}%` }} /></div>
            <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginTop: 14 }}><span>Web search quota</span><span className="mono">{usage.searches} / {SEARCH_QUOTA}</span></div>
            <div className="bar"><i style={{ width: `${Math.min(100, (usage.searches / SEARCH_QUOTA) * 100)}%` }} /></div>
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              Estimated spend: ${cost.toFixed(4)} · {usage.fails} call{usage.fails === 1 ? "" : "s"} fell back to sample data · research is cached per topic, so repeating one is free.
            </div>
          </div>
          <div className="eyebrow" style={{ margin: "26px 0 10px" }}>By engine</div>
          <table className="tbl">
            <thead><tr><th>Engine</th><th>Calls</th><th>In</th><th>Out</th><th>Cost</th></tr></thead>
            <tbody>
              {Object.keys(usage.byEngine).length === 0 && <tr><td colSpan={5} className="u-muted">No calls yet.</td></tr>}
              {Object.entries(usage.byEngine).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td><td className="mono">{v.calls}</td><td className="mono">{v.inTok.toLocaleString()}</td>
                  <td className="mono">{v.outTok.toLocaleString()}</td><td className="mono">${(v.inTok * IN_RATE + v.outTok * OUT_RATE).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === "connections" && (
        <>
          <div className="conn">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 11 }}>
                <span className="li-chip">in</span>
                <div>
                  <div style={{ fontWeight: 600 }}>LinkedIn Company Page</div>
                  <div className="u-muted" style={{ fontSize: 13 }}>
                    {linkedin.viaWorkflow ? `LinkedIn publishing ready via Make · ${MAKE_CONFIG.supportedPostTypes.join(", ")}`
                      : linkedin.connected
                      ? `${linkedin.org}${linkedin.role ? " · " + linkedin.role : ""}${linkedin.expires ? " · access to " + linkedin.expires : ""}`
                      : "Not connected — publishing is blocked"}
                  </div>
                </div>
              </div>
              {linkedin.viaWorkflow ? null
                : linkedin.connected
                ? <button className="btn sm" onClick={disconnectLinkedIn}>Disconnect</button>
                : <button className="btn acc sm" onClick={() => openLinkedIn(0)}>Connect</button>}
            </div>
            <div className="setrow">
              <span className="u-muted">Authorization</span>
              <span className={"state " + (liMeta.mode === "real" || linkedin.viaWorkflow ? "pub" : "rev")}>
                {liMeta.mode === "real" ? "REAL OAUTH" : linkedin.viaWorkflow ? "MAKE WEBHOOK" : liMeta.mode === "misconfigured" ? "MISCONFIGURED" : "PROTOTYPE"}
              </span>
            </div>
            {linkedin.viaWorkflow && (
              <>
                <div className="setrow"><span className="u-muted">Publishing via</span><span>Unison API → LinkedIn workflow → Company Page</span></div>
                <div className="setrow">
                  <span className="u-muted">Publishing service</span>
                  <span>{relay?.relay ? `Connected${relay.webhookConfigured === false ? " · webhook not set on the server" : ""}` : relay?.checked ? "Not reachable from this preview" : "Checking…"}</span>
                </div>
                <div className="setrow"><span className="u-muted">Endpoint</span><span className="mono" style={{ fontSize: 11.5 }}>{PUBLISH_RELAY_PATH}</span></div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600 }}>Company Page details</div>
                  <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>Sent with every post. Make still decides which Page it publishes to.</div>
                  <div className="row">
                    <input className="ta" style={{ flex: 1 }} placeholder="Page name" value={makeCompany.name} onChange={(e) => setMakeCompany({ ...makeCompany, name: e.target.value })} />
                    <input className="ta mono" style={{ flex: 1 }} placeholder="urn:li:organization:…" value={makeCompany.urn} onChange={(e) => setMakeCompany({ ...makeCompany, urn: e.target.value })} />
                  </div>
                </div>
              </>
            )}
            <div className="setrow">
              <span className="u-muted">Unison API</span>
              <span>{liMeta.reachable ? "Reachable" : "Not running"}</span>
            </div>
            {liMeta.apiVersion && (
              <div className="setrow"><span className="u-muted">LinkedIn API version</span><span className="mono">{liMeta.apiVersion}</span></div>
            )}
            {liMeta.scopes?.length > 0 && (
              <div className="u-muted mono" style={{ fontSize: 11.5, marginTop: 8 }}>{liMeta.scopes.join("   ")}</div>
            )}
            {liMeta.mode !== "real" && !linkedin.viaWorkflow && (
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                Real authorization needs the Unison API running with LinkedIn credentials and Community Management API access. See docs/linkedin-integration.md.
              </div>
            )}
          </div>

          <div className="conn">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Web search</div>
                <div className="u-muted" style={{ fontSize: 13 }}>Powers discovery and every source link. {usage.searches} used.</div>
              </div>
              <button className={"toggle " + (searchOn ? "on" : "")} onClick={() => setSearchOn(!searchOn)}><i /></button>
            </div>
          </div>
          <div className="conn">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Typefaces</div>
            <div className="u-muted" style={{ fontSize: 13, marginBottom: 10 }}>Google Fonts. Free, no key, falls back to system faces offline.</div>
            {[["Sora", "Display and headings"], ["Inter Tight", "Interface and body"], ["IBM Plex Mono", "Labels, numbers, identifiers"]].map(([f, use]) => (
              <div className="setrow" key={f}><div><span style={{ fontWeight: 600 }}>{f}</span><div className="u-muted" style={{ fontSize: 12.5 }}>{use}</div></div><span className="chipflat">loaded</span></div>
            ))}
          </div>
          <div className="conn">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Not connected here</div>
            <div className="u-muted" style={{ fontSize: 13 }}>
              No database, object store, job queue or image model. LinkedIn has no free public API for trending content and scraping breaks their terms, so discovery uses public web search instead. Publishing and analytics are simulated in the browser.
            </div>
          </div>
        </>
      )}

      {tab === "workspace" && (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>What discovery watches</div>
          {[["industry", "Industry"], ["audience", "Audience"], ["keywords", "Watch terms"]].map(([k, l]) => (
            <div key={k} style={{ marginBottom: 10 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{l}</div>
              <input className="ta" value={profile[k]} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} />
            </div>
          ))}
          <table className="tbl" style={{ marginTop: 20 }}>
            <thead><tr><th>Member</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {team.map((m, i) => (
                <tr key={m.email}>
                  <td><div style={{ fontWeight: 600 }}>{m.name}</div><div className="u-muted" style={{ fontSize: 12.5 }}>{m.email}</div></td>
                  <td>
                    <select className="ta" style={{ width: 130 }} value={m.role} disabled={m.role === "Owner"}
                      onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                      {["Owner", "Admin", "Creator", "Reviewer"].map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>{m.role !== "Owner" && <button className="btn sm" onClick={() => setTeam(team.filter((_, j) => j !== i))}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="eyebrow" style={{ margin: "22px 0 8px" }}>Invite someone</div>
          <div className="row">
            <input className="ta" style={{ flex: 1, minWidth: 200 }} placeholder="name@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            <select className="ta" style={{ width: 130 }} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              {["Admin", "Creator", "Reviewer"].map((r) => <option key={r}>{r}</option>)}
            </select>
            <button className="btn acc sm" disabled={!invite.email.includes("@")} onClick={() => {
              setTeam([...team, { name: invite.email.split("@")[0], email: invite.email, role: invite.role }]);
              notify(`Invite sent to ${invite.email}.`); setInvite({ email: "", role: "Creator" });
            }}>Send invite</button>
          </div>
          <div className="conn" style={{ marginTop: 22 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>What each role can do</div>
            {[["Owner", "Everything, including billing"], ["Admin", "Settings, connections, team"], ["Creator", "Create and edit, cannot approve"], ["Reviewer", "Approve, reject, schedule"]].map(([r, d]) => (
              <div className="setrow" key={r}><span style={{ fontWeight: 600 }}>{r}</span><span className="u-muted" style={{ fontSize: 13 }}>{d}</span></div>
            ))}
          </div>
        </>
      )}

      {tab === "dev" && (
        <>
          <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
            Nothing on this tab appears in the creation workflow. Users never pick a model.
          </div>
          <div className="conn">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Local model endpoint</div>
                <div className="u-muted" style={{ fontSize: 13 }}>Ollama. Probed once per session.</div>
              </div>
              <span className={"chipflat " + (AI_STATUS.local === "reachable" ? "" : "")}>{AI_STATUS.local}</span>
            </div>
            <input className="ta" style={{ marginTop: 10 }} defaultValue={AI_CONFIG.ollamaEndpoint}
              onChange={(e) => { AI_CONFIG.ollamaEndpoint = e.target.value; ollamaProvider.reset(); }} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={async () => { ollamaProvider.reset(); const ok = await ollamaProvider.available(); notify(ok ? "Local models reachable." : "Local models unreachable — using the hosted fallback."); }}>
                Re-probe
              </button>
              {AI_STATUS.localModels.length > 0 && <span className="u-muted mono" style={{ fontSize: 11.5 }}>{AI_STATUS.localModels.slice(0, 4).join("  ")}</span>}
            </div>
            {AI_STATUS.local === "unreachable" && (
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                Browser sandboxes can't reach localhost. Run this build from your own machine to use the local models.
              </div>
            )}
          </div>

          <div className="eyebrow" style={{ margin: "20px 0 10px" }}>Capability routing</div>
          <table className="tbl">
            <thead><tr><th>Capability</th><th>Intended</th><th>Actually used</th></tr></thead>
            <tbody>
              {Object.entries(MODEL_REGISTRY).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="u-muted">{v.label}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{AI_STATUS.routed[k] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="conn" style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Media providers</div>
            {[["Image", imageProvider], ["Video", videoProvider]].map(([n, pv]) => (
              <div className="setrow" key={n}>
                <div><span style={{ fontWeight: 600 }}>{n}</span><div className="u-muted" style={{ fontSize: 12.5 }}>{pv.label}</div></div>
                <span className="chipflat">{pv.configured ? "provider" : "prototype"}</span>
              </div>
            ))}
            <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              No external image or video model is configured. Assets are rendered locally and labelled as such.
            </div>
          </div>
        </>
      )}

      {tab === "publishing" && (
        <>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Default timezone</div><div className="u-muted" style={{ fontSize: 13 }}>Stored with every scheduled post.</div></div>
            <select className="ta" style={{ width: 180 }} value={schedule.tz} onChange={(e) => setSchedule({ ...schedule, tz: e.target.value })}>
              <option>Asia/Kolkata</option><option>America/New_York</option><option>Europe/London</option><option>Asia/Dubai</option>
            </select>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Retry policy</div><div className="u-muted" style={{ fontSize: 13 }}>Applied to failed publishing jobs.</div></div>
            <span className="chipflat">manual retry only · nothing is resent automatically</span>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Approval required before publishing</div><div className="u-muted" style={{ fontSize: 13 }}>Locked on in the MVP.</div></div>
            <button className="toggle on" disabled><i /></button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Simulate a publishing failure</div><div className="u-muted" style={{ fontSize: 13 }}>The next publish fails before anything is sent to Make. For testing the failure UI.</div></div>
            <button className={"toggle " + (failMode ? "on" : "")} onClick={() => setFailMode(!failMode)}><i /></button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Appearance</div><div className="u-muted" style={{ fontSize: 13 }}>Currently {theme}.</div></div>
            <button className="btn sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>Switch to {theme === "dark" ? "light" : "dark"}</button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Notifications</div><div className="u-muted" style={{ fontSize: 13 }}>{notes.length} unread.</div></div>
            <button className="btn sm" onClick={() => setNotes([])}>Clear all</button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Background 3D</div><div className="u-muted" style={{ fontSize: 13 }}>The scroll-driven pipeline scene. Turn it off on slower machines.</div></div>
            <button className={"toggle " + (bg3d ? "on" : "")} onClick={() => setBg3d(!bg3d)}><i /></button>
          </div>
          <div className="setrow">
            <div><div style={{ fontWeight: 600 }}>Saved session</div><div className="u-muted" style={{ fontSize: 13 }}>Your draft, sources and settings are saved and survive a refresh.</div></div>
            <button className="btn sm" onClick={wipe}>Clear saved data</button>
          </div>
        </>
      )}
    </div>
  );
}
