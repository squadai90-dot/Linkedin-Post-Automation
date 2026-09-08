import { useState, useEffect, useRef } from "react";
import { MAKE_CONFIG } from "../lib/publish.js";
import { FORMAT_BY_ID, STAGE_LABEL } from "../lib/formats.js";
import { NAV, navKey } from "../lib/seed.js";
import { pad } from "../lib/util.js";
import { Mark } from "./ambient.jsx";

/* ============================================================
   CHROME
   ============================================================ */

export function Header({ view, setView, setDrawer, setModal, notes, linkedin, liMeta, relay, theme, setTheme, navOpen, setNavOpen, openLinkedIn, manageConnection, disconnectLinkedIn, draftCount = 0 }) {
  const [liOpen, setLiOpen] = useState(false);
  return (
    <header className="hdr">
      <div className="hdr-in">
        <button className="mark" onClick={() => setView("home")}><Mark />Unison</button>
        <nav className="nav">
          {NAV.map(([v, label]) => (
            <button key={v} className={navKey(view) === v ? "on" : ""} onClick={() => setView(v)}>
              {label}{v === "drafts" && draftCount > 0 && <span className="navcount">{draftCount}</span>}
            </button>
          ))}
        </nav>
        <div className="hdr-right">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button className="btn sm hide-sm" onClick={() => setModal("voice")}>Brand voice</button>

          <LinkedInChip
            linkedin={linkedin} liMeta={liMeta} relay={relay} open={liOpen} setOpen={setLiOpen}
            openLinkedIn={openLinkedIn} manageConnection={manageConnection} disconnectLinkedIn={disconnectLinkedIn}
          />

          <button className="bell" onClick={() => setDrawer("notes")} aria-label="Notifications"><span>◔</span>{notes.length ? <b>{notes.length}</b> : null}</button>
          <button className="btn sm hide-sm" onClick={() => setModal("settings")}>Settings</button>
          <div className="avatar">JA</div>
          <button className="burger" onClick={() => setNavOpen(!navOpen)} aria-label="Menu">≡</button>
        </div>
      </div>
    </header>
  );
}

/* The company chip is the LinkedIn context, not a shortcut into Settings.
   Clicking it opens a compact popover; the full connection flow and the
   detailed configuration still live where they always did. */
