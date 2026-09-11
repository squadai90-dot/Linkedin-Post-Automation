/* The bridge to the enhancement layer.
 *
 * dist/index.html carries an enhancement layer that runs as plain DOM code
 * beside the React app -- the OCR card, the mapping-table polish, the verify
 * badges. It is deliberately outside the bundle (it lazy-loads three libraries
 * from a CDN, which this self-contained single-file build otherwise never
 * does), so it cannot subscribe to the store. Three things connect them, and
 * all three must exist or the layer half-works in ways that are hard to see.
 *
 * This boots the SOURCE build in jsdom and checks all three are really there
 * at runtime, rather than string-matching the file.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const esbuild = require("esbuild");
const { JSDOM, VirtualConsole } = require("jsdom");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

const root = path.join(__dirname, "..");
const bundle = esbuild.buildSync({
  entryPoints: [path.join(root, "src/prototype/wp/store.ts")],
  bundle: true, write: false, format: "cjs", platform: "browser", logLevel: "silent",
  define: { "process.env.NODE_ENV": '"production"', __API_BASE__: '""' },
}).outputFiles[0].text;

/* One test throws from a listener on purpose; jsdom reports that as an
   uncaught error on the console. Swallow it so the expected noise does not
   read as a failure. */
const quiet = new VirtualConsole();
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "https://example.invalid/", pretendToBeVisual: true, virtualConsole: quiet,
});
const { window } = dom;

// The store reaches for these the way the browser provides them.
const mod = { exports: {} };
const sandbox = {
  window, document: window.document, navigator: window.navigator,
  CustomEvent: window.CustomEvent, Event: window.Event, Blob: window.Blob, File: window.File,
  fetch: () => Promise.reject(new Error("no network in tests")),
  setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
  crypto: window.crypto, indexedDB: undefined, JSZip: undefined,
};
new Function("module", "exports", "require", "globalThis", ...Object.keys(sandbox),
  `${bundle}\n`)(mod, mod.exports, require, window, ...Object.values(sandbox));
const store = mod.exports;

/* The exposure is deferred by a macrotask on purpose, so drain the queue the
   way the browser would before asserting. */
const settle = () => new Promise((r) => window.setTimeout(r, 5));

(async () => {
  await settle();

  t("__WPGET hands the layer the LIVE state, not a copy taken at boot", () => {
    assert.strictEqual(typeof window.__WPGET, "function", "the layer has no way to read state");
    const before = window.__WPGET();
    assert.ok(Array.isArray(before.entities));
    store.actions.setStakeholder("Keystone Byron Bay Pty Ltd");
    assert.strictEqual(window.__WPGET().stakeholder, "Keystone Byron Bay Pty Ltd",
      "__WPGET returned a stale snapshot");
  });

  t("__WPACT is published, and only once the action surface is complete", () => {
    assert.ok(window.__WPACT, "the layer has no way to act");
    // Exposed at module scope it would be half-built; these are the ones the
    // layer actually calls.
    for (const fn of ["processEntity", "addFiles", "setDocKind", "resolveWithGroq", "EN9_expose", "__toast"]) {
      assert.strictEqual(typeof window.__WPACT[fn], "function", "__WPACT." + fn + " is missing");
    }
  });

  t("__toast exists -- the auto-OCR announcer was calling one that did not", () => {
    // Its messages reached only the console before this.
    window.__WPACT.__toast("“Keystone FS.pdf” is a scan with no text. Reading it with OCR…");
    assert.ok(window.__WPGET().toast, "the toast never reached the app");
    assert.match(window.__WPGET().toast.text, /is a scan with no text/);
  });

  t("a state change fires wp:state -- the layer's only re-render trigger", () => {
    let fired = 0;
    window.addEventListener("wp:state", () => fired++);
    store.actions.setStakeholder("Shaka Traders Pty Ltd");
    assert.ok(fired > 0, "the layer would never redraw");
  });

  t("a listener that throws cannot take a state update down with it", () => {
    // Contained by the event system, not by the try/catch around dispatch --
    // but the property that matters to the app is the same either way.
    window.addEventListener("wp:state", () => { throw new Error("layer bug"); });
    store.actions.setStakeholder("Hope Dealers Pty Ltd");
    assert.strictEqual(window.__WPGET().stakeholder, "Hope Dealers Pty Ltd");
  });

  /* ---- the auto-OCR scan queue ---- */

  const src = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");

  t("the queue is reset per entity at the start of a run", () => {
    // Without this, a document fixed by OCR stays queued on the next pass.
    assert.ok(src.includes("queueScans(entityId, null);"));
  });

  t("a text-less PDF is queued on BOTH failure paths", () => {
    // pdfToDoc returns null for some files and throws for others; the scan
    // reaches the OCR card either way.
    const marks = src.match(/queueScans\(entityId, \{ id: f\.id, name: f\.name \}\)/g) || [];
    assert.strictEqual(marks.length, 2, "one of the two read-failure paths does not queue");
    assert.ok(src.includes('/\\.pdf$/i.test(f.name) && !/\\(OCR\\)\\.pdf$/i.test(f.name)'), "the null path");
    assert.ok(src.includes('/no text layer/i.test(String(msg)) && !/\\(OCR\\)\\.pdf$/i.test(f.name)'), "the throw path");
  });

  t("a document that is ALREADY an OCR output is never re-queued", () => {
    // Re-running would loop on a file OCR has already failed to fix.
    const guard = (src.match(/!\/\\\(OCR\\\)\\\.pdf\$\/i\.test\(f\.name\)/g) || []).length;
    assert.strictEqual(guard, 2, "both queue sites need the guard");
  });

  t("the queue never throws -- a missing global must not fail processing", () => {
    const fn = src.slice(src.indexOf("function queueScans("));
    assert.ok(/try \{/.test(fn.slice(0, 400)) && /catch \{/.test(fn.slice(0, 700)));
  });

  t("the queue is a plain global, because the layer is outside the bundle", () => {
    assert.ok(src.includes("g.EN9SCANS = { ...(g.EN9SCANS || {}) };"));
  });

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
