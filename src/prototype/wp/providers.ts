/* Free, keyless services for translation and live exchange rates, plus the
   quota accounting shown in Settings.

   Every call is defensive: these are public endpoints that can rate-limit,
   change shape or block CORS at any time, so each provider reports failure
   rather than throwing, and callers fall through to the next one. The offline
   IRS/Treasury tables remain the default source for the work paper itself. */

import { nearestPoint, windowStart, type RatePoint } from "./fxDates";

export type ProviderKind = "translate" | "fx";

export type ProviderSpec = {
  id: string;
  kind: ProviderKind;
  name: string;
  endpoint: string;
  keyless: boolean;
  /** Documented free allowance, per day unless stated. null = none published. */
  dailyLimit: number | null;
  limitUnit: "characters" | "requests";
  notes: string;
};

import { isServiceErrorText } from "./captions";

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "mymemory",
    kind: "translate",
    name: "MyMemory",
    endpoint: "https://api.mymemory.translated.net/get",
    keyless: true,
    dailyLimit: 5000,
    limitUnit: "characters",
    notes: "Anonymous use is capped at 5,000 characters per day per IP address.",
  },
  {
    id: "lingva",
    kind: "translate",
    name: "Lingva",
    endpoint: "https://lingva.ml/api/v1",
    keyless: true,
    dailyLimit: null,
    limitUnit: "requests",
    notes: "Community-hosted front end. No published quota; availability varies.",
  },
  {
    id: "groq",
    kind: "translate",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    keyless: false,
    dailyLimit: null,
    limitUnit: "requests",
    notes: "Needs an API key. Highest quality for accounting terminology.",
  },
  {
    id: "ofx",
    kind: "fx",
    name: "OFX",
    endpoint: "https://api.ofx.com/PublicSite.ApiService/SpotRateHistory",
    keyless: true,
    dailyLimit: null,
    limitUnit: "requests",
    notes: "OFX public spot-rate history. Indicative mid-market rates.",
  },
  {
    id: "frankfurter",
    kind: "fx",
    name: "Frankfurter (ECB)",
    endpoint: "https://api.frankfurter.dev/v1",
    keyless: true,
    dailyLimit: null,
    limitUnit: "requests",
    notes: "European Central Bank reference rates. Historical dates supported.",
  },
  {
    id: "erapi",
    kind: "fx",
    name: "ExchangeRate-API (open)",
    endpoint: "https://open.er-api.com/v6/latest",
    keyless: true,
    dailyLimit: null,
    limitUnit: "requests",
    notes: "Open endpoint, latest rates only — no historical lookup.",
  },
  {
    id: "tables",
    kind: "fx",
    name: "IRS + US Treasury tables",
    endpoint: "bundled",
    keyless: true,
    dailyLimit: null,
    limitUnit: "requests",
    notes: "Offline tables extracted from the reference workbook. Default source for the work paper.",
  },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);

export type ProviderResult<T> =
  | { ok: true; value: T; provider: string; units: number }
  | { ok: false; error: string; provider: string; units: number };

const TIMEOUT_MS = 12000;

async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Translation                                                         */
/* ------------------------------------------------------------------ */

/** MyMemory: one short phrase per request, counted in characters. */
export async function translateMyMemory(text: string, from = "auto"): Promise<ProviderResult<string>> {
  const units = text.length;
  try {
    const pair = `${from === "auto" ? "autodetect" : from}|en`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`;
    const data = await getJson(url);
    const out = data?.responseData?.translatedText;
    if (typeof out !== "string" || !out.trim()) throw new Error("empty response");
    // The service returns its complaints INSIDE a 200 response, in the same
    // field a real translation occupies. Treat them as failures, or an error
    // string gets stored as the caption's translation and is never retried.
    if (/MYMEMORY WARNING|QUOTA EXCEEDED/i.test(out)) throw new Error("daily quota exceeded");
    if (isServiceErrorText(out)) throw new Error(out.trim().slice(0, 80));
    return { ok: true, value: out, provider: "mymemory", units };
  } catch (err) {
    return { ok: false, error: (err as Error).message, provider: "mymemory", units };
  }
}

/** Lingva: path-based, no quota published. */
export async function translateLingva(text: string, from = "auto"): Promise<ProviderResult<string>> {
  const units = text.length;
  try {
    const url = `https://lingva.ml/api/v1/${encodeURIComponent(from)}/en/${encodeURIComponent(text)}`;
    const data = await getJson(url);
    const out = data?.translation;
    if (typeof out !== "string" || !out.trim()) throw new Error("empty response");
    return { ok: true, value: out, provider: "lingva", units };
  } catch (err) {
    return { ok: false, error: (err as Error).message, provider: "lingva", units };
  }
}

