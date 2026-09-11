/* Writes cell values into an existing .xlsx while leaving every other byte of
   the template untouched. The workbook is never re-serialised: only the
   targeted <c> elements inside sheetN.xml are rewritten, so styles, merges,
   hidden sheets, data validation and every existing formula survive. */

declare const JSZip: any;

const XML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => XML_ESC[c]);

function colToNum(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}

function splitRef(ref: string) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error("Bad cell reference: " + ref);
  return { col: m[1], colNum: colToNum(m[1]), row: parseInt(m[2], 10) };
}

export type CellValue = string | number | boolean | null | undefined;

function buildCell(ref: string, value: CellValue, styleAttr: string | null): string {
  const s = styleAttr ? ` s="${styleAttr}"` : "";
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number" && isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = String(value);
  if (text.charAt(0) === "=") return `<c r="${ref}"${s}><f>${esc(text.slice(1))}</f></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

/** Set by setCell when it refuses to overwrite a formula; read by applyWrites. */
let lastRefusedFormula = false;

export function setCell(xml: string, ref: string, value: CellValue): string {
  const { colNum, row } = splitRef(ref);
  lastRefusedFormula = false;

  // 1. Cell already present — swap it, keeping its style index.
  const cellRe = new RegExp(`<c r="${ref}"(?![0-9])([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const hit = cellRe.exec(xml);
  if (hit) {
    // Belt: never destroy an existing formula with a plain value. The curated
    // cell maps should prevent this; when they don't, refuse and report.
    const incomingFormula = typeof value === "string" && value.charAt(0) === "=";
    if (!incomingFormula && hit[2] !== "/>" && /<f[ >]/.test(hit[2])) {
      lastRefusedFormula = true;
      return xml;
    }
    const styleMatch = /\bs="(\d+)"/.exec(hit[1]);
    return xml.replace(cellRe, () => buildCell(ref, value, styleMatch ? styleMatch[1] : null));
  }

  // 2. Row present — insert the cell in column order.
  const rowRe = new RegExp(`<row r="${row}"(?![0-9])([^>]*?)(/>|>([\\s\\S]*?)</row>)`);
  const rowHit = rowRe.exec(xml);
  if (rowHit) {
    const newCell = buildCell(ref, value, null);
    if (rowHit[2] === "/>") return xml.replace(rowRe, () => `<row r="${row}"${rowHit[1]}>${newCell}</row>`);
    const inner = rowHit[3];
    let insertAt = inner.length;
    for (const m of inner.matchAll(/<c r="([A-Z]+)(\d+)"/g)) {
      if (colToNum(m[1]) > colNum) { insertAt = m.index!; break; }
    }
    const merged = inner.slice(0, insertAt) + newCell + inner.slice(insertAt);
    return xml.replace(rowRe, () => `<row r="${row}"${rowHit[1]}>${merged}</row>`);
  }

  // 3. Row absent — insert a new row in row order.
  const newRow = `<row r="${row}">${buildCell(ref, value, null)}</row>`;
  for (const m of xml.matchAll(/<row r="(\d+)"/g)) {
    if (parseInt(m[1], 10) > row) return xml.slice(0, m.index!) + newRow + xml.slice(m.index!);
  }
  if (/<sheetData\s*\/>/.test(xml)) return xml.replace(/<sheetData\s*\/>/, () => `<sheetData>${newRow}</sheetData>`);
  return xml.replace("</sheetData>", () => newRow + "</sheetData>");
}

async function sheetIndex(zip: any): Promise<Record<string, string>> {
  const wbXml: string = await zip.file("xl/workbook.xml").async("string");
  const relsXml: string = await zip.file("xl/_rels/workbook.xml.rels").async("string");

  const rels: Record<string, string> = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]);
    const target = /Target="([^"]+)"/.exec(m[0]);
    if (id && target) rels[id[1]] = "xl/" + target[1].replace(/^\/?xl\//, "").replace(/^\.\//, "");
  }

  const map: Record<string, string> = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = /name="([^"]*)"/.exec(m[0]);
    const rid = /r:id="([^"]+)"/.exec(m[0]);
    if (name && rid && rels[rid[1]]) {
      const clean = name[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      map[clean] = rels[rid[1]];
    }
  }
  return map;
}

