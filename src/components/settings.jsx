import { useState, useEffect, useMemo, useCallback } from "react";
import { AI_CONFIG, MODEL_REGISTRY, AI_STATUS, PROVIDERS, MODELS, modelsFor, rateFor, aiRouter, hostedProvider, activeProvider, friendlyError, blockedRemedy, modelForTier, TIER_DEFAULTS } from "../lib/ai.js";
import { PUBLISH_RELAY_PATH, MAKE_CONFIG } from "../lib/publish.js";
import { imageProvider, videoProvider } from "../lib/media.js";
import { TIMEZONES, localTimezone } from "../lib/dates.js";
import { FREE_APIS, DEFAULT_EXTRAS } from "../lib/freeApis.js";
import { defaultRedirectUri, authorizationUrl, isLinkedInConfigured, isBridgeConfigured } from "../lib/linkedinAuth.js";

/* ---------- settings ----------
   Six tabs, plain language, nothing a marketer has to guess at. Anything
   developer-facing sits under Advanced. */

export const TABS = [["workspace", "Workspace"], ["ai", "AI"], ["linkedin", "LinkedIn"], ["publishing", "Publishing"], ["appearance", "Appearance"], ["dev", "Advanced"]];
const TAB_ALIAS = { models: "ai", connections: "linkedin" };

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div className="u-muted" style={{ fontSize: 12.5, marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function Row({ title, sub, children }) {
  return (
    <div className="setrow">
      <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{title}</div>{sub && <div className="u-muted" style={{ fontSize: 13 }}>{sub}</div>}</div>
      {children}
    </div>
  );
}

const Toggle = ({ on, set, label }) => <button className={"toggle " + (on ? "on" : "")} role="switch" aria-checked={!!on} aria-label={label} onClick={() => set(!on)}><i /></button>;

export function Settings(props) {
  const {
    usage, linkedin, liMeta, relay, disconnectLinkedIn, openLinkedIn, searchOn, setSearchOn, failMode, setFailMode,
    makeCompany, setMakeCompany, team, setTeam, theme, setTheme, schedule, setSchedule, notes, setNotes, notify,
    profile, setProfile, wipe, bg3d, setBg3d, initialTab,
    aiSettings, updateAI, aiInfo, refreshAI,
    liSettings, updateLinkedIn, pubSettings, updatePublish,
    extras = DEFAULT_EXTRAS, setExtras, exportSession, importSession, storageIssue, posts = [],
    sync, syncNow,
  } = props;
  const [tab, setTab] = useState(TAB_ALIAS[initialTab] || initialTab || "workspace");
  const [invite, setInvite] = useState({ email: "", role: "Creator" });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const provider = aiSettings?.provider || AI_CONFIG.provider;
  const meta = PROVIDERS[provider] || activeProvider();
  const savedKey = aiSettings?.keys?.[provider] || "";
  const model = aiSettings?.models?.[provider] || AI_CONFIG.models[provider] || "";
  const [keyDraft, setKeyDraft] = useState(savedKey);
  useEffect(() => { setKeyDraft(savedKey); }, [savedKey]);

  /* Groq retires model ids on its own schedule, so the picker asks the key
     what it can actually use rather than trusting a list we shipped. */
  const [liveModels, setLiveModels] = useState(null);
  const [modelErr, setModelErr] = useState(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const refreshModels = useCallback(async () => {
    setLoadingModels(true); setModelErr(null);
    try { setLiveModels(await hostedProvider.listModels()); }
    catch (e) { setModelErr(friendlyError(e)); }
    finally { setLoadingModels(false); }
  }, []);
  useEffect(() => { setLiveModels(null); setModelErr(null); }, [provider, savedKey]);
  const modelOptions = useMemo(() => {
    const known = new Map((MODELS[provider] || []).map((m) => [m.id, m]));
    const ids = liveModels?.length ? liveModels : modelsFor(provider).map((m) => m.id);
    const list = ids.map((id) => known.get(id) || { id, label: id, rates: [0, 0], note: "" });
    /* Whatever is selected must stay selectable, even if the list lost it. */
    return list.some((m) => m.id === model) || !model ? list : [{ id: model, label: model, rates: [0, 0], note: "Not in the provider's current list" }, ...list];
  }, [provider, liveModels, model]);
  const searchModels = useMemo(() => modelOptions.filter((m) => /compound/.test(m.id)), [modelOptions]);

  const [inRate, outRate] = rateFor(model);
  const cost = (usage?.inTok || 0) * inRate + (usage?.outTok || 0) * outRate;
  const quota = AI_STATUS.quota;
  const setP = (k) => (e) => setProfile({ ...profile, [k]: e.target.value });

  async function testAI() {
    setTesting(true);
    try {
      const t0 = Date.now();
      const out = await aiRouter.run({ capability: "reasoning", system: "Reply with exactly the word OK.", user: "Say OK." });
      notify(`AI is working (${Math.round((Date.now() - t0) / 100) / 10}s) — reply: "${String(out).trim().slice(0, 40)}"`, { tone: "ok" });
    } catch (e) {
      notify(`AI test failed: ${e?.message || e}`, { tone: "bad", ms: 8000 });
    } finally { setTesting(false); refreshAI?.(); }
  }

  const importRef = (el) => { if (el) el.onchange = (e) => { const f = e.target.files?.[0]; if (f) importSession?.(f); e.target.value = ""; }; };
  const savedBytes = (() => { try { return new Blob([localStorage.getItem("unison:session:v1") || ""]).size; } catch { return 0; } })();

  return (
    <div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {/* ================= WORKSPACE ================= */}
      {tab === "workspace" && (
        <>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Company</div>
          <div className="grid2">
            <Field label="Company / Page name" hint="Shown in the post preview and stamped on generated images."><input className="ta" placeholder="e.g. Unison Systems" value={profile.company || ""} onChange={setP("company")} /></Field>
            <Field label="Website" hint="Used as the footer line on branded images."><input className="ta" placeholder="company.com" value={profile.website || ""} onChange={setP("website")} /></Field>
            <Field label="Page followers (optional)" hint="Only for a realistic preview."><input className="ta" inputMode="numeric" placeholder="e.g. 12480" value={profile.followers || ""} onChange={setP("followers")} /></Field>
            <Field label="Your name" hint="Greets you on Home and signs the activity log."><input className="ta" placeholder="e.g. Priya Shah" value={profile.userName || ""} onChange={setP("userName")} /></Field>
          </div>

          <div className="eyebrow" style={{ margin: "18px 0 10px" }}>What discovery watches</div>
          <div className="grid2">
            <Field label="Industry"><input className="ta" value={profile.industry || ""} onChange={setP("industry")} /></Field>
            <Field label="Audience"><input className="ta" value={profile.audience || ""} onChange={setP("audience")} /></Field>
          </div>
          <Field label="Watch terms" hint="Comma-separated topics Discover and the trending feed search for."><input className="ta" value={profile.keywords || ""} onChange={setP("keywords")} /></Field>

          <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Team</div>
          <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>A local list for reference — there is no login. Roles are documentation, not enforcement.</div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Member</th><th>Role</th><th></th></tr></thead>
              <tbody>
                {team.length === 0 && <tr><td colSpan={3} className="u-muted" style={{ fontSize: 13.5 }}>Nobody added yet. Add the people who create and approve posts so the activity log can name them.</td></tr>}
                {team.map((m, i) => (
                  <tr key={m.email}>
                    <td><div style={{ fontWeight: 600 }}>{m.name}</div><div className="u-muted" style={{ fontSize: 12.5 }}>{m.email}</div></td>
                    <td>
                      <select className="ta" style={{ width: 130 }} value={m.role} disabled={m.role === "Owner"} onChange={(e) => setTeam(team.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                        {["Owner", "Admin", "Creator", "Reviewer"].map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td>{m.role !== "Owner" && <button className="btn sm" onClick={() => setTeam(team.filter((_, j) => j !== i))}>Remove</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <input className="ta" style={{ flex: 1, minWidth: 200 }} placeholder="name@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            <select className="ta" style={{ width: 130 }} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              {["Owner", "Admin", "Creator", "Reviewer"].map((r) => <option key={r}>{r}</option>)}
            </select>
            <button className="btn acc sm" disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invite.email)} onClick={() => {
              if (team.some((t) => t.email.toLowerCase() === invite.email.toLowerCase())) { notify("That person is already on the list.", { tone: "warn" }); return; }
              setTeam([...team, { name: invite.email.split("@")[0].replace(/[._-]+/g, " "), email: invite.email, role: invite.role }]);
              notify(`${invite.email} added to the team list.`); setInvite({ email: "", role: "Creator" });
            }}>Add</button>
          </div>
        </>
      )}

      {/* ================= AI ================= */}
      {tab === "ai" && (
        <>
          <div className="conn">
            <Row title="Status" sub={aiInfo ? aiInfo.summary : "Checking…"}>
              <span className={"dot " + (aiInfo ? (aiInfo.ready ? "g" : "r") : "y")} style={{ flex: "none" }} />
            </Row>
            <Row title="Web search" sub={meta.free ? "Lets research and discovery pull real sources with links, using Groq's compound model. Free." : "Lets research and discovery pull real sources with links. Billed per search."}>
              <Toggle on={searchOn} set={setSearchOn} label="Web search" />
            </Row>
          </div>

          <div className="conn">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Text and reasoning</div>
            <div className="u-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Every written feature — discovery, research, drafting, evidence checks, the health score, image and video prompts — runs on the provider chosen here.
            </div>

            <Field label="Provider">
              <div className="segs" role="radiogroup" aria-label="AI provider">
                {Object.values(PROVIDERS).map((p) => (
                  <button key={p.id} role="radio" aria-checked={provider === p.id} className={"seg " + (provider === p.id ? "on" : "")} onClick={() => updateAI({ provider: p.id })}>
                    {p.label} <span className="u-muted">· {p.free ? "free" : "paid"}</span>
                  </button>
                ))}
              </div>
            </Field>
            <div className="u-muted" style={{ fontSize: 12.5, margin: "-4px 0 12px" }}>{meta.note}</div>

            {aiInfo?.mode === "relay" ? (
              <div className="u-muted" style={{ fontSize: 13, marginBottom: 12 }}>
                This deployment has an AI relay, so the key lives on the server. Nothing to enter here.
              </div>
            ) : (
              <Field label={`${meta.label} API key`} hint={<>Stored in this browser only — never in the saved session or an export. <a href={meta.keyUrl} target="_blank" rel="noreferrer">Get a key</a>.</>}>
                <div className="row">
                  <input className="ta mono" style={{ flex: 1, minWidth: 220 }} type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder={meta.keyPlaceholder} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} onBlur={() => keyDraft !== savedKey && updateAI({ keys: { [provider]: keyDraft } })} />
                  <button className="btn sm" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</button>
                  {keyDraft !== savedKey && <button className="btn acc sm" onClick={() => updateAI({ keys: { [provider]: keyDraft } })}>Save</button>}
                  {savedKey && <button className="btn sm" onClick={() => { setKeyDraft(""); updateAI({ keys: { [provider]: "" } }); }}>Remove</button>}
                </div>
              </Field>
            )}

            <div className="grid2">
              <Field label="Model" hint={modelErr || modelOptions.find((m) => m.id === model)?.note}>
                <select className="ta" aria-label="Model" value={model} onChange={(e) => updateAI({ models: { [provider]: e.target.value } })}>
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}{m.rates[0] ? ` · $${m.rates[0]} / $${m.rates[1]} per M tokens` : " · free"}</option>
                  ))}
                </select>
              </Field>
              {meta.free ? (
                <Field label="Search model" hint="Used only when Web search is on. Runs its own web lookups.">
                  <select className="ta" aria-label="Search model" value={aiSettings?.searchModel || AI_CONFIG.searchModel} onChange={(e) => updateAI({ searchModel: e.target.value })}>
                    {(searchModels.length ? searchModels : [{ id: "groq/compound", label: "Compound (web search)" }, { id: "groq/compound-mini", label: "Compound mini (web search)" }]).map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Thinking depth" hint="Low is fastest. Medium is right for drafting. High for the final rewrite.">
                  <select className="ta" aria-label="Thinking depth" value={aiSettings?.effort || "medium"} onChange={(e) => updateAI({ effort: e.target.value })}>
                    <option value="low">Low — fastest</option><option value="medium">Medium — balanced</option><option value="high">High — most careful</option>
                  </select>
                </Field>
              )}
            </div>

            <div className="row">
              <button className="btn sm" disabled={testing} onClick={testAI}>{testing ? "Testing…" : "Test connection"}</button>
              {meta.free && <button className="btn sm" disabled={loadingModels || !savedKey} onClick={refreshModels}>{loadingModels ? "Loading…" : "Refresh model list"}</button>}
              <button className="btn sm" onClick={() => refreshAI?.()}>Re-check</button>
            </div>

            {quota && (
              <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                Free allowance left: <b>{quota.requests.remaining ?? "—"}</b> of {quota.requests.limit ?? "—"} requests
                {quota.tokens.limit ? <> · <b>{(quota.tokens.remaining ?? 0).toLocaleString()}</b> of {quota.tokens.limit.toLocaleString()} tokens</> : null}
                {quota.requests.reset ? ` · resets in ${quota.requests.reset}` : ""}
              </div>
            )}

            {aiInfo?.blocked && (
              <div className="badge warn" style={{ marginTop: 12, display: "block", lineHeight: 1.6 }}>
                <b>This browser could not reach {blockedRemedy().provider}.</b> The key was never sent, so there is nothing
                wrong with it. In order of what usually works:
                <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                  {blockedRemedy().steps.map((t, i) => <li key={i} style={{ marginBottom: 4 }}>{t}</li>)}
                </ol>
              </div>
            )}
          </div>

          <div className="conn">
            <Row title="Match the model to the job"
                 sub="Drafting and evidence checks get the strongest free model; image and video prompts get the fastest. Off, everything uses the model above.">
              <Toggle on={aiSettings?.useTiers !== false} set={(v) => updateAI({ useTiers: v })} label="Match the model to the job" />
            </Row>
            {aiSettings?.useTiers !== false && (
              <div className="grid2" style={{ marginTop: 8 }}>
                {[["strong", "Strong — drafting, evidence"], ["fast", "Fast — prompts, short rewrites"]].map(([tier, label]) => (
                  <Field key={tier} label={label} hint={`Now: ${modelForTier(tier, provider)}`}>
                    <select className="ta" aria-label={label} value={aiSettings?.tiers?.[provider]?.[tier] || ""} onChange={(e) => updateAI({ tiers: { [provider]: { [tier]: e.target.value } } })}>
                      <option value="">Default — {TIER_DEFAULTS[provider]?.[tier] || model}</option>
                      {modelOptions.filter((m) => !/compound/.test(m.id)).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            )}
            <Row title="Keep going when the daily limit runs out"
                 sub="On a free tier a long session can exhaust one model. Rather than dropping to sample data mid-post, step down to a lighter model and say so once.">
              <Toggle on={aiSettings?.autoDowngrade !== false} set={(v) => updateAI({ autoDowngrade: v })} label="Step down instead of stopping" />
            </Row>
          </div>

          <div className="conn">
            <Row title="Local models (Ollama)" sub="Free and private. Only works when Unison runs on the same machine as Ollama.">
              <Toggle on={aiSettings?.useLocal !== false} set={(v) => updateAI({ useLocal: v })} label="Use local models" />
            </Row>
            {aiSettings?.useLocal !== false && (
              <div className="grid2" style={{ marginTop: 8 }}>
                <Field label="Endpoint"><input className="ta mono" value={aiSettings?.ollamaEndpoint || ""} onChange={(e) => updateAI({ ollamaEndpoint: e.target.value })} /></Field>
                <Field label="Model tag" hint={`Status: ${AI_STATUS.local}${AI_STATUS.localModels.length ? " · installed: " + AI_STATUS.localModels.slice(0, 4).join(", ") : ""}`}><input className="ta mono" value={aiSettings?.localModel || ""} onChange={(e) => updateAI({ localModel: e.target.value })} /></Field>
              </div>
            )}
          </div>

          <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Usage this session</div>
          <div className="quads">
            {[["Calls", usage.calls], ["Searches", usage.searches], ["Input tokens", usage.inTok.toLocaleString()], ["Output tokens", usage.outTok.toLocaleString()]].map(([l, v]) => (
              <div key={l}><span className="eyebrow">{l}</span><b>{v}</b></div>
            ))}
          </div>
          <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {meta.free ? <>No spend — {model} is on {meta.label}'s free tier.</> : <>Estimated spend ${cost.toFixed(3)} at {model} list prices.</>} {usage.fails} call{usage.fails === 1 ? "" : "s"} fell back to sample data · research is cached per topic for the session.
          </div>
          {Object.keys(usage.byEngine || {}).length > 0 && (
            <div className="tbl-wrap" style={{ marginTop: 12 }}>
              <table className="tbl">
                <thead><tr><th>Engine</th><th>Calls</th><th>In</th><th>Out</th><th>Cost</th></tr></thead>
                <tbody>
                  {Object.entries(usage.byEngine).map(([k, v]) => (
                    <tr key={k}><td>{k}</td><td className="mono">{v.calls}</td><td className="mono">{v.inTok.toLocaleString()}</td><td className="mono">{v.outTok.toLocaleString()}</td><td className="mono">${(v.inTok * inRate + v.outTok * outRate).toFixed(3)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ================= LINKEDIN ================= */}
      {tab === "linkedin" && (
        <>
          <div className="conn">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 11, minWidth: 0 }}>
                <span className="li-chip">in</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>LinkedIn Company Page</div>
                  <div className="u-muted" style={{ fontSize: 13 }}>
                    {linkedin.connected && linkedin.org ? `${linkedin.org}${linkedin.role ? " · " + linkedin.role : ""}${linkedin.expires ? " · access until " + linkedin.expires : ""}`
                      : linkedin.status === "authorized" ? "Signed in — choose a Page to finish"
                      : linkedin.needsAttention ? (linkedin.error || "Needs attention — reconnect")
                      : linkedin.viaWorkflow ? "Publishing goes through the Make workflow; sign in below to attach your identity and Page."
                      : "Not connected"}
                  </div>
                  {linkedin.profile?.name && <div className="u-muted" style={{ fontSize: 12.5 }}>Signed in as {linkedin.profile.name}{linkedin.profile.email ? ` · ${linkedin.profile.email}` : ""}</div>}
                </div>
              </div>
              <div className="row">
                {(linkedin.connected && !linkedin.viaWorkflow) || linkedin.status === "authorized"
                  ? <><button className="btn sm" onClick={() => openLinkedIn(1)}>Switch Page</button><button className="btn sm" onClick={disconnectLinkedIn}>Disconnect</button></>
                  : <button className="btn acc sm" onClick={() => openLinkedIn(0)}>{isLinkedInConfigured(liSettings) ? "Sign in with LinkedIn" : "Connect"}</button>}
              </div>
            </div>
            <Row title="Mode">
              <span className={"state " + (liMeta.mode === "browser" || liMeta.mode === "real" ? "pub" : linkedin.viaWorkflow ? "sch" : "rev")}>
                {liMeta.mode === "real" ? "SERVER OAUTH" : liMeta.mode === "browser" ? "BROWSER OAUTH" : linkedin.viaWorkflow ? "MAKE WORKFLOW" : "PROTOTYPE"}
              </span>
            </Row>
          </div>

          <div className="conn">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Sign in with LinkedIn (no backend)</div>
            <div className="u-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Create an app at linkedin.com/developers, add this page's address as an authorised redirect URL, and paste the Client ID. The browser can send people to LinkedIn and get an authorisation code back; exchanging it for a token needs your Client Secret, which must never sit in a web page. Point the bridge at a Make webhook that does the exchange (contract in the README), or skip the bridge and paste a token from the developer portal's token generator.
            </div>
            <div className="grid2">
              <Field label="Client ID"><input className="ta mono" spellCheck={false} placeholder="86xxxxxxxxxxxx" value={liSettings?.clientId || ""} onChange={(e) => updateLinkedIn({ clientId: e.target.value })} /></Field>
              <Field label="Redirect URL" hint="Add exactly this in the LinkedIn app's OAuth settings.">
                <div className="row"><input className="ta mono" style={{ flex: 1, minWidth: 180 }} value={liSettings?.redirectUri || defaultRedirectUri()} onChange={(e) => updateLinkedIn({ redirectUri: e.target.value })} /><button className="btn sm" onClick={() => { navigator.clipboard?.writeText(liSettings?.redirectUri || defaultRedirectUri()); notify("Redirect URL copied."); }}>Copy</button></div>
              </Field>
            </div>
            <Field label="Token bridge URL (optional)" hint={isBridgeConfigured(liSettings) ? "Configured. The bridge receives {action:\"exchange\", code, redirect_uri, client_id} and must return {access_token, expires_in, profile, organizations} with an Access-Control-Allow-Origin header." : "A Make webhook (or any endpoint) that exchanges the code for a token and lists your Pages. Without it, sign-in stops at 'authorised' and you can paste a token instead."}>
              <input className="ta mono" spellCheck={false} placeholder="https://hook.eu1.make.com/…" value={liSettings?.bridgeUrl || ""} onChange={(e) => updateLinkedIn({ bridgeUrl: e.target.value })} />
            </Field>
            <Field label="Scopes"><input className="ta mono" spellCheck={false} value={liSettings?.scopes || ""} onChange={(e) => updateLinkedIn({ scopes: e.target.value })} /></Field>
            {isLinkedInConfigured(liSettings) && (
              <details className="brief"><summary>Consent URL this will open</summary><div className="mono" style={{ wordBreak: "break-all", fontSize: 11.5 }}>{authorizationUrl(liSettings, "STATE")}</div></details>
            )}
          </div>

          <div className="conn">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Publishing through Make</div>
            <div className="u-muted" style={{ fontSize: 13, marginBottom: 12 }}>
              Approved posts are sent to a Make scenario that owns the LinkedIn posting step. This works with no LinkedIn sign-in at all; sign-in just adds who you are and which Page to the payload.
            </div>
            <Row title="Publishing service (relay)" sub={relay?.relay ? `Deployed at ${PUBLISH_RELAY_PATH}${relay.webhookConfigured === false ? " · webhook not set on the server" : ""}` : relay?.checked ? "Not deployed — the browser posts to the webhook directly." : "Checking…"}>
              <span className={"dot " + (relay?.relay ? "g" : relay?.checked ? "y" : "y")} style={{ flex: "none" }} />
            </Row>
            <Field label="Make webhook URL" hint={pubSettings?.isDefault ? "Using the team default webhook." : "Custom webhook in use."}>
              <div className="row">
                <input className="ta mono" style={{ flex: 1, minWidth: 220 }} spellCheck={false} value={pubSettings?.webhookUrl || ""} onChange={(e) => updatePublish({ webhookUrl: e.target.value })} />
                {!pubSettings?.isDefault && <button className="btn sm" onClick={() => updatePublish({ webhookUrl: "" })}>Reset</button>}
              </div>
            </Field>
            <div className="grid2">
              <Field label="Company Page name" hint="Sent with every post so the scenario can route it."><input className="ta" placeholder="Page name" value={makeCompany.name} onChange={(e) => setMakeCompany({ ...makeCompany, name: e.target.value })} /></Field>
              <Field label="Company Page URN"><input className="ta mono" placeholder="urn:li:organization:…" value={makeCompany.urn} onChange={(e) => setMakeCompany({ ...makeCompany, urn: e.target.value })} /></Field>
            </div>
            <Row title="Send my LinkedIn token with posts" sub="Only if the Make scenario should post with your access instead of its own connection. Off by default.">
              <Toggle on={!!liSettings?.sendToken} set={(v) => updateLinkedIn({ sendToken: v })} label="Send token" />
            </Row>
            <Row title="Post types the scenario receives"><span className="u-muted" style={{ fontSize: 12.5, textAlign: "right" }}>{MAKE_CONFIG.supportedPostTypes.join(", ")}</span></Row>
          </div>
        </>
      )}

      {/* ================= PUBLISHING ================= */}
      {tab === "publishing" && (
        <>
          <Row title="Default timezone" sub="Stored with every scheduled post and sent to Make.">
            <select className="ta" style={{ width: 220 }} value={schedule.tz} onChange={(e) => setSchedule({ ...schedule, tz: e.target.value })}>
              {!TIMEZONES.includes(schedule.tz) && <option value={schedule.tz}>{schedule.tz}</option>}
              {TIMEZONES.map((z) => <option key={z} value={z}>{z}{z === localTimezone() ? " (this device)" : ""}</option>)}
            </select>
          </Row>
          <Row title="Approval required before publishing" sub="Always on. A human approves before anything is sent."><button className="toggle on" disabled aria-label="Approval required" role="switch" aria-checked="true"><i /></button></Row>
          <Row title="Scheduled posts" sub="Nothing runs in the background of a browser app. A due post is flagged on Home and in Content; publishing it is one click, or let the Make scenario schedule from the date and time in the payload." />
          <Row title="Retry policy" sub="Manual retry only. Nothing is resent automatically, and every send carries an idempotency key." />
          <Row title="Simulate a publishing failure" sub="The next publish fails before anything is sent. For testing the failure UI.">
            <Toggle on={failMode} set={setFailMode} label="Simulate failure" />
          </Row>

        </>
      )}

      {/* ================= APPEARANCE ================= */}
      {tab === "appearance" && (
        <>
          <Row title="Theme" sub={`Currently ${theme}.`}>
            <div className="row">
              <button className={"chip " + (theme === "dark" ? "on" : "")} onClick={() => setTheme("dark")}>Dark</button>
              <button className={"chip " + (theme === "light" ? "on" : "")} onClick={() => setTheme("light")}>Light</button>
            </div>
          </Row>
          <Row title="Ambient effects" sub="A scroll-driven 3D scene and a soft cursor glow behind the interface. Off by default — it costs GPU and battery.">
            <Toggle on={bg3d} set={setBg3d} label="Ambient effects" />
          </Row>
        </>
      )}

      {/* ================= ADVANCED ================= */}
      {tab === "dev" && (
        <>
          <div className="eyebrow" style={{ margin: "22px 0 8px" }}>Where your work lives</div>
          <Row title="Shared team workspace" sub={sync?.summary || "Checking…"}>
            <div className="row">
              <span className={"dot " + (sync?.status === "ready" ? "g" : sync?.status === "error" || sync?.status === "conflict" ? "r" : "y")} style={{ flex: "none" }} />
              <button className="btn sm" onClick={() => syncNow?.()}>Sync now</button>
            </div>
          </Row>
          {sync?.status !== "ready" && (
            <div className="u-muted" style={{ fontSize: 12.5, margin: "-4px 0 14px", lineHeight: 1.6 }}>
              Posts, calendar, team and the audit trail are held in this browser only, so a teammate cannot see them.
              To share them, deploy <code className="mono">api/workspace.js</code> with a store behind it — the README has the two
              environment variables. Until then, <b>Export JSON</b> below is the way to hand work over.
            </div>
          )}
          <Row title="Saved session" sub={`${(savedBytes / 1024).toFixed(0)} KB used · ${posts.length} posts${storageIssue === "failed" ? " · saving is FAILING — storage full" : storageIssue === "partial" ? " · media on older posts was dropped to fit" : ""}`}>
            <div className="row">
              <button className="btn sm" onClick={exportSession}>Export JSON</button>
              <label className="btn sm" style={{ cursor: "pointer" }}>Import<input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }} /></label>
            </div>
          </Row>
          <Row title="Notifications" sub={`${notes.length} in the drawer.`}><button className="btn sm" onClick={() => setNotes([])}>Clear</button></Row>
          <Row title="Clear saved data" sub="Removes posts, drafts, settings and the team list from this browser. The AI key and LinkedIn sign-in are kept.">
            {confirmWipe
              ? <div className="row"><button className="btn bad sm" onClick={() => { setConfirmWipe(false); wipe(); }}>Yes, clear everything</button><button className="btn sm" onClick={() => setConfirmWipe(false)}>Keep</button></div>
              : <button className="btn sm" onClick={() => setConfirmWipe(true)}>Clear…</button>}
          </Row>

          <div className="eyebrow" style={{ marginBottom: 8 }}>Free public APIs</div>
          <div className="u-muted" style={{ fontSize: 13, marginBottom: 8 }}>Keyless services that add real data around the AI. Each one is optional and fails quietly if it can't be reached.</div>
          <div className="conn">
            {Object.values(FREE_APIS).map((a) => (
              <Row key={a.id} title={a.label} sub={a.note}>
                <Toggle on={extras[a.id] !== false && (a.id !== "pollinations" || extras.pollinations === true)} set={(v) => setExtras({ ...extras, [a.id]: v })} label={a.label} />
              </Row>
            ))}
          </div>

          <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Routing</div>
          <div className="u-muted" style={{ fontSize: 13, marginBottom: 8 }}>Capabilities route to the local model when it is reachable, otherwise to the hosted model. Nobody picks a model in the creation flow.</div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Capability</th><th>Intended</th><th>Actually used</th></tr></thead>
              <tbody>
                {Object.entries(MODEL_REGISTRY).map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td className="u-muted">{v.provider === "text" ? aiRouter.describe(k) : v.label}</td><td className="mono" style={{ fontSize: 12 }}>{AI_STATUS.routed[k] || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="conn" style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Media providers</div>
            {[["Image", imageProvider], ["Video", videoProvider]].map(([n, pv]) => (
              <Row key={n} title={n} sub={pv.label}><span className="chipflat">{n === "Image" && extras.pollinations ? "Pollinations + renderer" : pv.configured ? "provider" : "brand renderer"}</span></Row>
            ))}
          </div>
          <div className="conn">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Endpoints</div>
            <Row title="AI relay" sub={AI_CONFIG.aiRelayEndpoint}><span className="chipflat">{aiInfo?.mode === "relay" ? "deployed" : "absent"}</span></Row>
            <Row title="Publishing relay" sub={PUBLISH_RELAY_PATH}><span className="chipflat">{relay?.relay ? "deployed" : "absent"}</span></Row>
            <Row title="Console tracing" sub={'localStorage["unison:debug"] = "1" then reload.'}><span className="chipflat">{MAKE_CONFIG.debug ? "on" : "off"}</span></Row>
          </div>
        </>
      )}
    </div>
  );
}
