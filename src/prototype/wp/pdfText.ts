/* Extracts text from a PDF as positional rows.

   Primary path: pdf.js (bundled and inlined at build time — no CDN, no worker
   file, no network access; the worker runs on the main thread). It decodes
   every filter, encoding and font format a real-world statement can carry.

   Fallback path: the original hand-rolled parser below, kept for producers
   pdf.js rejects and for environments where it fails to start. It uses only
   what the browser already provides (DecompressionStream for FlateDecode).

   Both paths return rows of cells, reconstructed from glyph positions:
   items sharing a baseline become one row, ordered left to right, and a wide
   horizontal gap starts a new cell. That is the same shape the spreadsheet
   reader produces, so the existing mapping and entity-detection engines work
   on PDFs unchanged. */

import { getDocument } from "pdfjs-dist";
import { sanitize } from "./hygiene";
// @ts-expect-error — the worker build ships no type declarations.
import { WorkerMessageHandler } from "pdfjs-dist/build/pdf.worker.mjs";

/* Registering the handler globally makes pdf.js run its "fake worker" on the
   main thread, so the single-file build needs no separate worker script. */
(globalThis as any).pdfjsWorker = { WorkerMessageHandler };

/* pdf.js ≥4.4 relies on Promise.withResolvers (Chrome 119+, Safari 17.4+). */
if (typeof (Promise as any).withResolvers !== "function") {
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (v: T) => void, reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}

const LATIN1 = (bytes: Uint8Array): string => {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[]);
  }
  return s;
};

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Try zlib framing first, then raw deflate — producers differ.
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const ds = new DecompressionStream(format);
      const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      if (buf.byteLength) return new Uint8Array(buf);
    } catch {
      /* try the next framing */
    }
  }
  throw new Error("could not inflate stream");
}

type PdfObject = { num: number; dict: string; stream: Uint8Array | null };

/** Scan the file for "N G obj … endobj" rather than trusting the xref table. */
function scanObjects(raw: string, bytes: Uint8Array): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const num = parseInt(m[1], 10);
    const start = m.index + m[0].length;
    const endIdx = raw.indexOf("endobj", start);
    const body = raw.slice(start, endIdx === -1 ? raw.length : endIdx);

    let stream: Uint8Array | null = null;
    const sIdx = body.indexOf("stream");
    if (sIdx !== -1) {
      let dataStart = start + sIdx + 6;
      if (raw[dataStart] === "\r") dataStart++;
      if (raw[dataStart] === "\n") dataStart++;
      const lenMatch = /\/Length\s+(\d+)/.exec(body.slice(0, sIdx));
      let dataEnd: number;
      if (lenMatch) {
        dataEnd = dataStart + parseInt(lenMatch[1], 10);
      } else {
        const e = raw.indexOf("endstream", dataStart);
        dataEnd = e === -1 ? raw.length : e;
      }
      // A /Length given by reference can be wrong; fall back to the marker.
      const marker = raw.indexOf("endstream", dataStart);
      if (marker !== -1 && (dataEnd > marker || !lenMatch)) dataEnd = marker;
      stream = bytes.subarray(dataStart, Math.max(dataStart, dataEnd));
    }
    objects.set(num, { num, dict: body.slice(0, sIdx === -1 ? body.length : sIdx), stream });
  }
  return objects;
}

async function decodeStream(obj: PdfObject): Promise<string> {
  if (!obj.stream || !obj.stream.length) return "";
  if (/\/Filter\s*\/FlateDecode|\/Filter\s*\[\s*\/FlateDecode/.test(obj.dict)) {
    try {
      return LATIN1(await inflate(obj.stream));
    } catch {
      return "";
    }
  }
  if (/\/Filter/.test(obj.dict)) return "";   // DCT, JBIG2, LZW etc — not text
  return LATIN1(obj.stream);
}

/** PDF 1.5+ packs objects into object streams; unpack them too. */
async function expandObjectStreams(objects: Map<number, PdfObject>) {
  for (const obj of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(obj.dict)) continue;
    const data = await decodeStream(obj);
    if (!data) continue;
    const n = parseInt((/\/N\s+(\d+)/.exec(obj.dict) || [])[1] || "0", 10);
    const first = parseInt((/\/First\s+(\d+)/.exec(obj.dict) || [])[1] || "0", 10);
    const header = data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2];
      const off = header[i * 2 + 1];
      if (!isFinite(num) || !isFinite(off)) continue;
      const end = i + 1 < n ? first + header[(i + 1) * 2 + 1] : data.length;
      if (!objects.has(num) || !objects.get(num)!.dict.trim()) {
        objects.set(num, { num, dict: data.slice(first + off, end), stream: null });
      }
    }
  }
}

