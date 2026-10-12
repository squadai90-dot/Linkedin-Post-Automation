/**
 * The LinkedIn Pages this deployment may publish to.
 *
 * The list lives on the server, in LINKEDIN_DESTINATIONS, so the browser
 * chooses Pages by id and never supplies an organization URN of its own. A
 * request naming an id that is not here is refused before anything reaches
 * Make.
 *
 *   LINKEDIN_DESTINATIONS='[
 *     {"id":"test-1","name":"Unison Content OS Test","organizationUrn":"urn:li:organization:…"},
 *     {"id":"test-2","name":"Unison Content OS Test 2","organizationUrn":"urn:li:organization:…"}
 *   ]'
 *
 * Optional per entry: "logo" (an https image URL) and "enabled": false to
 * show a Page as unavailable without removing it.
 *
 * Multi-destination publishing is switched on only when this list AND
 * MAKE_MULTI_WEBHOOK_URL are both set. Without them the app publishes exactly
 * as before, through api/publish.js. Nothing here is a secret: Page names and
 * organization URNs are public on LinkedIn. The webhook URL is never sent to
 * the browser.
 *
 * Files whose names start with "_" are not deployed as functions by Vercel.
 */

const URN = /^urn:li:organization:\d+$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HOOK = /^https:\/\/hook\.[a-z0-9.-]+\.make\.com\//;

/** Parse and validate the registry. Bad entries are dropped with a reason,
    never guessed at. */
export function readRegistry(raw = process.env.LINKEDIN_DESTINATIONS) {
  const problems = [];
  let list = [];
  if (raw && String(raw).trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) problems.push("LINKEDIN_DESTINATIONS must be a JSON array.");
      else list = parsed;
    } catch {
      problems.push("LINKEDIN_DESTINATIONS is not valid JSON.");
    }
  }
  const seen = new Set();
  const destinations = [];
  for (const d of list) {
    const id = String(d?.id || "").trim().toLowerCase();
    const urn = String(d?.organizationUrn || "").trim();
    if (!ID.test(id)) { problems.push(`Skipped an entry with an invalid id "${d?.id ?? ""}".`); continue; }
    if (!URN.test(urn)) { problems.push(`Skipped "${id}": organizationUrn must look like urn:li:organization:123.`); continue; }
    if (seen.has(id)) { problems.push(`Skipped a second entry with id "${id}".`); continue; }
    seen.add(id);
    destinations.push({
      id,
      name: String(d?.name || id).slice(0, 120),
      organizationUrn: urn,
      logo: typeof d?.logo === "string" && /^https:\/\//.test(d.logo) ? d.logo : null,
      enabled: d?.enabled !== false,
    });
  }
  return { destinations, problems };
}

export const multiWebhook = () => {
  const url = String(process.env.MAKE_MULTI_WEBHOOK_URL || "").trim();
  return HOOK.test(url) ? url : null;
};

/** Which of the requested ids may be published to, and why the rest may not. */
export function resolveDestinations(ids, registry) {
  const list = Array.isArray(ids) ? ids : [];
  const wanted = [...new Set(list.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))];
  const byId = new Map(registry.map((d) => [d.id, d]));
  const ok = [];
  const refused = [];
  for (const id of wanted) {
    const d = byId.get(id);
    if (!d) refused.push({ id, reason: "unknown" });
    else if (!d.enabled) refused.push({ id, reason: "unavailable" });
    else ok.push(d);
  }
  return { ok, refused, duplicates: list.length - wanted.length };
}

/** The per-destination job key. A post going to one Page keeps its own id,
    exactly as before; a post going to several gets one key per Page, so each
    is stored, de-duplicated and retried on its own. */
export const jobKey = (postId, destinationId, fanout) => (fanout ? `${postId}~${destinationId}` : String(postId));
