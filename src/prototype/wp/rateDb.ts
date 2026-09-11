/* The currency-rate database: three sheets — Currency Code, IRS Average
   Rate, Treasury Spot Rate — seeded from the built-in tables and replaceable
   by an uploaded Rates.xlsx. All rates are divide rates (units per 1 USD).
   The database is the FIRST source in the lookup chain; live providers are
   fallbacks, and a rate that exists nowhere stays blank — never guessed. */

import { FX_META, IRS_AVERAGE, TREASURY_SPOT } from "./fxRates";

declare const JSZip: any;

export type RateDb = {
  codes: Array<{ code: string; country?: string; currency?: string }>;
  irsAvg: Record<string, Record<string, number>>;   // code -> year -> rate
  spot: Record<string, Record<string, number>>;     // code -> year -> 12/31 rate
  source: string;
  uploadedAt: string | null;
};

export function seedRateDb(): RateDb {
  const codes = Object.entries(FX_META).map(([code, m]) => ({ code, country: m.country, currency: m.currency }));
  const clone = (t: Record<string, Record<string, number>>) => {
    const out: Record<string, Record<string, number>> = {};
    for (const [c, years] of Object.entries(t)) out[c] = { ...years };
    return out;
  };
  return {
    codes,
    irsAvg: clone(IRS_AVERAGE),
    spot: clone(TREASURY_SPOT),
    source: "Built-in IRS yearly average + US Treasury 12/31 tables",
    uploadedAt: null,
  };
}

export function rateDbYears(db: RateDb): string[] {
  const ys = new Set<string>();
  for (const t of [db.irsAvg, db.spot]) for (const years of Object.values(t)) for (const y of Object.keys(years)) ys.add(y);
  return [...ys].sort();
}

/* ---------------- Excel parsing ---------------- */

const unesc = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** Read every sheet of a workbook as {name, grid} — the rate workbook needs
    per-sheet identity, which the document reader deliberately flattens. */
export async function readWorkbookSheets(buffer: ArrayBuffer): Promise<Array<{ name: string; grid: string[][] }>> {
  const zip = await JSZip.loadAsync(buffer);
  const wb: string = await zip.file("xl/workbook.xml").async("string");
  const rels: string = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const relMap: Record<string, string> = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]);
    const t = /Target="([^"]+)"/.exec(m[0]);
    if (id && t) relMap[id[1]] = "xl/" + t[1].replace(/^\/?xl\//, "").replace(/^\.\//, "");
  }
  let shared: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) {
    shared = [...(await ss.async("string")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
    );
  }
  const out: Array<{ name: string; grid: string[][] }> = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = /name="([^"]*)"/.exec(m[0]);
    const rid = /r:id="([^"]+)"/.exec(m[0]);
    if (!name || !rid || !relMap[rid[1]] || !zip.file(relMap[rid[1]])) continue;
    const xml: string = await zip.file(relMap[rid[1]]).async("string");
    const grid: string[][] = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = (/t="([^"]+)"/.exec(cm[2] || "") || [])[1] || "n";
        let val = "";
        if (type === "inlineStr") val = [...(cm[3] || "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
        else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(cm[3] || "");
          val = v ? v[1] : "";
          if (type === "s") val = shared[parseInt(val, 10)] || "";
        }
        const col = cm[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        cells[col] = unesc(String(val));
      }
      grid.push([...cells].map((c) => (c === undefined ? "" : c)));
    }
    out.push({ name: unesc(name[1]), grid });
  }
  return out;
}

export type RateDbParse = { db?: RateDb; errors: string[]; warnings: string[] };

/** Parse a 3-sheet rates workbook. Tolerant of layout, strict about meaning:
    every problem is reported; an invalid workbook never replaces the DB. */
