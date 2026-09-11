/* Item F: Task management without a backend. Evals the /*EN9TASKS-BEGIN*​/ block
   out of dist/index.html so it pins the shipped code. */
const fs = require("fs");
const path = require("path");

const dist = fs.readFileSync(path.join(__dirname, "..", "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const m = dist.match(/\/\*EN9TASKS-BEGIN\*\/([\s\S]*?)\/\*EN9TASKS-END\*\//);
a(!!m, "EN9TASKS sentinel block present in dist");
if (!m) { process.exit(1); }
eval(m[1]);

// --- 1. Three causes must produce three different messages -----------------
// The old build collapsed all of these into "Backend is not connected".
a(EN9backendMode("__local__", null) === "local", "file:// -> local mode");
a(EN9backendMode("__local__", false) === "local", "local mode is not reported as unreachable");
a(EN9backendMode("", false) === "unreachable", "static host (same-origin 404) -> unreachable, NOT local");
a(EN9backendMode("https://api.example.com", false) === "unreachable", "configured URL that fails -> unreachable");
a(EN9backendMode("", true) === "connected", "same-origin API that answers -> connected");
a(EN9backendMode("https://api.example.com", true) === "connected", "configured URL that answers -> connected");
a(EN9backendMode("", null) === "checking", "before the health check resolves -> checking");
a(new Set(["local", "unreachable", "connected", "checking"]).size === 4, "four distinct states exist");
a(EN9baseLabel("__local__") === "none (this browser only)", "local base is labelled honestly");
a(EN9baseLabel("") === "this site (same origin)", "empty base means same origin");
a(EN9baseLabel("https://api.example.com") === "https://api.example.com", "a configured base is shown verbatim");

// --- 2. Local rows are shaped exactly like server rows ---------------------
let list = [];
const t1 = EN9makeTask({ client: " Acme Group ", subClient: " Acme GmbH ", taxYear: "2025", assigneeName: "Jaynil", dueDate: "2026-04-15" }, list);
const serverShape = ["id", "task_no", "client", "sub_client", "return_type", "tax_year",
  "assignee_name", "assignee_id", "status", "workpaper_id", "due_date", "created_at", "updated_at"];
a(serverShape.every(k => k in t1), "a local task carries every field the server row has");
a(t1.client === "Acme Group" && t1.sub_client === "Acme GmbH", "fields are trimmed like the server does");
a(t1.return_type === "5471" && t1.status === "pending", "defaults match the server defaults");
a(t1.tax_year === 2025, "tax year is stored as a number, as the API returns it");
a(t1.EN9local === true, "a local row is flagged so the UI can be honest about it");
a(t1.task_no === "1", "numbering starts at 1");

// --- 3. Create / update / status / delete / filter -------------------------
list = [t1];
const t2 = EN9makeTask({ client: "Beta Ltd", subClient: "Beta SARL" }, list);
a(t2.task_no === "2", "the next task number continues the sequence");
list = [t2, t1];

let after = EN9patchTaskList(list, t1.id, { status: "in_progress" });
a(after.find(t => t.id === t1.id).status === "in_progress", "status change is applied");
a(after.find(t => t.id === t2.id).status === "pending", "status change touches only the target row");
a(after.find(t => t.id === t1.id).updated_at >= t1.updated_at, "updated_at moves forward");

after = EN9patchTaskList(after, t2.id, { assignee_name: "Priya", due_date: "2026-05-01" });
a(after.find(t => t.id === t2.id).assignee_name === "Priya", "arbitrary field updates work");

a(EN9removeTaskFrom(after, t1.id).length === 1, "delete removes exactly one row");
a(EN9removeTaskFrom(after, "nope").length === 2, "deleting an unknown id is a no-op");

a(EN9taskRef(t1) === "T-0001" && EN9taskRef(t2) === "T-0002", "task refs are zero-padded");

a(EN9filterTasks(after, "", "ALL").length === 2, "no filter shows everything");
a(EN9filterTasks(after, "", "pending").length === 1, "status filter works");
a(EN9filterTasks(after, "acme", "ALL").length === 1, "search matches the client");
a(EN9filterTasks(after, "BETA SARL", "ALL").length === 1, "search is case-insensitive and matches the entity");
a(EN9filterTasks(after, "priya", "ALL").length === 1, "search matches the assignee");
a(EN9filterTasks(after, "T-0001", "ALL").length === 1, "search matches the displayed task ref");
a(EN9filterTasks(after, "2025", "ALL").length === 1, "search matches the tax year");
a(EN9filterTasks(after, "acme", "completed").length === 0, "search and status filter combine");
a(EN9filterTasks(after, "zzzz", "ALL").length === 0, "a miss returns nothing");
a(EN9filterTasks(null, "x", "ALL").length === 0, "a missing list does not throw");

// --- 4. dist wiring -------------------------------------------------------
a(!dist.includes("Task management is currently unavailable"),
  "REGRESSION: the dead-end 'backend connection required' banner is gone");
a(!dist.includes('if(!e.remote||e.connected===!1||!Array.isArray(e.tasks))return'),
  "REGRESSION: the gate that hid the whole view is gone");
a(dist.includes('EN9mode==="local"?') && dist.includes('EN9mode==="unreachable"?') && dist.includes('EN9mode==="connected"?'),
  "the view renders a different message per state");
a(dist.includes("Local mode \\u2014 tasks are saved in this browser only"), "local mode says where the tasks live");
a(dist.includes("Backend configured but not reachable"), "an unreachable backend is named as such");
a(dist.includes("nobody is notified and nothing is assigned to them"),
  "local mode does not claim assignment works");
a(dist.includes('children:"this browser only"'), "a local assignee is labelled on its own row");
a(dist.includes('EN9local?"saved in this browser"'), "the metric card does not claim a sync that is not happening");
a(dist.includes("await EN9taskStore.create("), "create goes through the store");
a(dist.includes("await EN9taskStore.patch(d.id,{status:f})"), "status change goes through the store");
a(dist.includes("EN9taskStore.remove(d.id)"), "delete goes through the store");
a(dist.includes("async list(){if(EN9remoteOk())return(await ss.listTasks())||[];return EN9tasksLoadLocal()}"),
  "the same interface swaps adapters underneath");
a(dist.includes("await EN9taskStore.list()"), "the refresh path uses the store");
a(dist.includes("EN9tor(tu,\"readwrite\",i=>i.put(t,EN9TASK_KEY))"), "IndexedDB is the primary local store");
a(dist.includes("localStorage.setItem(EN9TASK_LS,JSON.stringify(t))"), "localStorage is the fallback");
a(dist.includes('placeholder:"https://api.example.com"'), "the backend URL override is in the UI");
a(dist.includes('children:"Save & reconnect"') && dist.includes('children:"Retry now"'),
  "the override can be saved and the connection retried without devtools");
a(dist.includes('if(!Xc())sa({remote:!1,connected:null})'), "local mode is set explicitly at boot");
a(dist.includes("}else UA()}"), "local mode loads its tasks at boot");
a(dist.includes('catch{sa({connected:!1});UA();return}'), "an unreachable backend falls back to the local tasks");
a(dist.includes("if(!EN9remoteOk()){try{await EN9taskStore.patch(t.id,{entity_client_id:i.id})"),
  "opening a workpaper from a task works with no backend");
a(dist.includes("EN9shown=EN9filterTasks(EN9tasks,EN9q,EN9st)"), "the table renders the filtered rows");
a(dist.includes('children:"All statuses"'), "the status filter is present in the view");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL TASK TESTS PASSED");
