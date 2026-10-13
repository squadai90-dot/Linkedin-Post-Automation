/* A small interpreter for the Make blueprints in make/. It runs the blueprint
 * JSON itself — router filters, mappings, the data store, iterators and
 * aggregators, error handlers, webhook responses — so a test exercises the
 * routes and formulas that would be imported into Make, not a description of
 * them. LinkedIn is a stand-in the test supplies.
 *
 * It is not Make. It covers the formula functions and modules these
 * blueprints use, with the behaviour Make documents (and the production
 * scenarios rely on): a webhook with no response module run answers
 * "Accepted"; an unhandled error answers 500; an error handler ending in
 * Ignore ends that route quietly; Get a record of a missing key returns an
 * empty bundle; a data store keeps only the fields its structure declares.
 * Operations are counted the way Make bills them: one per module run, routers
 * and Ignore excluded. */

/* The fields of the production data structure 584788 (the data store's) and of
   631043 (the multi-Page payload). Fields outside a structure are dropped. */
export const STORE_FIELDS = ["source", "postId", "idempotencyKey", "postType", "content", "company", "companyUrn", "publishMode", "scheduledDate",
  "scheduledTime", "timezone", "submittedBy", "media", "poll", "dueAt", "status", "attemptAt", "publishedUrn", "note"];
export const PAYLOAD_FIELDS = {
  584788: STORE_FIELDS,
  631043: ["source", "postId", "parentPostId", "destinationId", "idempotencyKey", "postType", "content", "company", "companyUrn", "publishMode",
    "scheduledDate", "scheduledTime", "timezone", "submittedBy", "destinations", "media", "poll"],
};

class StopRoute extends Error {}
export class ModuleError extends Error {}

/* ---------------- formulas ---------------- */
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let s = ""; i++;
      while (i < src.length && src[i] !== '"') { if (src[i] === "\\") i++; s += src[i++]; }
      i++; out.push({ t: "str", v: s }); continue;
    }
    if ("();+=-".includes(c)) { out.push({ t: c }); i++; continue; }
    const m = /^[A-Za-z0-9_.[\]]+/.exec(src.slice(i));
    if (!m || !m[0]) throw new Error(`Cannot read formula at: ${src.slice(i)}`);
    out.push(/^\d+(\.\d+)?$/.test(m[0]) ? { t: "num", v: Number(m[0]) } : { t: "id", v: m[0] });
    i += m[0].length;
  }
  return out;
}

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => { if (tokens[p]?.t !== t) throw new Error(`expected ${t}`); return tokens[p++]; };
  function primary() {
    const tk = tokens[p++];
    if (!tk) throw new Error("unexpected end");
    if (tk.t === "str") return { k: "lit", v: tk.v };
    if (tk.t === "num") return { k: "lit", v: tk.v };
    if (tk.t === "-") { const e = primary(); return { k: "neg", e }; }
    if (tk.t === "(") { const e = expr(); eat(")"); return e; }
    if (tk.t === "id") {
      if (peek()?.t === "(") {
        p++;
        const args = [];
        if (peek()?.t !== ")") { args.push(expr()); while (peek()?.t === ";") { p++; args.push(expr()); } }
        eat(")");
        return { k: "call", name: tk.v, args };
      }
      return { k: "ref", v: tk.v };
    }
    throw new Error(`unexpected ${tk.t}`);
  }
  function sum() { let l = primary(); while (peek()?.t === "+") { p++; l = { k: "plus", l, r: primary() }; } return l; }
  function expr() { const l = sum(); if (peek()?.t === "=") { p++; return { k: "eq", l, r: sum() }; } return l; }
  const e = expr();
  if (p !== tokens.length) throw new Error("trailing tokens");
  return e;
}

const empty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