const refNum = (s: string | undefined): number | null => {
  if (!s) return null;
  const m = /(\d+)\s+\d+\s+R/.exec(s);
  return m ? parseInt(m[1], 10) : null;
};

/** Parse a ToUnicode CMap into code -> character. */
function parseCMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexToStr = (hex: string) => {
    let out = "";
    for (let i = 0; i + 3 < hex.length + 1; i += 4) {
      const code = parseInt(hex.substr(i, 4), 16);
      if (isFinite(code)) out += String.fromCharCode(code);
    }
    return out;
  };

  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(pair[1], 16), hexToStr(pair[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(r[1], 16), hi = parseInt(r[2], 16), dst = parseInt(r[3], 16);
      for (let c = lo; c <= hi && c - lo < 65535; c++) {
        map.set(c, String.fromCharCode(dst + (c - lo)));
      }
    }
    for (const r of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const lo = parseInt(r[1], 16);
      const items = [...r[3].matchAll(/<([0-9A-Fa-f]+)>/g)];
      items.forEach((it, i) => map.set(lo + i, hexToStr(it[1])));
    }
  }
  return map;
}

type FontInfo = { cmap: Map<number, string> | null; twoByte: boolean };

/* Some producers emit Identity-H CID fonts with no ToUnicode map. The only
   remaining source of meaning is the embedded TrueType cmap table: it maps
   Unicode to glyph id, so inverting it recovers glyph id -> character. */
function glyphMapFromTrueType(font: Uint8Array): Map<number, string> {
  const out = new Map<number, string>();
  const dv = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const u16 = (o: number) => dv.getUint16(o);
  const u32 = (o: number) => dv.getUint32(o);
  if (font.byteLength < 12) return out;

  const numTables = u16(4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > font.byteLength) break;
    const tag = String.fromCharCode(font[rec], font[rec + 1], font[rec + 2], font[rec + 3]);
    if (tag === "cmap") { cmapOff = u32(rec + 8); break; }
  }
  if (!cmapOff || cmapOff + 4 > font.byteLength) return out;

  // Prefer a Unicode subtable (platform 3 encoding 1 or 10, or platform 0).
  const n = u16(cmapOff + 2);
  let best = 0;
  for (let i = 0; i < n; i++) {
    const rec = cmapOff + 4 + i * 8;
    if (rec + 8 > font.byteLength) break;
    const platform = u16(rec), encoding = u16(rec + 2), off = u32(rec + 4);
    if (platform === 3 && (encoding === 1 || encoding === 10)) best = cmapOff + off;
    else if (platform === 0 && !best) best = cmapOff + off;
  }
  if (!best || best + 4 > font.byteLength) return out;

  const format = u16(best);
  const put = (code: number, gid: number) => {
    if (gid && !out.has(gid)) out.set(gid, String.fromCodePoint(code));
  };

  if (format === 4) {
    const segX2 = u16(best + 6);
    const ends = best + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s2 = 0; s2 < segX2; s2 += 2) {
      const end = u16(ends + s2), start = u16(starts + s2);
      const delta = dv.getInt16(deltas + s2), rangeOff = u16(ranges + s2);
      if (start > end) continue;
      for (let c = start; c <= end && c !== 0xFFFF; c++) {
        let gid: number;
        if (rangeOff === 0) gid = (c + delta) & 0xFFFF;
        else {
          const gi = ranges + s2 + rangeOff + (c - start) * 2;
          if (gi + 1 >= font.byteLength) continue;
          gid = u16(gi);
          if (gid) gid = (gid + delta) & 0xFFFF;
        }
        put(c, gid);
      }
    }
  } else if (format === 12) {
    const groups = u32(best + 12);
    for (let g = 0; g < groups; g++) {
      const rec = best + 16 + g * 12;
      if (rec + 12 > font.byteLength) break;
      const start = u32(rec), end = u32(rec + 4), gid = u32(rec + 8);
      for (let c = start; c <= end && c - start < 65536; c++) put(c, gid + (c - start));
    }
  }
  return out;
}