/* ------------------------------------------------------------------ */
/* Live exchange rates                                                 */
/* ------------------------------------------------------------------ */

/** All providers return a divide rate: units of `code` per 1 USD. */
export type LiveRate = { rate: number; asOf: string; provider: string };

/* ---------- the OFX daily series ----------

   One request per currency per session, shared by the latest-spot, the
   nearest-date and the period-average lookups. Without the cache, filling a
   single entity's three rates fetched the same multi-megabyte series three
   times. The PROMISE is cached, not the result, so three lookups racing at
   startup make one request between them; a rejection evicts the entry so the
   next attempt is a real retry rather than a replay of the failure. */
const ofxSeries = new Map<string, Promise<RatePoint[]>>();

const OFX_URL = (code: string) =>
  `https://api.ofx.com/PublicSite.ApiService/SpotRateHistory/allTime/USD/${encodeURIComponent(code)}?DecimalPlaces=6&ReportingInterval=daily&format=json`;

/** The whole published daily series for one currency, once per session. */
export async function ofxAllTime(code: string): Promise<RatePoint[]> {
  const key = String(code || "").toUpperCase().trim();
  const cached = ofxSeries.get(key);
  if (cached) return cached;
  const p = (async () => {
    const data = await getJson(OFX_URL(key));
    if (data?.ErrorCode || data?.Message) throw new Error(String(data.Message || data.ErrorCode));
    const points = data?.HistoricalPoints;
    if (!Array.isArray(points) || !points.length) throw new Error("no rate points returned");
    const usable = points
      .map((p2: any) => ({ t: Number(p2?.PointInTime), r: Number(p2?.InterbankRate ?? p2?.Rate) }))
      .filter((p2: RatePoint) => isFinite(p2.t) && isFinite(p2.r) && p2.r > 0);
    if (!usable.length) throw new Error("no usable rate points");
    return usable;
  })().catch((err) => { ofxSeries.delete(key); throw err; });
  ofxSeries.set(key, p);
  return p;
}

/** The OFX rate for a specific date: the last one published on or before it,
    within ten days. Never a later rate — see nearestPoint. */
export async function fxOfxOnDate(code: string, iso: string): Promise<ProviderResult<LiveRate>> {
  try {
    if (!iso) throw new Error("no date requested");
    const series = await ofxAllTime(code);
    const hit = nearestPoint(series, iso, 10);
    if (!hit) {
      throw new Error(
        `no OFX daily rate published on or before ${iso} (searched back to ${windowStart(iso, 10) || "the start of the series"}); ` +
        "a rate published after the measurement date cannot be used",
      );
    }
    return { ok: true, value: { rate: hit.rate, asOf: hit.date, provider: "ofx" }, provider: "ofx", units: 1 };
  } catch (err) {
    return { ok: false, error: (err as Error).message, provider: "ofx", units: 1 };
  }
}

/** OFX public spot-rate history, USD -> code. */
export async function fxOfx(code: string): Promise<ProviderResult<LiveRate>> {
  try {
    const series = await ofxAllTime(code);
    const last = series[series.length - 1];
    if (!last || !isFinite(last.r) || last.r <= 0) throw new Error("unusable rate value");
    return {
      ok: true,
      value: { rate: last.r, asOf: new Date(last.t).toISOString().slice(0, 10), provider: "ofx" },
      provider: "ofx", units: 1,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message, provider: "ofx", units: 1 };
  }
}

/** OFX daily-series average over a period — the average-rate fallback when
    the IRS table has no figure. Filters the allTime daily series to
    [startIso, endIso]; refuses sparse windows rather than guessing. NOTE:
    OFX supports ~50 major currencies; unsupported codes (e.g. RON) return
    "Currency … not supported" and the caller falls through to manual entry. */
export async function fxOfxAverage(
  code: string,
  startIso: string,
  endIso: string,
): Promise<ProviderResult<{ rate: number; points: number; from: string; to: string }>> {
  try {
    const points = await ofxAllTime(code);
    const start = Date.parse(startIso);
    const end = Date.parse(endIso) + 86399999;
    if (!isFinite(start) || !isFinite(end) || end <= start) throw new Error("bad period");
    const inRange = points.filter((p) => p.t >= start && p.t <= end);
    if (inRange.length < 60) throw new Error(`only ${inRange.length} daily points in ${startIso}..${endIso}`);
    const rate = inRange.reduce((s: number, p) => s + p.r, 0) / inRange.length;
    return {
      ok: true,
      value: { rate: Math.round(rate * 1e6) / 1e6, points: inRange.length, from: startIso, to: endIso },
      provider: "ofx", units: 1,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message, provider: "ofx", units: 1 };
  }
}