/* A formula cell stores BOTH the formula and the last computed result. The
   tool writes formulas but cannot evaluate them, so every untouched formula
   keeps whatever the template last cached — usually 0 or #DIV/0!.

   fullCalcOnLoad (below) makes Excel recompute on open, but ANY reader that
   does not run a calculation engine still sees the stale cache: the in-app
   preview, a PDF/print export, an OS preview pane, a reviewer's automated
   check. A reconciliation done that way scores correct totals as zeros and
   correct rates as 0.000, which reads as "the tool computed nothing".

   Deleting the cached value leaves the formula intact and makes such readers
   show an EMPTY cell — honest ("not yet computed") instead of misleading
   ("zero"). Excel fills them in on open exactly as before. */
export function stripStaleFormulaValues(xml: string): string {
  return xml.replace(/<c\b[^>]*>[\s\S]*?<\/c>/g, (cell) => {
    if (!/<f[\s>]/.test(cell)) return cell;          // not a formula cell
    if (/<f[^>]*\bt="shared"[^>]*\/>/.test(cell) && !/<f[^>]*>[^<]/.test(cell)) {
      // shared-formula child: drop the value, keep the reference
      return cell.replace(/<v>[\s\S]*?<\/v>/, "");
    }
    return cell
      .replace(/<v>[\s\S]*?<\/v>/, "")              // the cached result
      .replace(/\s+t="(e|str)"/, "");                // and its error/string type
  });
}

/* Untouched formulas now hold stale cached results, so ask the spreadsheet
   application to recalculate everything the moment the file opens. */
