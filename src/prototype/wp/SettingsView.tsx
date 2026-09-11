"use client";

import { useState, useSyncExternalStore } from "react";
import { Callout, SectionHeader, StatusPill } from "../primitives";
import { DOC_TYPES, GROQ_MODELS, MAX_FILE_MB, NATIVE_PARSE, PROCESS_STEPS, QUOTA, actions, getSnapshot, subscribe } from "./store";
import type { ReviewItem } from "./store";
import { apiBase, isRemote, setApiBaseOverride } from "../api";
import { generateRatesWorkbook, parseRatesWorkbook, rateDbYears, readWorkbookSheets } from "./rateDb";
import { resetProject } from "./localStore";
import { safeDownload } from "./safeBrowser";
import { sessionSnapshot, sessionSubscribe } from "../session";
import { PROVIDERS } from "./providers";

type Tab = "methodology" | "technical" | "config" | "policies" | "ai" | "services" | "usage";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "methodology", label: "Methodologies" },
  { id: "technical", label: "Technical information" },
  { id: "config", label: "Tool configuration" },
  { id: "policies", label: "Policies" },
  { id: "ai", label: "AI platform" },
  { id: "services", label: "Free services" },
  { id: "usage", label: "Usage & quota" },
];

const VERSIONS: Array<[string, string]> = [
  ["Application", "2.0.0"],
  ["Master template", "Final_Copy_of_5471_workpaper.XLSX"],
  ["Tax rules", "5471-US-2025.4"],
  ["FX policy", "FX-POLICY-2025.3"],
  ["Mapping configuration", "MAP-MULTI-1.4"],
];

function Row({ label, value }: { label: string; value: string }) {
  return <div className="fact-row"><span>{label}</span><strong>{value}</strong></div>;
}