/** Decode a PDF string literal, honouring escapes and octal codes. */
function decodeLiteral(src: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch !== "\\") { out.push(src.charCodeAt(i)); continue; }
    const next = src[++i];
    if (next === undefined) break;
    if (next >= "0" && next <= "7") {
      let oct = next;
      while (oct.length < 3 && src[i + 1] >= "0" && src[i + 1] <= "7") oct += src[++i];
      out.push(parseInt(oct, 8));
    } else {
      const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      if (next === "\n") continue;                     // line continuation
      out.push(esc[next] !== undefined ? esc[next] : next.charCodeAt(0));
    }
  }
  return out;
}

const WIN_ANSI_HIGH: Record<number, string> = {
  0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201C", 0x94: "\u201D",
  0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014", 0xA3: "£", 0xA9: "©", 0xAE: "®",
};

function codesToText(codes: number[], font: FontInfo | undefined): string {
  if (font && font.twoByte) {
    let s = "";
    for (let i = 0; i + 1 < codes.length; i += 2) {
      const code = (codes[i] << 8) | codes[i + 1];
      s += font.cmap?.get(code) ?? "";
    }
    return s;
  }
  let s = "";
  for (const c of codes) {
    const mapped = font?.cmap?.get(c);
    if (mapped !== undefined) { s += mapped; continue; }
    s += WIN_ANSI_HIGH[c] ?? String.fromCharCode(c);
  }
  return s;
}

type Item = { x: number; y: number; text: string };

/** Walk a content stream, tracking the text matrix, collecting positioned runs. */
function extractItems(content: string, fonts: Record<string, FontInfo>): Item[] {
  const items: Item[] = [];
  let tx = 0, ty = 0, lineX = 0, lineY = 0, leading = 0;
  let font: FontInfo | undefined;

  // Tokens we care about, in stream order.
  const re = /(\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[[^\]]*\]|\/[^\s/[\]<>()]+|-?[\d.]+|BT|ET|Td|TD|Tm|T\*|TJ|Tj|Tf|TL|'|")/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;

  const push = (raw: string, isArray: boolean) => {
    let codes: number[] = [];
    let text = "";
    if (isArray) {
      for (const part of raw.matchAll(/\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>|(-?[\d.]+)/g)) {
        if (part[0][0] === "(") {
          text += codesToText(decodeLiteral(part[0].slice(1, -1)), font);
        } else if (part[1] !== undefined) {
          const hex = part[1].replace(/\s+/g, "");
          const cs: number[] = [];
          for (let i = 0; i < hex.length; i += 2) cs.push(parseInt(hex.substr(i, 2), 16));
          text += codesToText(cs, font);
        } else if (part[2] !== undefined) {
          // Large negative kerns are inter-word gaps.
          if (Number(part[2]) < -120) text += " ";
        }
      }
    } else if (raw[0] === "(") {
      text = codesToText(decodeLiteral(raw.slice(1, -1)), font);
    } else {
      const hex = raw.slice(1, -1).replace(/\s+/g, "");
      for (let i = 0; i < hex.length; i += 2) codes.push(parseInt(hex.substr(i, 2), 16));
      text = codesToText(codes, font);
    }
    if (text) items.push({ x: tx, y: ty, text });
  };

  while ((m = re.exec(content))) {
    const tok = m[0];
    switch (tok) {
      case "BT": tx = ty = lineX = lineY = 0; stack.length = 0; break;
      case "ET": stack.length = 0; break;
      case "Tf": {
        const name = stack[stack.length - 2];
        font = name && name[0] === "/" ? fonts[name.slice(1)] : undefined;
        stack.length = 0;
        break;
      }
      case "TL": leading = Number(stack[stack.length - 1]) || 0; stack.length = 0; break;
      case "Td": case "TD": {
        const dy = Number(stack[stack.length - 1]) || 0;
        const dx = Number(stack[stack.length - 2]) || 0;
        if (tok === "TD") leading = -dy;
        lineX += dx; lineY += dy; tx = lineX; ty = lineY;
        stack.length = 0;
        break;
      }
      case "Tm": {
        const n = stack.slice(-6).map(Number);
        if (n.length === 6 && n.every(isFinite)) { lineX = tx = n[4]; lineY = ty = n[5]; }
        stack.length = 0;
        break;
      }
      case "T*": lineY -= leading; tx = lineX; ty = lineY; stack.length = 0; break;
      case "'": case '"': {
        lineY -= leading; tx = lineX; ty = lineY;
        const last = stack[stack.length - 1];
        if (last && (last[0] === "(" || last[0] === "<")) push(last, false);
        stack.length = 0;
        break;
      }
      case "Tj": {
        const last = stack[stack.length - 1];
        if (last && (last[0] === "(" || last[0] === "<")) push(last, false);
        stack.length = 0;
        break;
      }
      case "TJ": {
        const last = stack[stack.length - 1];
        if (last && last[0] === "[") push(last, true);
        stack.length = 0;
        break;
      }
      default: stack.push(tok); if (stack.length > 12) stack.shift();
    }
  }
  return items;
}

