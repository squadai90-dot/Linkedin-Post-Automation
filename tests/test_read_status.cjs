/* The "Reading path" column reported the file EXTENSION, not what happened.
 *
 * Every PDF showed "native parser" — including a scan the tool could not read
 * one character of. That is the single case a preparer most needs to spot,
 * because it is the one OCR fixes, and the column was actively hiding it. A
 * user reading that table could not tell "read fine but I don't recognise it"
 * (where OCR is useless) from "could not read a word" (where OCR is the
 * answer). The column now reports the outcome, and is named Read status.
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");

const DIST = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const block = /\/\*EN9RDPATH-BEGIN\*\/[\s\S]*?\/\*EN9RDPATH-END\*\//.exec(DIST);
t("the read-status block is present in dist", () => assert.ok(block, "EN9RDPATH block missing"));

const { EN9readState, EN9READTAG } =
  new Function(`${block[0]}\nreturn { EN9readState, EN9READTAG };`)();

const PDF = { id: "f1", name: "accounts.pdf", parsable: true };
const XLS = { id: "f2", name: "notes.pages", parsable: false };
const scanWarning = { source: "accounts.pdf", message: "accounts.pdf could not be read, so NOTHING from it feeds the work paper. The PDF opened but carries no text layer, which means it is a scan." };

t("a file the tool read and classified reports that it was read", () => {
  const ent = { processedAt: "now", docClasses: { f1: { kind: "cfc-financial-statements" } } };
  assert.strictEqual(EN9readState(ent, PDF), "text read");
});

t("a scan is called a scan, not 'native parser'", () => {
  const ent = { processedAt: "now", docClasses: {}, reviewItems: [scanWarning] };
  assert.strictEqual(EN9readState(ent, PDF), "scan — needs OCR");
});

t("a file read fine but not identified still reports 'text read'", () => {
  // UNKNOWN in the Classified-as column, but the text WAS read — OCR would do
  // nothing here, and the column must not imply otherwise.
  const ent = { processedAt: "now", docClasses: { f1: { kind: "unknown" } } };
  assert.strictEqual(EN9readState(ent, PDF), "text read");
});

t("a read failure that is NOT a missing text layer is reported honestly", () => {
  const ent = { processedAt: "now", docClasses: {},
                reviewItems: [{ source: "accounts.pdf", message: "accounts.pdf could not be read (password protected)." }] };
  assert.strictEqual(EN9readState(ent, PDF), "could not be read");
});

t("before processing, nothing is claimed either way", () => {
  assert.strictEqual(EN9readState({ docClasses: {} }, PDF), "not read yet");
});

t("an unsupported format is still called out as such", () => {
  assert.strictEqual(EN9readState({ processedAt: "now", docClasses: {} }, XLS), "unsupported format");
});

t("another file's warning cannot make this file look like a scan", () => {
  const ent = { processedAt: "now", docClasses: {},
                reviewItems: [{ source: "somebody-else.pdf", message: "carries no text layer" }] };
  assert.strictEqual(EN9readState(ent, PDF), "could not be read");
});

t("a missing or half-built entity never throws", () => {
  for (const ent of [undefined, null, {}, { processedAt: "now" }]) {
    assert.doesNotThrow(() => EN9readState(ent, PDF), String(ent));
  }
  assert.doesNotThrow(() => EN9readState({}, undefined));
});

t("every state has a colour, and a scan is not dressed up as success", () => {
  assert.strictEqual(EN9READTAG["text read"], "actor-tag system");        // green
  assert.strictEqual(EN9READTAG["scan — needs OCR"], "actor-tag groq");   // amber
  assert.strictEqual(EN9READTAG["could not be read"], "actor-tag groq");  // amber
  assert.strictEqual(EN9READTAG["not read yet"], "actor-tag");            // neutral
});

t("the column is wired up and no longer keyed off the extension", () => {
  assert.ok(DIST.includes("EN9read:EN9readState(c,g)"), "rows do not carry the state");
  assert.ok(DIST.includes('{key:"path",value:c=>c.EN9read}'), "the filter still uses the old value");
  assert.ok(DIST.includes("className:EN9READTAG[c.EN9read]"), "the cell still renders the old badge");
  assert.ok(!DIST.includes('children:"native parser"'), "the old badge text survives");
  assert.ok(DIST.includes('label:"Read status"'), "the column is still called Reading path");
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
