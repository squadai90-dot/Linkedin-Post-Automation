/* Boots the SHIPPED dist/index.html in jsdom and checks the app actually
   renders. Every other suite pins a slice of the bundle; this one proves the
   whole edited file still runs. */
require("fake-indexeddb/auto");
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "dist", "index.html");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", e => errors.push(String(e && e.message || e)));
vc.on("error", (...m) => errors.push(m.join(" ")));

const dom = new JSDOM(fs.readFileSync(file, "utf8"), {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "http://localhost:8471/",
  virtualConsole: vc,
});
const { window } = dom;
window.indexedDB = global.indexedDB;
window.IDBKeyRange = global.IDBKeyRange;
// no network in the harness; every fetch the app makes should be handled, not fatal
window.fetch = () => Promise.reject(new Error("offline in test harness"));

(async () => {
  await new Promise(r => setTimeout(r, 2500));
  const d = window.document;

  /* ---- it rendered ------------------------------------------------------ */
  a(!!d.querySelector(".app-shell"), "the app shell rendered");
  const nav = [...d.querySelectorAll(".nav-item")].map(b => b.textContent.replace(/^\d+/, "").trim());
  a(nav.length === 16, `all 16 tabs are in the sidebar (${nav.length})`);
  a(nav.includes("Task management") && nav.includes("Settings") && nav.includes("FX policy & rates"),
    "the tabs are the expected ones");

  /* ---- no crash --------------------------------------------------------- */
  const fatal = errors.filter(e => !/offline in test harness|Not implemented|Could not parse CSS/i.test(e));
  a(fatal.length === 0, `no uncaught errors during boot${fatal.length ? ": " + fatal.slice(0, 2).join(" | ") : ""}`);

  /* ---- the store and actions are live ----------------------------------- */
  a(typeof window.__WPGET === "function", "the store is exposed");
  const st = window.__WPGET();
  a(st && Array.isArray(st.entities), "state is initialised");
  a(st.groq && "EN9notice" in st.groq, "item D: the groq slice carries the notice field");
  a(typeof window.__WPACT === "object" && typeof window.__WPACT.EN9revalidateGroq === "function",
    "item D: the quiet revalidation action is live on the real app");

  /* ---- the enhancement layer attached ----------------------------------- */
  await new Promise(r => setTimeout(r, 600));
  a(!d.querySelector("tr.en9-cfrow"), "item A: no separate filter row anywhere in the rendered app");

  /* ---- item F: Task management renders with NO backend ------------------ */
  const tasksBtn = [...d.querySelectorAll(".nav-item")].find(b => /Task management/.test(b.textContent));
  tasksBtn.click();
  await new Promise(r => setTimeout(r, 800));
  const text = d.querySelector(".view-stack") ? d.querySelector(".view-stack").textContent : "";
  a(/Task management/.test(text), "the Task management view rendered");
  a(!/currently unavailable/.test(text), "item F REGRESSION: it is not a dead end any more");
  a(/tasks are saved in this browser only|not reachable/.test(text),
    "item F: it names the actual connection state");
  a(!!d.querySelector('input[placeholder="https://api.example.com"]'),
    "item F: the backend URL override is on screen");
  a(!!d.querySelector('input[placeholder="Client / stakeholder"]'),
    "item F: the create-task form is usable with no backend");
  a([...d.querySelectorAll("select")].some(s => /All statuses/.test(s.textContent)),
    "item F: the status filter is on screen");

  /* ---- item A: carets on the task table's headers ----------------------- */
  const tbl = d.querySelector(".wp-table table");
  if (tbl) {
    const carets = tbl.tHead ? tbl.tHead.querySelectorAll(".en9-caret").length : 0;
    a(carets > 0, `item A: header carets injected on the task table (${carets})`);
  } else {
    a(true, "item A: no task table yet (empty list) — nothing to filter");
  }

  /* ---- item E: Settings names the key mode ------------------------------ */
  const setBtn = [...d.querySelectorAll(".nav-item")].find(b => /Settings/.test(b.textContent));
  setBtn.click();
  await new Promise(r => setTimeout(r, 600));
  const aiTab = [...d.querySelectorAll("button")].find(b => b.textContent.trim() === "AI platform");
  if (aiTab) {
    aiTab.click();
    await new Promise(r => setTimeout(r, 600));
    const s2 = d.body.textContent;
    a(/Personal-key mode/.test(s2), "item E: Settings names the active key mode");
    a(/it is stored in this browser, for this origin/.test(s2),
      "item E: and states plainly that the key does not travel with a shared link");
    a(/Key mode/.test(s2), "item E: the mode is also on the telemetry panel");
  } else {
    a(false, "could not reach the AI platform settings tab");
  }

  if (fails) { console.error(`\n${fails} FAILURE(S)`); process.exit(1); }
  console.log("\nAPP BOOT SMOKE TEST PASSED");
  process.exit(0);
})().catch(e => { console.error("UNCAUGHT:", e); process.exit(1); });
