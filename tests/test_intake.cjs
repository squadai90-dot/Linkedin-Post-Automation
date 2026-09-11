/* Document intake: duplicate refusal, the new readers, read status, and the
 * provenance sheet.
 *
 * The duplicate case is the one that matters most. Attaching the same file
 * twice doubles every figure it contributes, and the second copy looks exactly
 * like a legitimate second statement -- nothing downstream can catch it. So
 * identity is the bytes, compared against what is attached AND what is earlier
 * in the same batch, because dragging a folder in twice is how it happens.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");
const JSZip = require("jszip");
globalThis.JSZip = JSZip;   // engine.ts reads the page-global one

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };
const T = (name, fn) => fn().then(() => { console.log("ok:", name); pass++; },
                                  (e) => { console.log("FAILED:", name, "-", e.message); fail++; });

const root = path.join(__dirname, "..");
function load(entry) {
  const out = esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const ENG = load("src/prototype/wp/engine.ts");
const XP = load("src/prototype/wp/xlsxPatch.ts");
const store = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");

/* ---- duplicate refusal ---- */

t("identity is the bytes, not the name", () => {
  assert.ok(store.includes('crypto.subtle.digest("SHA-256", await f.arrayBuffer())'));
  assert.ok(store.includes("const dup = [...ent.files, ...added].find((x) => x.sha && x.sha === sha);"),
    "the same batch must be compared too -- dragging a folder in twice is the usual way");
});

t("a file attached before hashing existed can never match on undefined", () => {
  // `x.sha && x.sha === sha` -- both sides must have a key. Without the first
  // clause, every legacy file would match every other one.
  assert.ok(/find\(\(x\) => x\.sha && x\.sha === sha\)/.test(store));
});

t("without the crypto API the fallback key is prefixed so it cannot collide", () => {
  assert.ok(store.includes('sha = `nk:${f.name}|${f.size}|${f.lastModified || 0}`'));
});

t("the order is size gate, then extension, then hash", () => {
  const fn = store.slice(store.indexOf("async addFiles(id: string"));
  const size = fn.indexOf("exceeds ${MAX_FILE_MB} MB");
  const ext = fn.indexOf('const ext = "." +');
  const hash = fn.indexOf("crypto.subtle.digest");
  assert.ok(size > 0 && ext > size && hash > ext, "hashing a file about to be refused for size is wasted work");
});

t("the refusal says what would have happened, and is logged", () => {
  assert.ok(store.includes("already attached, skipped (uploading the same file twice would double every figure)"));
  assert.ok(store.includes('logEvent("Duplicate document refused"'));
});

/* ---- what the picker offers ---- */

t("images are not offered, because there is no reader for them", () => {
  assert.ok(!/DOC_TYPES = \[[^\]]*\.png/.test(store), "the picker still offers images");
  assert.ok(!/DOC_TYPES = \[[^\]]*\.jpg/.test(store));
});

t(".xls and .docx are read natively now", () => {
  assert.ok(/NATIVE_PARSE = \[[^\]]*"\.xls"/.test(store));
  assert.ok(/NATIVE_PARSE = \[[^\]]*"\.docx"/.test(store));
});

/* ---- explainUnreadable ---- */

t("each format is told what is actually wrong and what to do", () => {
  const xls = ENG.explainUnreadable("accounts.xls");
  assert.match(xls, /\.xls itself is supported/, "the .xls case is the reason this exists");
  assert.match(xls, /re-save as \.xlsx/i);
  assert.match(ENG.explainUnreadable("scan.pdf"), /no text layer/);
  assert.match(ENG.explainUnreadable("scan.pdf"), /OCR card/);
  assert.match(ENG.explainUnreadable("page.png"), /Images carry no text layer/);
  assert.match(ENG.explainUnreadable("letter.doc"), /Re-save as \.docx/);
  assert.match(ENG.explainUnreadable("bundle.zip"), /Archives are not opened/);
  assert.match(ENG.explainUnreadable("deck.pptx"), /Presentations are not a source/);
  assert.match(ENG.explainUnreadable("data.json"), /Export the figures as \.csv/);
});

