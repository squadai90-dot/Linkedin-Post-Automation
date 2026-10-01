import { INTENTS, OCCASION_CHOICES, GENERAL_CHOICES } from "../lib/intent.js";
import { LinkBadge } from "./linkbadge.jsx";

/* ============================================================
   RESEARCH AND INTENT

   Three things this panel is strict about, because each one failed on a
   Navratri post:

   — Only a source the live search actually returned is shown as a source.
     There are no placeholder rows, no "example" sources, and nothing the
     model wrote from memory dressed up as research.
   — When research is not needed — a greeting, your own launch or milestone —
     it is skipped and the panel says so, rather than inventing sources to
     fill the space. It can still be run on request.
   — When research fails, it says why and the post is written without
     sources. Ideas the model offered are labelled as its own, not as facts.
   ============================================================ */

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const tierLabel = (t) => ({ 1: "Official", 2: "Major publication", 3: "Industry press", 4: "Blog / social" }[t] || "Source");

const SHORT = {
  greeting: "Greeting", occasion_info: "History & culture", occasion_recap: "Celebration recap", occasion_csr: "CSR activity",
  occasion_event: "Festival event", launch: "Launch", milestone: "Milestone", event: "Event", hiring: "Hiring", culture: "Team & culture",
  educational: "Educational", thought: "Point of view", news: "News & regulation",
};

/* Which kind of post this is, why Unison thinks so, and how to change it. */
export function IntentBar({ research, busy, locked, onSwitch }) {
  if (!research?.intent) return null;
  const isOccasion = !!INTENTS[research.intent]?.occasion;
  const choices = isOccasion ? OCCASION_CHOICES : GENERAL_CHOICES;
  return (
    <div className="card" data-testid="intent-bar">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>This post is</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{research.intentLabel || INTENTS[research.intent]?.label}</div>
          {research.intentWhy && <div className="u-muted" style={{ fontSize: 13, marginTop: 3 }}>{research.intentWhy}</div>}
        </div>
      </div>
      <div className="eyebrow" style={{ margin: "12px 0 6px" }}>{isOccasion ? "Write something else for this occasion" : "Not right? Choose what this post is for"}</div>
      <div className="chips" style={{ marginTop: 0 }}>
        {choices.map((k) => (
          <button key={k} className={"chip " + (research.intent === k ? "on" : "")} disabled={busy || locked || research.intent === k}
            aria-pressed={research.intent === k} onClick={() => onSwitch(k)}>
            {SHORT[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ResearchResults({ research, busy, onRetry, onResearchAnyway }) {
  if (!research) return null;
  const real = (research.sources || []).filter((s) => !s.background);
  const background = (research.sources || []).filter((s) => s.background);

  if (research.status === "skipped") {
    return (
      <div className="card" data-testid="research-skipped">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Research skipped</div>
        <div style={{ fontSize: 14 }}>{research.skipReason}</div>
        <div className="u-muted" style={{ fontSize: 13, marginTop: 6 }}>Nothing is cited in this post, so nothing needs checking against a source.</div>
        <button className="btn sm" style={{ marginTop: 10 }} disabled={busy} onClick={onResearchAnyway}>Research anyway</button>
      </div>
    );
  }

  return (
    <>
      <div className="card" data-testid="research-sources">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div className="eyebrow">Verified sources</div>
          {real.length > 0 && <span className="badge">{research.freshness || "Recent"}</span>}
        </div>
        {real.length === 0 && (
          <div data-testid="research-unavailable">
            <div style={{ fontSize: 14 }}><b>No verified sources.</b> {research.reason || "The live search did not return usable results."}</div>
            <div className="u-muted" style={{ fontSize: 13, marginTop: 6 }}>
              The post will be written without sources, so it will not cite or state any figure, date or fact from research.
            </div>
            <button className="btn sm" style={{ marginTop: 10 }} disabled={busy} onClick={onRetry}>Try research again</button>
          </div>
        )}
        {real.map((s, i) => (
          <div className="src" key={i}>
            <span className={"tier t" + (s.tier || 4)}>{s.uploaded ? "Your document" : `T${s.tier} · ${tierLabel(s.tier)}`}</span>
            <div style={{ minWidth: 0 }}>
              {s.url ? <a className="srclink" href={s.url} target="_blank" rel="noreferrer">{s.title} <span className="ext">↗</span></a> : <div style={{ fontWeight: 600 }}>{s.title}</div>}
              <div className="u-muted" style={{ fontSize: 13 }}>{[s.publisher, s.date, s.uploaded ? "your upload" : s.url ? host(s.url) : ""].filter(Boolean).join(" · ")} <LinkBadge state={s.link} /></div>
              {s.note && <div className="u-muted" style={{ fontSize: 13, marginTop: 3 }}>{s.note}</div>}
            </div>
          </div>
        ))}
        {research.dropped > 0 && real.length > 0 && (
          <div className="u-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            {research.dropped} more source{research.dropped === 1 ? "" : "s"} named by the model {research.dropped === 1 ? "was" : "were"} left out — the search did not return {research.dropped === 1 ? "it" : "them"}, so {research.dropped === 1 ? "it" : "they"} could not be verified.
          </div>
        )}
        {background.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Background reading — not evidence</div>
            {background.map((s, i) => (
              <div key={i} style={{ fontSize: 13.5, padding: "3px 0" }}>
                <a className="srclink" href={s.url} target="_blank" rel="noreferrer">{s.title} <span className="ext">↗</span></a>
                <span className="u-muted"> · {host(s.url)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {((research.insights || []).length > 0 || (research.docInsights || []).length > 0 || (research.risks || []).length > 0) && (
        <div className="card">
          {(research.insights || []).length > 0 && (
            <>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{real.length ? "What the research shows" : "Ideas from the AI — not verified"}</div>
              {!real.length && <div className="u-muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Suggestions to consider, not facts. Nothing here came from a source.</div>}
              {research.insights.map((x, i) => <div key={i} style={{ padding: "5px 0" }}>— {x}</div>)}
            </>
          )}
          {(research.docInsights || []).length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 7 }}>From your document</div>
              {research.docInsights.map((x, i) => <div key={i} style={{ padding: "5px 0" }}>— {x}</div>)}
            </div>
          )}
          {(research.risks || []).length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 7 }}>Watch out for</div>
              {research.risks.map((x, i) => <div key={i} className="u-muted" style={{ padding: "3px 0" }}>⚠ {x}</div>)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
