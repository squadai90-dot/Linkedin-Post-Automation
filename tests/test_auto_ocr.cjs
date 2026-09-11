/* A scan the tool cannot read used to end the story: the file was reported
 * unreadable and the preparer had to know an OCR card existed, find it, pick
 * the file again and choose a language. The engine was always there — only the
 * decision to start it was manual. A Swiss client's signed accounts arrived as
 * a scan, and the alternative the client supplied (a chatbot translation) had
 * dropped every minus sign, so the scan was the only sound source.
 *
 * These assertions cover the WIRING. The download of the OCR engine itself
 * comes from a CDN and is exercised in the browser, not here.
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");

const DIST = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

t("a PDF that opens with no text is recorded as a scan, on BOTH failure paths", () => {
  // readDocument returns null for some formats and THROWS for a text-less PDF;
  // marking only one path left the queue empty and the runner idle.
  assert.ok(DIST.includes("/*EN9SCANMARK*/"), "null path not marked");
  assert.ok(DIST.includes("/*EN9SCANMARK2*/"), "throw path not marked");
  assert.ok(/EN9SCANMARK2\*\/if\(\/no text layer\/i\.test/.test(DIST),
    "the throw path marks every failure, not just a missing text layer");
  assert.ok(DIST.includes("/*EN9SCANQ*/"), "the queue is never reset between runs");
});

t("the queue is emptied at the start of every run, so a fixed file does not requeue", () => {
  const i = DIST.indexOf("/*EN9SCANQ*/");
  assert.ok(DIST.slice(i, i + 160).includes("globalThis.EN9SCANS[t]=[]"), "queue not cleared");
});

t("an OCR output is never itself queued for OCR", () => {
  const marks = DIST.split("/*EN9SCANMARK").slice(1);
  assert.strictEqual(marks.length, 2);
  for (const m of marks) assert.ok(/\\\(OCR\\\)\\\.pdf\$/i.test(m.slice(0, 200)), "no re-entry guard");
});

t("the runner exists, is started, and never runs twice for one file", () => {
  assert.ok(DIST.includes("/*EN9AUTOOCR-BEGIN*/"), "runner missing");
  assert.ok(DIST.includes("setInterval(EN9autoOcrTick"), "runner never started");
  assert.ok(DIST.includes("EN9autoOcrTried[f.id] = 1"), "no once-per-file guard");
});

t("it waits for the app to be idle and for the profile to be written", () => {
  const i = DIST.indexOf("function EN9autoOcrTick");
  const body = DIST.slice(i, i + 1400);
  assert.ok(/if \(EN9OCR\.busy\) return;/.test(body), "would start a second OCR over a running one");
  assert.ok(/if \(!st \|\| st\.busy\) return;/.test(body), "would start while processing is still running");
  assert.ok(/!ent\.processedAt/.test(body),
    "reads the profile before it is written — the language would fall back to English");
});

t("the language comes from the country the other documents established", () => {
  const i = DIST.indexOf("function EN9ocrLangsFor");
  const body = DIST.slice(i, DIST.indexOf("function EN9autoOcrTick"));
  const langs = new Function(`${body}\nreturn EN9ocrLangsFor;`)();
  const of = (countryInc, currency) => langs({ profile: { countryInc, currency } });
  assert.strictEqual(of("SWITZERLAND", "CHF"), "eng+fra+deu+ita");
  assert.strictEqual(of("", "CHF"), "eng+fra+deu+ita", "currency alone should be enough");
  assert.strictEqual(of("Chile", "CLP"), "eng+spa");
  assert.strictEqual(of("Netherlands", "EUR"), "eng+nld");
  assert.strictEqual(of("Brazil", "BRL"), "eng+por");
  assert.strictEqual(of("", ""), "eng", "unknown must not ask for every language at once");
});

t("the result is attached and re-processed, and is labelled OCR-derived", () => {
  const i = DIST.indexOf("/*EN9AUTOOCR-BEGIN*/");
  const body = DIST.slice(i, DIST.indexOf("/*EN9AUTOOCR-END*/"));
  assert.ok(/__WPACT\.addFiles\(entityId, \[res\.file\]\)/.test(body), "result not attached");
  assert.ok(/__WPACT\.processEntity\(entityId\)/.test(body), "not re-processed");
  assert.ok(/OCR-derived and must be checked against the scan/.test(body),
    "the preparer is not told the figures are unverified");
  assert.ok(/catch \(e\) \{ \/\* never let the watcher break the app \*\//.test(body),
    "a failure in the watcher could take the app down with it");
});

t("the OCR engine is reachable for tests without touching the network", () => {
  // en9OcrRun reads EN9OCR.io before EN9OCR.realIO, which is what let the
  // whole chain be driven in a browser with a stub in place of the CDN.
  assert.ok(DIST.includes("var io=EN9OCR.io||EN9OCR.realIO"), "the injection seam is gone");
  assert.ok(DIST.includes("/*EN9OCREXP*/"), "EN9OCR is not reachable from the page");
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
