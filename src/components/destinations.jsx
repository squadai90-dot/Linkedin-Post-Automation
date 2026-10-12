import { toggle, selectAll, publishLabel, reconcileSelection, STATE_LABEL } from "../lib/destinations.js";

/* ============================================================
   WHERE THE POST GOES — the LinkedIn Pages picker and its results

   Shown only when the deployment has a Page list. Each Page is a checkbox
   with its name and logo; the count says what pressing Publish will do. A
   Page that has the post already is marked and cannot be sent twice.
   ============================================================ */

const Logo = ({ d }) => (
  d.logo
    ? <img src={d.logo} alt="" className="dest-logo" />
    : <span className="dest-logo dest-initial" aria-hidden="true">{String(d.name || "?").trim()[0]}{/(\d+)\s*$/.exec(d.name || "")?.[1] || ""}</span>
);

export function DestinationPicker({ registry, selected, setSelected, results = {}, locked }) {
  if (!registry?.enabled) return null;
  const list = registry.destinations || [];
  const { valid, missing, unavailable } = reconcileSelection(selected, list);
  const settled = (id) => ["published", "queued", "accepted", "unknown"].includes(results[id]?.state);
  return (
    <div className="dest" data-testid="destinations">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <div className="eyebrow">Publish to LinkedIn</div>
          <div style={{ fontWeight: 600, marginTop: 4 }} data-testid="dest-summary">{publishLabel(valid.length)}</div>
        </div>
        <div className="row">
          <button className="btn sm ghost" disabled={locked} onClick={() => setSelected(selectAll(list))}>Select all</button>
          <button className="btn sm ghost" disabled={locked} onClick={() => setSelected(list.filter((d) => settled(d.id)).map((d) => d.id))}>Clear selection</button>
        </div>
      </div>
      <div className="dest-list" role="group" aria-label="LinkedIn Pages">
        {list.map((d) => {
          const on = selected.includes(d.id);
          const r = results[d.id];
          const off = d.enabled === false;
          return (
            <label key={d.id} className={"dest-item" + (on ? " on" : "") + (off ? " off" : "")}>
              <input type="checkbox" checked={on && !off} disabled={locked || off || settled(d.id)}
                onChange={() => setSelected(toggle(selected, d.id))} aria-label={d.name} />
              <Logo d={d} />
              <span className="dest-name">{d.name}</span>
              {off && <span className="badge warn">Not available</span>}
              {r && r.state !== "idle" && <span className={"badge " + (["failed", "rejected"].includes(r.state) ? "bad" : r.state === "published" || r.state === "queued" ? "" : "warn")} data-testid={`dest-state-${d.id}`}>{STATE_LABEL[r.state] || r.state}</span>}
            </label>
          );
        })}
      </div>
      {(missing.length > 0 || unavailable.length > 0) && (
        <div className="badge warn" style={{ display: "block", marginTop: 8 }} data-testid="dest-missing">
          {missing.length > 0 && <>This post was set to go to a Page that is no longer on the list ({missing.join(", ")}). It will not be sent there, and no other Page is used instead. </>}
          {unavailable.length > 0 && <>{unavailable.map((id) => list.find((d) => d.id === id)?.name || id).join(", ")} can't be published to right now.</>}
        </div>
      )}
      {valid.length === 0 && <div className="u-muted" style={{ fontSize: 12.5, marginTop: 8 }}>Choose at least one Page. Nothing is sent until you do.</div>}
    </div>
  );
}

/** Per-Page outcome after a send: published (with a link), queued, failed (with why). */
export function DestinationResults({ registry, selected, results = {} }) {
  if (!registry?.enabled) return null;
  const rows = (selected || []).filter((id) => results[id] && results[id].state !== "idle");
  if (!rows.length) return null;
  const name = (id) => registry.destinations.find((d) => d.id === id)?.name || id;
  return (
    <div className="dest-results" data-testid="dest-results">
      {rows.map((id) => {
        const r = results[id];
        return (
          <div key={id} className="dest-row">
            <span className={"dot " + (r.state === "published" ? "g" : ["failed", "rejected"].includes(r.state) ? "r" : "y")} />
            <span style={{ fontWeight: 600 }}>{name(id)}</span>
            <span className="u-muted">— {STATE_LABEL[r.state] || r.state}</span>
            {r.url && <a href={r.url} target="_blank" rel="noreferrer">View post ↗</a>}
            {["failed", "rejected", "unknown"].includes(r.state) && r.message && <span className="u-muted" style={{ fontSize: 12.5, flexBasis: "100%", paddingLeft: 18 }}>{r.message}</span>}
          </div>
        );
      })}
    </div>
  );
}
