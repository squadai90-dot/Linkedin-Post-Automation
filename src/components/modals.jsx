import { useState, useEffect, useMemo, useRef } from "react";
import { diffWords } from "../lib/text.jsx";
import { linkedinService } from "../lib/linkedin.js";
import { isLinkedInConfigured, isBridgeConfigured } from "../lib/linkedinAuth.js";

/* ============================================================
   MODALS
   ============================================================ */

export function Modal({ title, children, onClose, wide }) {
  const box = useRef(null);
  /* Callers pass a fresh arrow for onClose on every render. Reading it
     through a ref keeps the setup effect at [] — otherwise it re-runs on
     each keystroke and pulls focus out of whatever field is being typed in. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const k = (e) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", k);
    /* lock the page behind the dialog and put focus inside it — once */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = box.current?.querySelector("input, select, textarea, button:not(.modal-close)");
    (first || box.current)?.focus?.({ preventScroll: true });
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={"modal " + (wide ? "wide" : "")} role="dialog" aria-modal="true" aria-label={title} ref={box} tabIndex={-1}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
          <div className="disp" style={{ fontSize: 25 }}>{title}</div>
          <button className="btn sm modal-close" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </>
  );
}

export function DiffView({ versions }) {
  const [a, setA] = useState(Math.max(0, versions.length - 2));
  const [b, setB] = useState(versions.length - 1);
  const va = versions[a]?.snapshot, vb = versions[b]?.snapshot;
  const parts = useMemo(() => (va && vb ? diffWords(`${va.hook}\n\n${va.body}\n\n${va.cta}`, `${vb.hook}\n\n${vb.body}\n\n${vb.cta}`) : []), [va, vb]);
  const changed = parts.filter((p) => p.t !== "same").length;
  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <select className="ta" style={{ width: 190 }} value={a} onChange={(e) => setA(+e.target.value)}>
          {versions.map((v, i) => <option key={i} value={i}>Version {v.n} — {v.label}</option>)}
        </select>
        <span className="u-muted">compared with</span>
        <select className="ta" style={{ width: 190 }} value={b} onChange={(e) => setB(+e.target.value)}>
          {versions.map((v, i) => <option key={i} value={i}>Version {v.n} — {v.label}</option>)}
        </select>
      </div>
      <div className="u-muted" style={{ fontSize: 13, marginBottom: 12 }}>{changed} word{changed === 1 ? "" : "s"} changed.</div>
      <div className="diff">
        {parts.map((p, i) => <span key={i} className={p.t}>{p.w}</span>)}
      </div>
    </div>
  );
}

/* Prototype-only Pages. Real and browser modes never render these. */
export const PROTOTYPE_ORGS = [
  { urn: "urn:li:organization:2841193", name: "Sample Company Page", role: "ADMINISTRATOR", followers: 12480, canPublish: true },
  { urn: "urn:li:organization:9920117", name: "Sample Labs", role: "CONTENT_ADMIN", followers: 3204, canPublish: true },
  { urn: "urn:li:organization:5510882", name: "Sample Ventures", role: "ANALYST", followers: 890, canPublish: false },
];

const SCOPE_TEXT = [
  ["Publish to your Page", "Create organic posts on Pages you administer"],
  ["Read your Page content", "Show published posts and their performance"],
  ["See which Pages you manage", "List the Pages you can choose from"],
  ["Know who you are", "Your name and email, so posts are signed"],
];

/* One component, three truths: a real server-side OAuth handoff, the browser
   sign-in (consent on LinkedIn, token via a bridge or pasted), and a clearly
   labelled prototype path when neither is configured. */