function forceRecalc(wbXml: string): string {
  if (/<calcPr\b[^>]*\/>/.test(wbXml)) {
    return wbXml.replace(/<calcPr\b([^>]*)\/>/, (_all, attrs: string) => {
      const cleaned = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${cleaned} fullCalcOnLoad="1"/>`;
    });
  }
  return wbXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
}

export type PatchReport = { written: number; skippedSheets: string[]; refusedFormula: string[] };
export type Writes = Record<string, Record<string, CellValue>>;

export async function applyWrites(zip: any, writes: Writes): Promise<PatchReport> {
  const sheets = await sheetIndex(zip);
  const report: PatchReport = { written: 0, skippedSheets: [], refusedFormula: [] };

  for (const [sheetName, cells] of Object.entries(writes)) {
    const path = sheets[sheetName];
    if (!path || !zip.file(path)) { report.skippedSheets.push(sheetName); continue; }
    let xml: string = await zip.file(path).async("string");
    for (const [ref, value] of Object.entries(cells)) {
      xml = setCell(xml, ref, value);
      if (lastRefusedFormula) report.refusedFormula.push(`${sheetName}!${ref}`);
      else report.written++;
    }
    zip.file(path, xml);
  }

  // Removing calcChain.xml leaves dangling part references behind — strip
  // them too, or strict consumers prompt to "repair" the workbook.
  zip.remove("xl/calcChain.xml");
  const ct = zip.file("[Content_Types].xml");
  if (ct) {
    const ctXml: string = await ct.async("string");
    zip.file("[Content_Types].xml", ctXml.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/g, ""));
  }
  const wbRels = zip.file("xl/_rels/workbook.xml.rels");
  if (wbRels) {
    const relXml: string = await wbRels.async("string");
    zip.file("xl/_rels/workbook.xml.rels", relXml.replace(/<Relationship\b[^>]*Target="calcChain\.xml"[^>]*\/>/g, ""));
  }
  // Clear stale cached results on EVERY sheet, not only the ones written to —
  // an untouched sheet (Sch H, Worksheet A, 8992) carries the same dead cache.
  for (const path of Object.values(sheets)) {
    const f = zip.file(path);
    if (!f) continue;
    const sheetXml: string = await f.async("string");
    zip.file(path, stripStaleFormulaValues(sheetXml));
  }

  const wbXml: string = await zip.file("xl/workbook.xml").async("string");
  zip.file("xl/workbook.xml", forceRecalc(wbXml));
  return report;
}


/**
 * Add a worksheet to an open template zip: the sheet part, the <sheets> entry,
 * the relationship, and the content-type override. All four are required —
 * Excel refuses to open a workbook that is missing any one of them.
 *
 * Idempotent BY SHEET NAME: generating twice from the same session must not
 * produce two Provenance tabs, and the caller has no easy way to know whether
 * it already ran.
 *
 * @param rows  each row's cells, left to right from column A.
 */
export async function addWorksheet(zip: any, name: string, rows: CellValue[][]): Promise<boolean> {
  const wbXml: string = await zip.file("xl/workbook.xml").async("string");
  if (wbXml.includes(`name="${esc(name)}"`)) return false;   // already there

  const relsXml: string = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const typesXml: string = await zip.file("[Content_Types].xml").async("string");

  // A part name and relationship id that cannot collide with the template's
  // own numbered sheets, whatever it contains.
  const slug = "EN9" + name.replace(/[^A-Za-z0-9]/g, "");
  const part = `xl/worksheets/sheet${slug}.xml`;
  const relId = `rId${slug}`;

  const body = rows.map((cells, i) => {
    const r = i + 1;
    const xml = cells.map((v, c) => buildCell(String.fromCharCode(65 + c) + r, v, null)).join("");
    return `<row r="${r}">${xml}</row>`;
  }).join("");

  zip.file(part, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`);
  zip.file("xl/workbook.xml", wbXml.replace("</sheets>", `<sheet name="${esc(name)}" sheetId="9471" r:id="${relId}"/></sheets>`));
  zip.file("xl/_rels/workbook.xml.rels", relsXml.replace("</Relationships>",
    `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${slug}.xml"/></Relationships>`));
  zip.file("[Content_Types].xml", typesXml.replace("</Types>",
    `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
  return true;
}

export type LabelQuery = { col: string; contains: string; excludes?: string };

/** Find the row whose label-column text contains the query — used to place
    Schedule M lines whose numbering moves between form revisions. Requires
    shared strings and inline strings both to resolve. */
export async function resolveTemplateRows(
  zip: any,
  sheetName: string,
  queries: LabelQuery[],
): Promise<(number | null)[]> {
  const sheets = await sheetIndex(zip);
  const path = sheets[sheetName];
  if (!path || !zip.file(path)) return queries.map(() => null);
  const xml: string = await zip.file(path).async("string");

  let shared: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) {
    const ssXml: string = await ss.async("string");
    shared = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""),
    );
  }

  // Labels keyed by (column, row) — the query names its label column, and a
  // stray match in some other column must not move a write.
  const labels = new Map<string, string>();
  for (const cm of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const [, col, rowStr, attrs, body] = cm;
    const tm = /t="([^"]+)"/.exec(attrs);
    let text = "";
    if (tm && tm[1] === "s") {
      const v = /<v>(\d+)<\/v>/.exec(body);
      if (v) text = shared[parseInt(v[1], 10)] || "";
    } else if (tm && tm[1] === "inlineStr") {
      text = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
    }
    if (text) labels.set(`${col}:${rowStr}`, text);
  }

  return queries.map((q) => {
    const want = q.contains.toLowerCase();
    const not = q.excludes?.toLowerCase();
    const col = (q.col || "B").toUpperCase();
    for (const [key, text] of labels) {
      if (!key.startsWith(col + ":")) continue;
      const t = text.toLowerCase();
      if (t.includes(want) && (!not || !t.includes(not))) return parseInt(key.slice(col.length + 1), 10);
    }
    return null;
  });
}

/** Decode the master template embedded in the page. */
export function templateBytes(): Uint8Array {
  const node = document.getElementById("wp-template");
  if (!node) throw new Error("Master template is not embedded in this build");
  const bin = atob((node.textContent || "").trim());
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