/* ---------- positional row model (shared by both extractors) ----------

   Rows carry their page and each cell its x-range so downstream code can
   tell WHICH printed column a number sat in. This is what makes a 2023-only
   comparative row distinguishable from a current-year row when the other
   column is blank — the blankness itself is invisible in plain text. */

export type PdfCell = { text: string; x0: number; x1: number };
export type PdfRow = { page: number; y: number; cells: PdfCell[] };
export type PdfDoc = { pageCount: number; rows: PdfRow[]; approxWidths?: boolean };

/** Group positioned runs into rows and cells (legacy path; x1 is estimated). */
function itemsToPdfRows(items: Item[], page: number): PdfRow[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  const rows: PdfRow[] = [];
  let current: Item[] = [];
  let baseline = sorted[0].y;

  const flush = () => {
    if (!current.length) return;
    current.sort((a, b) => a.x - b.x);
    const cells: PdfCell[] = [];
    let buf = current[0].text;
    let x0 = current[0].x;
    let prevX = current[0].x;
    for (let i = 1; i < current.length; i++) {
      const it = current[i];
      // A wide horizontal gap means a new cell, not a new word.
      if (it.x - prevX > 26) {
        cells.push({ text: buf.trim(), x0, x1: Math.max(prevX, x0 + buf.length * 5.5) });
        buf = it.text;
        x0 = it.x;
      } else {
        buf += (it.x - prevX > 2 && !/\s$/.test(buf) ? " " : "") + it.text;
      }
      prevX = it.x;
    }
    cells.push({ text: buf.trim(), x0, x1: Math.max(prevX, x0 + buf.length * 5.5) });
    // Keep runs of plain spaces — they mark column boundaries for the splitter.
    const cleaned = cells
      .map((c) => ({ ...c, text: c.text.replace(/[^\S ]+/g, "  ").trim() }))
      .filter((c, i, a) => c.text !== "" || i < a.length - 1);
    if (cleaned.some((c) => c.text !== "")) rows.push({ page, y: baseline, cells: cleaned });
    current = [];
  };

  for (const it of sorted) {
    if (Math.abs(it.y - baseline) > 3.2) { flush(); baseline = it.y; }
    current.push(it);
  }
  flush();
  return rows;
}

/* Columnar layouts often reach the row-builders as one run of text whose
   columns are separated by padded spaces ("Revenue      1,250,000"), which
   would otherwise read as a single textual cell and yield no number. Two or
   more consecutive spaces only ever come from column alignment, so split
   there, interpolating each fragment's x-range from its character offsets;
   single spaces (words, "1 250 000" digit grouping) are preserved. */