export function LinkedInFlow({ onDone, startAt = 0, mode, connection, scopes, browser, openSettings, notify }) {
  const real = mode === "real";
  const inBrowser = mode === "browser";
  const authorized = connection?.status === "authorized" || connection?.status === "connected";
  const [step, setStep] = useState((real || inBrowser) && authorized ? 1 : startAt);
  const [pick, setPick] = useState(null);
  const [orgs, setOrgs] = useState(real ? null : inBrowser ? (browser?.settings?.connection?.organizations || []) : PROTOTYPE_ORGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scan, setScan] = useState(false);
  const [token, setToken] = useState("");
  const [tokenDays, setTokenDays] = useState("60");
  const [manual, setManual] = useState({ name: "", urn: "" });
  const [showManual, setShowManual] = useState(false);
  const hasToken = !!browser?.settings?.connection?.accessToken;
  const bridge = isBridgeConfigured(browser?.settings);

  /* Real Pages are fetched, never assumed. */
  useEffect(() => {
    if (!real || step !== 1 || orgs) return;
    let alive = true;
    setBusy(true); setError(null);
    linkedinService.organizations()
      .then((r) => { if (alive) setOrgs(r.organizations || []); })
      .catch((e) => { if (alive) setError(e.status === 403
        ? "LinkedIn refused the organization lookup. The app may not have Community Management API access yet."
        : e.message || "Could not load your Pages."); })
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [real, step, orgs]);

  /* Browser mode: ask the bridge for Pages once when a token exists and none are known. */
  useEffect(() => {
    if (!inBrowser || step !== 1 || !hasToken || !bridge || (orgs && orgs.length)) return;
    let alive = true;
    setBusy(true); setError(null);
    browser.loadOrgs().then((list) => { if (alive) setOrgs(list); }).catch((e) => { if (alive) setError(`Couldn't list your Pages through the bridge: ${e.message}`); }).finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [inBrowser, step, hasToken, bridge, orgs]);   // orgs: clearing it is how "Refresh" re-runs this

  useEffect(() => {
    if (!real && !inBrowser && step === 2) { setScan(true); const t = setTimeout(() => setScan(false), 1100); return () => clearTimeout(t); }
  }, [step, real, inBrowser]);

  const banner = real
    ? <div className="badge" style={{ marginBottom: 18 }}>Real LinkedIn authorization</div>
    : inBrowser
    ? <div className="badge" style={{ marginBottom: 18 }}>Sign in with LinkedIn · browser flow{hasToken ? " · token present" : connection?.status === "authorized" ? " · authorised, no token yet" : ""}</div>
    : <div className="badge warn" style={{ marginBottom: 18 }}>Prototype connection — publishing is simulated until LinkedIn sign-in is configured</div>;

  const useToken = async () => {
    if (!token.trim()) return;
    setBusy(true); setError(null);
    try {
      const c = await browser.useToken(token.trim(), Number(tokenDays) * 86400);
      setOrgs(c?.organizations || []);
      setToken("");
      setStep(1);
    } catch (e) { setError(e?.message || "Could not use that token."); }
    finally { setBusy(false); }
  };

  const addManual = () => {
    const urn = manual.urn.trim().startsWith("urn:li:organization:") ? manual.urn.trim() : /^\d+$/.test(manual.urn.trim()) ? `urn:li:organization:${manual.urn.trim()}` : "";
    if (!manual.name.trim() || !urn) { setError("Enter the Page name and its numeric ID or URN (from the Page's admin URL)."); return; }
    const org = { urn, name: manual.name.trim(), role: "ADMINISTRATOR", followers: null, canPublish: true, manual: true };
    setOrgs(browser.addOrg(org)); setPick(org); setShowManual(false); setError(null);
  };

  /* ---- step 0: start ---- */
  if (step === 0) {
    return (
      <div>
        {banner}
        {real || inBrowser ? (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Connect your LinkedIn Company Page</div>
            <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
              You'll be taken to LinkedIn to sign in and approve access. Unison never sees your LinkedIn password{inBrowser ? ", and no server of ours is involved" : ""}.
            </div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Unison will ask for</div>
            {SCOPE_TEXT.map(([t, d]) => <div className="scope" key={t}><span style={{ fontWeight: 600 }}>{t}</span><span className="u-muted">{d}</span></div>)}
            {scopes?.length > 0 && <div className="u-muted mono" style={{ fontSize: 11, marginTop: 10, wordBreak: "break-word" }}>{scopes.join("  ")}</div>}
            {inBrowser && !isLinkedInConfigured(browser?.settings) && (
              <div className="badge warn" style={{ marginTop: 14 }}>No LinkedIn Client ID yet — add it under Settings → LinkedIn first.</div>
            )}
            {inBrowser && !bridge && (
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 14 }}>
                No token bridge is configured. After LinkedIn sends you back, finish by pasting an access token from your LinkedIn app's token generator, or add a bridge URL in Settings.
              </div>
            )}
            <div className="row" style={{ marginTop: 18 }}>
              {real
                ? <button className="btn acc" onClick={() => { setStep(-2); linkedinService.beginAuthorization(); }}>Continue to LinkedIn</button>
                : <button className="btn acc" disabled={!isLinkedInConfigured(browser?.settings)} onClick={() => { setStep(-2); browser.begin(); }}>Continue to LinkedIn</button>}
              {inBrowser && <button className="btn" onClick={() => setStep(-1)}>I have an access token</button>}
              {inBrowser && openSettings && <button className="btn sm" onClick={openSettings}>Settings</button>}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>LinkedIn sign-in isn't set up yet</div>
            <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
              Add your LinkedIn app's Client ID under Settings → LinkedIn to sign in from the browser. Publishing already works through the Make workflow without signing in; this connects a sample Page so the rest of the flow can be tried.
            </div>
            <div className="row">
              {openSettings && <button className="btn acc" onClick={openSettings}>Set up LinkedIn sign-in</button>}
              <button className="btn" onClick={() => setStep(1)}>Continue with a sample Page</button>
            </div>
          </>
        )}
      </div>
    );
  }

  /* ---- paste a token (browser mode) ---- */
  if (step === -1) {
    return (
      <div>
        {banner}
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Use an access token</div>
        <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
          In the LinkedIn developer portal open your app → Auth → OAuth 2.0 tools → Token generator, pick the Page scopes and copy the token. It is stored in this browser only{bridge ? " and used through the bridge to list your Pages" : ""}.
        </div>
        <input className="ta mono" spellCheck={false} placeholder="AQV…" value={token} onChange={(e) => setToken(e.target.value)} />
        <div className="row" style={{ marginTop: 10 }}>
          <span className="u-muted" style={{ fontSize: 13 }}>Expires in</span>
          <select className="ta" style={{ width: 120 }} value={tokenDays} onChange={(e) => setTokenDays(e.target.value)}>
            <option value="1">1 day</option><option value="60">60 days</option><option value="365">1 year</option>
          </select>
        </div>
        {error && <div className="badge bad" style={{ marginTop: 12 }}>{error}</div>}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn acc" disabled={!token.trim() || busy} onClick={useToken}>{busy ? "Saving…" : "Use this token"}</button>
          <button className="btn" onClick={() => { setError(null); setStep(0); }}>Back</button>
        </div>
      </div>
    );
  }

  /* ---- leaving for LinkedIn ---- */
  if (step === -2) {
    return <div>{banner}<div className="pstep active"><span className="tick"><span className="pulse" /></span>Redirecting you to LinkedIn…</div></div>;
  }

  /* ---- step 1: choose a Page ---- */
  if (step === 1) {
    const list = orgs || [];
    return (
      <div>
        {banner}
        {inBrowser && connection?.status === "authorized" && !hasToken && (
          <div className="badge warn" style={{ marginBottom: 12 }}>
            Authorised on LinkedIn, but there is no access token yet.
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setStep(-1)}>Paste a token</button>
          </div>
        )}
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <div className="eyebrow">{real || inBrowser ? "Pages you can publish to" : "Sample Pages"}</div>
          {inBrowser && bridge && hasToken && <button className="btn sm" disabled={busy} onClick={() => { setOrgs([]); }}>Refresh from bridge</button>}
        </div>
        {busy && <div className="pstep active"><span className="tick"><span className="pulse" /></span>Loading your Pages…</div>}
        {error && (
          <div className="badge bad" style={{ marginBottom: 12 }}>
            {error}
            {real && <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setOrgs(null)}>Retry</button>}
          </div>
        )}
        {list.length === 0 && !busy && (
          <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 10 }}>
            {real ? "LinkedIn returned no Pages for this account. You need an admin role on a Company Page."
              : inBrowser ? (bridge ? "No Pages listed yet." : "Without a bridge Unison can't list your Pages. Add the Page by hand — the ID is the number in its admin URL.") : "No Pages."}
          </div>
        )}
        {list.map((o) => (
          <button key={o.urn} className={"orgrow " + (pick?.urn === o.urn ? "on" : "")} onClick={() => setPick(o)} disabled={!o.canPublish} aria-pressed={pick?.urn === o.urn}>
            <span className="li-chip">in</span>
            <span style={{ textAlign: "left", minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{o.name}</div>
              <div className="u-muted mono" style={{ fontSize: 11 }}>{o.urn}{o.manual ? " · added by hand" : ""}</div>
            </span>
            <span className="u-muted" style={{ fontSize: 12.5, marginLeft: "auto", textAlign: "right" }}>
              {o.followers != null && <div>{Number(o.followers).toLocaleString()} followers</div>}
              <div>{o.canPublish ? "✓ Can publish" : "Cannot publish"}</div>
            </span>
          </button>
        ))}
        {inBrowser && (showManual ? (
          <div className="card tight" style={{ marginTop: 8 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Add a Page by hand</div>
            <div className="row">
              <input className="ta" style={{ flex: 2, minWidth: 160 }} placeholder="Page name" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
              <input className="ta mono" style={{ flex: 2, minWidth: 160 }} placeholder="Page ID or urn:li:organization:…" value={manual.urn} onChange={(e) => setManual({ ...manual, urn: e.target.value })} />
              <button className="btn sm acc" onClick={addManual}>Add</button>
              <button className="btn sm" onClick={() => setShowManual(false)}>Cancel</button>
            </div>
          </div>
        ) : <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setShowManual(true)}>+ Add a Page by hand</button>)}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn acc" disabled={!pick || busy} onClick={() => (real || inBrowser ? onDone(pick) : setStep(2))}>{inBrowser ? "Use this Page" : "Continue"}</button>
          {(!real) && <button className="btn" onClick={() => setStep(0)}>Back</button>}
        </div>
      </div>
    );
  }

  /* ---- step 2: prototype confirmation only ---- */
  return (
    <div>
      {banner}
      <div className="eyebrow" style={{ marginBottom: 12 }}>Preparing {pick?.name}</div>
      {[["Page role", pick?.role], ["Publishing", pick?.canPublish ? "allowed" : "not allowed"], ["Credentials", "none — nothing was sent to LinkedIn"]].map(([k, v]) => (
        <div className="pstep done" key={k} style={{ opacity: scan ? .4 : 1 }}>
          <span className="tick">{scan ? <span className="pulse" /> : "✓"}</span>{k} — <span className="u-muted">&nbsp;{v}</span>
        </div>
      ))}
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn acc" disabled={scan} onClick={() => onDone(pick)}>Finish</button>
      </div>
    </div>
  );
}
