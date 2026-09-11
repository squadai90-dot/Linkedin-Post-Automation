"use client";

import { useState, useSyncExternalStore } from "react";
import { Callout, SectionHeader, StatusPill } from "../primitives";
import type { ViewId } from "../Shell";
import { BS_LINES, CATEGORY_CELLS, IS_LINES, OWNERSHIP_FIELDS, explainUnreadable } from "./engine";
import { displayLabel } from "./captions";
import {
  actions, allReviewItems, buildWrites, cellCount, getSnapshot, readState, subscribe, validateEntity,
  PROCESS_STEPS, type Entity,
} from "./store";

const bytes = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;

function useWp() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function ActiveEntityBar({ state }: { state: ReturnType<typeof getSnapshot> }) {
  if (state.entities.length < 2) return null;
  return (
    <div className="entity-switch">
      <span>Entity</span>
      {state.entities.map((e) => (
        <button
          key={e.id}
          type="button"
          className={e.id === state.activeEntityId ? "chip-btn active" : "chip-btn"}
          onClick={() => actions.setActiveEntity(e.id)}
        >
          {e.name}
        </button>
      ))}
    </div>
  );
}

const active = (state: ReturnType<typeof getSnapshot>): Entity | undefined =>
  state.entities.find((e) => e.id === state.activeEntityId) || state.entities[0];

function NoData({ what }: { what: string }) {
  return (
    <Callout title={`Nothing to show yet`} tone="amber">
      {what} Load documents against an entity in <strong>Entities &amp; documents</strong> and run processing.
    </Callout>
  );
}

/* ============================ 01 Executive overview ============================ */
export function OverviewView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const state = useWp();
  const docs = state.entities.reduce((n, e) => n + e.files.length, 0);
  const lines = state.entities.reduce((n, e) => n + Object.keys(e.lines).length, 0);
  const cells = state.entities.reduce((n, e) => n + cellCount(e), 0);
  const blockers = state.entities.reduce((n, e) => n + allReviewItems(e).filter((b) => b.level === "block" && !b.dismissed).length, 0);

  return (
    <div className="view-stack">
      <SectionHeader
        kicker={state.stakeholder}
        title="Executive overview"
        description="A controlled path from evidence to work paper. Every number below is counted from documents you have actually loaded — the tool populates the uploaded master template and never redraws it."
        action={
          <div className="signoff-actions">
            <button type="button" className="button" onClick={() => onNavigate("entities")}>Open workspace</button>
            {state.entities.some((e) => Object.keys(e.lines).length > 0 || e.status === "ready") ? (
              <button type="button" className="button primary" disabled={state.busy} onClick={() => void actions.generateWorkpapers()}>
                {state.busy ? "Working…" : "Generate work paper"}
              </button>
            ) : (
              // Nothing processed yet — there is nothing to generate. One
              // button, state-dependent: preview the untouched template.
              <button
                type="button"
                className="button primary"
                disabled={state.busy}
                title="Nothing has been processed yet — download the untouched master template to preview the output format."
                onClick={() => actions.downloadBlankTemplate()}
              >
                Preview format
              </button>
            )}
          </div>
        }
      />
      <div className="metric-grid">
        <div className="metric-card"><strong>{state.entities.length}</strong><span>Entities</span><em>{state.entities.filter((e) => e.status === "ready").length} processed</em></div>
        <div className="metric-card"><strong>{docs}</strong><span>Documents</span><em>{bytes(state.usage.storage)}</em></div>
        <div className="metric-card"><strong>{lines}</strong><span>Lines mapped</span><em>{cells} cells queued</em></div>
        <div className={blockers ? "metric-card warn" : "metric-card"}><strong>{blockers}</strong><span>Blocking issues</span><em>{blockers ? "must clear before output" : "ready to generate"}</em></div>
      </div>

      <section className="panel">
        <div className="panel-heading"><div><span className="section-kicker">Operating flow</span><h2>Nine controlled stages</h2></div></div>
        <ol className="stage-list">
          {["Receive and secure", "Inventory and classify", "Extract and translate", "Reconcile history",
            "Normalize and map", "Apply tax and FX rules", "Generate draft", "Mandatory review", "Finalize and archive"]
            .map((s, i) => (
              <li key={s} className={i === 7 ? "gate" : ""}>
                <span className="ref-cell">{String(i + 1).padStart(2, "0")}</span>
                <strong>{s}</strong>
                <span className="run-state">{i === 7 ? "human gate" : i < 7 ? "automated" : "system"}</span>
              </li>
            ))}
        </ol>
      </section>

      <div className="two-column">
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Decision model</span><h2>AI proposes, rules calculate, people approve</h2></div></div>
          <div className="fact-row"><span>Local document intelligence</span><strong>Classify, extract, translate, propose</strong></div>
          <div className="fact-row"><span>Deterministic rules</span><strong>{state.rules.length} mapping rules + FX policy</strong></div>
          <div className="fact-row"><span>Professional control</span><strong>Judgments, overrides, sign-off</strong></div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Output</span><h2>Master template</h2></div></div>
          <div className="fact-row"><span>Template</span><strong>Final_Copy_of_5471_workpaper.XLSX</strong></div>
          <div className="fact-row"><span>Sheets preserved</span><strong>19 of 19</strong></div>
          <div className="fact-row"><span>Formulas rewritten</span><strong>0</strong></div>
          <div className="fact-row"><span>USD translation</span><strong>Template formulas, from C59/C60/C61</strong></div>
        </section>
      </div>
    </div>
  );
}

