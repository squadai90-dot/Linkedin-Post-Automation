import { useState, useEffect, useRef } from "react";
import { MAKE_CONFIG } from "../lib/publish.js";
import { FORMAT_BY_ID, STAGE_LABEL } from "../lib/formats.js";
import { NAV, navKey } from "../lib/seed.js";
import { pad } from "../lib/util.js";
import { Mark } from "./ambient.jsx";

/* ============================================================
   CHROME — header, LinkedIn chip, account menu, progress rails
   Breakpoints (see styles.css): ≥1180 everything; ≤1180 Brand voice moves
   into the account menu; ≤940 the nav collapses into the menu button;
   ≤700 the LinkedIn chip shrinks to its dot; ≤440 the theme toggle moves
   into the account menu. Settings always has a visible control.
   ============================================================ */

export const initialsOf = (name) => { const parts = String(name || "").trim().split(/\s+/).filter(Boolean); return parts.length ? (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase() : "U"; };

/* Close on outside click or Escape. */
function usePopover(open, setOpen) {
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open, setOpen]);
  return wrap;
}

export function Header({ view, setView, setDrawer, setModal, notes, linkedin, liMeta, relay, theme, setTheme, navOpen, setNavOpen, openLinkedIn, manageConnection, disconnectLinkedIn, draftCount = 0, profile = {}, openSettings }) {
  const [liOpen, setLiOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const goSettings = (tab) => (openSettings ? openSettings(tab) : setModal("settings"));
  return (
    <header className="hdr">
      <div className="hdr-in">
        <button className="mark" onClick={() => setView("home")} aria-label="Unison home"><Mark /><span>Unison</span></button>
        <nav className="nav" aria-label="Main">
          {NAV.map(([v, label]) => (
            <button key={v} className={navKey(view) === v ? "on" : ""} aria-current={navKey(view) === v ? "page" : undefined} onClick={() => setView(v)}>
              {label}{v === "drafts" && draftCount > 0 && <span className="navcount">{draftCount}</span>}
            </button>
          ))}
        </nav>
        <div className="hdr-right">
          <span className="hide-xs"><ThemeToggle theme={theme} setTheme={setTheme} /></span>
          <button className="btn sm hide-md" onClick={() => setModal("voice")}>Brand voice</button>

          <LinkedInChip
            linkedin={linkedin} liMeta={liMeta} relay={relay} open={liOpen} setOpen={setLiOpen}
            openLinkedIn={openLinkedIn} manageConnection={manageConnection} disconnectLinkedIn={disconnectLinkedIn} openSettings={goSettings}
          />

          <button className="bell" onClick={() => setDrawer("notes")} aria-label={`Notifications${notes.length ? `, ${notes.length} unread` : ""}`}><span aria-hidden="true">◔</span>{notes.length ? <b>{notes.length}</b> : null}</button>
          <button className="bell hide-xs" onClick={() => goSettings()} aria-label="Settings" title="Settings"><span aria-hidden="true">⚙</span></button>
          <AccountMenu profile={profile} open={meOpen} setOpen={setMeOpen} theme={theme} setTheme={setTheme} setModal={setModal} openSettings={goSettings} />
          <button className="burger" onClick={() => setNavOpen(!navOpen)} aria-label="Menu" aria-expanded={navOpen}>≡</button>
        </div>
      </div>
    </header>
  );
}

function AccountMenu({ profile, open, setOpen, theme, setTheme, setModal, openSettings }) {
  const wrap = usePopover(open, setOpen);
  return (
    <div className="pop-wrap" ref={wrap}>
      <button className="avatar" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={profile.userName || "Account"}>{initialsOf(profile.userName)}</button>
      {open && (
        <div className="pop" role="menu" style={{ width: 240 }}>
          <div style={{ fontWeight: 600 }}>{profile.userName || "Not signed in"}</div>
          <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{profile.company || "No company set"}{profile.userEmail ? ` · ${profile.userEmail}` : ""}</div>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); setTheme(theme === "dark" ? "light" : "dark"); }}>Switch to {theme === "dark" ? "light" : "dark"} theme</button>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); setModal("voice"); }}>Brand voice</button>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); openSettings("workspace"); }}>{profile.userName ? "Your name and company" : "Add your name"}</button>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); openSettings(); }}>Settings</button>
        </div>
      )}
    </div>
  );
}

/* The chip is the LinkedIn context, not a shortcut into Settings. Clicking
   it opens a compact popover with the one or two actions that make sense
   for the current state. */
