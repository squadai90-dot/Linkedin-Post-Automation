"use client";

import { useState, useSyncExternalStore } from "react";
import { Callout, SectionHeader } from "../primitives";
import { CURRENCY_CODES, FX_META, IRS_AVERAGE, TREASURY_SPOT, lookupRates, yearFromPeriod } from "./fxRates";
import { actions, getSnapshot, isFiscalPeriod, subscribe, validateEntity } from "./store";


function EntitySwitch() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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

export function FxRatesView() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [search, setSearch] = useState("");

  const active = state.entities.find((e) => e.id === state.activeEntityId) || state.entities[0];
  const code = (active?.profile.currency || "").toUpperCase().trim();
  const cyYear = yearFromPeriod(active?.profile.cyEnd || "");
  const pyYear = yearFromPeriod(active?.profile.pyEnd || "");
  // Fiscal years never show the published calendar-year figures — displaying
  // them beside blank inputs would invite exactly the wrong entry.
  const fiscal = !!active && isFiscalPeriod(active.profile.cyEnd);
  const published = code && !fiscal ? lookupRates(code, active.profile.cyEnd || "", active.profile.pyEnd || "") : null;

  const rateIssues = active ? validateEntity(active).filter((b) => b.message.includes("rate")) : [];

  const matches = CURRENCY_CODES.filter((c) => {
    if (!search.trim()) return false;
    const t = search.toLowerCase();
    return c.toLowerCase().includes(t)
      || (FX_META[c]?.country || "").toLowerCase().includes(t)
      || (FX_META[c]?.currency || "").toLowerCase().includes(t);
  }).slice(0, 12);

  const fxVal = (k: string) => (active?.fx[k] === undefined ? "" : active.fx[k]);
  const live = code ? state.liveRates[code] : undefined;

  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Schedule C and Schedule F translation"
        title="FX policy & rates"
        description="The template converts to US dollars itself by dividing local-currency figures by three rates. If any of them is blank the workbook returns #DIV/0! in every USD column — so they are looked up from published tables and validated before generation."
        action={
          <div className="signoff-actions">
            <button type="button" className="button" onClick={() => setSearch(code || "GBP")}>Browse rate tables</button>
            <button type="button" className="button" disabled={!active || state.busy} onClick={() => void actions.fetchLiveRate(active.id, false)}>
              {state.busy ? "Fetching…" : "Check live rate"}
            </button>
            <button type="button" className="button primary" disabled={!active} onClick={() => actions.autoFillRates(active.id)}>
              Apply published rates
            </button>
          </div>
        }
      />

      <EntitySwitch />

      {active && isFiscalPeriod(active.profile.cyEnd) ? (
        <Callout title={`Fiscal year ending ${active.profile.cyEnd}`} tone="amber">
          The published columns are blank BY DESIGN: the IRS yearly-average and Treasury 12/31 tables are
          calendar-year figures and do not apply to a fiscal year. Enter the period&apos;s average rate and the
          {" "}{active.profile.cyEnd} / {active.profile.pyEnd || "prior period-end"} spot rates manually.
        </Callout>
      ) : null}

      {rateIssues.length ? (
        <Callout title="These rates are required" tone="red">
          {rateIssues.map((b) => b.message).join(" · ")}
        </Callout>
      ) : (
        <Callout title="Rates are complete" tone="teal">
          Every USD column in Schedule C and Schedule F will calculate. The tool writes only the three divide rates;
          the arithmetic stays in the template.
        </Callout>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">{active ? active.name : "No entity"}</span>
            <h2>Rates written to the template</h2>
          </div>
          <span className="mini-label">
            {active?.detected.currency && !active.currencyConfirmed
              ? <>currency {code} detected — <button type="button" className="chip-btn" onClick={() => actions.confirmCurrency(active.id)}>confirm</button></>
              : active?.fxAuto ? "auto-filled from tables" : "manual entry"}
          </span>
        </div>

        <div className="wp-table">
          <table>
            <thead>
              <tr>
                <th>Rate</th><th style={{ width: 62 }}>Cell</th>
                <th className="numeric" style={{ width: 130 }}>In use</th>
                <th className="numeric" style={{ width: 130 }}>Published</th>
                <th style={{ width: 150 }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {[
                { k: "avgRate", cell: "C59", label: "Average exchange rate", pub: published?.avgRate, src: `IRS yearly average ${cyYear || "—"}`, used: "Schedule C" },
                { k: "cyRate", cell: "C60", label: "Current year end rate", pub: published?.cyRate, src: `Treasury spot ${active?.profile.cyEnd || (cyYear ? `12/31/${cyYear.slice(2)}` : "—")}`, used: "Schedule F col (b)" },
                { k: "pyRate", cell: "C61", label: "Prior year end rate", pub: published?.pyRate, src: `Treasury spot ${active?.profile.pyEnd || (pyYear ? `12/31/${pyYear.slice(2)}` : "—")}`, used: "Schedule F col (a)" },
              ].map((r) => {
                const n = Number(fxVal(r.k));
                const bad = !(isFinite(n) && n > 0);
                return (
                  <tr key={r.k}>
                    <td><strong>{r.label}</strong><br /><small style={{ color: "var(--muted)" }}>{r.used}</small></td>
                    <td className="ref-cell">{r.cell}</td>
                    <td className="numeric">
                      <input
                        type="number"
                        step="0.000001"
                        value={fxVal(r.k)}
                        style={bad ? { borderColor: "#e0b4b0", background: "#fdf3f2" } : undefined}
                        onChange={(e) => active && actions.setField(active.id, "fx", r.k, e.target.value)}
                      />
                    </td>
                    <td className="numeric">{r.pub ?? "—"}</td>
                    <td style={{ color: "var(--muted)", fontSize: 10.5 }}>
                      {active?.fxMeta?.[r.k]
                        ? <>{active.fxMeta[r.k].source}<br />as of {active.fxMeta[r.k].asOf}</>
                        : r.src}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {live ? (
          <div className="live-rate-row">
            <div>
              <span className="section-kicker">Live quote · {live.provider}</span>
              <strong>{code} {live.rate}</strong>
              <small>as of {live.asOf} · indicative mid-market</small>
            </div>
            <div className="live-delta">
              {published?.cyRate ? (
                <>
                  <span>vs Treasury 12/31 spot {published.cyRate}</span>
                  <strong>{(((live.rate - published.cyRate) / published.cyRate) * 100).toFixed(2)}%</strong>
                </>
              ) : <span>no published spot rate to compare</span>}
            </div>
            <button type="button" className="button" disabled={state.busy} onClick={() => void actions.fetchLiveRate(active.id, true)}>
              Override C60
            </button>
          </div>
        ) : null}

        <div className="fact-row"><span>Convention</span><strong>Divide rate — functional currency units per 1 USD</strong></div>
        <div className="fact-row"><span>Balance Sheet header</span><strong>G6 = C61 (PY) · H6 = C60 (CY)</strong></div>
        {/* Spot covers far more currencies than the IRS yearly average: Chile and
            Colombia, among others, have a 12/31 spot but no average, and the line
            used to imply both were complete. Count each table rather than claim it. */}
        <div className="fact-row"><span>Coverage</span><strong>
          {Object.keys(IRS_AVERAGE).length} currencies with a yearly average (2017–2025) · {Object.keys(TREASURY_SPOT).length} with a 12/31 spot (2016–2025)
        </strong></div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Reference</span>
            <h2>Published rate tables</h2>
          </div>
          <input
            className="stake-input"
            style={{ maxWidth: 260 }}
            placeholder="Search currency, code or country"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {matches.length ? (
          <div className="wp-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Code</th><th>Country / currency</th>
                  <th className="numeric">Avg {cyYear || "2025"}</th>
                  <th className="numeric">Spot {cyYear || "2025"}</th>
                  <th className="numeric">Spot {pyYear || "2024"}</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {matches.map((c) => (
                  <tr key={c}>
                    <td className="ref-cell">{c}</td>
                    <td>{FX_META[c]?.country} · {FX_META[c]?.currency}</td>
                    <td className="numeric">{IRS_AVERAGE[c]?.[cyYear || "2025"] ?? "—"}</td>
                    <td className="numeric">{TREASURY_SPOT[c]?.[cyYear || "2025"] ?? "—"}</td>
                    <td className="numeric">{TREASURY_SPOT[c]?.[pyYear || "2024"] ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="button"
                        disabled={!active}
                        onClick={() => {
                          actions.setField(active.id, "profile", "currency", c);
                          actions.autoFillRates(active.id);
                        }}
                      >
                        Use
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">
            Type a currency code, country or currency name to look up published rates — for example GBP, Morocco or Yuan.
          </p>
        )}
      </section>
    </div>
  );
}
