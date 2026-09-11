/* Dates and daily series for exchange-rate lookups.
 *
 * Pure, so it can be tested without a network. Everything here exists because
 * a date bug in a rate lookup is invisible: the workbook fills in, the columns
 * compute, and the figure is simply the wrong one.
 *
 * The two rules that matter:
 *
 *   - A rate must be published ON OR BEFORE the measurement date. A rate from
 *     after the balance-sheet date is not a substitute at any distance; it is
 *     information that did not exist yet.
 *   - An unparseable date must REFUSE, never fall through to "latest". Falling
 *     through stamps today's rate as the 31-December rate, and nothing in the
 *     workbook shows that it happened.
 */

/** Milliseconds to whole days, so two timestamps on the same date compare
    equal whatever time of day the provider stamped them with. */
export const dayNum = (ms: number) => Math.floor(ms / 86400000);

/** Parse the date forms a preparer actually types, to ISO. Returns null when
    the input is empty or not a date; never guesses a year.

    "3/4/2024" is genuinely ambiguous, so it follows the US convention the
    rest of the form uses (March 4) — EXCEPT when the first number cannot be a
    month, where the only possible reading is day-first. */
export function toIsoLoose(value: unknown): string | null {
  const s = String(value ?? "").trim();

  const iso = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (iso) {
    const y = parseInt(iso[1], 10), m = parseInt(iso[2], 10), d = parseInt(iso[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const parts = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (!parts) return null;
  let m = parseInt(parts[1], 10);
  let d = parseInt(parts[2], 10);
  if (m > 12 && d <= 12) { const t = m; m = d; d = t; }   // 31/12 can only be day-first
  const y = parts[3].length === 2 ? 2000 + parseInt(parts[3], 10) : parseInt(parts[3], 10);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Like toIsoLoose, but a non-empty value that will not parse THROWS.
    An empty value returns null — absent is not the same as wrong. */
export function requireIso(value: unknown, label?: string): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const iso = toIsoLoose(s);
  if (!iso) {
    const what = label || "measurement date";
    throw new Error(
      `Unparseable ${what}: "${s}". Accepted forms are YYYY-MM-DD, MM/DD/YYYY and DD/MM/YYYY. ` +
      `Refusing to look up a dateless "latest" rate, which would stamp today's rate as the ${what} rate.`,
    );
  }
  return iso;
}

/** The ISO date `days` before `iso` — used to name the window a failed
    lookup actually searched, so the message can say how far back it went. */
export function windowStart(iso: string, days: number): string | null {
  const t = Date.parse(iso + "T00:00:00Z");
  if (!isFinite(t)) return null;
  return new Date(t - days * 86400000).toISOString().slice(0, 10);
}

/** The day AFTER the same date one year earlier: the first day of the year
    ending on `iso`. "2024-12-31" -> "2024-01-01".
 *
 * Leap days are why this is not string arithmetic. Subtracting a year from
 * 2024-02-29 lands on 2023-02-29, which JavaScript silently rolls forward to
 * 2023-03-01 — a period a day short at one end and wrong at the other. The
 * month is checked and clamped back before the day is added. */
export function yearBefore(iso: string): string | null {
  const t = Date.parse(iso + "T00:00:00Z");
  if (!isFinite(t)) return null;
  const d = new Date(t);
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  if (d.getUTCMonth() !== month) d.setUTCDate(d.getUTCDate() - 1);   // 29 Feb -> 28 Feb
  const next = new Date(d.getTime() + 86400000);
  return isFinite(next.getTime()) ? next.toISOString().slice(0, 10) : null;
}

export type RatePoint = { t: number; r: number };

/** The most recent point published ON OR BEFORE `iso`, within `maxDays`.
 *
 * A later rate is never substituted, at any distance: on 31 December the
 * 2 January rate is not "one day away", it is information that did not exist
 * on the measurement date. Markets close for weekends and holidays, so a
 * window is necessary — ten days covers the longest ordinary closure. */
export function nearestPoint(
  series: RatePoint[],
  iso: string,
  maxDays = 10,
): { rate: number; date: string; diffDays: number } | null {
  if (!Array.isArray(series) || !series.length) return null;
  const target = Date.parse(iso + "T00:00:00Z");
  if (!isFinite(target)) return null;
  const want = dayNum(target);
  let best: RatePoint | null = null;
  let bestDiff = Infinity;
  for (const p of series) {
    const day = dayNum(p.t);
    if (day > want) continue;                      // published after the date
    const diff = want - day;
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  if (!best || bestDiff > maxDays) return null;
  return { rate: best.r, date: new Date(dayNum(best.t) * 86400000).toISOString().slice(0, 10), diffDays: bestDiff };
}

/** Short label for where a rate came from, shown next to it in the UI. */
export const providerTag = (provider?: string) =>
  provider === "ofx" ? "OFX" : provider === "frankfurter" ? "ECB" : provider === "tables" ? "IRS" : "Live";

/** The tag for a stored rate. Newer entries carry it explicitly; older ones
    are read back out of the source text they were saved with. */
export function fxTag(meta?: { tag?: string; source?: string } | null): string {
  if (!meta) return "";
  if (meta.tag) return meta.tag;
  const s = String(meta.source || "");
  if (/manual/i.test(s)) return "Manual";
  if (/OFX/i.test(s)) return "OFX";
  if (/IRS yearly average/i.test(s)) return "IRS";
  if (/Treasury/.test(s)) return "Treasury";
  if (/IRS/.test(s)) return "IRS";
  if (/frankfurter|ECB/i.test(s)) return "ECB";
  return s ? "Live" : "";
}

/** "2024-12-30 (requested 2024-12-31)" — the provenance has to show both when
    the market was shut on the date actually being measured. */
export const asOfLabel = (asOf?: string, requested?: string) =>
  asOf && requested && asOf !== requested ? `${asOf} (requested ${requested})` : asOf || requested || "latest";
