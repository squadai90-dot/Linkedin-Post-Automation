/* Date helpers. Everything user-facing is local time; scheduling carries an
   explicit IANA timezone so the payload Make receives is unambiguous. */

export const pad2 = (n) => String(n).padStart(2, "0");

/* yyyy-mm-dd in LOCAL time (toISOString() would shift the day near midnight) */
export const toISODate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayISO = () => toISODate(new Date());

export const parseISODate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

export const addDays = (iso, n) => { const d = parseISODate(iso) || new Date(); d.setDate(d.getDate() + n); return toISODate(d); };

/* Monday-first */
export const startOfWeek = (iso) => { const d = parseISODate(iso) || new Date(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return toISODate(d); };

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const fmtDay = (iso) => { const d = parseISODate(iso); return d ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}` : String(iso || ""); };
export const fmtLong = (iso) => { const d = parseISODate(iso); return d ? `${DAY_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : String(iso || ""); };
export const fmtMonth = (iso) => { const d = parseISODate(iso); return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : ""; };

/* Six rows of seven ISO dates covering the month that contains `iso`. */
export function monthGrid(iso) {
  const d = parseISODate(iso) || new Date();
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  let cur = startOfWeek(toISODate(first));
  const rows = [];
  for (let r = 0; r < 6; r++) {
    const row = [];
    for (let c = 0; c < 7; c++) { row.push(cur); cur = addDays(cur, 1); }
    rows.push(row);
  }
  return rows;
}
export const weekDays = (iso) => { const s = startOfWeek(iso); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); };
export const sameMonth = (a, b) => String(a).slice(0, 7) === String(b).slice(0, 7);

export const greeting = (d = new Date()) => { const h = d.getHours(); return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

/* Next weekday at 09:30 local — a sensible default that is never in the past. */
export function nextSlot(from = new Date()) {
  const d = new Date(from.getTime());
  if (d.getHours() >= 9) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return { date: toISODate(d), time: "09:30" };
}

/* ---- timezones ---- */
const FALLBACK_TZ = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Africa/Johannesburg", "UTC"];
export const TIMEZONES = (() => {
  try { const list = Intl.supportedValuesOf?.("timeZone"); if (Array.isArray(list) && list.length) return list; } catch { /* old browser */ }
  return FALLBACK_TZ;
})();
export const localTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

/* Which country's public holidays to check for a timezone (Nager.Date codes). */
const TZ_COUNTRY = {
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Asia/Dubai": "AE", "Asia/Singapore": "SG", "Asia/Tokyo": "JP", "Asia/Hong_Kong": "HK", "Asia/Shanghai": "CN",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE", "Europe/Paris": "FR", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Amsterdam": "NL", "Europe/Stockholm": "SE", "Europe/Zurich": "CH",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US", "America/Los_Angeles": "US", "America/Phoenix": "US", "America/Toronto": "CA", "America/Vancouver": "CA", "America/Sao_Paulo": "BR", "America/Mexico_City": "MX",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU", "Australia/Perth": "AU", "Pacific/Auckland": "NZ", "Africa/Johannesburg": "ZA", "Africa/Lagos": "NG", "Africa/Nairobi": "KE",
};
export const countryForTimezone = (tz) => TZ_COUNTRY[tz] || null;

/* Offset of `tz` from UTC at a given instant, in minutes. */
export function tzOffsetMinutes(date, tz) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch { return 0; }
}

/* A wall-clock time in a timezone → the instant it happens. */
export function zonedToUtc(iso, hhmm, tz) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const [hh, mm] = String(hhmm || "09:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const off = tzOffsetMinutes(new Date(guess), tz);
  const utc = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(utc), tz);
  return new Date(guess - off2 * 60000);
}

export const isDue = (iso, hhmm, tz, now = new Date()) => { try { return zonedToUtc(iso, hhmm, tz).getTime() <= now.getTime(); } catch { return false; } };

export const relativeTime = (iso, now = Date.now()) => {
  if (!iso) return "";
  const m = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
