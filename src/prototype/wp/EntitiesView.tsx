"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Callout, SectionHeader, StatusPill } from "../primitives";
import {
  BS_LINES, FX_FIELDS, IS_LINES, OWNERSHIP_FIELDS, PROFILE_FIELDS, CATEGORY_CELLS,
} from "./engine";
import { displayLabel } from "./captions";
import {
  DOC_TYPES, PROCESS_STEPS, actions, cellCount, getSnapshot, subscribe,
  type Entity,
} from "./store";

const bytes = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`;

const num = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : String(v);

export function EntitiesView() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Stakeholder engagement"
        title="Entities & documents"
        description="A stakeholder can hold any number of entities. Each one keeps its own document pool, its own processing run and its own schedule lines — nothing is shared or merged between them."
        action={
          <div className="signoff-actions">
            <button type="button" className="button" onClick={() => actions.addEntity()}>+ Add entity</button>
          </div>
        }
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Stakeholder</span>
            <h2>Engagement owner</h2>
          </div>
          <span className="mini-label">{state.entities.length} entit{state.entities.length === 1 ? "y" : "ies"}</span>
        </div>
        <label className="comment-field" style={{ marginTop: 0 }}>
          <span>Stakeholder name</span>
          <input
            className="stake-input"
            value={state.stakeholder}
            onChange={(e) => actions.setStakeholder(e.target.value)}
          />
        </label>
      </section>

      <div className="entity-stack">
        {state.entities.map((ent, index) => (
          <EntityCard key={ent.id} entity={ent} index={index} />
        ))}
      </div>

      <Callout title="Output format is locked to the uploaded template" tone="teal">
        Generation opens <strong>Final_Copy_of_5471_workpaper.XLSX</strong> and writes values into its designated input
        cells only. All 19 sheets, styling, merged ranges and existing formulas are preserved — the USD columns and every
        subtotal are still calculated by the template itself. One entity downloads a single workbook; several download a
        zip containing one workbook per entity, each in the same format.
      </Callout>
    </div>
  );
}

function EntityCard({ entity, index }: { entity: Entity; index: number }) {
  const [tab, setTab] = useState<"docs" | "profile" | "holders" | "dividends" | "lines" | "review">("docs");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mapped = Object.keys(entity.lines).length;
  const detectedCount = Object.keys(entity.detected).length;

  return (
    <article className={entity.open ? "entity-card open" : "entity-card"}>
      <header className="entity-head">
        <button
          type="button"
          className="entity-toggle"
          aria-expanded={entity.open}
          onClick={() => actions.toggleEntity(entity.id)}
        >
          <span className="entity-index">{String(index + 1).padStart(2, "0")}</span>
          <span className="entity-chev" aria-hidden="true">›</span>
        </button>
        <input
          className="entity-name"
          value={entity.name}
          aria-label={`Rename ${entity.name}`}
          onChange={(e) => actions.renameEntity(entity.id, e.target.value)}
        />
        <span className="entity-meta">
          {entity.files.length} doc{entity.files.length === 1 ? "" : "s"} · {mapped} lines · {cellCount(entity)} cells
        </span>
        <StatusPill status={entity.status} />
        <button
          type="button"
          className="button entity-remove"
          onClick={() => actions.removeEntity(entity.id)}
        >
          Remove
        </button>
      </header>

      {entity.open ? (
        <div className="entity-body">
          <div className="tab-row">
            {(["docs", "profile", "holders", "dividends", "lines", "review"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={tab === id ? "tab-button active" : "tab-button"}
                onClick={() => setTab(id)}
              >
                {id === "docs" ? "Documents" : id === "profile" ? "Entity profile" : id === "holders" ? "Shareholders" : id === "dividends" ? "Dividends" : id === "lines" ? "Schedule lines" : "Review & log"}
              </button>
            ))}
          </div>

          {tab === "docs" ? (
            <div>
              <div
                className={dragging ? "dropzone over" : "dropzone"}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer?.files?.length) void actions.addFiles(entity.id, e.dataTransfer.files);
                }}
              >
                <strong>Drop documents for {entity.name}</strong>
                <p>Trial balances, financial statements, prior-year returns, ownership registers · {DOC_TYPES.join(" ")}</p>
                <button type="button" className="button" onClick={() => fileRef.current?.click()}>Choose files</button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  accept={DOC_TYPES.join(",")}
                  onChange={(e) => {
                    if (e.target.files?.length) void actions.addFiles(entity.id, e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {entity.files.length ? (
                <div className="doc-list">
                  {entity.files.map((f) => (
                    <div className="doc-row" key={f.id}>
                      <span className="doc-mark">{(f.name.split(".").pop() || "?").toUpperCase().slice(0, 4)}</span>
                      <div>
                        <strong>{f.name}</strong>
                        <small>{bytes(f.size)} · {f.parsable ? "native parse" : "unsupported format"}</small>
                      </div>
                      <button type="button" className="button" onClick={() => actions.removeFile(entity.id, f.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="hint">No documents yet for this entity.</p>
              )}

              <div className="run-panel">
                <div>
                  <strong>Independent processing run</strong>
                  <p>Documents in this entity are never combined with another entity&apos;s.</p>
                </div>
                <button
                  type="button"
                  className="button primary"
                  disabled={entity.status === "processing" || !entity.files.length}
                  onClick={() => void actions.processEntity(entity.id)}
                >
                  {entity.status === "processing" ? "Processing…" : "Process entity"}
                </button>
              </div>

              <ol className="run-steps">
                {PROCESS_STEPS.map((step, i) => {
                  const done = entity.status === "ready" || entity.progress > i;
                  const active = entity.status === "processing" && entity.progress === i;
                  return (
                    <li key={step} className={done ? "done" : active ? "active" : ""}>
                      <span className="run-mark">{done ? "✓" : ""}</span>
                      <span>{step}</span>
                      <span className="run-state">{done ? "done" : active ? "running" : "—"}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          {tab === "profile" ? (
            <div>
              {detectedCount ? (
                <Callout title={`${detectedCount} detail(s) read from your documents`} tone="teal">
                  Fields marked <span className="auto-badge">auto</span> were filled from the uploaded documents and are
                  shown with the caption they came from. Every one is editable — typing over a value makes it yours and
                  drops the badge. Nothing here is mandatory.
                </Callout>
              ) : null}

              <div className="field-grid">
                {PROFILE_FIELDS.filter((f) => f.key !== "entityShort").map((f) => {
                  const det = entity.detected[f.key];
                  return (
                    <label className={det ? "wp-field detected" : "wp-field"} key={f.key}>
                      <span>
                        {f.label}
                        {det ? <span className="auto-badge" title={`from "${det.sourceLabel}"`}>auto</span> : null}
                      </span>
                      <input
                        value={entity.profile[f.key] || ""}
                        placeholder={f.placeholder || ""}
                        onChange={(e) => actions.setField(entity.id, "profile", f.key, e.target.value)}
                      />
                      <em>{det ? `${f.cell} · ${det.sourceLabel}` : f.cell}</em>
                    </label>
                  );
                })}
              </div>

              <h3 className="wp-subhead">Additional particulars (no template cell — carried on the profile)</h3>
              <div className="field-grid">
                {([
                  { key: "refId", label: "Reference ID number", hint: "must match every year's filing · flows to Schedule E" },
                  { key: "principalPlace", label: "Principal place of business", hint: "5471 face item e" },
                  { key: "activityCode", label: "Principal business activity code", hint: "5471 face item f" },
                ] as const).map((f) => {
                  const det = entity.detected[f.key];
                  return (
                    <label className={det ? "wp-field detected" : "wp-field"} key={f.key}>
                      <span>
                        {f.label}
                        {det ? <span className="auto-badge" title={`from "${det.sourceLabel}"`}>auto</span> : null}
                      </span>
                      <input
                        value={entity.profile[f.key] || ""}
                        onChange={(e) => actions.setField(entity.id, "profile", f.key, e.target.value)}
                      />
                      <em>{f.hint}</em>
                    </label>
                  );
                })}
              </div>

              <h3 className="wp-subhead">Filer category determination</h3>
              <div className="field-grid">
                {OWNERSHIP_FIELDS.map((f) => (
                  <label className={entity.detected[f.key] ? "wp-field detected" : "wp-field"} key={f.key}>
                    <span>
                      {f.label}{f.type === "pct" ? " (%)" : ""}
                      {entity.detected[f.key] ? <span className="auto-badge" title={`from "${entity.detected[f.key].sourceLabel}"`}>auto</span> : null}
                    </span>
                    {f.type === "yn" ? (
                      <select
                        value={entity.ownership[f.key] || ""}
                        onChange={(e) => actions.setField(entity.id, "ownership", f.key, e.target.value)}
                      >
                        <option value="">—</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    ) : (
                      <input
                        type="number"
                        value={entity.ownership[f.key] || ""}
                        onChange={(e) => actions.setField(entity.id, "ownership", f.key, e.target.value)}
                      />
                    )}
                    <em>{f.cell}</em>
                  </label>
                ))}
              </div>

              <h3 className="wp-subhead">Filing categories</h3>
              <div className="cat-row">
                {Object.keys(CATEGORY_CELLS).map((cat) => (
                  <label key={cat} className={entity.categories[cat] ? "cat-chip on" : "cat-chip"}>
                    <input
                      type="checkbox"
                      checked={!!entity.categories[cat]}
                      onChange={() => actions.toggleCategory(entity.id, cat)}
                    />
                    Category {cat}
                  </label>
                ))}
              </div>

              <h3 className="wp-subhead">Functional currency — divide rates</h3>
              <div className="field-grid">
                {FX_FIELDS.map((f) => (
                  <label className="wp-field" key={f.key}>
                    <span>{f.label}</span>
                    <input
                      type="number"
                      step="0.0001"
                      value={entity.fx[f.key] || ""}
                      onChange={(e) => actions.setField(entity.id, "fx", f.key, e.target.value)}
                    />
                    <em>{f.cell}</em>
                  </label>
                ))}
              </div>

              <Callout title="Enter local currency only" tone="teal">
                The template converts to US dollars itself: Schedule F divides by the spot rates in C60/C61 and
                Schedule C uses the average rate in C59.
              </Callout>
            </div>
          ) : null}

          {tab === "holders" ? (
            <div>
              <Callout title="Shareholding Details rows 19–26" tone="teal">
                Direct shareholders write into the template with their real names and BOY/EOY share counts.
                Rows seeded from the prior 5471&apos;s Schedule B Part II carry a source badge; every cell is
                editable and edits update the workbook immediately — the template&apos;s demo rows (A/B/C/D)
                are always cleared.
              </Callout>
              {(entity.shareholders || []).length ? (
                <div className="wp-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Shareholder</th><th style={{ width: 130 }}>Class</th>
                        <th className="numeric" style={{ width: 110 }}>Shares BOY</th>
                        <th className="numeric" style={{ width: 110 }}>Shares EOY</th>
                        <th style={{ width: 80 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {(entity.shareholders || []).map((s) => (
                        <tr key={s.id}>
                          <td>
                            <input
                              className="stake-input"
                              value={s.name}
                              placeholder="Shareholder name"
                              onChange={(e) => actions.updateShareholder(entity.id, s.id, { name: e.target.value })}
                            />
                            {s.source ? <small style={{ display: "block", color: "var(--muted)" }}>{s.source}</small> : null}
                          </td>
                          <td>
                            <input
                              className="stake-input"
                              value={s.classOfShares}
                              onChange={(e) => actions.updateShareholder(entity.id, s.id, { classOfShares: e.target.value })}
                            />
                          </td>
                          <td className="numeric">
                            <input
                              type="number"
                              value={s.boy}
                              onChange={(e) => actions.updateShareholder(entity.id, s.id, { boy: Number(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="numeric">
                            <input
                              type="number"
                              value={s.eoy}
                              onChange={(e) => actions.updateShareholder(entity.id, s.id, { eoy: Number(e.target.value) || 0 })}
                            />
                          </td>
                          <td><button type="button" className="button" onClick={() => actions.removeShareholder(entity.id, s.id)}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td><td />
                        <td className="numeric"><strong>{(entity.shareholders || []).reduce((n, s) => n + s.boy, 0)}</strong></td>
                        <td className="numeric"><strong>{(entity.shareholders || []).reduce((n, s) => n + s.eoy, 0)}</strong></td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="hint">
                  No shareholders yet. Process a prior-year 5471 to seed them from Schedule B Part II, or add them here.
                </p>
              )}
              <button type="button" className="button" onClick={() => actions.addShareholder(entity.id)}>+ Add shareholder</button>
            </div>
          ) : null}

          {tab === "dividends" ? (
            <div>
              <Callout title="Dividends sheet rows 3–6" tone="teal">
                The detected dividend drives four schedules (Dividends, Schedule R, Schedule J line 9, Schedule M) —
                editing it updates all of them. Rows added here write to the Dividends sheet only; review the
                distribution schedules for them separately.
              </Callout>
              {(entity.dividends || []).length ? (
                <div className="wp-table">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 120 }}>Date paid</th>
                        <th className="numeric">Amount (functional)</th>
                        <th className="numeric" style={{ width: 130 }}>US$ per unit</th>
                        <th>Rate source</th>
                        <th style={{ width: 80 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {(entity.dividends || []).map((d, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              className="stake-input"
                              value={d.date}
                              onChange={(e) => actions.updateDividend(entity.id, i, { date: e.target.value })}
                            />
                          </td>
                          <td className="numeric">
                            <input
                              type="number"
                              value={d.amountFunctional}
                              onChange={(e) => actions.updateDividend(entity.id, i, { amountFunctional: Number(e.target.value) || 0 })}
                            />
                          </td>
                          <td className="numeric">
                            <input
                              type="number"
                              step="0.0001"
                              value={d.usdPerUnit ?? ""}
                              onChange={(e) => actions.updateDividend(entity.id, i, { usdPerUnit: e.target.value === "" ? null : Number(e.target.value) })}
                            />
                          </td>
                          <td style={{ color: "var(--muted)", fontSize: 11 }}>
                            {d.rateSource === "frankfurter" ? "ECB payment-date rate" : d.rateSource === "eoy-fallback" ? "1 ÷ year-end spot (fallback)" : i === 0 ? "—" : "added by hand"}
                            {i === 0 ? <><br />flows to Sch R / J / M</> : null}
                          </td>
                          <td>
                            {i > 0 && i === (entity.dividends || []).length - 1
                              ? <button type="button" className="button" onClick={() => actions.removeDividend(entity.id, i)}>Remove</button>
                              : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint">
                  No dividend detected. Processing reads dividends from the equity movement or the local return&apos;s
                  dividend schedule — or add one here for the Dividends sheet.
                </p>
              )}
              <button type="button" className="button" onClick={() => actions.addDividend(entity.id)}>+ Add dividend row</button>
            </div>
          ) : null}

          {tab === "lines" ? (
            <div>
              <LineTable entity={entity} kind="IS" />
              <LineTable entity={entity} kind="BS" />
            </div>
          ) : null}

          {tab === "review" ? (
            <div className="two-column">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">Exceptions</span>
                    <h2>Unmatched labels</h2>
                  </div>
                  <span className="mini-label">{entity.unmatched.length} open</span>
                </div>
                {entity.unmatched.length ? (
                  <>
                    <div className="wp-table">
                      <table>
                        <thead><tr><th>Label</th><th>Values</th><th>Assign to</th></tr></thead>
                        <tbody>
                          {entity.unmatched.map((u, i) => (
                            <tr key={`${u.label}-${i}`}>
                              <td>
                                {displayLabel(entity.translations, u.label)}
                                {displayLabel(entity.translations, u.label) !== u.label
                                  ? <small style={{ display: "block", opacity: 0.7 }}>{u.label}</small> : null}
                                {u.reason ? <small style={{ display: "block", color: "var(--muted)" }}>{u.reason}</small> : null}
                              </td>
                              <td className="numeric">{u.values.join(" · ")}</td>
                              <td>
                                <select
                                  value=""
                                  onChange={(e) => actions.assignUnmatched(entity.id, i, e.target.value)}
                                >
                                  <option value="">—</option>
                                  {IS_LINES.map((l) => (
                                    <option key={`is${l.row}`} value={`IS:${l.row}`}>Sch C · {l.label}</option>
                                  ))}
                                  {BS_LINES.map((l) => (
                                    <option key={`bs${l.row}`} value={`BS:${l.row}`}>Sch F · {l.label}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="review-actions">
                      <button type="button" className="button" onClick={() => void actions.resolveWithGroq(entity.id)}>
                        Resolve with Groq
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <span>✓</span>
                    <strong>Nothing outstanding</strong>
                    <p>Every extracted label was mapped to a template line.</p>
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">Provenance</span>
                    <h2>Processing log</h2>
                  </div>
                  <span className="mini-label">{entity.processedAt || "not run"}</span>
                </div>
                {entity.log.length ? (
                  <div className="log-list">
                    {entity.log.map((line, i) => <div key={i}>{line}</div>)}
                  </div>
                ) : (
                  <p className="hint">No entries yet — run processing to populate the log.</p>
                )}
                <div className="gate-summary">
                  <div><span>Documents</span><strong>{entity.files.length}</strong></div>
                  <div><span>Lines mapped</span><strong>{Object.keys(entity.lines).length}</strong></div>
                  <div><span>Cells to be written</span><strong>{cellCount(entity)}</strong></div>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function LineTable({ entity, kind }: { entity: Entity; kind: "IS" | "BS" }) {
  const lines = kind === "IS" ? IS_LINES : BS_LINES;
  return (
    <section className="panel wp-lines">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">{kind === "IS" ? "Schedule C" : "Schedule F"}</span>
          <h2>{kind === "IS" ? "Income statement" : "Balance sheet"}</h2>
        </div>
        <span className="mini-label">{kind === "IS" ? "column F · local currency" : "columns D and F · local currency"}</span>
      </div>
      <div className="wp-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 52 }}>Ref</th>
              <th>Line</th>
              {kind === "BS" ? <th className="numeric">Beginning</th> : null}
              <th className="numeric">{kind === "BS" ? "End" : "Amount"}</th>
              <th style={{ width: 68 }}>Cell</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const key = `${kind}:${l.row}`;
              const d = entity.lines[key] || {};
              return (
                <tr key={key}>
                  <td className="ref-cell">{l.ref}</td>
                  <td>
                    {l.relabel ? (
                      <input
                        className="relabel-input"
                        value={entity.relabels[key] || ""}
                        placeholder={l.label}
                        onChange={(e) => actions.setRelabel(entity.id, key, e.target.value)}
                      />
                    ) : l.label}
                  </td>
                  {kind === "BS" ? (
                    <td className="numeric">
                      <input
                        type="number"
                        value={num(d.boy)}
                        onChange={(e) => actions.setLine(entity.id, key, "boy", e.target.value)}
                      />
                    </td>
                  ) : null}
                  <td className="numeric">
                    <input
                      type="number"
                      value={num(kind === "BS" ? d.eoy : d.amount)}
                      onChange={(e) => actions.setLine(entity.id, key, kind === "BS" ? "eoy" : "amount", e.target.value)}
                    />
                  </td>
                  <td className="ref-cell">{kind === "IS" ? `F${l.row}` : `D/F${l.row}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