export function LinkedInChip({ linkedin, liMeta, relay, open, setOpen, openLinkedIn, manageConnection, disconnectLinkedIn, openSettings }) {
  const wrap = usePopover(open, setOpen);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (!open) setConfirm(false); }, [open]);

  const st = linkedin.status;
  const browser = liMeta.mode === "browser";
  const tone = linkedin.viaWorkflow ? "g" : st === "connected" ? "g" : st === "simulated" || st === "authorized" || st === "connecting" ? "y" : linkedin.needsAttention ? "r" : "";
  const label = linkedin.viaWorkflow ? "Publishing via Make"
    : st === "connected" ? linkedin.org
    : st === "simulated" ? `${linkedin.org} · sample`
    : st === "authorized" ? "Choose a Page"
    : st === "connecting" ? "Connecting…"
    : linkedin.needsAttention ? "Reconnect LinkedIn"
    : "Connect LinkedIn";
  const headline = { connected: "Connected", simulated: "Sample Page (dry run)", workflow: "Publishing via Make", authorized: "Signed in — no Page chosen",
    expired: "Access expired", revoked: "Access revoked", error: "Connection error", connecting: "Connecting…", disconnected: "Not connected" }[st] || "Not connected";

  return (
    <div className="pop-wrap" ref={wrap}>
      <button className={"btn sm chip-li " + (linkedin.connected ? "" : "acc")} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog" aria-label={`LinkedIn: ${label}`} title={label}>
        <span className={"dot " + tone} /><span className="chip-text">{label}</span><span className="chip-in" aria-hidden="true">in</span><span className="caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="pop" role="dialog" aria-label="LinkedIn connection">
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
              <div className="pop-row"><span className="u-muted">Publishing</span><span style={{ fontWeight: 600 }}>{relay?.relay ? "✓ Via publishing service" : relay?.checked ? "✓ Direct to Make" : "Checking…"}</span></div>
              <div className="pop-row"><span className="u-muted">Post types</span><span style={{ textAlign: "right" }}>{MAKE_CONFIG.supportedPostTypes.map((t) => FORMAT_BY_ID[t]?.label || t).join(", ")}</span></div>
              <div className="u-muted" style={{ fontSize: 13, marginTop: 12 }}>
                The Make scenario owns the LinkedIn connection, so nothing needs signing in here. Sign in anyway to attach your name and pick the Page.
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn sm acc" onClick={() => { setOpen(false); openSettings("linkedin"); }}>Sign in with LinkedIn</button>
                <button className="btn sm" onClick={() => { setOpen(false); manageConnection(); }}>Manage</button>
              </div>
            </>
          ) : linkedin.connected ? (
            <>
              <div className="pop-row"><span className="u-muted">Company Page</span><span style={{ fontWeight: 600 }}>{linkedin.org}</span></div>
              {linkedin.profile?.name && <div className="pop-row"><span className="u-muted">Signed in as</span><span>{linkedin.profile.name}</span></div>}
              {linkedin.followers != null && <div className="pop-row"><span className="u-muted">Followers</span><span>{Number(linkedin.followers).toLocaleString()}</span></div>}
              <div className="pop-row"><span className="u-muted">Publishing</span><span>{st === "simulated" ? "Simulated" : linkedin.canPublish ? "✓ Available" : "Not available"}</span></div>
              {linkedin.expires && <div className="pop-row"><span className="u-muted">Access</span><span>Until {linkedin.expires}</span></div>}
              {confirm ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 600 }}>Disconnect LinkedIn?</div>
                  <div className="u-muted" style={{ fontSize: 13, marginTop: 4 }}>Unison will no longer publish to this Page.</div>
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
                    <button className="btn sm bad" onClick={() => { setConfirm(false); setOpen(false); disconnectLinkedIn(); }}>Disconnect</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="row" style={{ marginTop: 14 }}>
                    <button className="btn sm" onClick={() => { setOpen(false); manageConnection(); }}>Manage</button>
                    <button className="btn sm" onClick={() => { setOpen(false); openLinkedIn(1); }}>Switch Page</button>
                  </div>
                  <button className="btn sm" style={{ width: "100%", marginTop: 8 }} onClick={() => setConfirm(true)}>Disconnect</button>
                </>
              )}
            </>
          ) : linkedin.needsAttention ? (
            <>
              <div className="u-muted" style={{ fontSize: 13.5 }}>{linkedin.error || "The LinkedIn connection needs attention. Please reconnect."}</div>
              <button className="btn acc sm" style={{ width: "100%", marginTop: 14 }} onClick={() => { setOpen(false); openLinkedIn(0); }}>Reconnect LinkedIn</button>
            </>
          ) : (
            <>
              <div className="u-muted" style={{ fontSize: 13.5 }}>
                {browser ? "Sign in to LinkedIn to attach your identity and choose the Company Page." : "Connect a Company Page to publish from Unison. Until then, publishing is a dry run."}
              </div>
              <button className="btn acc sm" style={{ width: "100%", marginTop: 14 }} onClick={() => { setOpen(false); openLinkedIn(st === "authorized" ? 1 : 0); }}>
                {st === "authorized" ? "Choose a Page" : browser ? "Sign in with LinkedIn" : "Connect LinkedIn"}
              </button>
              {!browser && <button className="btn sm" style={{ width: "100%", marginTop: 8 }} onClick={() => { setOpen(false); openSettings("linkedin"); }}>Set up sign-in or Make</button>}
            </>
          )}

          <div className="u-muted" style={{ fontSize: 11.5, marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            {liMeta.mode === "real" ? `Server-side LinkedIn authorization${liMeta.apiVersion ? " · API " + liMeta.apiVersion : ""}`
              : browser ? `Browser sign-in${liMeta.bridge ? " with token bridge" : " (no token bridge)"} · publishing goes through Make.`
              : linkedin.viaWorkflow ? "Publishing via Make → LinkedIn. Unison never holds a LinkedIn credential on this route."
              : "Nothing is configured — publishing is simulated until Make or LinkedIn sign-in is set up."}
          </div>
        </div>
      )}
    </div>
  );
}

export function ThemeToggle({ theme, setTheme }) {
  return (
    <button className={"tt " + (theme === "light" ? "on" : "")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} role="switch" aria-checked={theme === "light"}>
      <span className="tt-i" aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span>
    </button>
  );
}

export function Rail({ index, active, started, fmt }) {
  const stages = fmt.stages;
  const pct = started ? ((index + 0.5) / stages.length) * 100 : 0;
  return (
    <div className="rail" aria-label="Progress">
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
