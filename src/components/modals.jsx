import { useState, useEffect, useMemo } from "react";
import { linkedinService } from "../lib/linkedin.js";
import { diffWords } from "../lib/text.jsx";

/* ============================================================
   MODALS
   ============================================================ */

export function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={"modal " + (wide ? "wide" : "")}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 20 }}>
          <div className="disp" style={{ fontSize: 25 }}>{title}</div>
          <button className="btn sm" onClick={onClose}>Close</button>
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

/* Prototype-only Pages. Real mode never renders these — organizations come
   from LinkedIn via the Unison API. */
export const PROTOTYPE_ORGS = [
  { urn: "urn:li:organization:2841193", name: "Acme Systems", role: "ADMINISTRATOR", followers: 12480, canPublish: true },
  { urn: "urn:li:organization:9920117", name: "Acme Labs", role: "CONTENT_ADMIN", followers: 3204, canPublish: true },
  { urn: "urn:li:organization:5510882", name: "Acme Ventures", role: "ANALYST", followers: 890, canPublish: false },
];

/* One component, two truths: a real OAuth handoff when the integration is
   configured, and a clearly-labelled prototype path when it is not. */
export function LinkedInFlow({ onDone, startAt = 0, mode, connection, scopes }) {
  const real = mode === "real";
  const authorized = connection?.status === "authorized" || connection?.status === "connected";
  const [step, setStep] = useState(real && authorized ? 1 : startAt);
  const [pick, setPick] = useState(null);
  const [orgs, setOrgs] = useState(real ? null : PROTOTYPE_ORGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scan, setScan] = useState(false);

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

  useEffect(() => {
    if (!real && step === 2) { setScan(true); const t = setTimeout(() => setScan(false), 1100); return () => clearTimeout(t); }
  }, [step, real]);

  const banner = real
    ? <div className="badge" style={{ marginBottom: 18 }}>Real LinkedIn authorization</div>
    : <div className="badge warn" style={{ marginBottom: 18 }}>
        Prototype connection — publishing is simulated until real LinkedIn authorization is configured
      </div>;

  /* ---- step 0: start ---- */
  if (step === 0) {
    return (
      <div>
        {banner}
        {real ? (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Connect your LinkedIn Company Page</div>
            <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 16 }}>
              You'll be taken to LinkedIn to sign in and approve access. Unison never sees your LinkedIn password.
            </div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Unison will ask for</div>
            {[["Publish to your Page", "Create and manage organic posts on Pages you administer"],
              ["Read your Page content", "Show published posts and their performance in Unison"],
              ["See which Pages you manage", "List the Pages you can choose from"]].map(([t, d]) => (
              <div className="scope" key={t}><span style={{ fontWeight: 600 }}>{t}</span><span className="u-muted">{d}</span></div>
            ))}
            {scopes?.length > 0 && <div className="u-muted mono" style={{ fontSize: 11, marginTop: 10 }}>{scopes.join("  ")}</div>}
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn acc" onClick={() => { setStep(-2); linkedinService.beginAuthorization(); }}>Continue to LinkedIn</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Real authorization isn't configured</div>
            <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 14 }}>
              The Unison API isn't running with LinkedIn credentials, so this connects a prototype Page.
              Nothing is sent to LinkedIn and no post will appear there.
            </div>
            <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 16 }}>
              To enable real publishing: create a LinkedIn developer app, request Community Management API access,
              add the credentials to the server environment, then reconnect. See docs/linkedin-integration.md.
            </div>
            <div className="row">
              <button className="btn" onClick={() => setStep(1)}>Continue in prototype mode</button>
            </div>
          </>
        )}
      </div>
    );
  }

  /* ---- leaving for LinkedIn ---- */
  if (step === -2) {
    return <div>{banner}<div className="pstep active"><span className="tick"><span className="pulse" /></span>Redirecting you to LinkedIn…</div></div>;
  }

  /* ---- step 1: choose a Page ---- */
  if (step === 1) {
    return (
      <div>
        {banner}
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          {real ? "Pages you can publish to" : "Prototype Pages"}
        </div>
        {busy && <div className="pstep active"><span className="tick"><span className="pulse" /></span>Loading your Pages from LinkedIn…</div>}
        {error && (
          <div className="badge bad" style={{ marginBottom: 12 }}>
            {error}
            <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setOrgs(null)}>Retry</button>
          </div>
        )}
        {orgs?.length === 0 && !busy && (
          <div className="u-muted" style={{ fontSize: 13.5 }}>
            LinkedIn returned no Pages for this account. You need an admin role on a Company Page.
          </div>
        )}
        {(orgs || []).map((o) => (
          <button key={o.urn} className={"orgrow " + (pick?.urn === o.urn ? "on" : "")} onClick={() => setPick(o)} disabled={!o.canPublish}>
            <span className="li-chip">in</span>
            <span style={{ textAlign: "left", minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{o.name}</div>
              <div className="u-muted mono" style={{ fontSize: 11 }}>{o.urn}</div>
            </span>
            <span className="u-muted" style={{ fontSize: 12.5, marginLeft: "auto", textAlign: "right" }}>
              {o.followers != null && <div>{Number(o.followers).toLocaleString()} followers</div>}
              <div>{o.canPublish ? "✓ Can publish" : "Cannot publish"}</div>
            </span>
          </button>
        ))}
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn acc" disabled={!pick || busy} onClick={() => (real ? onDone(pick) : setStep(2))}>Continue</button>
          {!real && <button className="btn" onClick={() => setStep(0)}>Back</button>}
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
