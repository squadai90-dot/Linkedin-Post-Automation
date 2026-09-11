/* 5471 Work Paper backend: one service serving the API and the single-file
   app. No authentication yet by explicit decision — a shared workspace until
   Microsoft (Entra ID) sign-in is added; every route funnels through
   requireUser(), which is where sessions will plug in without touching the
   route bodies. Documents are stored as bytea; entity state as jsonb with an
   optimistic version counter. */

import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import path from "node:path";
import { existsSync } from "node:fs";
import { migrate, pool, q } from "./db";
import { readProxyConfig, registerAiProxy } from "./aiProxy";

const PORT = Number(process.env.PORT || 8471);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);
// The bundle lives at <repo>/dist-server/server.cjs; everything is repo-relative.
const ROOT = path.resolve(__dirname, "..");
const DIST = [path.join(ROOT, "dist"), path.join(ROOT, "..", "dist")].find((p) => existsSync(path.join(p, "index.html")));
const MIGRATIONS = [path.join(ROOT, "server", "migrations"), path.join(ROOT, "migrations")].find((p) => existsSync(p));

/** Auth seam. Today: an anonymous shared workspace. When Entra ID lands,
    this reads the session cookie and returns the user (or throws 401);
    nothing else in the file changes. */
const requireUser = (_req: unknown) => ({ id: null as string | null, role: "preparer" as const });

const TASK_STATUSES = new Set(["pending", "in_progress", "completed"]);