function tzOffsetMinutes(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(date).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime()) / 60000;
}
const pad = (n) => String(n).padStart(2, "0");
function formatDate(d, fmt, tz) {
  const date = d instanceof Date ? d : new Date(Number(d) * (String(d).length <= 11 ? 1000 : 1));
  if (fmt === "X") return String(Math.floor(date.getTime() / 1000));
  const off = tz ? tzOffsetMinutes(date, tz) : 0;
  const l = new Date(date.getTime() + off * 60000);
  return fmt.replace("YYYY", l.getUTCFullYear()).replace("MM", pad(l.getUTCMonth() + 1)).replace("DD", pad(l.getUTCDate()))
    .replace("HH", pad(l.getUTCHours())).replace("mm", pad(l.getUTCMinutes()));
}
function parseDate(s, fmt, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(s).trim());
  if (!m || fmt !== "YYYY-MM-DD HH:mm") return null;
  const guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return new Date(guess.getTime() - tzOffsetMinutes(guess, tz || "UTC") * 60000);
}

function resolvePath(path, ctx) {
  const segs = [];
  path.replace(/([^.[\]]+)|\[(\d+)\]/g, (_, name, idx) => { segs.push(idx != null ? Number(idx) - 1 : name); return ""; });
  let v = ctx.out[segs[0]];
  for (const s of segs.slice(1)) v = v == null ? undefined : v[s];
  return v;
}

function evaluate(node, ctx) {
  switch (node.k) {
    case "lit": return node.v;
    case "neg": return -Number(evaluate(node.e, ctx));
    case "plus": return `${evaluate(node.l, ctx) ?? ""}${evaluate(node.r, ctx) ?? ""}`;
    case "eq": return String(evaluate(node.l, ctx) ?? "") === String(evaluate(node.r, ctx) ?? "");
    case "ref": return node.v === "now" ? new Date(ctx.sim.now) : resolvePath(node.v, ctx);
    case "call": {
      const a = node.args.map((x) => evaluate(x, ctx));
      switch (node.name) {
        case "ifempty": return empty(a[0]) ? a[1] : a[0];
        case "length": return a[0] == null ? 0 : a[0].length;
        case "parseNumber": return a[0] == null || a[0] === "" ? undefined : Number(a[0]);
        case "formatDate": return a[0] == null ? "" : formatDate(a[0], a[1], a[2]);
        case "parseDate": return parseDate(a[0], a[1], a[2]);
        case "addMinutes": return new Date(new Date(a[0]).getTime() + a[1] * 60000);
        case "addDays": return new Date(new Date(a[0]).getTime() + a[1] * 86400000);
        case "toBinary": return { binary: a[0], encoding: a[1] };
        case "get": return a[0] == null ? undefined : a[0][a[1]];
        case "if": return a[0] ? a[1] : a[2];
        case "toString": return String(a[0] ?? "");
        case "replace": {
          const m = /^\/(.*)\/([gimsuy]*)$/.exec(a[1]);
          return String(a[0] ?? "").replace(m ? new RegExp(m[1], m[2]) : a[1], a[2]);
        }
        case "switch": {
          for (let k = 1; k + 1 < a.length; k += 2) if (String(a[0]) === String(a[k])) return a[k + 1];
          return a.length % 2 === 0 ? a[a.length - 1] : undefined;
        }
        default: throw new Error(`formula function ${node.name} is not simulated`);
      }
    }
    default: throw new Error(node.k);
  }
}

const formulaCache = new Map();
function formula(src, ctx) {
  if (!formulaCache.has(src)) formulaCache.set(src, parse(tokenize(src)));
  return evaluate(formulaCache.get(src), ctx);
}

/** A mapped value: "{{x}}" alone keeps its type; mixed text becomes a string. */
export function template(v, ctx) {
  if (Array.isArray(v)) return v.map((x) => template(x, ctx));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, template(x, ctx)]));
  if (typeof v !== "string" || !v.includes("{{")) return v;
  const whole = /^\{\{([\s\S]*)\}\}$/.exec(v);
  if (whole && !whole[1].includes("{{") && !whole[1].includes("}}")) return formula(whole[1], ctx);
  return v.replace(/\{\{([\s\S]*?)\}\}/g, (_, src) => {
    const x = formula(src, ctx);
    if (x == null) return "";
    if (x instanceof Date) return x.toISOString();
    return typeof x === "object" ? JSON.stringify(x) : String(x);
  });
}

