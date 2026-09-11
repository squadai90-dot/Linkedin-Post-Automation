/* Item F, end to end: the LOCAL task store, driven through a real IndexedDB
   implementation, across the three environments separately.

   This is not a shape test. It pulls the storage adapters straight out of
   dist/index.html, runs create / update / status / delete / filter against
   them, then throws the whole in-memory layer away and re-reads to prove the
   data survived a refresh and a reopen. */
require("fake-indexeddb/auto");
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

/* ---- a minimal localStorage, so the fallback path is exercised too ------- */
let lsBacking = {};
global.localStorage = {
  getItem: k => (k in lsBacking ? lsBacking[k] : null),
  setItem: (k, v) => { lsBacking[k] = String(v); },
  removeItem: k => { delete lsBacking[k]; },
};

/* ---- pull the real code out of the bundle -------------------------------- */
const pure = dist.match(/\/\*EN9TASKS-BEGIN\*\/([\s\S]*?)\/\*EN9TASKS-END\*\//);
a(!!pure, "EN9TASKS block found");
if (!pure) process.exit(1);
eval(pure[1]);

// the adapters, verbatim from the bundle
const grab = (start, end) => {
  const i = dist.indexOf(start), j = dist.indexOf(end, i);
  if (i < 0 || j < 0) { console.error("FAIL: could not extract", start.slice(0, 40)); process.exit(1); }
  return dist.slice(i, j);
};
const adapters = grab("var EN9tdb=null;", "function EN9remoteOk()");
a(adapters.includes("EN9tasksLoadLocal") && adapters.includes("EN9tasksSaveLocal"),
  "storage adapters extracted from the shipped bundle");

// the two things the adapters close over from the app's own persistence block
const b_ = "wp-local", tu = "kv", nl = "files";
function w_() {
  return new Promise(res => {
    try {
      const r = indexedDB.open(b_, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(tu)) d.createObjectStore(tu);
        if (!d.objectStoreNames.contains(nl)) d.createObjectStore(nl);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
void b_; void tu; void nl; void w_;

// The adapters declare their own bindings. Evaluate them in a child scope and
// hand the three entry points back out, so a "reload" can drop the cached
// IndexedDB handle exactly the way a fresh page load would.
const api = (function () {
  let out;
  eval(adapters + "\nout={load:EN9tasksLoadLocal,save:EN9tasksSaveLocal,drop:function(){EN9tdb=null}};");
  return out;
})();
const EN9tasksLoadLocal = api.load, EN9tasksSaveLocal = api.save, dropHandle = api.drop;

(async () => {
  /* ================= CASE A: file:// — no backend at all ================= */
  console.log("\n-- CASE A: file:// (Zc() -> \"__local__\")");
  a(EN9backendMode("__local__", null) === "local", "mode is local, not 'unreachable'");

  let tasks = await EN9tasksLoadLocal();
  a(Array.isArray(tasks) && tasks.length === 0, "a fresh browser starts with an empty task list, not an error");

  // create
  const t1 = EN9makeTask({ client: "Acme Group", subClient: "Acme GmbH", taxYear: "2025", assigneeName: "Priya" }, tasks);
  tasks = [t1, ...tasks];
  a(await EN9tasksSaveLocal(tasks), "create persists");
  const t2 = EN9makeTask({ client: "Beta Ltd", subClient: "Beta SARL", dueDate: "2026-04-15" }, tasks);
  tasks = [t2, ...tasks];
  await EN9tasksSaveLocal(tasks);

  // read back through a fresh handle -- this is the "refresh" case
  dropHandle();
  let reloaded = await EN9tasksLoadLocal();
  a(reloaded.length === 2, `both tasks survive a refresh (${reloaded.length})`);
  a(reloaded.find(t => t.id === t1.id).client === "Acme Group", "field values survive intact");
  a(reloaded.find(t => t.id === t1.id).tax_year === 2025, "the tax year survives as a number");
  a(reloaded.find(t => t.id === t2.id).task_no === "2", "numbering survives");

  // update: status change
  reloaded = EN9patchTaskList(reloaded, t1.id, { status: "in_progress" });
  await EN9tasksSaveLocal(reloaded);
  dropHandle();
  reloaded = await EN9tasksLoadLocal();
  a(reloaded.find(t => t.id === t1.id).status === "in_progress", "a status change survives a refresh");
  a(reloaded.find(t => t.id === t2.id).status === "pending", "and did not touch the other task");

  // update: arbitrary field
  reloaded = EN9patchTaskList(reloaded, t2.id, { assignee_name: "Jaynil" });
  await EN9tasksSaveLocal(reloaded);
  dropHandle();
  reloaded = await EN9tasksLoadLocal();
  a(reloaded.find(t => t.id === t2.id).assignee_name === "Jaynil", "an edit survives a refresh");

  // filter / search over the persisted set
  a(EN9filterTasks(reloaded, "", "in_progress").length === 1, "status filter works on the reloaded set");
  a(EN9filterTasks(reloaded, "beta", "ALL").length === 1, "search works on the reloaded set");
  a(EN9filterTasks(reloaded, "T-0001", "ALL")[0].id === t1.id, "search by the displayed ref works");

  // delete
  reloaded = EN9removeTaskFrom(reloaded, t1.id);
  await EN9tasksSaveLocal(reloaded);
  dropHandle();
  reloaded = await EN9tasksLoadLocal();
  a(reloaded.length === 1 && reloaded[0].id === t2.id, "a delete survives a refresh");

  // "reopen the app": drop every handle, as a new page load would
  dropHandle();
  const afterReopen = await EN9tasksLoadLocal();
  a(afterReopen.length === 1 && afterReopen[0].assignee_name === "Jaynil",
    "everything is still there after a full reopen");

  /* ============ CASE B: static host — same origin, /api 404s ============= */
  console.log("\n-- CASE B: static host (Netlify/Pages), same-origin /api/health 404s");
  a(EN9backendMode("", false) === "unreachable",
    "REGRESSION: a static host reports 'unreachable', NOT 'local' — two causes, two messages");
  a(EN9backendMode("__local__", false) !== EN9backendMode("", false),
    "the file:// case and the static-host case no longer produce the same message");
  const stillThere = await EN9tasksLoadLocal();
  a(stillThere.length === 1, "an unreachable backend still shows this browser's tasks rather than a blank screen");
  const t3 = EN9makeTask({ client: "Gamma", subClient: "Gamma Oy" }, stillThere);
  await EN9tasksSaveLocal([t3, ...stillThere]);
  dropHandle();
  a((await EN9tasksLoadLocal()).length === 2, "and tasks created while it is down are kept");

  /* ============ CASE C: backend connected — store defers to the API ====== */
  console.log("\n-- CASE C: backend connected");
  a(EN9backendMode("", true) === "connected" && EN9backendMode("https://api.x.com", true) === "connected",
    "a reachable API reports connected, same-origin or configured");
  a(dist.includes("async list(){if(EN9remoteOk())return(await ss.listTasks())||[];return EN9tasksLoadLocal()}"),
    "the store calls the API when connected and the local adapter otherwise");
  a(dist.includes("async create(t){if(EN9remoteOk())return ss.createTask(t);"), "create defers to the API when connected");
  a(dist.includes("async patch(t,e){if(EN9remoteOk())return ss.patchTask(t,e);"), "patch defers to the API");
  a(dist.includes("async remove(t){if(EN9remoteOk())return ss.deleteTask(t);"), "delete defers to the API");
  a(dist.includes("function EN9remoteOk(){try{let t=hn();return!!(t.remote&&t.connected===!0)}"),
    "'connected' means the health check actually answered, not merely that a URL is set");

  /* ---- localStorage fallback: IndexedDB unavailable --------------------- */
  console.log("\n-- fallback: IndexedDB unavailable");
  a(Object.keys(lsBacking).includes("wp-local-tasks"), "every save also mirrors to localStorage");
  const mirrored = JSON.parse(lsBacking["wp-local-tasks"]);
  a(Array.isArray(mirrored) && mirrored.length === 2, "the mirror holds the same rows");
  const realOpen = global.indexedDB;
  global.indexedDB = { open() { throw new Error("IndexedDB disabled (private mode)"); } };
  dropHandle();
  const viaLs = await EN9tasksLoadLocal();
  a(viaLs.length === 2, "with IndexedDB unavailable the tasks still load from localStorage");
  a(viaLs.find(t => t.client === "Gamma"), "and they are the right ones");
  global.indexedDB = realOpen;

  if (fails) { console.error(`\n${fails} FAILURE(S)`); process.exit(1); }
  console.log("\nALL TASK-PERSISTENCE TESTS PASSED");
})().catch(e => { console.error("UNCAUGHT:", e); process.exit(1); });
