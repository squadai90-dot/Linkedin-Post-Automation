/* How much a link can be trusted.
 *
 * A model that writes a URL into JSON is generating text, and generated URLs
 * are sometimes plausible and wrong. The compound models also report the
 * searches they really ran, so a link that appears in both was retrieved and
 * one that appears only in the answer was not. That difference decides
 * whether a row can back a claim, so it is shown, not buried.
 *
 * "unknown" means we had no record of what was searched — which is not the
 * same as doubt, so it says nothing rather than implying suspicion. */

const LINK_STATE = {
  retrieved:   { label: "Retrieved", cls: "lk-ok", title: "This link came back from a real search, not from the model's memory." },
  unconfirmed: { label: "Unconfirmed link", cls: "lk-warn", title: "The model wrote this link but the search did not return it. Open it before citing it." },
  placeholder: { label: "Not a real link", cls: "lk-bad", title: "This is a placeholder domain. Treat the row as an example, not a source." },
};

export function LinkBadge({ state }) {
  const s = LINK_STATE[state];
  if (!s) return null;   // "unknown" and "none" say nothing
  return <span className={"lk " + s.cls} title={s.title}>{s.label}</span>;
}

/* True when a source is safe to attach to a published claim. */
export const linkTrusted = (s) => s?.link === "retrieved" || s?.uploaded === true;