function splitWideCellsPos(doc: PdfDoc): PdfDoc {
  const rows = doc.rows
    .map((row) => {
      const cells = row.cells.flatMap((cell) => {
        if (!/\s{2,}/.test(cell.text)) return cell.text.trim() ? [cell] : [];
        const span = Math.max(1, cell.x1 - cell.x0);
        const len = Math.max(1, cell.text.length);
        const out: PdfCell[] = [];
        let offset = 0;
        for (const part of cell.text.split(/(\s{2,})/)) {
          if (!/^\s+$/.test(part) && part.trim()) {
            out.push({
              text: part.trim(),
              x0: cell.x0 + (offset / len) * span,
              x1: cell.x0 + ((offset + part.length) / len) * span,
            });
          }
          offset += part.length;
        }
        return out;
      });
      return { ...row, cells };
    })
    .filter((r) => r.cells.length);
  return { ...doc, rows };
}

/* A caption that wraps across two printed lines arrives as a label-only row
   followed by the continuation row that carries the numbers ("Profit (Loss)
   from Ordinary Activities before" / "income tax  (25,164)  29,092").
   Merge the orphaned label into its continuation. */
const NUMERIC_TEXT = /^\(?\s*-?[\d,.'\s ]+\s*\)?$/;
function mergeWrappedLabels(doc: PdfDoc): PdfDoc {
  const rows = doc.rows;
  const out: PdfRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const s = rows[i + 1];
    if (
      s && r.page === s.page &&
      r.cells.length === 1 &&
      /[A-Za-z]/.test(r.cells[0].text) && !NUMERIC_TEXT.test(r.cells[0].text) &&
      r.y - s.y > 0 && r.y - s.y < 15 &&
      s.cells.length > 0 &&
      /[A-Za-z]/.test(s.cells[0].text) && !NUMERIC_TEXT.test(s.cells[0].text) &&
      Math.abs(r.cells[0].x0 - s.cells[0].x0) <= 30 &&
      (/^[a-z]/.test(s.cells[0].text) ||
        /(?:\b(?:and|of|or|for|to|in|the|from|on|before|per|not)|[-–,])$/i.test(r.cells[0].text.trim()))
    ) {
      s.cells[0] = { ...s.cells[0], text: r.cells[0].text.trim() + " " + s.cells[0].text, x0: r.cells[0].x0 };
      continue;   // drop the orphan; the continuation row is pushed on its turn
    }
    out.push(r);
  }
  return { ...doc, rows: out };
}

/* Producer artifacts that corrupt caption matching: IRS dot leaders
   ("Cash. . . . . ."), underscore rules glued onto numbers ("____2,194"),
   and Drake's statement references ("Other current assetsStatement#Z015"). */
function cleanCellText(s: string): string {
  return sanitize(s)
    .replace(/(?:\s?[.·•]){3,}/g, " ")
    .replace(/_{2,}/g, " ")
    .replace(/\s*Statement\s*#\s*[A-Za-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDoc(doc: PdfDoc): PdfDoc {
  const rows = doc.rows
    .map((row) => ({
      ...row,
      cells: row.cells.map((c) => ({ ...c, text: cleanCellText(c.text) })).filter((c) => c.text),
    }))
    .filter((r) => r.cells.length);
  return { ...doc, rows };
}

/** Primary extractor: pdf.js, worker inlined, positional rows per page. */
async function pdfjsToDoc(buffer: ArrayBuffer): Promise<PdfDoc> {
  const task = getDocument({
    data: new Uint8Array(buffer.slice(0)),   // pdf.js may transfer the buffer
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  const rows: PdfRow[] = [];
  let pageCount = 0;
  try {
    pageCount = doc.numPages;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: (Item & { w: number; h: number })[] = [];
      // Some producers (Kofax) draw the same run twice at the same spot;
      // keep only the first occurrence or the copies concatenate.
      const seen = new Set<string>();
      for (const it of content.items) {
        if (!("str" in it) || !it.str || !it.str.trim()) continue;
        const t = it.transform;                       // [a b c d e f]
        const h = Math.hypot(t[1], t[3]) || Math.abs(t[3]) || 10;
        const key = `${Math.round(t[4] * 2)}|${Math.round(t[5] * 2)}|${it.str}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ x: t[4], y: t[5], text: it.str, w: it.width || 0, h });
      }
      if (!items.length) continue;

      // Group items sharing a baseline, top of page first.
      items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
      let line: typeof items = [];
      let baseline = items[0].y;
      const flush = () => {
        if (!line.length) return;
        line.sort((a, b) => a.x - b.x);
        const cells: PdfCell[] = [];
        let buf = line[0].text;
        let x0 = line[0].x;
        let end = line[0].x + line[0].w;
        const close = () => cells.push({ text: buf, x0, x1: end });
        for (let i = 1; i < line.length; i++) {
          const it = line[i];
          const gap = it.x - end;
          if (it.x < end - Math.max(2, it.h * 0.3)) {
            // Item starts INSIDE the previous run — an overlay (form-field
            // value stamped over static text). Start a new cell, no space.
            close();
            buf = it.text; x0 = it.x; end = it.x + it.w;
          } else if (gap > Math.max(12, it.h * 1.2)) {
            // Gaps are in points here: beyond ~1.2 em it is a column boundary.
            close();
            buf = it.text; x0 = it.x; end = it.x + it.w;
          } else {
            buf += (gap > it.h * 0.12 && !/\s$/.test(buf) ? " " : "") + it.text;
            end = Math.max(end, it.x + it.w);
          }
        }
        close();
        const cleaned = cells
          .map((c) => ({ ...c, text: c.text.trim() }))
          .filter((c) => c.text !== "");
        if (cleaned.length) rows.push({ page: p, y: baseline, cells: cleaned });
        line = [];
      };
      for (const it of items) {
        const tol = Math.max(2, it.h * 0.4);
        if (Math.abs(it.y - baseline) > tol) { flush(); baseline = it.y; }
        line.push(it);
      }
      flush();
    }
  } finally {
    await doc.destroy();
  }
  return { pageCount, rows };
}

const finalizeDoc = (d: PdfDoc): PdfDoc => cleanDoc(mergeWrappedLabels(splitWideCellsPos(d)));

/** Read a PDF into a positional document. Empty rows ⇒ no text layer. */
export async function pdfToDoc(buffer: ArrayBuffer): Promise<PdfDoc> {
  try {
    const doc = await pdfjsToDoc(buffer);
    if (doc.rows.length) return finalizeDoc(doc);
  } catch {
    /* fall through to the built-in parser */
  }
  return finalizeDoc(await legacyPdfToDoc(buffer));
}

/** Back-compat projection: rows of cell text, all pages concatenated. */
export async function pdfToRows(buffer: ArrayBuffer): Promise<string[][]> {
  return (await pdfToDoc(buffer)).rows.map((r) => r.cells.map((c) => c.text));
}

/** The dependency-free parser, kept callable directly (tests, diagnostics). */
export async function legacyPdfToRows(buffer: ArrayBuffer): Promise<string[][]> {
  return finalizeDoc(await legacyPdfToDoc(buffer)).rows.map((r) => r.cells.map((c) => c.text));
}

/** Fallback extractor: the original dependency-free parser. */
async function legacyPdfToDoc(buffer: ArrayBuffer): Promise<PdfDoc> {
  const bytes = new Uint8Array(buffer);
  const raw = LATIN1(bytes);
  if (!raw.startsWith("%PDF")) throw new Error("not a PDF file");

  const objects = scanObjects(raw, bytes);
  await expandObjectStreams(objects);

  // Font name -> ToUnicode map, resolved per page resource dictionary.
  const fontCache = new Map<number, FontInfo>();
  const fontFor = async (num: number): Promise<FontInfo> => {
    if (fontCache.has(num)) return fontCache.get(num)!;
    const fo = objects.get(num);
    const info: FontInfo = { cmap: null, twoByte: false };
    if (fo) {
      info.twoByte = /\/Subtype\s*\/Type0/.test(fo.dict) || /\/Encoding\s*\/Identity-[HV]/.test(fo.dict);
      const tu = refNum((/\/ToUnicode\s+(\d+\s+\d+\s+R)/.exec(fo.dict) || [])[1]);
      if (tu && objects.has(tu)) {
        const cm = await decodeStream(objects.get(tu)!);
        if (cm) info.cmap = parseCMap(cm);
      }
      if (!info.cmap) {
        // Walk Type0 -> DescendantFonts -> FontDescriptor -> FontFile2.
        let descriptorDict = fo.dict;
        const desc = refNum((/\/DescendantFonts\s*\[?\s*(\d+\s+\d+\s+R)/.exec(fo.dict) || [])[1]);
        if (desc && objects.has(desc)) descriptorDict = objects.get(desc)!.dict;
        const fd = refNum((/\/FontDescriptor\s+(\d+\s+\d+\s+R)/.exec(descriptorDict) || [])[1]);
        const fdDict = fd && objects.has(fd) ? objects.get(fd)!.dict : "";
        const ff = refNum((/\/FontFile2\s+(\d+\s+\d+\s+R)/.exec(fdDict) || [])[1]);
        if (ff && objects.has(ff)) {
          const fileObj = objects.get(ff)!;
          if (fileObj.stream) {
            try {
              const data = /FlateDecode/.test(fileObj.dict) ? await inflate(fileObj.stream) : fileObj.stream;
              const glyphs = glyphMapFromTrueType(data);
              if (glyphs.size) { info.cmap = glyphs; info.twoByte = true; }
            } catch {
              /* font programme unreadable — leave the text undecodable */
            }
          }
        }
      }
    }
    fontCache.set(num, info);
    return info;
  };

  const pages = [...objects.values()].filter((o) => /\/Type\s*\/Page\b/.test(o.dict));
  const rows: PdfRow[] = [];

  /** Resolve the font map for a resource dictionary. */
  const fontsFor = async (resources: string): Promise<Record<string, FontInfo>> => {
    const fonts: Record<string, FontInfo> = {};
    const block = /\/Font\s*<<([\s\S]*?)>>/.exec(resources);
    if (block) {
      for (const f of block[1].matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)) {
        fonts[f[1]] = await fontFor(parseInt(f[2], 10));
      }
      return fonts;
    }
    const fontRef = refNum((/\/Font\s+(\d+\s+\d+\s+R)/.exec(resources) || [])[1]);
    if (fontRef && objects.has(fontRef)) {
      for (const f of objects.get(fontRef)!.dict.matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)) {
        fonts[f[1]] = await fontFor(parseInt(f[2], 10));
      }
    }
    return fonts;
  };

  const resolveResources = (dict: string): string => {
    const ref = refNum((/\/Resources\s+(\d+\s+\d+\s+R)/.exec(dict) || [])[1]);
    return ref && objects.has(ref) ? objects.get(ref)!.dict : dict;
  };

  /* Text is frequently wrapped in Form XObjects that carry their own fonts,
     so walk into them rather than only reading the page content stream. */
  const walkContent = async (content: string, resources: string, depth: number, pageNo: number) => {
    if (!content.trim() || depth > 6) return;
    rows.push(...itemsToPdfRows(extractItems(content, await fontsFor(resources)), pageNo));

    const xBlock = /\/XObject\s*<<([\s\S]*?)>>/.exec(resources);
    if (!xBlock) return;
    for (const x of xBlock[1].matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)) {
      if (!new RegExp("/" + x[1] + "\\s+Do").test(content)) continue;   // only if drawn
      const xo = objects.get(parseInt(x[2], 10));
      if (!xo || !/\/Subtype\s*\/Form/.test(xo.dict)) continue;
      await walkContent(await decodeStream(xo), resolveResources(xo.dict), depth + 1, pageNo);
    }
  };

  const handlePage = async (pageDict: string, pageNo: number) => {
    const resources = resolveResources(pageDict);
    const contentsMatch = /\/Contents\s+(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(pageDict);
    let content = "";
    if (contentsMatch) {
      for (const r of contentsMatch[1].matchAll(/(\d+)\s+\d+\s+R/g)) {
        const co = objects.get(parseInt(r[1], 10));
        if (co) content += (await decodeStream(co)) + "\n";
      }
    }
    await walkContent(content, resources, 0, pageNo);
  };

  for (let i = 0; i < pages.length; i++) await handlePage(pages[i].dict, i + 1);

  // No /Type /Page found (unusual producers): fall back to every text stream.
  if (!rows.length) {
    for (const obj of objects.values()) {
      if (!obj.stream) continue;
      const content = await decodeStream(obj);
      if (!/BT[\s\S]*?(Tj|TJ)/.test(content)) continue;
      rows.push(...itemsToPdfRows(extractItems(content, {}), 1));
    }
  }
  return { pageCount: pages.length || 1, rows, approxWidths: true };
}