async function main() {
  // JSON bodies carry serialized entity state (a few MB); binary uploads go
  // through multipart with their own limit.
  const app = Fastify({ logger: { level: "info" }, bodyLimit: 64 * 1024 * 1024 });
  await app.register(fastifyMultipart, { limits: { fileSize: (MAX_UPLOAD_MB + 1) * 1024 * 1024, files: 1 } });

  const origins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Headers", "Content-Type, X-AI-Proxy-Token");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    }
    if (req.method === "OPTIONS") reply.code(204).send();
  });

  const aiCfg = readProxyConfig();

  app.get("/api/health", async () => {
    const [{ now }] = await q<{ now: string }>("select now()");
    // aiProxy tells the browser whether a server-side key exists, so it can
    // choose the proxy over its own per-browser key. The key never leaves here.
    return { ok: true, db: now, aiProxy: !!aiCfg.key, aiTokenRequired: !!aiCfg.token };
  });

  registerAiProxy(app, aiCfg);

  /* ---------------- workpapers ---------------- */

  app.get("/api/workpapers", async (req) => {
    requireUser(req);
    return q(
      `select id, stakeholder, entity_name, entity_client_id, version, created_at, updated_at,
              (select count(*) from documents d where d.workpaper_id = w.id)::int as document_count
         from workpapers w order by updated_at desc`,
    );
  });

  app.post("/api/workpapers", async (req, reply) => {
    requireUser(req);
    const b = req.body as { stakeholder?: string; entityName?: string; entityClientId?: string; stateJson?: unknown };
    if (!b?.entityClientId || !b.entityName) return reply.code(400).send({ error: "entityClientId and entityName are required" });
    const rows = await q(
      `insert into workpapers (stakeholder, entity_name, entity_client_id, state_json)
       values ($1, $2, $3, $4)
       on conflict (entity_client_id) do update
         set stakeholder = excluded.stakeholder, entity_name = excluded.entity_name, updated_at = now()
       returning id, version`,
      [b.stakeholder || "", b.entityName, b.entityClientId, JSON.stringify(b.stateJson ?? {})],
    );
    // Link a matching unlinked task by client/sub-client, if one exists.
    await q(
      `update tasks set workpaper_id = $1, updated_at = now()
        where workpaper_id is null and lower(sub_client) = lower($2)`,
      [rows[0].id, b.entityName],
    );
    return rows[0];
  });

  app.get("/api/workpapers/:id", async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const rows = await q(
      "select id, stakeholder, entity_name, entity_client_id, state_json, version, updated_at from workpapers where id = $1",
      [id],
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    return rows[0];
  });

  app.put("/api/workpapers/:id/state", async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const b = req.body as { stateJson?: unknown; baseVersion?: number; stakeholder?: string; entityName?: string };
    if (b?.stateJson === undefined) return reply.code(400).send({ error: "stateJson is required" });
    const rows = await q(
      `update workpapers
          set state_json = $2, version = version + 1, updated_at = now(),
              stakeholder = coalesce($4, stakeholder), entity_name = coalesce($5, entity_name)
        where id = $1 and ($3::int is null or version = $3)
        returning id, version`,
      [id, JSON.stringify(b.stateJson), b.baseVersion ?? null, b.stakeholder ?? null, b.entityName ?? null],
    );
    if (!rows.length) {
      const exists = await q("select version from workpapers where id = $1", [id]);
      if (!exists.length) return reply.code(404).send({ error: "not found" });
      return reply.code(409).send({ error: "version conflict", currentVersion: exists[0].version });
    }
    return rows[0];
  });

  app.delete("/api/workpapers/:id", async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    await q("delete from workpapers where id = $1", [id]);
    return reply.code(204).send();
  });

  /* ---------------- documents ---------------- */

  app.post("/api/workpapers/:id/documents", async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const wp = await q("select id from workpapers where id = $1", [id]);
    if (!wp.length) return reply.code(404).send({ error: "workpaper not found" });
    const part = await (req as any).file();
    if (!part) return reply.code(400).send({ error: "multipart file field required" });
    const clientFileId = (part.fields?.clientFileId?.value as string) || part.filename;
    const buf: Buffer = await part.toBuffer();
    if (buf.length > MAX_UPLOAD_MB * 1024 * 1024) return reply.code(413).send({ error: `file exceeds ${MAX_UPLOAD_MB} MB` });
    const rows = await q(
      `insert into documents (workpaper_id, client_file_id, filename, size_bytes, content_type, bytes)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (workpaper_id, client_file_id) do update
         set filename = excluded.filename, size_bytes = excluded.size_bytes,
             content_type = excluded.content_type, bytes = excluded.bytes, uploaded_at = now()
       returning id, client_file_id, filename, size_bytes`,
      [id, clientFileId, part.filename, buf.length, part.mimetype || null, buf],
    );
    return rows[0];
  });

  app.get("/api/workpapers/:id/documents", async (req) => {
    requireUser(req);
    const { id } = (req.params as { id: string });
    return q(
      "select id, client_file_id, filename, size_bytes, content_type, uploaded_at from documents where workpaper_id = $1 order by uploaded_at",
      [id],
    );
  });

  app.get("/api/documents/:id/content", async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const rows = await q<{ filename: string; content_type: string | null; bytes: Buffer }>(
      "select filename, content_type, bytes from documents where id = $1",
      [id],
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    reply.header("Content-Type", rows[0].content_type || "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${rows[0].filename.replace(/"/g, "")}"`);
    return reply.send(rows[0].bytes);
  });

  app.delete("/api/documents/:id", async (req, reply) => {
    requireUser(req);
    await q("delete from documents where id = $1", [(req.params as { id: string }).id]);
    return reply.code(204).send();
  });

  /* ---------------- audit ---------------- */

  app.post("/api/workpapers/:id/audit", async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const b = req.body as { events?: Array<{ id: string; at: string; actor: string; entity?: string | null; action: string; detail: string }> };
    if (!Array.isArray(b?.events)) return reply.code(400).send({ error: "events[] required" });
    let inserted = 0;
    for (const ev of b.events.slice(0, 500)) {
      const rows = await q(
        `insert into audit_events (workpaper_id, client_event_id, at, actor, entity, action, detail)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (workpaper_id, client_event_id) do nothing
         returning id`,
        [id, ev.id, ev.at, ev.actor, ev.entity ?? null, ev.action, String(ev.detail).slice(0, 2000)],
      );
      if (rows.length) inserted++;
      // Task auto-advance: processing → in progress; generation → completed.
      if (rows.length && ev.action === "Processing completed") {
        await q("update tasks set status = 'in_progress', updated_at = now() where workpaper_id = $1 and status = 'pending'", [id]);
      }
      if (rows.length && (ev.action === "Work paper generated" || ev.action === "Work papers generated")) {
        await q("update tasks set status = 'completed', updated_at = now() where workpaper_id = $1 and status <> 'completed'", [id]);
      }
    }
    return { inserted };
  });

  app.get("/api/workpapers/:id/audit", async (req) => {
    requireUser(req);
    return q(
      "select client_event_id as id, at, actor, entity, action, detail from audit_events where workpaper_id = $1 order by at desc limit 500",
      [(req.params as { id: string }).id],
    );
  });

  /* ---------------- tasks ---------------- */

  app.get("/api/tasks", async (req) => {
    requireUser(req);
    return q(
      `select t.id, t.task_no, t.client, t.sub_client, t.return_type, t.tax_year,
              t.assignee_name, t.status, t.workpaper_id, t.due_date, t.created_at, t.updated_at,
              w.entity_client_id
         from tasks t left join workpapers w on w.id = t.workpaper_id
        order by t.task_no desc`,
    );
  });

  app.post("/api/tasks", async (req, reply) => {
    requireUser(req);
    const b = req.body as { client?: string; subClient?: string; returnType?: string; taxYear?: number; assigneeName?: string; dueDate?: string; workpaperId?: string };
    if (!b?.client || !b.subClient) return reply.code(400).send({ error: "client and subClient are required" });
    const rows = await q(
      `insert into tasks (client, sub_client, return_type, tax_year, assignee_name, due_date, workpaper_id)
       values ($1, $2, coalesce($3, '5471'), $4, $5, $6, $7) returning *`,
      [b.client, b.subClient, b.returnType ?? null, b.taxYear ?? null, b.assigneeName ?? null, b.dueDate ?? null, b.workpaperId ?? null],
    );
    return rows[0];
  });

  app.patch("/api/tasks/:id", async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const b = req.body as { status?: string; assigneeName?: string; dueDate?: string | null; workpaperId?: string | null };
    if (b.status && !TASK_STATUSES.has(b.status)) return reply.code(400).send({ error: "invalid status" });
    const rows = await q(
      `update tasks set
          status = coalesce($2, status),
          assignee_name = coalesce($3, assignee_name),
          due_date = case when $4::text = '__clear__' then null else coalesce($4::date, due_date) end,
          workpaper_id = coalesce($5, workpaper_id),
          updated_at = now()
        where id = $1 returning *`,
      [id, b.status ?? null, b.assigneeName ?? null, b.dueDate === null ? "__clear__" : b.dueDate ?? null, b.workpaperId ?? null],
    );
    if (!rows.length) return reply.code(404).send({ error: "not found" });
    return rows[0];
  });

  app.delete("/api/tasks/:id", async (req, reply) => {
    requireUser(req);
    await q("delete from tasks where id = $1", [(req.params as { id: string }).id]);
    return reply.code(204).send();
  });

  /* ---------------- settings (global policies) ---------------- */

  app.get("/api/settings/:key", async (req) => {
    requireUser(req);
    const { key } = req.params as { key: string };
    const rows = await q("select value from settings where user_id is null and key = $1", [key]);
    return rows.length ? rows[0].value : null;
  });

  app.put("/api/settings/:key", async (req) => {
    requireUser(req);
    const { key } = req.params as { key: string };
    await q(
      `insert into settings (user_id, key, value) values (null, $1, $2)
       on conflict (user_id, key) do update set value = excluded.value, updated_at = now()`,
      [key, JSON.stringify((req.body as { value?: unknown })?.value ?? null)],
    );
    return { ok: true };
  });

  /* ---------------- static app ---------------- */

  if (DIST) {
    await app.register(fastifyStatic, { root: DIST, wildcard: false });
  }

  if (!MIGRATIONS) throw new Error("migrations directory not found");
  await migrate(MIGRATIONS);
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`5471 work-paper server on :${PORT}${DIST ? ` serving ${DIST}` : " (API only)"}`);
  console.log(
    aiCfg.key
      ? `AI proxy: ON (key held server-side, ${aiCfg.perMin}/min per IP${aiCfg.token ? ", token required" : ", NO token — rely on CORS_ORIGINS"})`
      : "AI proxy: OFF (no GROQ_API_KEY) — browsers fall back to their own per-browser key",
  );
}

main().catch((err) => {
  console.error("server failed to start:", err);
  process.exit(1);
});

export { main, pool };
