/* Wave-1 acceptance: the mapping rules are WIRED into the shipped pipeline
   (not just defined for the test harness), the Schedule F block is
   acknowledgeable, and sl() no longer mutates entity state from render.
   The dead-wiring guard exists because rules 1-3 originally shipped inert:
   defined, tested through a harness reimplementation, and never called. */
require("fake-indexeddb/auto");
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (c, m) => { if (!c) { console.error("FAIL:", m); fails++; } else console.log("ok:", m); };

/* ---- 1. dead-wiring guard: getter(3) + definition(1) + >=1 real call ---- */
const count = (name) => (dist.match(new RegExp(name.replace(/[$]/g, "\\$") + "\\(", "g")) || []).length;
// "NAME(" appears once in the __EN9MAP getter and once at the definition = 2 when dead.
a(count("EN9tagSections") > 2, `EN9tagSections has a real call site (${count("EN9tagSections")} occurrences)`);
a(count("EN9structRows") > 2, `EN9structRows has a real call site (${count("EN9structRows")} occurrences)`);
a(count("EN9sectionOk") > 2, `EN9sectionOk has a real call site (${count("EN9sectionOk")} occurrences)`);
a(dist.includes("x0:j.x0"), "PDF feed items carry x0 (structural indent detection has real input)");
a(dist.includes("EN9section:F.section"), "unmatched rows carry the section banner to the AI pass");
a(dist.includes("EN9bkSeen"), "cross-document booking dedupe is present in stage 3");
a(dist.includes("structural subtotal/total row(s) dropped before mapping"),
  "structurally-skipped rows are logged per document");
a(dist.includes('if(F.EN9skip||F.row&&F.row.EN9banner)continue'), "the booking loop honors structural skips and section banners");
a(!dist.includes("function EN9sumSide"), "the dead-and-broken EN9sumSide helper is gone");
a(dist.includes('target:Ce.bs+"!F62"'), "tie-out items carry a navigable target");

/* ---- 2. behavioral: dismissing the tie-out block unblocks generation ---- */
(async () => {
  const vc = new VirtualConsole();
  const dom = new JSDOM(dist, { runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: vc });
  dom.window.fetch = () => Promise.reject(new Error("offline"));
  await new Promise(r => setTimeout(r, 2500));
  const W = dom.window;
  a(typeof W.__WPGET === "function" && W.__WPACT, "app booted with hooks exposed");
  const A = W.__WPACT, S = W.__WPGET;
  const e = S().entities[0];

  // clear the FX blockers so the tie-out is the only blocking item
  A.setField(e.id, "fx", "avgRate", "1");
  A.setField(e.id, "fx", "cyRate", "1");
  A.setField(e.id, "fx", "pyRate", "1");
  // create an out-of-balance Schedule F
  A.setLine(e.id, "BS:10", "eoy", "114923.68");
  A.setLine(e.id, "BS:46", "eoy", "67114.13");
  await new Promise(r => setTimeout(r, 200));
  const readToast = () => (S().toast ? S().toast.text : null);

  /* ---- 3. sl() does not mutate entity state from render ---- */
  const before = (S().entities[0].extraWrites || []).length;
  for (let i = 0; i < 10; i++) {
    A.setField(e.id, "profile", "activity", "test " + i);
    await new Promise(r => setTimeout(r, 30));
  }
  await new Promise(r => setTimeout(r, 300));
  const after = (S().entities[0].extraWrites || []).length;
  a(after <= before + 1, `extraWrites stable across renders (${before} -> ${after}; was 22 -> 242 before the fix)`);

  /* generateOne sets busy:true only AFTER the blocking check passes, and its
     JSZip generation path hangs under jsdom — so probe the gate, not completion. */
  A.generateOne(e.id).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  const t1 = readToast() || "";
  a(/does not balance/i.test(t1) && S().busy === false,
    `unbalanced sheet blocks generation before busy is set (toast: ${t1.slice(0, 55)})`);

  A.dismissReviewItem(e.id, "EN9-tie-bs-eoy", "acknowledged by preparer for test");
  await new Promise(r => setTimeout(r, 200));
  A.generateOne(e.id).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  a(S().busy === true || !/does not balance/i.test(readToast() || ""),
    "dismissed tie-out no longer blocks (generation passed the gate)");

  if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
  console.log("ALL WIRING-ACCEPTANCE TESTS PASSED");
  process.exit(0);
})().catch(e => { console.error("UNCAUGHT:", e); process.exit(1); });