function test(c, a) {
  const b = c.b == null ? c.b : a.ctx ? template(c.b, a.ctx) : c.b;
  const v = a.value;
  switch (c.o) {
    case "text:equal": return String(v ?? "") === String(b ?? "");
    case "text:notequal": return String(v ?? "") !== String(b ?? "");
    case "number:equal": return Number(v ?? 0) === Number(b);
    case "number:greater": return Number(v ?? 0) > Number(b);
    case "number:lessorequal": return v != null && v !== "" && Number(v) <= Number(b);
    case "exist": return !empty(v);
    case "notexist": return empty(v);
    default: throw new Error(`filter operator ${c.o} is not simulated`);
  }
}
const passes = (filter, ctx) => !filter || filter.conditions.some((g) => g.every((c) => test(c, { value: template(c.a, ctx), ctx })));
const matches = (groups, data, ctx) => !groups?.length || groups.some((g) => g.every((c) => test(c, { value: c.a.split(".").reduce((o, k) => o?.[k], data), ctx })));

const pick = (obj, fields) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => fields.includes(k)));

/* ---------------- the simulator ---------------- */
export function createMake({ linkedin, now = Date.UTC(2026, 9, 13, 6, 0), storeLimit = 1048576 } = {}) {
  const sim = {
    now, store: new Map(), ops: 0, calls: [], active: true, queue: [], storeLimit,
    failWrites: null,          // (module, key) => true to make a data-store write fail
    crashAfterLinkedIn: false, // the run dies right after LinkedIn answers
    linkedin,
    storeBytes() { let n = 0; for (const [k, v] of sim.store) n += k.length + JSON.stringify(v).length; return n; },
    records() { return Object.fromEntries([...sim.store].map(([k, v]) => [k, structuredClone(v)])); },
  };

  function write(m, key, data) {
    if (sim.failWrites?.(m, key)) throw new ModuleError("The data store could not be written.");
    const before = sim.store.get(key);
    sim.store.set(key, data);
    if (sim.storeBytes() > sim.storeLimit) { if (before) sim.store.set(key, before); else sim.store.delete(key); throw new ModuleError("Data store is full."); }
  }

  function exec(m, ctx) {
    const p = m.parameters || {};
    const mp = m.mapper;
    switch (m.module) {
      case "gateway:CustomWebHook": return { value: ctx.body };
      case "json:ParseJSON": {
        const parsed = JSON.parse(template(mp.json, ctx));
        return PAYLOAD_FIELDS[p.type] ? pick(parsed, PAYLOAD_FIELDS[p.type]) : parsed;
      }
      case "json:CreateJSON": return { json: JSON.stringify(template(mp, ctx)) };
      case "json:TransformToJSON": return { json: JSON.stringify(template(mp.object, ctx)) };
      case "gateway:WebhookRespond": {
        if (!ctx.res.v) ctx.res.v = { status: Number(template(mp.status, ctx)), body: String(template(mp.body, ctx)) };
        return {};
      }
      case "datastore:AddRecord": {
        const key = String(template(mp.key, ctx));
        if (mp.overwrite === false && sim.store.has(key)) throw new ModuleError("The record already exists.");
        write(m, key, pick(template(mp.data, ctx), STORE_FIELDS));
        return { key };
      }
      case "datastore:UpdateRecord": {
        const key = String(template(mp.key, ctx));
        if (!sim.store.has(key)) throw new ModuleError(`Record ${key} not found.`);
        write(m, key, { ...sim.store.get(key), ...pick(template(mp.data, ctx), STORE_FIELDS) });
        return { key };
      }
      case "datastore:GetRecord": return structuredClone(sim.store.get(String(template(mp.key, ctx))) || {});
      case "datastore:DeleteRecord": sim.store.delete(String(template(mp.key, ctx))); return {};
      default:
        if (m.module.startsWith("linkedin:")) {
          const args = template(mp, ctx);
          sim.calls.push({ module: m.module.slice(9), args });
          const r = sim.linkedin({ module: m.module.slice(9), args });
          if (r instanceof Error) throw new ModuleError(r.message);
          if (sim.crashAfterLinkedIn) throw new Error("The run stopped (simulated crash after LinkedIn answered).");
          return m.module === "linkedin:MakeAPICall" ? { headers: { "x-restli-id": r.id }, body: {}, statusCode: 201 } : { id: r.id };
        }
        throw new Error(`module ${m.module} is not simulated`);
    }
  }

  function bundlesOf(m, ctx) {
    if (m.module === "builtin:BasicFeeder") return (template(m.mapper.array, ctx) || []).map((x) => (x && typeof x === "object" ? { ...x, value: x } : { value: x }));
    const p = m.parameters;
    const rows = [...sim.store].filter(([, d]) => matches(m.mapper.filter, d, ctx)).slice(0, p.limit || 10).map(([key, data]) => ({ key, data: structuredClone(data) }));
    return rows.length || !p.continueWhenNoRes ? rows : [{ key: undefined, data: {} }];
  }

  function run(flow, ctx) {
    for (let i = 0; i < flow.length; i++) {
      const m = flow[i];
      if (!passes(m.filter, ctx)) return;
      if (m.module === "builtin:BasicRouter") {
        for (const r of m.routes) {
          try { run(r.flow, { ...ctx, out: { ...ctx.out } }); } catch (e) { if (!(e instanceof StopRoute)) throw e; }
        }
        return;
      }
      if (m.module === "builtin:Ignore") throw new StopRoute();
      if (m.module === "builtin:BasicFeeder" || m.module === "datastore:SearchRecord") {
        sim.ops++;
        const bundles = bundlesOf(m, ctx);
        const j = flow.findIndex((x, k) => k > i && x.module === "builtin:BasicAggregator" && x.parameters?.feeder === m.id);
        if (j < 0) { for (const b of bundles) runChild(flow.slice(i + 1), ctx, m.id, b); return; }
        const items = [];
        for (const b of bundles) {
          const reached = runChild(flow.slice(i + 1, j), ctx, m.id, b);
          if (reached) items.push(template(flow[j].mapper, reached));
        }
        if (!bundles.length) return;
        sim.ops++;
        ctx.out[flow[j].id] = { array: items };
        i = j;
        continue;
      }
      sim.ops++;
      try {
        ctx.out[m.id] = exec(m, ctx);
      } catch (e) {
        if (!(e instanceof ModuleError) || !m.onerror) throw e;
        ctx.out[m.id] = { error: { message: e.message } };
        try { run(m.onerror, ctx); } catch (s) { if (!(s instanceof StopRoute)) throw s; }
        return;
      }
    }
    return ctx;
  }

  /* One bundle down the rest of a flow; returns its context if it got to the end. */
  function runChild(flow, ctx, id, bundle) {
    const c = { ...ctx, out: { ...ctx.out, [id]: bundle } };
    try {
      const done = run(flow, c);
      return done || null;
    } catch (s) {
      if (s instanceof StopRoute) return null;
      throw s;
    }
  }

  /** A webhook delivery. Returns what Make would answer the caller. */
  sim.deliver = (blueprint, body) => {
    if (!sim.active) { sim.queue.push(body); return { status: 200, body: "Accepted" }; }
    const ctx = { sim, body, out: {}, res: { v: null } };
    try {
      run(blueprint.flow, ctx);
    } catch (e) {
      if (!(e instanceof StopRoute)) return ctx.res.v || { status: 500, body: "Scenario failed to complete.", error: e.message };
    }
    return ctx.res.v || { status: 200, body: "Accepted" };
  };

  /** One run of a scheduled scenario. */
  sim.tick = (blueprint) => {
    const ctx = { sim, out: {}, res: { v: null } };
    try { run(blueprint.flow, ctx); return { ok: true }; } catch (e) { return { ok: e instanceof StopRoute, error: e.message }; }
  };

  return sim;
}