/** Frankfurter (ECB). Accepts an ISO date for historical lookups. */
export async function fxFrankfurter(code: string, date?: string): Promise<ProviderResult<LiveRate>> {
  try {
    const when = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "latest";
    const url = `https://api.frankfurter.dev/v1/${when}?base=USD&symbols=${encodeURIComponent(code)}`;
    const data = await getJson(url);
    const rate = Number(data?.rates?.[code.toUpperCase()]);
    if (!isFinite(rate) || rate <= 0) throw new Error(`no rate for ${code}`);
    return { ok: true, value: { rate, asOf: data?.date || "latest", provider: "frankfurter" }, provider: "frankfurter", units: 1 };
  } catch (err) {
    return { ok: false, error: (err as Error).message, provider: "frankfurter", units: 1 };
  }
}

/** ExchangeRate-API open endpoint. Latest only. */
export async function fxErApi(code: string): Promise<ProviderResult<LiveRate>> {
  try {
    const data = await getJson("https://open.er-api.com/v6/latest/USD");
    const rate = Number(data?.rates?.[code.toUpperCase()]);
    if (!isFinite(rate) || rate <= 0) throw new Error(`no rate for ${code}`);
    const asOf = data?.time_last_update_utc ? String(data.time_last_update_utc).slice(5, 16) : "latest";
    return { ok: true, value: { rate, asOf, provider: "erapi" }, provider: "erapi", units: 1 };
  } catch (err) {
    return { ok: false, error: (err as Error).message, provider: "erapi", units: 1 };
  }
}

/** Try providers in order; first success wins. Errors are collected. */
export async function fetchLiveRate(
  code: string,
  order: string[],
  date?: string,
): Promise<{ result: ProviderResult<LiveRate>; attempts: Array<{ provider: string; error: string }> }> {
  const attempts: Array<{ provider: string; error: string }> = [];
  for (const id of order) {
    let r: ProviderResult<LiveRate>;
    // With a date in hand OFX can answer it exactly; without one it is the
    // latest published point, same as before.
    if (id === "ofx") r = date ? await fxOfxOnDate(code, date) : await fxOfx(code);
    else if (id === "frankfurter") r = await fxFrankfurter(code, date);
    else if (id === "erapi") r = await fxErApi(code);
    else continue;
    if (r.ok) return { result: r, attempts };
    attempts.push({ provider: id, error: r.error });
  }
  return {
    result: { ok: false, error: attempts.map((a) => `${a.provider}: ${a.error}`).join(" · ") || "no provider attempted", provider: "none", units: 0 },
    attempts,
  };
}

/** Try free translators in order. */
export async function translateFree(
  text: string,
  order: string[],
  from = "auto",
): Promise<{ result: ProviderResult<string>; attempts: Array<{ provider: string; error: string }> }> {
  const attempts: Array<{ provider: string; error: string }> = [];
  for (const id of order) {
    let r: ProviderResult<string>;
    if (id === "mymemory") r = await translateMyMemory(text, from);
    else if (id === "lingva") r = await translateLingva(text, from);
    else continue;
    if (r.ok) return { result: r, attempts };
    attempts.push({ provider: id, error: r.error });
  }
  return {
    result: { ok: false, error: attempts.map((a) => `${a.provider}: ${a.error}`).join(" · ") || "no provider attempted", provider: "none", units: 0 },
    attempts,
  };
}

/** Two-letter hint for the translator, from the script the caption uses. */
export function sourceLangHint(text: string): string {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[\u0370-\u03FF]/.test(text)) return "el";
  if (/[\u0590-\u05FF]/.test(text)) return "he";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu";
  if (/[\u0E00-\u0E7F]/.test(text)) return "th";
  if (/[ăâđêôơưĂÂĐÊÔƠƯạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/.test(text)) return "vi";
  return "auto";
}

/** True when the text is dominated by non-Latin script — a "translation"
    still in that script is not a translation. */
export function isMostlyNonLatin(text: string): boolean {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return false;
  const nonLatin = letters.filter((c) => !/[A-Za-z\u00C0-\u024F]/.test(c)).length;
  return nonLatin / letters.length > 0.5;
}
