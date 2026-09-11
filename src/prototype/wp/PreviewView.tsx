"use client";

/* Workpaper preview (NEH-004): every cell the generator will write, grouped
   by template sheet, with its source — verifiable BEFORE downloading. The
   Review-Summary exclusions (NEH-009) are toggled here and in Sign-off. */

import { useSyncExternalStore } from "react";
import { Callout, SectionHeader } from "../primitives";
import type { ViewId } from "../Shell";
import { FORMULA_REFS } from "./engine";
import { actions, blockingIssues, buildWrites, getSnapshot, subscribe } from "./store";

export function PreviewView({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const ent = state.entities.find((e) => e.id === state.activeEntityId) || state.entities[0];
  if (!ent) return null;

  // Preview shows EVERYTHING (excluded sheets grayed, not hidden) — the
  // generator itself drops the excluded sheets.
  const writes = buildWrites({ ...ent, excludedSheets: [] });
  const excluded = new Set(ent.excludedSheets || []);
  const srcByRef = new Map(ent.extraWrites.map((w) => [`${w.sheet}!${w.ref}`, w.source]));
  const blockers = blockingIssues(ent);
  const sheets = Object.entries(writes);
  const totalCells = sheets.reduce((n, [, cells]) => n + Object.keys(cells).length, 0);

  return (
    <div className="view-stack">
      <SectionHeader
        kicker={ent.name}
        title="Workpaper preview"
        description="Every cell the generator will write into the master template, sheet by sheet, with its source. Formula cells are never written — the template's own arithmetic stays intact."
        action={
          <div className="signoff-actions">
            {state.entities.length > 1 ? (
              <select value={ent.id} onChange={(e) => actions.setActiveEntity(e.target.value)}>
                {state.entities.map((e2) => <option key={e2.id} value={e2.id}>{e2.name}</option>)}
              </select>
            ) : null}
            <button
              type="button"
              className="button primary"
              disabled={state.busy || !!blockers.length}
              title={blockers.length ? blockers[0].message : ""}
              onClick={() => void actions.generateOne(ent.id)}
            >
              Generate workbook
            </button>
          </div>
        }
      />

      {blockers.length ? (
        <Callout title={`${blockers.length} blocking exception(s) before generation`} tone="red">
          {blockers[0].message}{" "}
          <button type="button" className="chip-btn" onClick={() => onNavigate("exceptions")}>Open Exception Center</button>
        </Callout>
      ) : (
        <Callout title={`Ready — ${totalCells} cell(s) across ${sheets.length} sheet(s)`} tone="teal">
          Unchecking a sheet keeps it in the workbook but writes nothing into it; the exclusion is logged on generation.
        </Callout>
      )}

      {sheets.map(([sheet, cells]) => {
        const guard = FORMULA_REFS[sheet];
        const rows = Object.entries(cells);
        const off = excluded.has(sheet);
        return (
          <section className="panel" key={sheet} style={off ? { opacity: 0.55 } : undefined}>
            <div className="panel-heading">
              <div>
                <span className="section-kicker">{rows.length} cell(s){off ? " · EXCLUDED" : ""}</span>
                <h2>{sheet}</h2>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={!off} onChange={() => actions.toggleSheetExclusion(ent.id, sheet)} />
                write this sheet
              </label>
            </div>
            <div className="wp-table">
              <table>
                <thead><tr><th style={{ width: 70 }}>Cell</th><th className="numeric" style={{ width: 160 }}>Value</th><th>Source</th></tr></thead>
                <tbody>
                  {rows.map(([ref, value]) => (
                    <tr key={ref}>
                      <td className="ref-cell">{ref}{guard?.(ref) ? " ⚠" : ""}</td>
                      <td className="numeric">{typeof value === "number" ? value.toLocaleString() : String(value) || <em style={{ color: "var(--muted)" }}>cleared</em>}</td>
                      <td style={{ color: "var(--muted)", fontSize: 11 }}>{srcByRef.get(`${sheet}!${ref}`) || "entity profile / schedule lines"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {!sheets.length ? <p className="hint">Nothing to write yet — process documents first.</p> : null}
    </div>
  );
}
