"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { detectLanguage } from "./captions";
import { Callout, SectionHeader } from "../primitives";
import { BS_LINES, IS_LINES } from "./engine";
import { actions, entityCaseCy, getSnapshot, subscribe } from "./store";

const SCRIPTS: Array<{ name: string; re: RegExp }> = [
  { name: "Arabic", re: /[\u0600-\u06FF]/ },
  { name: "Japanese", re: /[\u3040-\u30FF]/ },
  { name: "Chinese", re: /[\u4E00-\u9FFF]/ },
  { name: "Korean", re: /[\uAC00-\uD7AF]/ },
  { name: "Cyrillic", re: /[\u0400-\u04FF]/ },
  { name: "Greek", re: /[\u0370-\u03FF]/ },
  { name: "Hebrew", re: /[\u0590-\u05FF]/ },
  { name: "Devanagari", re: /[\u0900-\u097F]/ },
  { name: "Bengali", re: /[\u0980-\u09FF]/ },
  { name: "Tamil", re: /[\u0B80-\u0BFF]/ },
  { name: "Telugu", re: /[\u0C00-\u0C7F]/ },
  { name: "Gujarati", re: /[\u0A80-\u0AFF]/ },
  { name: "Thai", re: /[\u0E00-\u0E7F]/ },
  { name: "Vietnamese", re: /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i },
];

const HINTS: Array<{ name: string; words: string[] }> = [
  { name: "French", words: ["achats", "charges", "produits", "créances", "dettes", "immobilisations", "amortissements", "loyer", "société", "trésorerie", "capital social"] },
  { name: "Spanish", words: ["ingresos", "gastos", "cuenta", "clientes", "proveedores", "inmovilizado", "existencias", "capital", "banco"] },
  { name: "German", words: ["umsatz", "aufwand", "ertrag", "forderungen", "verbindlichkeiten", "anlagevermögen", "kapital"] },
  { name: "Portuguese", words: ["receita", "despesa", "clientes", "fornecedores", "imobilizado", "capital"] },
  { name: "Italian", words: ["ricavi", "costi", "crediti", "debiti", "immobilizzazioni", "capitale"] },
];

const lineLabel = (target: string) => {
  const [kind, row] = target.split(":");
  const list = kind === "IS" ? IS_LINES : BS_LINES;
  const hit = list.find((l) => String(l.row) === row);
  return hit ? `${kind === "IS" ? "Sch C" : "Sch F"} · ${hit.label}` : target;
};


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

