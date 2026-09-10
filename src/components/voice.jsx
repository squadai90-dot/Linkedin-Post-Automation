import { useState, useMemo } from "react";
import { askJSON, JSON_RULE } from "../lib/ai.js";

/* ---------- brand voice ---------- */

export const VOICE_DIMS = [
  ["professional", "Professional", "Casual", "Formal"],
  ["conversational", "Conversational", "Distant", "Direct address"],
  ["technical", "Technical depth", "Plain", "Specialist"],
  ["opinionated", "Opinion strength", "Neutral", "Takes a side"],
  ["humour", "Humour", "None", "Dry wit"],
  ["emoji", "Emoji", "Never", "Frequent"],
];

export function VoiceStudio({ voice, setVoice, track }) {
  const [tab, setTab] = useState("dimensions");
  const [newAvoid, setNewAvoid] = useState("");
  const [newPrefer, setNewPrefer] = useState("");
  const [sample, setSample] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setVoice({ ...voice, [k]: v });

  const summary = useMemo(() => {
    const b = [];
    b.push(voice.professional > 65 ? "Formal register" : voice.professional < 35 ? "Casual register" : "Neutral register");
    b.push(voice.opinionated > 65 ? "takes a clear position" : voice.opinionated < 35 ? "stays neutral" : "argues carefully");
    b.push(voice.technical > 60 ? "assumes domain knowledge" : "explains in plain terms");
    b.push(voice.emoji < 20 ? "no emoji" : "occasional emoji");
    return b.join(", ") + ".";
  }, [voice]);

  async function draftSample() {
    setBusy(true);
    const r = await askJSON({
      system: `You write brand voice samples. ${JSON_RULE}`,
      user: `Write two opening lines for a LinkedIn post about improving a support workflow, in this voice:
professional ${voice.professional}, conversational ${voice.conversational}, technical ${voice.technical}, opinionated ${voice.opinionated}, humour ${voice.humour}, emoji ${voice.emoji}.
Never use: ${voice.avoid.join(", ")}. Prefer: ${voice.prefer.join(", ")}.
{"lines":["",""]}`,
      fallback: () => ({ lines: ["Most support backlogs are not a staffing problem.", "We cut first-response time by rewriting one workflow, not by hiring."] }),
      track: track("Brand writer"),
    });
    setSample(r.lines); setBusy(false);
  }

  async function learnFrom(source) {
    setBusy(true);
    const r = await askJSON({
      system: `You infer a brand voice profile. ${JSON_RULE}`,
      user: `Infer a voice profile for a B2B enterprise software company from its ${source}. Return 0-100 scores.
{"professional":0,"conversational":0,"technical":0,"opinionated":0,"humour":0,"emoji":0,"avoid":["word"],"prefer":["word"]}`,
      fallback: () => ({ professional: 74, conversational: 58, technical: 62, opinionated: 70, humour: 14, emoji: 5, avoid: ["revolutionary", "seamless"], prefer: ["measurable", "workflow"] }),
      track: track("Brand writer"),
    });
    setVoice({ ...voice, ...r, avoid: [...new Set([...voice.avoid, ...(r.avoid || [])])], prefer: [...new Set([...voice.prefer, ...(r.prefer || [])])] });
    setBusy(false);
  }

  return (
    <div>
      <div className="tabs">
        {[["dimensions", "Dimensions"], ["vocabulary", "Vocabulary"], ["format", "Format"], ["learn", "Learn"]].map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="vgrid">
        <div>
          {tab === "dimensions" && VOICE_DIMS.map(([k, label, lo, hi]) => (
            <div className="dim" key={k}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
                <span className="mono u-muted" style={{ fontSize: 12 }}>{voice[k]}</span>
              </div>
              <input type="range" min="0" max="100" value={voice[k]} onChange={(e) => set(k, +e.target.value)} />
              <div className="row" style={{ justifyContent: "space-between" }}><span className="eyebrow">{lo}</span><span className="eyebrow">{hi}</span></div>
            </div>
          ))}
          {tab === "vocabulary" && (
            <>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Never use</div>
              <div className="tagrow">
                {voice.avoid.map((w) => <span className="tag" key={w}>{w}<button onClick={() => set("avoid", voice.avoid.filter((x) => x !== w))}>×</button></span>)}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <input className="ta" style={{ flex: 1 }} placeholder="Add a word or phrase" value={newAvoid} onChange={(e) => setNewAvoid(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newAvoid.trim()) { set("avoid", [...voice.avoid, newAvoid.trim()]); setNewAvoid(""); } }} />
                <button className="btn sm" onClick={() => { if (newAvoid.trim()) { set("avoid", [...voice.avoid, newAvoid.trim()]); setNewAvoid(""); } }}>Add</button>
              </div>
              <div className="eyebrow" style={{ margin: "24px 0 8px" }}>Prefer</div>
              <div className="tagrow">
                {voice.prefer.map((w) => <span className="tag ok" key={w}>{w}<button onClick={() => set("prefer", voice.prefer.filter((x) => x !== w))}>×</button></span>)}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <input className="ta" style={{ flex: 1 }} placeholder="Add a preferred term" value={newPrefer} onChange={(e) => setNewPrefer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newPrefer.trim()) { set("prefer", [...voice.prefer, newPrefer.trim()]); setNewPrefer(""); } }} />
                <button className="btn sm" onClick={() => { if (newPrefer.trim()) { set("prefer", [...voice.prefer, newPrefer.trim()]); setNewPrefer(""); } }}>Add</button>
              </div>
            </>
          )}
          {tab === "format" && [["cta", "Call to action", ["Question-based", "Direct", "Soft", "None"]],
            ["paragraphs", "Paragraph length", ["Short", "Medium", "Long"]],
            ["hashtags", "Hashtags", ["None", "1–2", "2–3", "4+"]]].map(([k, label, opts]) => (
            <div key={k} style={{ marginBottom: 22 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
              <div className="row">{opts.map((o) => <button key={o} className={"chip " + (voice[k] === o ? "on" : "")} onClick={() => set(k, o)}>{o}</button>)}</div>
            </div>
          ))}
          {tab === "learn" && (
            <>
              <div className="u-muted" style={{ fontSize: 14, marginBottom: 16 }}>Infer the profile instead of setting it by hand. Each option runs the writer engine and overwrites the sliders.</div>
              {[["approved posts", "Your last 20 approved posts"], ["brand guidelines document", "An uploaded brand guidelines PDF"], ["public website copy", "Your website and product pages"]].map(([src, label]) => (
                <button key={src} className="opt" disabled={busy} onClick={() => learnFrom(src)}>{busy ? "Reading…" : label}</button>
              ))}
            </>
          )}
        </div>
        <div className="vpreview">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Profile summary</div>
          <div style={{ fontSize: 14.5, marginBottom: 18 }}>{summary}</div>
          <div className="vbars">
            {VOICE_DIMS.map(([k, label]) => (
              <div key={k}>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}><span className="u-muted">{label}</span><span className="mono">{voice[k]}</span></div>
                <div className="bar"><i style={{ width: `${voice[k]}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="eyebrow" style={{ margin: "22px 0 8px" }}>Sounds like</div>
          {sample ? sample.map((l, i) => <div key={i} className="samp">{l}</div>) : <div className="u-muted" style={{ fontSize: 13.5 }}>Draft a sample to hear it.</div>}
          <button className="btn sm" style={{ marginTop: 12 }} disabled={busy} onClick={draftSample}>{busy ? "Writing…" : "Draft a sample line"}</button>
        </div>
      </div>
    </div>
  );
}