export function parseRatesWorkbook(sheets: Array<{ name: string; grid: string[][] }>, filename: string): RateDbParse {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byRole = (res: RegExp[]) => sheets.find((s) => res.some((re) => re.test(s.name)));

  const codeSheet = byRole([/currency\s*code/i, /^codes?$/i, /^currenc/i]);
  const avgSheet = byRole([/irs/i, /average/i]);
  const spotSheet = byRole([/treasury/i, /spot/i]);
  if (!codeSheet) errors.push('No "Currency Code" sheet found (looked for a sheet named like "Currency Code").');
  if (!avgSheet) errors.push('No "IRS Average Rate" sheet found (looked for "IRS" or "Average" in the sheet name).');
  if (!spotSheet) errors.push('No "Treasury Spot Rate" sheet found (looked for "Treasury" or "Spot" in the sheet name).');
  if (errors.length) return { errors, warnings };

  const CODE_RE = /^[A-Z]{3}$/;

  const parseCodes = (grid: string[][]) => {
    const codes: RateDb["codes"] = [];
    for (const r of grid) {
      const cells = (r || []).map((c) => String(c ?? "").trim());
      const idx = cells.findIndex((c) => CODE_RE.test(c.toUpperCase()) && c.toUpperCase() !== "USD");
      if (idx < 0) continue;
      const code = cells[idx].toUpperCase();
      const others = cells.filter((_, i) => i !== idx).filter(Boolean);
      codes.push({ code, country: others[0], currency: others[1] });
    }
    return codes;
  };

  const parseRateSheet = (grid: string[][], label: string) => {
    const table: Record<string, Record<string, number>> = {};
    // Find the header row: contains at least one 4-digit year.
    let headerIdx = -1;
    let yearCols: Array<{ col: number; year: string }> = [];
    for (let i = 0; i < Math.min(grid.length, 10); i++) {
      const cols = (grid[i] || []).map((c, j) => ({ c: String(c ?? "").trim(), j }))
        .filter((x) => /^(19|20)\d{2}(\.0)?$/.test(x.c));
      if (cols.length) { headerIdx = i; yearCols = cols.map((x) => ({ col: x.j, year: x.c.replace(/\.0$/, "") })); break; }
    }
    if (headerIdx < 0) {
      errors.push(`${label}: no year columns found in the first rows — expected a header like "Code | 2023 | 2024 | 2025".`);
      return table;
    }
    let rows = 0;
    for (const r of grid.slice(headerIdx + 1)) {
      const cells = (r || []).map((c) => String(c ?? "").trim());
      const codeIdx = cells.findIndex((c) => CODE_RE.test(c.toUpperCase()));
      if (codeIdx < 0) continue;
      const code = cells[codeIdx].toUpperCase();
      if (table[code]) warnings.push(`${label}: duplicate row for ${code} — the later row wins.`);
      table[code] = table[code] || {};
      for (const yc of yearCols) {
        const raw = cells[yc.col];
        if (!raw) continue;
        const n = Number(raw.replace(/,/g, ""));
        if (!isFinite(n) || n <= 0) { warnings.push(`${label}: ${code} ${yc.year} is not a positive number ("${raw}") — skipped.`); continue; }
        table[code][yc.year] = n;
      }
      rows++;
    }
    if (!rows) errors.push(`${label}: no currency rows parsed.`);
    return table;
  };

  const codes = parseCodes(codeSheet!.grid);
  if (!codes.length) errors.push(`"${codeSheet!.name}": no ISO currency codes found.`);
  const irsAvg = parseRateSheet(avgSheet!.grid, `"${avgSheet!.name}"`);
  const spot = parseRateSheet(spotSheet!.grid, `"${spotSheet!.name}"`);
  if (errors.length) return { errors, warnings };

  // Cross-checks: every rate row's code should be declared.
  const declared = new Set(codes.map((c) => c.code));
  for (const c of Object.keys(irsAvg)) if (!declared.has(c)) warnings.push(`IRS sheet has ${c} which is missing from the Currency Code sheet.`);
  for (const c of Object.keys(spot)) if (!declared.has(c)) warnings.push(`Treasury sheet has ${c} which is missing from the Currency Code sheet.`);

  return {
    db: { codes, irsAvg, spot, source: `${filename} (uploaded)`, uploadedAt: new Date().toISOString() },
    errors,
    warnings,
  };
}

/* ---------------- Excel generation (download) ---------------- */

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function sheetXml(rows: Array<Array<string | number>>): string {
  const colName = (n: number) => {
    let s = "";
    n++;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  const body = rows.map((r, ri) =>
    `<row r="${ri + 1}">` + r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (v === "") return "";
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(String(v))}</t></is></c>`;
    }).join("") + "</row>",
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Build a 3-sheet Rates.xlsx from the database. */
export async function generateRatesWorkbook(db: RateDb): Promise<Blob> {
  const years = rateDbYears(db);
  const codeRows: Array<Array<string | number>> = [["Currency Code", "Country", "Currency"]];
  for (const c of db.codes) codeRows.push([c.code, c.country || "", c.currency || ""]);
  const rateRows = (t: Record<string, Record<string, number>>): Array<Array<string | number>> => {
    const rows: Array<Array<string | number>> = [["Currency Code", ...years]];
    for (const c of db.codes) {
      if (!t[c.code]) continue;
      rows.push([c.code, ...years.map((y) => (t[c.code][y] !== undefined ? t[c.code][y] : ""))]);
    }
    return rows;
  };

  const sheets = [
    { name: "Currency Code", xml: sheetXml(codeRows) },
    { name: "IRS Average Rate", xml: sheetXml(rateRows(db.irsAvg)) },
    { name: "Treasury Spot Rate", xml: sheetXml(rateRows(db.spot)) },
  ];

  const zip = new JSZip();
  zip.file("[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml));

  const buf: ArrayBuffer = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