t("an unknown extension lists what IS supported", () => {
  const msg = ENG.explainUnreadable("thing.qbo");
  assert.match(msg, /\.qbo is not one of the formats/);
  assert.match(msg, /\.pdf \(with a text layer\), \.xlsx, \.xlsm, \.xls, \.docx, \.csv, \.tsv and \.txt/);
});

t("it matches the shipped wording", () => {
  const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  // dist stores non-ASCII as \uXXXX escapes; compare in that form.
  const esc16 = (s2) => s2.replace(/[^\x00-\x7F]/g, (ch) =>
    "\\u" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"));
  const inDist = (text) => dist.includes(text) || dist.includes(esc16(text)) || dist.includes(esc16(text).toLowerCase());
  for (const name of ["a.xls", "a.pdf", "a.png", "a.doc", "a.zip", "a.pptx", "a.json"]) {
    assert.ok(inDist(ENG.explainUnreadable(name)), "wording drifted for " + name);
  }
  // The default branch interpolates the extension, so only its tail is literal.
  assert.ok(inDist(ENG.explainUnreadable("a.qbo").replace(/^\.qbo /, "")), "wording drifted for the default case");
});

t("both read-failure paths explain themselves", () => {
  assert.ok(store.includes("const why = explainUnreadable(f.name);"), "the null-reader path");
  assert.ok(store.includes("/no text layer/i.test(msg) ? explainUnreadable(f.name) : msg"),
    "the throw path must not misreport a corrupt zip as a scan");
});

/* ---- read status ---- */

t("a document that was READ but not identified reads green", () => {
  // "text read" is checked before processedAt on purpose: the reading worked,
  // and the classification is a separate question. Conflating them sent
  // people hunting for a file problem that did not exist.
  const fn = store.slice(store.indexOf("export function readState("));
  const textRead = fn.indexOf('return "text read"');
  const notRead = fn.indexOf('return "not read yet"');
  assert.ok(textRead > 0 && textRead < notRead, "processedAt is checked first");
});

t("a scan is distinguishable from a genuine read failure", () => {
  assert.ok(store.includes('return "scan — needs OCR"'));
  assert.ok(store.includes('/no text layer/i.test(String(item.message || ""))'));
});

t("the intake column is Read status, not Reading path", () => {
  const views = fs.readFileSync(path.join(root, "src", "prototype", "wp", "CoreViews.tsx"), "utf8");
  assert.ok(views.includes("<th>Read status</th>"));
  assert.ok(!views.includes("Reading path"));
  assert.ok(!views.includes('actor-tag system">native parser'), "every PDF still claims a native parse");
});

/* ---- the .docx reader ---- */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const wt = (s) => `<w:r><w:t>${esc(s)}</w:t></w:r>`;
const tc = (s) => `<w:tc>${`<w:p>${wt(s)}</w:p>`}</w:tc>`;
const tr = (...cells) => `<w:tr>${cells.map(tc).join("")}</w:tr>`;

async function docx(bodyXml) {
  const zip = new JSZip();
  zip.file("word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${bodyXml}</w:body></w:document>`);
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new File([buf], "questionnaire.docx");
}

(async () => {
  await T("a two-column questionnaire table comes back as rows", async () => {
    const doc = await ENG.readDocument(await docx(
      `<w:tbl>${tr("Legal name of entity", "Barnomadics B.V.")}${tr("Functional currency", "EUR")}</w:tbl>`));
    assert.strictEqual(doc.kind, "docx");
    assert.deepStrictEqual(doc.grid, [["Legal name of entity", "Barnomadics B.V."], ["Functional currency", "EUR"]]);
  });

  await T("a nested table costs the outer row but never mis-columns it", async () => {
    /* Verified against the shipped reader, which produces the same grid. The
       non-greedy row matcher truncates an outer row at the inner </w:tr>, so
       that row is LOST -- a known limitation. What the depth-aware cell walk
       guarantees is that the loss is clean: "Address" is never merged with
       "inner a", and no later value is shifted under the wrong caption.
       Losing a row is visible in the grid; a mis-columned value is not. */
    const inner = `<w:tbl>${tr("inner a", "inner b")}</w:tbl>`;
    const outer = `<w:tbl><w:tr><w:tc><w:p>${wt("Address")}</w:p>${inner}</w:tc>${tc("Herengracht 1")}</w:tr></w:tbl>`;
    const doc = await ENG.readDocument(await docx(outer));
    const flat = doc.grid.map((r) => r.join("|")).join("\n");
    assert.ok(!/Address\|?inner a/.test(flat), "the outer cell merged with the nested one: " + flat);
    assert.ok(!doc.grid.some((r) => r[0] === "Address" && r[1] === "inner a"), "mis-columned: " + flat);
  });

  await T("a run split by mid-word formatting is rejoined", async () => {
    const split = `<w:tc><w:p><w:r><w:t>Func</w:t></w:r><w:r><w:t>tional currency</w:t></w:r></w:p></w:tc>`;
    const doc = await ENG.readDocument(await docx(`<w:tbl><w:tr>${split}${tc("EUR")}</w:tr></w:tbl>`));
    assert.strictEqual(doc.grid[0][0], "Functional currency");
  });

  await T("paragraphs outside a table are kept as single-cell rows", async () => {
    const doc = await ENG.readDocument(await docx(`<w:p>${wt("Engagement letter")}</w:p>`));
    assert.deepStrictEqual(doc.grid, [["Engagement letter"]]);
  });

  await T("a .docx with no document part is refused, not crashed on", async () => {
    const zip = new JSZip();
    zip.file("other.xml", "<x/>");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    assert.strictEqual(await ENG.readDocument(new File([buf], "broken.docx")), null);
  });

  /* ---- the provenance sheet ---- */

  const template = () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types></Types>");
    zip.file("xl/workbook.xml", "<workbook><sheets><sheet name=\"Basic\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
    zip.file("xl/_rels/workbook.xml.rels", "<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>");
    zip.file("xl/worksheets/sheet1.xml", "<worksheet><sheetData/></worksheet>");
    return zip;
  };

  await T("all four parts of a new worksheet are written", async () => {
    const zip = template();
    assert.strictEqual(await XP.addWorksheet(zip, "Provenance", [["Kind", "Line"], ["AI mapping", "Sch C · Gross receipts"]]), true);
    const part = await zip.file("xl/worksheets/sheetEN9Provenance.xml").async("string");
    assert.match(part, /Kind/, "the sheet part is missing its content");
    // Excel refuses to open a workbook missing ANY of the other three.
    assert.match(await zip.file("xl/workbook.xml").async("string"), /name="Provenance"/);
    assert.match(await zip.file("xl/_rels/workbook.xml.rels").async("string"), /rIdEN9Provenance/);
    assert.match(await zip.file("[Content_Types].xml").async("string"), /sheetEN9Provenance\.xml/);
  });

  await T("adding it twice does not produce two tabs", async () => {
    const zip = template();
    await XP.addWorksheet(zip, "Provenance", [["a"]]);
    assert.strictEqual(await XP.addWorksheet(zip, "Provenance", [["b"]]), false, "a second call must be a no-op");
    const wb = await zip.file("xl/workbook.xml").async("string");
    assert.strictEqual((wb.match(/name="Provenance"/g) || []).length, 1);
    assert.match(await zip.file("xl/worksheets/sheetEN9Provenance.xml").async("string"), /a/, "the first content must survive");
  });

  t("it is written AFTER the writes, and can never block a download", () => {
    const fn = store.slice(store.indexOf("export async function buildWorkbook("));
    const writes = fn.indexOf("const report = await applyWrites(zip, writes);");
    const prov = fn.indexOf('await addWorksheet(zip, "Provenance"');
    assert.ok(writes > 0 && prov > writes, "provenance must describe what was actually written");
    assert.ok(/try \{\s*await addWorksheet/.test(fn), "an unwrapped failure would refuse the whole work paper");
  });

  t("it lists AI-placed figures, AI profile fields and every rate's source", () => {
    assert.ok(store.includes('PROVENANCE_KIND[c.via] || "Rule mapping"'), "each contribution is labelled by how its line was chosen");
    assert.ok(store.includes('groq: "AI mapping"'));
    assert.ok(store.includes('rows.push(["AI profile field", key'));
    assert.ok(store.includes('rows.push(["Exchange rate", rateCell[key]'));
    assert.ok(store.includes("it is not tax advice, and the preparer remains responsible"));
  });

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