/* ============================ 02 Portfolio ============================ */
export function PortfolioView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const state = useWp();
  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Engagement portfolio"
        title="Portfolio dashboard"
        description="Every entity under this stakeholder with its live readiness. Select one to make it the active entity across the workspace tabs."
        action={<button type="button" className="button" onClick={() => { actions.addEntity(); onNavigate("entities"); }}>+ Add entity</button>}
      />
      <section className="panel">
        <div className="wp-table">
          <table>
            <thead>
              <tr><th>Entity</th><th>Currency</th><th className="numeric">Docs</th><th className="numeric">Lines</th>
                <th className="numeric">Unmatched</th><th className="numeric">Cells</th><th>Blockers</th><th>Status</th><th style={{ width: 78 }} /></tr>
            </thead>
            <tbody>
              {state.entities.map((e) => {
                const block = allReviewItems(e).filter((b) => b.level === "block" && !b.dismissed).length;
                return (
                  <tr key={e.id} className={e.id === state.activeEntityId ? "row-active" : ""}>
                    <td><strong>{e.name}</strong><br /><small style={{ color: "var(--muted)" }}>{e.profile.legalName || "legal name not set"}</small></td>
                    <td>{e.profile.currency || "—"}</td>
                    <td className="numeric">{e.files.length}</td>
                    <td className="numeric">{Object.keys(e.lines).length}</td>
                    <td className="numeric">{e.unmatched.length}</td>
                    <td className="numeric">{cellCount(e)}</td>
                    <td>{block ? <span className="actor-tag groq">{block}</span> : <span className="actor-tag system">none</span>}</td>
                    <td><StatusPill status={e.status} /></td>
                    <td><button type="button" className="button" onClick={() => { actions.setActiveEntity(e.id); onNavigate("workspace"); }}>Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ============================ 04 Entity workspace ============================ */
export function WorkspaceView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const state = useWp();
  const ent = active(state);
  if (!ent) return null;
  const issues = allReviewItems(ent).filter((b) => !b.dismissed);
  return (
    <div className="view-stack">
      <SectionHeader
        kicker={state.stakeholder}
        title="Entity workspace"
        description="Everything known about the active entity, and what still stands between it and a finished work paper."
        action={<button type="button" className="button primary" disabled={state.busy || cellCount(ent) === 0} onClick={() => void actions.generateOne(ent.id)}>Generate this entity</button>}
      />
      <ActiveEntityBar state={state} />
      <div className="metric-grid">
        <div className="metric-card"><strong>{ent.files.length}</strong><span>Documents</span><em>{bytes(ent.files.reduce((n, f) => n + f.size, 0))}</em></div>
        <div className="metric-card"><strong>{Object.keys(ent.lines).length}</strong><span>Lines mapped</span><em>{cellCount(ent)} cells</em></div>
        <div className="metric-card"><strong>{ent.unmatched.length}</strong><span>Unmatched</span><em>{ent.unmatched.length ? "needs review" : "clear"}</em></div>
        <div className={issues.some((i) => i.level === "block") ? "metric-card warn" : "metric-card"}>
          <strong>{issues.length}</strong><span>Open issues</span><em>{issues.filter((i) => i.level === "block").length} blocking</em>
        </div>
      </div>
      <div className="two-column">
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Identity</span><h2>{ent.name}</h2></div><StatusPill status={ent.status} /></div>
          <div className="fact-row"><span>Legal name</span><strong>{ent.profile.legalName || "—"}</strong></div>
          <div className="fact-row"><span>Country of incorporation</span><strong>{ent.profile.countryInc || "—"}</strong></div>
          <div className="fact-row"><span>Functional currency</span><strong>{ent.profile.currency || "—"}</strong></div>
          <div className="fact-row"><span>Current year end</span><strong>{ent.profile.cyEnd || "—"}</strong></div>
          <div className="fact-row"><span>Prior year end</span><strong>{ent.profile.pyEnd || "—"}</strong></div>
          <div className="fact-row"><span>Categories</span><strong>{Object.keys(CATEGORY_CELLS).filter((c) => ent.categories[c]).join(", ") || "none selected"}</strong></div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Readiness</span><h2>Open issues</h2></div>
            <button type="button" className="button" onClick={() => onNavigate("exceptions")}>Exception center</button></div>
          {issues.length ? (
            <div className="log-list">
              {issues.map((b, i) => (
                <div key={i}><span className={b.level === "block" ? "actor-tag groq" : "actor-tag user"}>{b.level}</span> {b.message}</div>
              ))}
            </div>
          ) : <p className="hint">No open issues. This entity is ready to generate.</p>}
        </section>
      </div>
    </div>
  );
}

/* ============================ 05 Document intake ============================ */

/* Manual type choices: label → override (empty = back to automatic). */
const DOC_KIND_CHOICES: { label: string; kind: string; pageHint?: "fs-pnl" | "fs-balance-sheet" }[] = [
  { label: "Automatic", kind: "" },
  { label: "Financial statements — P&L pages", kind: "cfc-financial-statements", pageHint: "fs-pnl" },
  { label: "Financial statements — balance sheet", kind: "cfc-financial-statements", pageHint: "fs-balance-sheet" },
  { label: "Financial statements (mixed)", kind: "cfc-financial-statements" },
  { label: "Local tax return", kind: "cfc-tax-return" },
  { label: "Prior-year US return (5471)", kind: "prior-year-us-return" },
  { label: "Related-party ledger", kind: "related-party-ledger" },
  { label: "Client questionnaire", kind: "client-questionnaire" },
  { label: "Related-party salary schedule", kind: "related-party-salary" },
  { label: "Trial balance", kind: "trial-balance" },
  { label: "Exclude (terms / other)", kind: "terms-and-conditions" },
];

/* Which worksheets to read. Only offered once a workbook has actually been
   read, because only then are its tab names known — and only for workbooks,
   since a PDF has no tabs. Nothing selected means automatic ranking. */
function DocSheetSelect({ entityId, fileId }: { entityId: string; fileId: string }) {
  const state = useWp();
  const ent = state.entities.find((e) => e.id === entityId);
  const file = ent?.files.find((f) => f.id === fileId);
  const names = file?.sheetNames || [];
  if (names.length < 2) return null;
  const pinned = ent?.docKindOverrides?.[fileId]?.sheets || [];
  return (
    <select
      multiple
      size={Math.min(names.length, 4)}
      value={pinned}
      onChange={(e) => {
        const chosen = [...e.target.selectedOptions].map((o) => o.value);
        actions.setDocSheets(entityId, fileId, chosen);
      }}
      title={pinned.length
        ? "Worksheets read from this workbook — clear the selection to go back to automatic"
        : "Automatic: statement tabs are read, administrative tabs are skipped. Select tabs to pin an explicit list."}
    >
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

function ReadStatusCell({ entityId, fileId }: { entityId: string; fileId: string }) {
  const state = useWp();
  const ent = state.entities.find((e) => e.id === entityId);
  const file = ent?.files.find((f) => f.id === fileId);
  if (!file) return null;
  const status = readState(ent, file);
  const tone = status === "text read" ? "system"
    : status === "not read yet" ? ""
    : status === "scan — needs OCR" ? "groq"
    : "user";
  return (
    <span className={`actor-tag ${tone}`} title={status === "text read" ? undefined : explainUnreadable(file.name)}>
      {status}
    </span>
  );
}

function DocKindSelect({ entityId, fileId }: { entityId: string; fileId: string }) {
  const state = useWp();
  const ent = state.entities.find((e) => e.id === entityId);
  const ov = ent?.docKindOverrides?.[fileId];
  const current = ov?.kind ? `${ov.kind}|${ov.pageHint || ""}` : "|";
  return (
    <select
      value={current}
      onChange={(e) => {
        const [kind, hint] = e.target.value.split("|");
        actions.setDocKind(entityId, fileId, kind as never, (hint || undefined) as never);
      }}
      title="Manual document type — wins over automatic classification on the next processing run"
    >
      {DOC_KIND_CHOICES.map((c) => (
        <option key={c.label} value={`${c.kind}|${c.pageHint || ""}`}>{c.label}</option>
      ))}
    </select>
  );
}

export function IntakeView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const state = useWp();
  const all = state.entities.flatMap((e) => e.files.map((f) => ({ ...f, entityId: e.id, entity: e.name, status: e.status, progress: e.progress, cls: e.docClasses[f.id] })));
  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Evidence intake"
        title="Document intake"
        description="Every file loaded in this session, which entity holds it, what the classifier decided, and the manual Type override when the rules get it wrong."
        action={<button type="button" className="button" onClick={() => onNavigate("entities")}>Add documents</button>}
      />
      <div className="metric-grid">
        <div className="metric-card"><strong>{all.length}</strong><span>Documents held</span><em>{bytes(state.usage.storage)}</em></div>
        <div className="metric-card"><strong>{all.filter((f) => f.parsable).length}</strong><span>Parsed locally</span><em>xlsx, csv, tsv, txt, pdf</em></div>
        <div className="metric-card"><strong>{all.filter((f) => !f.parsable).length}</strong><span>Unsupported format</span><em>.xls, images, docx</em></div>
        <div className="metric-card"><strong>{state.usage.docs}</strong><span>Processed</span><em>this session</em></div>
      </div>
      {all.length ? (
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Inventory</span><h2>Loaded documents</h2></div></div>
          <div className="wp-table">
            <table>
              <thead><tr><th>File</th><th>Entity</th><th>Classified as</th><th>Type</th><th>Worksheets</th><th className="numeric">Size</th><th>Read status</th></tr></thead>
              <tbody>
                {all.map((f) => (
                  <tr key={`${f.entityId}/${f.id}`}>
                    <td>
                      <strong>{f.name}</strong>
                      {f.cls?.blocks5471 && f.cls.blocks5471.length > 1 ? (
                        <><br /><small style={{ color: "var(--muted)" }}>
                          {f.cls.blocks5471.length} × Form 5471 ({f.cls.blocks5471.map((b) => b.cfcName || "unnamed").join(", ")})
                        </small></>
                      ) : null}
                    </td>
                    <td>{f.entity}</td>
                    <td>
                      {f.cls
                        ? <span className={f.cls.method === "user" ? "actor-tag user" : "actor-tag system"}>{f.cls.kind}{f.cls.duplicateOf ? " · duplicate" : ""}</span>
                        : <span className="actor-tag">not processed</span>}
                    </td>
                    <td><DocKindSelect entityId={f.entityId} fileId={f.id} /></td>
                    <td><DocSheetSelect entityId={f.entityId} fileId={f.id} /></td>
                    <td className="numeric">{bytes(f.size)}</td>
                    {/* Not "native parser" for every PDF, including one the
                        tool could not read a character of — that is precisely
                        the case a preparer must be able to see. */}
                    <td><ReadStatusCell entityId={f.entityId} fileId={f.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">A manual Type wins over the automatic classification the next time the entity is processed.</p>
        </section>
      ) : <NoData what="No documents have been loaded yet." />}

      <section className="panel">
        <div className="panel-heading"><div><span className="section-kicker">Pipeline</span><h2>Processing stages</h2></div></div>
        <ol className="stage-list">
          {PROCESS_STEPS.map((s, i) => <li key={s}><span className="ref-cell">{String(i + 1).padStart(2, "0")}</span><strong>{s}</strong></li>)}
        </ol>
      </section>
    </div>
  );
}

/* ============================ 07 Ownership & category ============================ */
export function CategoryView() {
  const state = useWp();
  const ent = active(state);
  if (!ent) return null;
  const chosen = Object.keys(CATEGORY_CELLS).filter((c) => ent.categories[c]);
  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Filer determination"
        title="Ownership & category"
        description="Ownership facts and the filing categories they support. These write to Basic Information C33:C40 and B42:B50 and drive which schedules the template expects."
      />
      <ActiveEntityBar state={state} />
      <div className="two-column">
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Facts</span><h2>Ownership</h2></div></div>
          <div className="field-grid">
            {OWNERSHIP_FIELDS.map((f) => (
              <label className={ent.detected[f.key] ? "wp-field detected" : "wp-field"} key={f.key}>
                <span>
                  {f.label}{f.type === "pct" ? " (%)" : ""}
                  {ent.detected[f.key] ? <span className="auto-badge">auto</span> : null}
                </span>
                {f.type === "yn" ? (
                  <select value={ent.ownership[f.key] || ""} onChange={(e) => actions.setField(ent.id, "ownership", f.key, e.target.value)}>
                    <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>
                  </select>
                ) : (
                  <input type="number" value={ent.ownership[f.key] || ""} onChange={(e) => actions.setField(ent.id, "ownership", f.key, e.target.value)} />
                )}
                <em>{f.cell}</em>
              </label>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">{chosen.length} selected</span><h2>Filing categories</h2></div></div>
          <div className="cat-row">
            {Object.keys(CATEGORY_CELLS).map((c) => (
              <label key={c} className={ent.categories[c] ? "cat-chip on" : "cat-chip"}>
                <input type="checkbox" checked={!!ent.categories[c]} onChange={() => actions.toggleCategory(ent.id, c)} />
                Category {c}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            {Object.entries(CATEGORY_CELLS).map(([c, cell]) => (
              <div className="fact-row" key={c}><span>Category {c}</span><strong>{ent.categories[c] ? `Yes → ${cell}` : "—"}</strong></div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ============================ 08 Mapping & adjustments ============================ */
export function MappingView() {
  const state = useWp();
  const ent = active(state);
  if (!ent) return null;
  const rows = [
    ...IS_LINES.filter((l) => ent.lines[`IS:${l.row}`]).map((l) => ({ kind: "Sch C", l, key: `IS:${l.row}` })),
    ...BS_LINES.filter((l) => ent.lines[`BS:${l.row}`]).map((l) => ({ kind: "Sch F", l, key: `BS:${l.row}` })),
  ];
  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Trial balance to template"
        title="Mapping & adjustments"
        description="Which document caption produced each populated line, and the value written. Amounts are in local currency exactly as reported — the template does the USD translation."
      />
      <ActiveEntityBar state={state} />
      {rows.length ? (
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">{rows.length} populated lines</span><h2>{ent.name}</h2></div></div>
          <div className="wp-table">
            <table>
              <thead><tr><th style={{ width: 60 }}>Sch</th><th>Template line</th><th>Source caption</th><th className="numeric">Value (LC)</th><th style={{ width: 68 }}>Cell</th></tr></thead>
              <tbody>
                {rows.map(({ kind, l, key }) => {
                  const d = ent.lines[key];
                  const src = ent.sourceLabels[key];
                  const contribs = ent.contributions[key] || [];
                  const captions = [...new Set(contribs.map((c) => c.label))];
                  const val = kind === "Sch C" ? d.amount : d.eoy;
                  return (
                    <tr key={key}>
                      <td className="ref-cell">{kind}</td>
                      <td><strong>{ent.relabels[key] || l.label}</strong></td>
                      <td style={{ color: "var(--muted)" }}>
                        {captions.length ? (
                          captions.map((caption) => {
                            const group = contribs.filter((c) => c.label === caption);
                            return (
                              <div key={caption} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                                <span>
                                  {caption}{" "}
                                  <small>
                                    ({group.map((c) => `${c.field} ${c.value.toLocaleString()}${c.year ? ` · ${c.year}` : ""}${c.period ? ` · ${c.period}` : ""}`).join(", ")}
                                    {group[0].docName ? ` · ${group[0].docName}${group[0].page ? ` p.${group[0].page}` : ""}` : ""}
                                    {group[0].via !== "rule" ? ` · ${group[0].via}` : ""})
                                  </small>
                                </span>
                                <select
                                  className="stake-input"
                                  style={{ maxWidth: 220, padding: "2px 6px" }}
                                  value={key}
                                  onChange={(e) => actions.remapCaption(ent.id, key, caption, e.target.value || null)}
                                >
                                  <option value="">— unassign —</option>
                                  {IS_LINES.map((x) => <option key={`is${x.row}`} value={`IS:${x.row}`}>Sch C · {x.label}</option>)}
                                  {BS_LINES.map((x) => <option key={`bs${x.row}`} value={`BS:${x.row}`}>Sch F · {x.label}</option>)}
                                </select>
                              </div>
                            );
                          })
                        ) : src ? src.label : "entered manually"}
                      </td>
                      <td className="numeric">{typeof val === "number" ? val.toLocaleString() : "—"}</td>
                      <td className="ref-cell">{kind === "Sch C" ? `F${l.row}` : `D/F${l.row}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : <NoData what="No lines have been mapped for this entity." />}
    </div>
  );
}

/* ============================ 10 Workpaper readiness ============================ */
export function ReadinessView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const state = useWp();
  const ent = active(state);
  if (!ent) return null;
  const issues = allReviewItems(ent).filter((b) => !b.dismissed);
  const blocking = issues.filter((i) => i.level === "block");
  const writes = buildWrites(ent);
  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Pre-flight"
        title="Workpaper readiness"
        description="What will be written, and everything that would make the output wrong. Generation is refused while a blocking issue remains, because those are the conditions that produce #DIV/0! in the USD columns."
        action={
          // Readiness is the pre-flight display; generation itself lives in
          // Overview / Preview / Workspace / Sign-off.
          <button type="button" className="button" onClick={() => onNavigate("signoff")}>Open sign-off</button>
        }
      />
      <ActiveEntityBar state={state} />
      <div className="metric-grid">
        <div className="metric-card"><strong>{cellCount(ent)}</strong><span>Cells to write</span><em>{Object.keys(writes).length} sheets</em></div>
        <div className={blocking.length ? "metric-card warn" : "metric-card"}><strong>{blocking.length}</strong><span>Blocking</span><em>must be cleared</em></div>
        <div className="metric-card"><strong>{issues.length - blocking.length}</strong><span>Advisory</span><em>review recommended</em></div>
        <div className="metric-card"><strong>{ent.fxAuto ? "Auto" : "Manual"}</strong><span>FX rates</span><em>{ent.profile.currency || "no currency"}</em></div>
      </div>
      <section className="panel">
        <div className="panel-heading"><div><span className="section-kicker">Checks</span><h2>Readiness checklist</h2></div>
          <button type="button" className="button" onClick={() => onNavigate("fx")}>Open FX rates</button></div>
        {issues.length ? (
          <div className="wp-table">
            <table>
              <thead><tr><th style={{ width: 90 }}>Level</th><th>Finding</th></tr></thead>
              <tbody>
                {issues.map((b, i) => (
                  <tr key={i}>
                    <td><span className={b.level === "block" ? "actor-tag groq" : "actor-tag user"}>{b.level}</span></td>
                    <td>{b.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state"><span>✓</span><strong>All checks passed</strong><p>Every USD column will calculate.</p></div>
        )}
      </section>
    </div>
  );
}

/* ============================ 11 Exception center ============================ */
export function ExceptionsView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const state = useWp();
  const all = state.entities.flatMap((e) =>
    allReviewItems(e).map((b) => {
      const linked = e.extraWrites.find((w) => w.reviewId === b.id);
      return {
        ...b,
        entity: e.name,
        entityId: e.id,
        // The value a reviewer may edit: the linked workbook write's current
        // value, else the item's suggestion.
        currentValue: linked !== undefined ? linked.value : b.suggestedValue,
      };
    }));
  const open = all.filter((b) => !b.dismissed);
  const dismissed = all.filter((b) => b.dismissed);
  // Items a policy removed entirely — kept visible so suppression is auditable.
  const suppressed = state.entities.flatMap((e) => {
    const visible = new Set(allReviewItems(e).map((r) => r.id));
    return allReviewItems(e, { raw: true })
      .filter((r) => !visible.has(r.id) && !r.dismissed)
      .map((r) => ({ ...r, entity: e.name, entityId: e.id }));
  });
  const [drafts, setDrafts] = useState<Record<string, { value: string; note: string }>>({});
  const draftKey = (b: { entityId: string; id: string }) => b.entityId + "|" + b.id;
  /* Resolve the caption against the entity's translations here, so the
     Exception Centre shows the same English the evidence tab does. */
  const unmatched = state.entities.flatMap((e) => e.unmatched.map((u, i) => ({
    entity: e.name, entityId: e.id, index: i, ...u, english: displayLabel(e.translations, u.label),
  })));
  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Open items"
        title="Exception center"
        description="Everything standing between the loaded documents and a clean work paper, across all entities."
        action={<button type="button" className="button" onClick={() => onNavigate("entities")}>Open workspace</button>}
      />
      <div className="metric-grid">
        <div className="metric-card warn"><strong>{open.filter((b) => b.level === "block").length}</strong><span>Blocking</span><em>output refused</em></div>
        <div className="metric-card"><strong>{open.filter((b) => b.level === "warn").length}</strong><span>Review</span><em>judgment required</em></div>
        <div className="metric-card"><strong>{open.filter((b) => b.level === "info").length}</strong><span>Informational</span><em>decisions on record</em></div>
        <div className="metric-card"><strong>{unmatched.length}</strong><span>Unassigned captions</span><em>not yet bound to a line</em></div>
      </div>

      {open.length ? (
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">{open.length} open items</span><h2>Exceptions and review items</h2></div></div>
          <div className="wp-table">
            <table>
              <thead><tr><th style={{ width: 76 }}>Level</th><th style={{ width: 130 }}>Entity</th><th style={{ width: 110 }}>Category</th><th>Finding</th><th style={{ width: 170 }}>Target</th><th style={{ width: 170 }} /></tr></thead>
              <tbody>
                {open.map((b) => (
                  <tr key={b.entityId + b.id}>
                    <td>
                      <span className={b.level === "block" ? "actor-tag groq" : b.level === "warn" ? "actor-tag user" : "actor-tag system"}>{b.level}</span>
                      {b.policy && b.policy.from !== b.level ? (
                        <small style={{ display: "block", opacity: 0.7 }}>policy: {b.policy.from}→{b.level}</small>
                      ) : null}
                    </td>
                    <td>{b.entity}</td>
                    <td>
                      {b.category}
                      {!b.policy ? (
                        <button
                          type="button"
                          className="button"
                          style={{ display: "block", marginTop: 4, fontSize: 11, padding: "1px 6px" }}
                          title="Create a policy rule matching this exception so future runs level it the same way"
                          onClick={() => actions.addPolicyRule({ match: { id: b.id }, action: b.level, note: "created from the exception center" })}
                        >
                          + policy
                        </button>
                      ) : null}
                    </td>
                    <td>
                      {b.message}
                      {b.source ? <small style={{ display: "block", opacity: 0.7 }}>Source: {b.source}</small> : null}
                    </td>
                    <td>{b.target || "—"}{b.applied ? <small style={{ display: "block", opacity: 0.7 }}>pre-filled</small> : null}</td>
                    <td>
                      {b.id === "fx-currency-unconfirmed" ? (
                        <button type="button" className="button primary" onClick={() => actions.confirmCurrency(b.entityId)}>
                          Confirm {(state.entities.find((e) => e.id === b.entityId)?.profile.currency || "").toUpperCase()}
                        </button>
                      ) : b.id === "cf-name-unconfirmed" ? (
                        (() => {
                          const mm = state.entities.find((e) => e.id === b.entityId)?.nameMismatch;
                          const key = draftKey(b);
                          const typed = drafts[key]?.value ?? mm?.statementName ?? "";
                          return (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <input
                                className="stake-input"
                                style={{ maxWidth: 220, padding: "2px 6px" }}
                                value={typed}
                                onChange={(e) => setDrafts((d) => ({ ...d, [key]: { value: e.target.value, note: d[key]?.note ?? "" } }))}
                                aria-label="Legal name of the foreign corporation"
                              />
                              <button type="button" className="button primary" onClick={() => actions.confirmLegalName(b.entityId, typed, true)}>
                                Same entity — use the prior return
                              </button>
                              <button type="button" className="button" onClick={() => actions.confirmLegalName(b.entityId, typed, false)}>
                                Different entity
                              </button>
                            </div>
                          );
                        })()
                      ) : b.id === "officer-flag-unconfirmed" ? (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button type="button" className="button primary" onClick={() => actions.setField(b.entityId, "ownership", "isOfficer", "Yes")}>Yes</button>
                          <button type="button" className="button" onClick={() => actions.setField(b.entityId, "ownership", "isOfficer", "No")}>No</button>
                        </div>
                      ) : b.message.includes("rate (C") ? (
                        <button type="button" className="button" onClick={() => { actions.setActiveEntity(b.entityId); actions.autoFillRates(b.entityId); }}>Apply rates</button>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {b.level !== "block" && b.currentValue !== undefined ? (
                            <>
                              <input
                                className="stake-input"
                                style={{ maxWidth: 150, padding: "2px 6px" }}
                                value={drafts[draftKey(b)]?.value ?? String(b.currentValue)}
                                onChange={(e) => setDrafts((d) => ({ ...d, [draftKey(b)]: { value: e.target.value, note: d[draftKey(b)]?.note ?? "" } }))}
                              />
                              <input
                                className="stake-input"
                                style={{ maxWidth: 150, padding: "2px 6px" }}
                                placeholder="note (optional)"
                                value={drafts[draftKey(b)]?.note ?? ""}
                                onChange={(e) => setDrafts((d) => ({ ...d, [draftKey(b)]: { value: d[draftKey(b)]?.value ?? String(b.currentValue), note: e.target.value } }))}
                              />
                              <button
                                type="button"
                                className="button primary"
                                onClick={() => {
                                  const d = drafts[draftKey(b)];
                                  actions.resubmitReviewItem(b.entityId, b.id, d?.value ?? String(b.currentValue), d?.note || undefined);
                                }}
                              >
                                Save & sign off
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            className="button"
                            onClick={() => {
                              const note = b.level === "block"
                                ? window.prompt("Acknowledging a blocking exception is a documented sign-off. Add a note for the audit trail:") ?? undefined
                                : undefined;
                              if (b.level === "block" && note === undefined) return;
                              actions.dismissReviewItem(b.entityId, b.id, note);
                            }}
                          >
                            {b.level === "block" ? "Acknowledge & unblock" : "Sign off"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="empty-state"><span>✓</span><strong>No exceptions</strong><p>Every entity passes validation.</p></div>
      )}

      {suppressed.length ? (
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">{suppressed.length} suppressed</span><h2>Suppressed by policy</h2></div></div>
          <p className="hint">
            These exceptions were computed but a policy rule removes them from the open list. Suppressing a blocking
            exception is a standing acknowledgement — it is logged on every generation. Manage rules in Settings ▸ Policies.
          </p>
          <div className="wp-table">
            <table>
              <thead><tr><th style={{ width: 76 }}>Level</th><th style={{ width: 130 }}>Entity</th><th>Finding</th></tr></thead>
              <tbody>
                {suppressed.map((b) => (
                  <tr key={b.entityId + b.id} style={{ opacity: 0.55 }}>
                    <td><span className="actor-tag system">{b.level}</span></td>
                    <td>{b.entity}</td>
                    <td>{b.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {dismissed.length ? (
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">{dismissed.length} signed off</span><h2>Acknowledged items</h2></div></div>
          <div className="wp-table">
            <table>
              <thead><tr><th style={{ width: 76 }}>Level</th><th style={{ width: 130 }}>Entity</th><th>Finding</th><th style={{ width: 120 }} /></tr></thead>
              <tbody>
                {dismissed.map((b) => (
                  <tr key={b.entityId + b.id} style={{ opacity: 0.55 }}>
                    <td><span className="actor-tag system">{b.level}</span></td>
                    <td>{b.entity}</td>
                    <td>
                      {b.message}
                      {b.resolution === "edited" ? (
                        <small style={{ display: "block" }}>
                          <span className="actor-tag groq">edited → {typeof b.editedValue === "number" ? b.editedValue.toLocaleString() : b.editedValue}</span>
                          {b.priorValue !== undefined ? <> was {typeof b.priorValue === "number" ? b.priorValue.toLocaleString() : b.priorValue}</> : null}
                        </small>
                      ) : null}
                      {b.dismissedNote ? <small style={{ display: "block" }}>Note: {b.dismissedNote}</small> : null}
                    </td>
                    <td><button type="button" className="button" onClick={() => actions.restoreReviewItem(b.entityId, b.id)}>Restore</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {unmatched.length ? (
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">{unmatched.length} captions</span><h2>Unassigned captions</h2></div></div>
          <div className="wp-table">
            <table>
              <thead><tr><th>Caption</th><th>Entity</th><th className="numeric">Values</th><th style={{ width: 200 }}>Assign to</th></tr></thead>
              <tbody>
                {unmatched.map((u, i) => (
                  <tr key={u.entityId + u.label + i}>
                    <td>
                      <strong>{u.english}</strong>
                      {u.english !== u.label ? <small style={{ display: "block", opacity: 0.7 }}>{u.label}</small> : null}
                      {u.docName ? <small style={{ display: "block", opacity: 0.7 }}>{u.docName}{u.page ? ` · p.${u.page}` : ""}</small> : null}
                      {u.reason ? <small style={{ display: "block", color: "var(--muted)" }}>{u.reason}</small> : null}
                    </td>
                    <td>{u.entity}</td>
                    <td className="numeric">{u.values.map((v) => v.toLocaleString()).join(" · ")}</td>
                    <td>
                      <select value="" onChange={(e) => actions.assignUnmatched(u.entityId, u.index, e.target.value)}>
                        <option value="">—</option>
                        {IS_LINES.map((l) => <option key={`is${l.row}`} value={`IS:${l.row}`}>Sch C · {l.label}</option>)}
                        {BS_LINES.map((l) => <option key={`bs${l.row}`} value={`BS:${l.row}`}>Sch F · {l.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ============================ 13 Review & sign-off ============================ */
export function SignoffView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const state = useWp();
  const ent = active(state);
  if (!ent) return null;
  const issues = allReviewItems(ent).filter((b) => !b.dismissed);
  const blocking = issues.filter((i) => i.level === "block");
  const ready = blocking.length === 0 && cellCount(ent) > 0;
  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Human gate"
        title="Review & sign-off"
        description="The final check before a work paper leaves the tool. Nothing is written to the template until a preparer confirms these facts."
        action={
          <button type="button" className="button primary" disabled={!ready || state.busy} onClick={() => void actions.generateOne(ent.id)}>
            {ready ? "Approve and generate" : "Blocked"}
          </button>
        }
      />
      <ActiveEntityBar state={state} />
      <div className="two-column">
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Summary</span><h2>{ent.name}</h2></div><StatusPill status={ent.status} /></div>
          <div className="fact-row"><span>Documents relied on</span><strong>{ent.files.length}</strong></div>
          <div className="fact-row"><span>Lines populated</span><strong>{Object.keys(ent.lines).length}</strong></div>
          <div className="fact-row"><span>Cells to write</span><strong>{cellCount(ent)}</strong></div>
          <div className="fact-row"><span>Unassigned captions</span><strong>{ent.unmatched.length}</strong></div>
          <div className="fact-row"><span>FX rates</span><strong>{ent.fx.avgRate || "—"} / {ent.fx.cyRate || "—"} / {ent.fx.pyRate || "—"}</strong></div>
          <div className="fact-row"><span>Events recorded</span><strong>{state.events.filter((e) => e.entity === ent.name).length}</strong></div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="section-kicker">Gate</span><h2>Outstanding before approval</h2></div>
            <button type="button" className="button" onClick={() => onNavigate("exceptions")}>Exceptions</button></div>
          {issues.length ? (
            <div className="log-list">
              {issues.map((b, i) => <div key={i}><span className={b.level === "block" ? "actor-tag groq" : "actor-tag user"}>{b.level}</span> {b.message}</div>)}
            </div>
          ) : <div className="empty-state"><span>✓</span><strong>Clear to approve</strong><p>All checks passed for this entity.</p></div>}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">
              Filer categor{Object.keys(ent.categories).filter((k) => ent.categories[k]).length === 1 ? "y" : "ies"}{" "}
              {Object.keys(ent.categories).filter((k) => ent.categories[k]).join(", ") || "not selected"}
            </span>
            <h2>Review summary — schedules in this workbook</h2>
          </div>
          <button type="button" className="button" onClick={() => onNavigate("preview")}>Open cell preview</button>
        </div>
        <div className="wp-table">
          <table>
            <thead><tr><th>Template sheet</th><th className="numeric" style={{ width: 110 }}>Cells to write</th><th style={{ width: 140 }}>Included</th></tr></thead>
            <tbody>
              {Object.entries(buildWrites({ ...ent, excludedSheets: [] })).map(([sheet, cells]) => {
                const off = (ent.excludedSheets || []).includes(sheet);
                return (
                  <tr key={sheet} style={off ? { opacity: 0.55 } : undefined}>
                    <td><strong>{sheet}</strong></td>
                    <td className="numeric">{Object.keys(cells).length}</td>
                    <td>
                      <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input type="checkbox" checked={!off} onChange={() => actions.toggleSheetExclusion(ent.id, sheet)} />
                        {off ? "excluded" : "write"}
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Cross-check this set against the filing-requirements table in the Form 5471 instructions for the selected
          categor{Object.keys(ent.categories).filter((k) => ent.categories[k]).length === 1 ? "y" : "ies"} — the tool
          fills what the documents support and never removes a template sheet (formula cross-references, e.g.
          Schedule I &amp; I-1 reading Sch E &amp; E-1, must stay intact). Unchecking a sheet writes nothing into it
          and is logged on generation.
        </p>
      </section>
    </div>
  );
}