export function EvidenceView() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const out: Array<{
      entity: string; entityId: string; label: string; language: string;
      target: string | null;
      cyValue: number | null;                       // the current-year figure
      allValues: string;                            // full multi-year audit string
      ambiguous: boolean;
      translation: string | null;
      failure: string | null;                       // why translation was refused
    }> = [];
    const fmt = (values: number[], years?: (number | null)[]) =>
      values.map((v, i) => years?.[i] ? `${v.toLocaleString()} (${years[i]})` : v.toLocaleString()).join(" · ");
    for (const ent of state.entities) {
      const cy = entityCaseCy(ent);

      // Bound rows come from contributions: routed, year-resolved, and — unlike
      // sourceLabels — complete when several captions feed one line.
      const seen = new Set<string>();
      for (const [target, list] of Object.entries(ent.contributions || {})) {
        const byLabel = new Map<string, typeof list>();
        for (const c of list) {
          if (!byLabel.has(c.label)) byLabel.set(c.label, []);
          byLabel.get(c.label)!.push(c);
        }
        for (const [label, contribs] of byLabel) {
          seen.add(label);
          // amount (IS) and eoy (BS) are current-year by routing construction.
          const cyValue = contribs
            .filter((c) => c.field === "amount" || c.field === "eoy")
            .reduce<number | null>((s, c) => (s ?? 0) + c.value, null);
          const src = contribs.find((c) => c.srcValues?.length);
          out.push({
            entity: ent.name, entityId: ent.id, label,
            language: detectLanguage(label), target,
            cyValue,
            allValues: src ? fmt(src.srcValues!, src.srcYears) : fmt(contribs.map((c) => c.value)),
            ambiguous: false,
            translation: ent.translations?.[label] ?? null,
            failure: ent.translationFailures?.[label] ?? null,
          });
        }
      }
      // Legacy fallback: lines whose provenance predates contributions.
      for (const [target, src] of Object.entries(ent.sourceLabels || {})) {
        if (seen.has(src.label)) continue;
        const idx = cy && src.years ? src.years.findIndex((y) => y === cy) : -1;
        out.push({
          entity: ent.name, entityId: ent.id, label: src.label,
          language: detectLanguage(src.label), target,
          cyValue: idx >= 0 ? src.values[idx] : src.values.length === 1 ? src.values[0] : src.values[src.values.length - 1],
          allValues: fmt(src.values, src.years),
          ambiguous: false,
          translation: ent.translations?.[src.label] ?? null,
          failure: ent.translationFailures?.[src.label] ?? null,
        });
      }

      for (const u of ent.unmatched) {
        const idx = cy && u.years ? u.years.findIndex((y) => y === cy) : -1;
        const cyValue =
          idx >= 0 ? u.values[idx]
          : u.values.length === 1 ? u.values[0]
          : !u.years ? u.values[u.values.length - 1]     // grid rows: right-most is current
          : null;                                        // multi-year, none matches — ambiguous
        out.push({
          entity: ent.name, entityId: ent.id, label: u.label,
          language: detectLanguage(u.label), target: null,
          cyValue,
          allValues: fmt(u.values, u.years),
          ambiguous: cyValue === null,
          translation: ent.translations?.[u.label] ?? null,
          failure: ent.translationFailures?.[u.label] ?? null,
        });
      }
    }
    return out;
  }, [state.entities]);

  const languages = [...new Set(rows.map((r) => r.language))].sort();
  const shown = filter === "all" ? rows : rows.filter((r) => r.language === filter);
  const nonEnglish = rows.filter((r) => r.language !== "English");
  const untranslated = nonEnglish.filter((r) => !r.translation);
  const failedRows = rows.filter((r) => r.failure && !r.translation);
  const pct = (n: number) => (rows.length ? Math.round((n / rows.length) * 100) : 0);
  // Documents the parser refused to read (scanned images etc.) — surfaced
  // here because their evidence never made it into the table at all.
  const unreadable = state.entities.flatMap((e) =>
    e.log
      .filter((l) => /could not be read|no text layer/.test(l))
      .map((l) => ({
        entity: e.name,
        line: l,
        reason: /no text layer|scanned image/.test(l)
          ? "Poor or unclear scan — the PDF has no text layer, and OCR is not attempted so nothing is guessed."
          : "The file could not be parsed — unsupported or corrupted format.",
      })),
  );

  const activeEnt = state.entities.find((e) => e.id === state.activeEntityId) || state.entities[0];

  return (
    <div className="view-stack">
      <SectionHeader
        kicker="Document evidence"
        title="Multilingual evidence"
        description="Every caption read out of your documents, with the script or vocabulary it was written in and the template line it was bound to. Amounts are always taken from the document — translation only ever affects the label."
        action={
          <div className="signoff-actions">
            <button
              type="button"
              className="button primary"
              disabled={state.busy || !untranslated.length}
              onClick={() => void actions.translateFreeLabels()}
            >
              {state.busy ? "Working…" : `Translate free (${untranslated.length})`}
            </button>
            <button
              type="button"
              className="button"
              disabled={state.busy || !untranslated.length}
              onClick={() => void actions.translateLabels()}
            >
              Translate with Groq
            </button>
          </div>
        }
      />

      <EntitySwitch />

      <div className="metric-grid">
        <div className="metric-card"><strong>{rows.length}</strong><span>Captions extracted</span><em>across {state.entities.length} entit{state.entities.length === 1 ? "y" : "ies"}</em></div>
        <div className="metric-card"><strong>{languages.length}</strong><span>Languages detected</span><em>{languages.slice(0, 4).join(", ") || "—"}</em></div>
        <div className="metric-card"><strong>{nonEnglish.length}</strong><span>Non-English captions</span><em>{nonEnglish.length - untranslated.length} translated</em></div>
        <div className="metric-card"><strong>{rows.filter((r) => r.target).length}</strong><span>Bound to a template line</span><em>{rows.filter((r) => !r.target).length} unassigned</em></div>
      </div>

      {rows.length ? (
        <p className="hint">
          <strong>{pct(nonEnglish.length)}% non-English</strong>
          {" → "}
          <strong>{pct(nonEnglish.length - untranslated.length)}% translated</strong>
          {" → "}
          <strong>{pct(untranslated.length)}% remaining</strong>
          {failedRows.length ? <> · {failedRows.length} caption{failedRows.length === 1 ? "" : "s"} could not be translated — highlighted below with the reason</> : null}
        </p>
      ) : null}

      {unreadable.length ? (
        <Callout title={`${unreadable.length} document(s) could not be read`} tone="amber">
          {unreadable.map((u, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <strong>{u.line.split(":")[0]}</strong> ({u.entity}) — {u.reason}
            </div>
          ))}
        </Callout>
      ) : null}

      {rows.length === 0 ? (
        <Callout title="No evidence yet" tone="amber">
          Load documents against an entity and run processing. Every caption the parser reads appears here with its
          detected language, so a reviewer can see exactly what the numbers came from.
        </Callout>
      ) : null}

      {untranslated.length ? (
        <Callout title={`${untranslated.length} caption(s) are not in English`} tone="teal">
          <strong>Translate free</strong> uses keyless public services (MyMemory, then Lingva) — no account needed.
          <strong> Translate with Groq</strong> needs a key but handles accounting terminology better. Either way the
          translation is stored beside the original caption, never instead of it, and amounts are untouched.
        </Callout>
      ) : null}

      {rows.length ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">{shown.length} shown</span>
              <h2>Extracted captions</h2>
            </div>
            <select className="stake-input" style={{ maxWidth: 190 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All languages</option>
              {languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="wp-table">
            <table>
              <thead>
                <tr>
                  <th>Caption in the document</th>
                  <th style={{ width: 90 }}>Language</th>
                  <th>English</th>
                  <th className="numeric" style={{ width: 170 }}>Value (current year)</th>
                  <th style={{ width: 210 }}>Bound to</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.entityId + r.label + i}>
                    <td><strong>{r.label}</strong><br /><small style={{ color: "var(--muted)" }}>{r.entity}</small></td>
                    <td><span className={r.language === "English" ? "actor-tag system" : "actor-tag groq"}>{r.language}</span></td>
                    <td style={{ color: "var(--muted)" }}>
                      {r.translation
                        ? r.translation
                        : r.failure
                          ? <span className="actor-tag groq" style={{ whiteSpace: "normal" }}>{r.failure}</span>
                          : r.language === "English" ? "—" : "not translated"}
                    </td>
                    <td className="numeric" title={`Values read: ${r.allValues}`}>
                      {r.ambiguous ? (
                        <span className="actor-tag user">ambiguous</span>
                      ) : (
                        <strong>{r.cyValue !== null ? r.cyValue.toLocaleString() : "—"}</strong>
                      )}
                      {r.allValues && (r.ambiguous || r.allValues.includes("·")) ? (
                        <small style={{ display: "block", color: "var(--muted)" }}>all: {r.allValues}</small>
                      ) : null}
                    </td>
                    <td>{r.target ? lineLabel(r.target) : <span className="actor-tag user">unassigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeEnt && activeEnt.extraWrites.length ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">{activeEnt.name} · {activeEnt.extraWrites.length} cell(s)</span>
              <h2>Schedule &amp; carry-forward values — source snapshot</h2>
            </div>
          </div>
          <p className="hint">
            Every value written beyond the core statements, with the document, page and the exact row text it was
            read from — the answer to &ldquo;where did this number come from?&rdquo; without opening the PDF.
          </p>
          <div className="wp-table">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Cell</th>
                  <th className="numeric" style={{ width: 130 }}>Value</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {activeEnt.extraWrites.filter((w) => w.value !== "").map((w, i) => (
                  <tr key={`${w.sheet}!${w.ref}-${i}`}>
                    <td className="ref-cell">{w.sheet}!{w.ref}</td>
                    <td className="numeric">{typeof w.value === "number" ? w.value.toLocaleString() : w.value}</td>
                    <td>
                      {w.source || "—"}
                      {w.prov?.rowText ? (
                        <small style={{ display: "block", color: "var(--muted)", whiteSpace: "normal" }}>
                          {w.prov.docName}{w.prov.page ? ` p.${w.prov.page}` : ""} · row read: &ldquo;{w.prov.rowText}&rdquo;
                        </small>
                      ) : null}
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