export function LinkedInChip({ linkedin, liMeta, relay, open, setOpen, openLinkedIn, manageConnection, disconnectLinkedIn }) {
  const wrap = useRef(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) { setOpen(false); setConfirm(false); } };
    const esc = (e) => e.key === "Escape" && (setOpen(false), setConfirm(false));
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open, setOpen]);

  const st = linkedin.status;
  const tone = st === "connected" ? "g" : st === "simulated" ? "y" : linkedin.needsAttention ? "r" : "r";
  const label = linkedin.viaWorkflow ? (relay?.relay ? "LinkedIn publishing ready" : "LinkedIn · preview") : linkedin.connected ? linkedin.org : st === "authorized" ? "Choose a Page" : "Connect LinkedIn";
  const headline = { connected: "Connected", simulated: "Prototype connection", workflow: "Publishing connected", authorized: "Authorized — no Page chosen",
    expired: "Needs attention", revoked: "Access revoked", error: "Connection error", connecting: "Connecting…",
    disconnected: "Not connected" }[st] || "Not connected";

  return (
    <div className="pop-wrap" ref={wrap}>
      <button className={"btn sm chip-li " + (linkedin.connected ? "" : "acc")} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={"dot " + tone} />{label}<span className="caret">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="pop">
          <div className="row" style={{ gap: 10, marginBottom: 12 }}>
            <span className="li-chip">in</span>
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow">LinkedIn</div>
              <div style={{ fontWeight: 600 }}>{headline}</div>
            </div>
            <span className={"dot " + tone} style={{ marginLeft: "auto" }} />
          </div>

          {linkedin.viaWorkflow ? (
            <>
              <div className="pop-row"><span className="u-muted">Publishing</span><span style={{ fontWeight: 600 }}>{relay?.relay ? "✓ Ready" : relay?.checked ? "Preview — not connected here" : "Checking…"}</span></div>
              <div className="pop-row"><span className="u-muted">Post types</span><span>{MAKE_CONFIG.supportedPostTypes.map((t) => FORMAT_BY_ID[t]?.label || t).join(", ")}</span></div>
              <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>
                {relay?.relay
                  ? "Your Company Page is authorised inside the LinkedIn workflow, so there's nothing to set up here."
                  : "This preview can't reach the publishing service. Everything else works — posts you create here are saved and can be published from the deployed version."}
              </div>
            </>
          ) : linkedin.connected ? (
            <>
              <div className="pop-row"><span className="u-muted">Company Page</span><span style={{ fontWeight: 600 }}>{linkedin.org}</span></div>
              {linkedin.followers != null && <div className="pop-row"><span className="u-muted">Followers</span><span>{Number(linkedin.followers).toLocaleString()}</span></div>}
              <div className="pop-row"><span className="u-muted">Publishing access</span><span>{linkedin.canPublish ? "✓ Available" : "Not available"}</span></div>
              {linkedin.expires && <div className="pop-row"><span className="u-muted">Access</span><span>Active until {linkedin.expires}</span></div>}
              {confirm ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 600 }}>Disconnect LinkedIn?</div>
                  <div className="u-muted" style={{ fontSize: 13, marginTop: 4 }}>
                    Unison will no longer be able to publish to this Page.
                  </div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
                    <button className="btn sm" onClick={() => { setConfirm(false); setOpen(false); disconnectLinkedIn(); }}>Disconnect</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="row" style={{ marginTop: 14 }}>
                    <button className="btn sm" onClick={() => { setOpen(false); manageConnection(); }}>Manage connection</button>
                    <button className="btn sm" onClick={() => { setOpen(false); openLinkedIn(1); }}>Switch Page</button>
                  </div>
                  <button className="btn sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setConfirm(true)}>Disconnect</button>
                </>
              )}
            </>
          ) : linkedin.needsAttention ? (
            <>
              <div className="u-muted" style={{ fontSize: 13.5 }}>
                {linkedin.error || "The LinkedIn connection needs attention. Please reconnect."}
              </div>
              <button className="btn acc sm" style={{ width: "100%", marginTop: 14 }} onClick={() => { setOpen(false); openLinkedIn(0); }}>Reconnect LinkedIn</button>
            </>
          ) : (
            <>
              <div className="u-muted" style={{ fontSize: 13.5 }}>
                Connect your LinkedIn Page to publish content directly from Unison.
              </div>
              <button className="btn acc sm" style={{ width: "100%", marginTop: 14 }} onClick={() => { setOpen(false); openLinkedIn(st === "authorized" ? 1 : 0); }}>
                {st === "authorized" ? "Choose a Page" : "Connect LinkedIn"}
              </button>
            </>
          )}

          <div className="u-muted" style={{ fontSize: 11.5, marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            {liMeta.mode === "real"
              ? `Real LinkedIn authorization${liMeta.apiVersion ? " · API " + liMeta.apiVersion : ""}`
              : linkedin.viaWorkflow ? "Publishing via Make → LinkedIn. Unison never holds a LinkedIn credential on this route."
              : "Prototype connection — publishing is simulated until real LinkedIn authorization is configured."}
          </div>
        </div>
      )}
    </div>
  );
}

export function ThemeToggle({ theme, setTheme }) {
  return (
    <button className={"tt " + (theme === "light" ? "on" : "")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
      <span className="tt-i">{theme === "dark" ? "☾" : "☀"}</span>
    </button>
  );
}

export function Rail({ index, active, started, fmt }) {
  const stages = fmt.stages;
  const pct = started ? ((index + 0.5) / stages.length) * 100 : 0;
  return (
    <div className="rail">
      <div className="eyebrow" style={{ marginBottom: 16 }}>{fmt.label}</div>
      <div className="rail-line">
        <div className="rail-fill" style={{ height: `calc(${pct}% - 12px)` }} />
        {stages.map((k, i) => (
          <div key={k} className={"rstep " + (i < index ? "done" : i === index && started ? "on" : "")}>
            <div className="rdot" />
            <div className="rl"><span className="rn">{pad(i + 1)}</span>{STAGE_LABEL[k]}</div>
            <div className="re">{i === index && active ? "running" : ""}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MobileRail({ index, stages }) {
  const list = stages || FORMAT_BY_ID.text.stages;
  return (
    <div className="mrail"><div className="mrail-in">
      {list.map((k, i) => <div key={k} className={"mdot " + (i < index ? "done" : i === index ? "on" : "")} title={STAGE_LABEL[k]} />)}
      <span className="eyebrow" style={{ marginLeft: 10 }}>{STAGE_LABEL[list[Math.min(index, list.length - 1)]]}</span>
    </div></div>
  );
}