function Ring({ pct, label, tone }: { pct: number; label: string; tone?: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div className="quota-ring">
      <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
        <circle cx="52" cy="52" r={r} className="ring-track" />
        <circle
          cx="52" cy="52" r={r}
          className="ring-value"
          style={{ stroke: tone, strokeDasharray: c, strokeDashoffset: c * (1 - clamped) }}
        />
      </svg>
      <div className="ring-cap">
        <b>{Math.round(clamped * 100)}%</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

function Meter({ label, used, total, unit }: { label: string; used: number; total: number; unit?: string }) {
  const pct = Math.max(0, Math.min(1, total ? used / total : 0));
  return (
    <div className="quota-meter">
      <div className="quota-meter-head">
        <span>{label}</span>
        <strong>{used.toLocaleString()}{unit || ""} / {total.toLocaleString()}{unit || ""}</strong>
      </div>
      <div className="progress-track"><span style={{ width: `${pct * 100}%` }} /></div>
    </div>
  );
}

export function SettingsView() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [tab, setTab] = useState<Tab>("methodology");
  const storageMB = state.usage.storage / 1048576;

  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Configuration"
        title="Settings"
        description="Every methodology, rule set, model and limit this tool applies, in one place — so a reviewer can see exactly how a number reached the work paper."
      />

      <div className="tab-row">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "tab-button active" : "tab-button"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "methodology" ? (
        <div className="two-column">
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Calculation</span><h2>Calculation methodology</h2></div></div>
            <Row label="Local currency capture" value="Values written exactly as reported" />
            <Row label="USD translation" value="Template formula — divide rate" />
            <Row label="Schedule C rate" value="Annual average · C59" />
            <Row label="Schedule F rates" value="Spot at BOY/EOY · C61 / C60" />
            <Row label="Subtotals" value="Template SUM formulas, never overwritten" />
            <Row label="Rounding" value="ROUND(x,0) as defined in the template" />
          </section>
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Pipeline</span><h2>Processing logic</h2></div></div>
            {PROCESS_STEPS.map((s, i) => <Row key={s} label={String(i + 1).padStart(2, "0")} value={s} />)}
          </section>
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Tax</span><h2>Tax methodology</h2></div></div>
            <Row label="Filer category" value="Ownership facts drive categories 1a–5c" />
            <Row label="Schedule set" value="Determined by category cells B42:B50" />
            <Row label="CFC test" value="Days held · C38 and C39" />
            <Row label="Scope" value="Current-year original work papers" />
          </section>
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Validation</span><h2>Data validation methodology</h2></div></div>
            <Row label="Balance sheet tie-out" value="Template check row G64 / H64" />
            <Row label="Unmatched labels" value="Surfaced for review, never dropped" />
            <Row label="Numeric parsing" value="Parentheses, thousands and decimal comma aware" />
            <Row label="Account codes" value="Numbers left of the caption are ignored" />
            <Row label="Entity isolation" value="Separate document pool per entity" />
          </section>
        </div>
      ) : null}

      {tab === "technical" ? (
        <div className="two-column">
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Stack</span><h2>Technology stack</h2></div></div>
            <Row label="Interface" value="React 19 · TypeScript" />
            <Row label="Workbook engine" value="JSZip with targeted OOXML cell patching" />
            <Row label="Spreadsheet reader" value="Built-in sharedStrings and sheet XML parser" />
            <Row label="AI provider" value="Groq Cloud — OpenAI-compatible API" />
            <Row label="Data residency" value={isRemote() ? "Parsed in-browser · stored on your backend" : "Documents parsed in-browser, never uploaded"} />
          </section>
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Documents</span><h2>Processing engine</h2></div></div>
            <Row label="Native parse" value={NATIVE_PARSE.join(" · ")} />
            <Row label="Scanned documents" value="In-browser OCR card (Tesseract) builds a searchable PDF — opt-in, on Document intake" />
            <Row label="Label matching" value={`${state.rules.length} keyword rules, multilingual`} />
            <Row label="Tie-break" value="Longest matching keyword wins" />
            <Row label="Fallback" value="Manual assignment or Groq proposal" />
          </section>
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Versions</span><h2>Version information</h2></div></div>
            {VERSIONS.map(([k, v]) => <Row key={k} label={k} value={v} />)}
          </section>
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">System</span><h2>System configuration</h2></div></div>
            <Row label="Max file size" value={`${MAX_FILE_MB} MB`} />
            <Row label="Entities per stakeholder" value="Unlimited" />
            <Row label="Output" value=".xlsx · .zip when several entities" />
            <Row label="Recalculation" value="fullCalcOnLoad flag set on save" />
            <Row label="Sheets preserved" value="19 of 19" />
          </section>
        </div>
      ) : null}

      {tab === "config" ? (
        <div className="two-column">
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Backend</span><h2>Persistence & tasks</h2></div></div>
            <BackendCard />
            <div className="panel-heading" style={{ marginTop: 18 }}><div><span className="section-kicker">Inputs</span><h2>Supported document types</h2></div></div>
            <div className="chip-row">{DOC_TYPES.map((d) => <span key={d} className="type-chip">{d}</span>)}</div>
            <h3 className="wp-subhead">Processing parameters</h3>
            <Row label="Amount column" value="Right-most numeric in the row" />
            <Row label="Balance sheet columns" value="Second-last = beginning, last = end" />
            <Row label="Duplicate labels" value="Summed into the same line" />
            <Row label="Prose filter" value="Captions over 64 characters are ignored" />
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div><span className="section-kicker">Mapping</span><h2>Mapping configuration</h2></div>
              <button type="button" className="button" onClick={() => actions.resetRules()}>Reset to defaults</button>
            </div>
            <p className="hint">Edit the keywords that bind document labels to template lines. Changes apply to the next processing run.</p>
            <div className="wp-table rules-table">
              <table>
                <thead><tr><th style={{ width: 74 }}>Target</th><th>Keywords</th></tr></thead>
                <tbody>
                  {state.rules.map((r, i) => (
                    <tr key={r.t + i}>
                      <td className="ref-cell">{r.t}</td>
                      <td>
                        <input
                          className="rule-input"
                          value={r.kw.join(", ")}
                          onChange={(e) => actions.setRuleKeywords(i, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "policies" ? (
        <section className="panel">
          <div className="panel-heading">
            <div><span className="section-kicker">Exception policies</span><h2>How exceptions are levelled</h2></div>
            <div className="signoff-actions">
              <button
                type="button"
                className="button"
                onClick={() => actions.addPolicyRule({ match: { category: "consistency" }, action: "keep" })}
              >
                + Add rule
              </button>
              <button type="button" className="button" onClick={() => actions.resetPolicies()}>Clear all</button>
            </div>
          </div>
          <p className="hint">
            Ordered rules — the first match decides. An empty list means every exception keeps its computed level.
            Suppressing or downgrading a <strong>blocking</strong> exception is a standing acknowledgement: the audit
            trail records it on every generation. New warnings that are not covered can be added from the
            Exception center with one click.
          </p>
          <div className="wp-table rules-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 26 }}>#</th>
                  <th style={{ width: 120 }}>Match on</th>
                  <th>Pattern</th>
                  <th style={{ width: 140 }}>Action</th>
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {state.policies.map((p, i) => {
                  const kind = p.match.id !== undefined ? "id" : p.match.category !== undefined ? "category" : "message";
                  const pattern = p.match.id ?? p.match.category ?? p.match.message ?? "";
                  let badPattern = false;
                  if (kind === "message" && p.match.regex) {
                    try { new RegExp(p.match.message || ""); } catch { badPattern = true; }
                  }
                  return (
                    <tr key={p.id}>
                      <td className="ref-cell">{i + 1}</td>
                      <td>
                        <select
                          className="stake-input"
                          value={kind}
                          onChange={(e) => {
                            const v = e.target.value;
                            actions.updatePolicyRule(p.id, {
                              match: v === "id" ? { id: pattern } : v === "category" ? { category: pattern as never } : { message: pattern, regex: p.match.regex },
                            });
                          }}
                        >
                          <option value="id">exception id</option>
                          <option value="category">category</option>
                          <option value="message">message text</option>
                        </select>
                      </td>
                      <td>
                        {kind === "category" ? (
                          <select
                            className="stake-input"
                            value={pattern}
                            // The cast stopped protecting anything once the union
                            // grew past one member; the option list below is the
                            // real guarantee, so it must mirror ReviewItem["category"].
                            onChange={(e) => actions.updatePolicyRule(p.id, { match: { category: e.target.value as ReviewItem["category"] } })}
                          >
                            {["fx", "mapping", "carry-forward", "related-party", "source-gap", "profile", "consistency", "process", "tie-out", "entity-scope"].map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="rule-input"
                            value={pattern}
                            placeholder={kind === "id" ? "e.g. cash-paid-total" : "text the message contains"}
                            onChange={(e) =>
                              actions.updatePolicyRule(p.id, {
                                match: kind === "id" ? { id: e.target.value } : { message: e.target.value, regex: p.match.regex },
                              })
                            }
                          />
                        )}
                        {kind === "message" ? (
                          <label style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={!!p.match.regex}
                              onChange={(e) => actions.updatePolicyRule(p.id, { match: { message: p.match.message || "", regex: e.target.checked } })}
                            />
                            regex{badPattern ? <span className="actor-tag groq">invalid pattern</span> : null}
                          </label>
                        ) : null}
                      </td>
                      <td>
                        <select
                          className="stake-input"
                          value={p.action}
                          onChange={(e) => actions.updatePolicyRule(p.id, { action: e.target.value as never })}
                        >
                          <option value="keep">keep level</option>
                          <option value="block">raise to block</option>
                          <option value="warn">set to warn</option>
                          <option value="info">set to info</option>
                          <option value="suppress">suppress</option>
                        </select>
                      </td>
                      <td>
                        <button type="button" className="button" onClick={() => actions.movePolicyRule(p.id, -1)}>↑</button>{" "}
                        <button type="button" className="button" onClick={() => actions.movePolicyRule(p.id, 1)}>↓</button>{" "}
                        <button type="button" className="button" onClick={() => actions.removePolicyRule(p.id)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!state.policies.length ? (
              <p className="hint" style={{ padding: "10px 4px" }}>
                No rules yet — every processed return generates exceptions at their computed levels.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "ai" ? (
        <div className="two-column">
          <section className="panel">
            <div className="panel-heading"><div><span className="section-kicker">Provider</span><h2>Groq AI</h2></div></div>
            <p className="hint">Used to map labels the deterministic rules cannot claim. Amounts always come from your documents — the model never invents a figure.</p>
            <label className="comment-field">
              <span>API key</span>
              <input
                type="password"
                className="stake-input"
                value={state.groq.key}
                placeholder="gsk_…"
                onChange={(e) => actions.setGroq({ key: e.target.value.trim() })}
              />
            </label>
            <label className="comment-field">
              <span>Model</span>
              <select
                className="stake-input"
                value={state.groq.model}
                onChange={(e) => actions.setGroq({ model: e.target.value })}
              >
                {GROQ_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <div className="review-actions">
              <button type="button" className="button" onClick={() => actions.setGroq({ key: "", status: "not configured", lastError: "" })}>Clear key</button>
              <button type="button" className="button primary" onClick={() => void actions.testGroq()}>Test connection</button>
            </div>
            {state.groq.lastError ? <Callout title="Last error" tone="red">{state.groq.lastError}</Callout> : null}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div><span className="section-kicker">Telemetry</span><h2>Model status</h2></div>
              <StatusPill status={state.groq.status === "online" ? "approved" : state.groq.status === "error" ? "blocked" : "waiting"} />
            </div>
            <Row label="Model name" value={state.groq.model} />
            <Row label="Status" value={state.groq.status} />
            <Row label="Last response time" value={state.groq.latency ? `${state.groq.latency} ms` : "—"} />
            <Row label="Requests this session" value={String(state.groq.calls)} />
            <Row label="Tokens consumed" value={state.groq.tokens.toLocaleString()} />
            <Row label="Endpoint" value="api.groq.com/openai/v1" />
            <Callout title="Key handling" tone="teal">
              The key is held in this browser tab only and is sent directly to Groq. Documents are parsed locally; only
              unmatched label text is ever transmitted.
            </Callout>
          </section>
        </div>
      ) : null}

      {tab === "services" ? (
        <div>
          <RateDbCard />
          <Callout title="Keyless by default" tone="teal">
            Translation and live rates run through public endpoints that need no account. They are tried in order and
            fall through on failure. Nothing here is required: the work paper itself uses the offline IRS and US
            Treasury tables bundled with the tool.
          </Callout>

          {(["translate", "fx"] as const).map((kind) => {
            const order = kind === "translate" ? state.translateOrder : state.fxOrder;
            const list = PROVIDERS.filter((p) => p.kind === kind);
            return (
              <section className="panel" key={kind}>
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">{kind === "translate" ? "Document translation" : "Live exchange rates"}</span>
                    <h2>{kind === "translate" ? "Translation providers" : "Rate providers"}</h2>
                  </div>
                  <span className="mini-label">order: {order.join(" → ") || "none"}</span>
                </div>
                <div className="wp-table">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>Use</th>
                        <th>Provider</th>
                        <th>Endpoint</th>
                        <th style={{ width: 120 }}>Free allowance</th>
                        <th className="numeric" style={{ width: 118 }}>Used today</th>
                        <th style={{ width: 96 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((p) => {
                        const u = state.providerUsage[p.id];
                        const on = order.includes(p.id);
                        const pct = p.dailyLimit ? Math.min(1, (u?.units || 0) / p.dailyLimit) : 0;
                        return (
                          <tr key={p.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={p.id === "groq" || p.id === "tables"}
                                onChange={() =>
                                  actions.setProviderOrder(
                                    kind,
                                    on ? order.filter((x) => x !== p.id) : [...order, p.id],
                                  )
                                }
                              />
                            </td>
                            <td>
                              <strong>{p.name}</strong>
                              {p.keyless ? <span className="actor-tag system" style={{ marginLeft: 6 }}>keyless</span>
                                : <span className="actor-tag groq" style={{ marginLeft: 6 }}>key</span>}
                              <br /><small style={{ color: "var(--muted)" }}>{p.notes}</small>
                            </td>
                            <td className="ref-cell">{p.endpoint.replace(/^https?:\/\//, "")}</td>
                            <td>{p.dailyLimit ? `${p.dailyLimit.toLocaleString()} ${p.limitUnit}/day` : "none published"}</td>
                            <td className="numeric">
                              {(u?.units || 0).toLocaleString()} {p.limitUnit === "characters" ? "chars" : "req"}
                              {p.dailyLimit ? (
                                <div className="progress-track" style={{ marginTop: 4 }}><span style={{ width: `${pct * 100}%` }} /></div>
                              ) : null}
                            </td>
                            <td>
                              <span className={u?.lastStatus === "ok" ? "actor-tag system" : u?.lastStatus === "error" ? "actor-tag groq" : "actor-tag user"}>
                                {u?.lastStatus || "idle"}
                              </span>
                              {u?.lastLatency ? <><br /><small style={{ color: "var(--muted)" }}>{u.lastLatency} ms</small></> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {list.some((p) => state.providerUsage[p.id]?.lastError) ? (
                  <div className="log-list" style={{ marginTop: 10 }}>
                    {list.filter((p) => state.providerUsage[p.id]?.lastError).map((p) => (
                      <div key={p.id}>{p.name}: {state.providerUsage[p.id].lastError}</div>
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}

          <Callout title="Published rates still govern the work paper" tone="amber">
            Live quotes are indicative mid-market rates. Schedule C expects the IRS yearly average and Schedule F the
            US Treasury 12/31 spot rate, both of which ship with the tool. Both tables are CALENDAR-year figures —
            a fiscal-year entity (period ending in any month but December) never receives them and its rates are
            entered manually. When the IRS table has no average for a currency, the tool falls back to an OFX daily
            average over the entity&apos;s period — always labelled as OFX and flagged for confirmation — and to manual
            entry with the reason when OFX doesn&apos;t carry the currency either. Applying a live quote overrides C60
            and is recorded in the audit trail.
          </Callout>
        </div>
      ) : null}

      {tab === "usage" ? (
        <div>
          <div className="quota-grid">
            <section className="panel quota-card">
              <Ring pct={state.groq.tokens / QUOTA.aiTokens} label="AI quota" tone="#4f46e5" />
              <strong>AI tokens</strong>
              <p>{state.groq.tokens.toLocaleString()} of {QUOTA.aiTokens.toLocaleString()} · {(QUOTA.aiTokens - state.groq.tokens).toLocaleString()} remaining</p>
            </section>
            <section className="panel quota-card">
              <Ring pct={state.usage.docs / QUOTA.documents} label="Documents" tone="#0f8a7b" />
              <strong>Documents processed</strong>
              <p>{state.usage.docs} of {QUOTA.documents} · {QUOTA.documents - state.usage.docs} remaining</p>
            </section>
            <section className="panel quota-card">
              <Ring pct={storageMB / QUOTA.storageMB} label="Storage" tone="#b45309" />
              <strong>Storage used</strong>
              <p>{storageMB.toFixed(1)} MB of {QUOTA.storageMB} MB</p>
            </section>
            <section className="panel quota-card">
              <Ring pct={state.usage.api / QUOTA.apiRequests} label="API" tone="#7c3aed" />
              <strong>API requests</strong>
              <p>{state.usage.api} of {QUOTA.apiRequests.toLocaleString()} · {(QUOTA.apiRequests - state.usage.api).toLocaleString()} remaining</p>
            </section>
          </div>

          <section className="panel">
            <div className="panel-heading">
              <div><span className="section-kicker">Free services</span><h2>Keyless quota — resets daily</h2></div>
              <span className="mini-label">day {state.quotaDay}</span>
            </div>
            {PROVIDERS.filter((p) => p.keyless && p.endpoint !== "bundled").map((p) => {
              const u = state.providerUsage[p.id];
              return p.dailyLimit ? (
                <Meter key={p.id} label={`${p.name} (${p.limitUnit})`} used={u?.units || 0} total={p.dailyLimit} />
              ) : (
                <div className="fact-row" key={p.id}>
                  <span>{p.name}</span>
                  <strong>{(u?.requests || 0).toLocaleString()} request(s) · no published cap</strong>
                </div>
              );
            })}
          </section>

          <div className="two-column">
            <section className="panel">
              <div className="panel-heading"><div><span className="section-kicker">Detail</span><h2>Consumption this session</h2></div></div>
              <Meter label="AI tokens" used={state.groq.tokens} total={QUOTA.aiTokens} />
              <Meter label="Documents" used={state.usage.docs} total={QUOTA.documents} />
              <Meter label="Storage" used={Math.round(storageMB)} total={QUOTA.storageMB} unit=" MB" />
              <Meter label="API requests" used={state.usage.api} total={QUOTA.apiRequests} />
            </section>
            <section className="panel">
              <div className="panel-heading"><div><span className="section-kicker">Activity</span><h2>Output activity</h2></div></div>
              <Row label="Work papers generated" value={String(state.usage.generated)} />
              <Row label="Entities configured" value={String(state.entities.length)} />
              <Row label="Documents held" value={String(state.entities.reduce((n, e) => n + e.files.length, 0))} />
              <Row label="Stakeholder" value={state.stakeholder} />
              <Callout title="Measured, not sampled" tone="teal">
                These figures come from real activity in this session — files you added, Groq calls that actually ran and
                work papers that were generated.
              </Callout>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BackendCard() {
  const session = useSyncExternalStore(sessionSubscribe, sessionSnapshot, sessionSnapshot);
  const [url, setUrl] = useState(() => {
    const b = apiBase();
    return b === "__local__" || b === "" ? "" : b;
  });
  return (
    <div>
      <Row
        label="Mode"
        value={session.remote
          ? session.connected === false ? "Remote — backend unreachable" : "Remote — state, documents and tasks persist on the server"
          : "Local — everything stays in this tab"}
      />
      {session.remote ? <Row label="Sync" value={session.saveState === "saved" ? `saved ${session.lastSavedAt ?? ""}` : session.saveState} /> : null}
      <p className="hint" style={{ marginTop: 8 }}>
        Backend URL (leave empty when the app is served by the backend itself; set it to attach a static build to a
        remote server). Changing it takes effect after a reload.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="stake-input"
          style={{ maxWidth: 320 }}
          placeholder="https://your-backend.up.railway.app"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          className="button"
          onClick={() => { setApiBaseOverride(url); window.location.reload(); }}
        >
          Save & reload
        </button>
      </div>
      {!isRemote() ? (
        <p className="hint" style={{ marginTop: 8 }}>
          Task management needs the backend; without it the project still persists in THIS browser (IndexedDB) across
          refreshes and restarts.
        </p>
      ) : null}
      <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--line, #e5e5e5)" }}>
        <button
          type="button"
          className="button"
          onClick={() => {
            const sure = window.confirm(
              "Reset Project permanently clears EVERYTHING stored in this browser: documents, entities, mappings, edits, translations, policies and the rate database. This cannot be undone." +
              (isRemote() ? " Data already saved to the backend is NOT deleted." : ""),
            );
            if (!sure) return;
            void resetProject().then(() => window.location.reload());
          }}
        >
          Reset Project…
        </button>
        <small style={{ marginLeft: 8, color: "var(--muted)" }}>clears all local data after confirmation</small>
      </div>
    </div>
  );
}

function RateDbCard() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const db = state.rateDb;
  const years = rateDbYears(db);
  const [code, setCode] = useState("AUD");
  const [uploadReport, setUploadReport] = useState<string[]>([]);
  const codes = db.codes.map((c) => c.code).sort();
  const chosen = codes.includes(code) ? code : codes[0] || "";

  const onUpload = async (file: File) => {
    try {
      const sheets = await readWorkbookSheets(await file.arrayBuffer());
      const parsed = parseRatesWorkbook(sheets, file.name);
      if (!parsed.db) {
        setUploadReport(["The workbook was NOT applied:", ...parsed.errors, ...parsed.warnings]);
        return;
      }
      actions.replaceRateDb(parsed.db);
      setUploadReport(parsed.warnings.length ? ["Applied with warnings:", ...parsed.warnings] : [`Applied: ${file.name}`]);
    } catch (err) {
      setUploadReport([`Could not read the workbook: ${(err as Error).message}`]);
    }
  };

  const onDownload = async () => {
    const blob = await generateRatesWorkbook(db);
    if (!safeDownload(blob, "Rates.xlsx")) {
      /* toast happens via store paths elsewhere; keep it simple here */
      window.alert("Download was blocked by the browser");
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <div><span className="section-kicker">Currency Rate Database</span><h2>IRS averages & Treasury spot rates</h2></div>
        <div className="signoff-actions">
          <label className="button" style={{ cursor: "pointer" }}>
            Upload / replace
            <input
              type="file"
              accept=".xlsx"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.currentTarget.value = ""; }}
            />
          </label>
          <button type="button" className="button" onClick={() => void onDownload()}>Download Excel</button>
          <button type="button" className="button" onClick={() => actions.resetRateDb()}>Reset to built-in</button>
        </div>
      </div>
      <Row label="Source" value={db.source} />
      <Row label="Coverage" value={`${db.codes.length} currencies · ${years[0]}–${years[years.length - 1]}`} />
      <p className="hint">
        This database is the FIRST source for every rate lookup; live providers (OFX, then the configured fallbacks)
        are only consulted for spot rates the database lacks — and a rate found nowhere stays blank, never guessed.
        The workbook has three sheets: <strong>Currency Code</strong>, <strong>IRS Average Rate</strong>,
        <strong> Treasury Spot Rate</strong> — all three are validated on upload.
      </p>
      {uploadReport.length ? (
        <Callout title="Upload result" tone={uploadReport[0].startsWith("The workbook was NOT") || uploadReport[0].startsWith("Could not") ? "amber" : "teal"}>
          {uploadReport.map((l, i) => <div key={i}>{l}</div>)}
        </Callout>
      ) : null}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0 6px" }}>
        <span className="section-kicker">Edit rates</span>
        <select className="stake-input" style={{ maxWidth: 130 }} value={chosen} onChange={(e) => setCode(e.target.value)}>
          {codes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <small style={{ color: "var(--muted)" }}>{db.codes.find((c) => c.code === chosen)?.country || ""}</small>
      </div>
      <div className="wp-table rules-table">
        <table>
          <thead><tr><th style={{ width: 70 }}>Year</th><th>IRS average</th><th>Treasury 12/31 spot</th></tr></thead>
          <tbody>
            {years.map((y) => (
              <tr key={y}>
                <td className="ref-cell">{y}</td>
                <td>
                  <input
                    className="rule-input"
                    defaultValue={db.irsAvg[chosen]?.[y] ?? ""}
                    key={`a-${chosen}-${y}-${db.irsAvg[chosen]?.[y] ?? ""}`}
                    onBlur={(e) => actions.setDbRate(chosen, "avg", y, e.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="rule-input"
                    defaultValue={db.spot[chosen]?.[y] ?? ""}
                    key={`s-${chosen}-${y}-${db.spot[chosen]?.[y] ?? ""}`}
                    onBlur={(e) => actions.setDbRate(chosen, "spot", y, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
