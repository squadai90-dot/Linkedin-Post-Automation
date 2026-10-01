/* ============================================================
   DEPLOYMENT CHECK

   Answers the question the deployed app could not: which server variables
   are set, which are missing, and does the AI key actually work?

   Every relay already reports, on a plain GET, whether it holds each key —
   as true/false, never the value. This collects those answers into one list
   with the exact fix for each line. The AI key is also tried for real (a
   free model-list call made by the server), because "set" and "valid" are
   different failures with different fixes.
   ============================================================ */

import { relayAuthHeaders } from "./store.js";

const VERCEL = "Vercel → your project → Settings → Environment Variables (Production), then Deployments → Redeploy";

export const RELAYS = [
  { id: "ai", path: "/api/ai", label: "AI writing and research", required: true,
    vars: ["GROQ_API_KEY"], optionalVars: ["ANTHROPIC_API_KEY"],
    read: (j) => ({ ok: !!(j.providers?.groq || j.providers?.anthropic), detail: j.providers?.groq ? "GROQ_API_KEY is set." : j.providers?.anthropic ? "ANTHROPIC_API_KEY is set." : "GROQ_API_KEY is not set." }) },
  { id: "image", path: "/api/image", label: "AI images",
    vars: ["OPENAI_API_KEY"], optionalVars: ["GOOGLE_API_KEY"],
    read: (j) => ({ ok: !!j.configured, detail: j.configured ? `Using ${j.defaultProvider === "google" ? "Google (GOOGLE_API_KEY)" : "OpenAI (OPENAI_API_KEY)"}.` : "Neither OPENAI_API_KEY nor GOOGLE_API_KEY is set. Unison's own layouts and Canva still work." }) },
  { id: "video", path: "/api/video", label: "AI video",
    vars: ["GOOGLE_API_KEY"], optionalVars: ["RUNWAY_API_KEY"],
    read: (j) => ({ ok: !!j.configured, detail: j.configured ? `Using ${j.defaultProvider === "runway" ? "Runway (RUNWAY_API_KEY)" : "Google Veo (GOOGLE_API_KEY)"}.` : "Neither GOOGLE_API_KEY nor RUNWAY_API_KEY is set. Canva video and Unison's storyboard video still work." }) },
  { id: "canva", path: "/api/canva", label: "Canva",
    vars: ["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET", "CANVA_REDIRECT_URI"],
    read: (j) => ({ ok: !!j.configured, detail: j.configured ? `Configured from ${j.configSource === "env" ? "environment variables" : "this server's memory (lost on restart)"} · redirect ${j.redirectUri || "—"}` : `Missing: ${["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET", "CANVA_REDIRECT_URI"].filter((v, i) => !(i === 0 ? j.clientId : i === 1 ? j.hasSecret : j.redirectUri)).join(", ") || "configuration"}.` }) },
  { id: "publish", path: "/api/publish", label: "Publishing relay (optional)",
    vars: ["MAKE_LINKEDIN_WEBHOOK_URL"],
    note: "Optional. Publishing works through the Make webhook saved in Settings → Publishing without it.",
    read: (j) => ({ ok: !!j.webhookConfigured, detail: j.webhookConfigured ? "MAKE_LINKEDIN_WEBHOOK_URL is set." : "Not set — the webhook in Settings → Publishing is used instead." }) },
  { id: "workspace", path: "/api/workspace?health", label: "Shared workspace (optional)",
    vars: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    note: "Optional. Without it, drafts stay in each person's own browser.",
    read: (j) => ({ ok: !!j.configured, detail: j.configured ? "Connected." : "Not set — drafts are kept per browser." }) },
];

async function getJSON(path, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(path, { headers: { Accept: "application/json", ...relayAuthHeaders() }, cache: "no-store", signal: ctl.signal });
    const j = await r.json().catch(() => null);
    return { status: r.status, ok: r.ok, json: j };
  } catch (e) {
    return { status: 0, ok: false, json: null, error: e?.name === "AbortError" ? "timeout" : "unreachable" };
  } finally { clearTimeout(t); }
}

/* One row per relay: ok, missing (deployed but a variable is absent),
   absent (no backend at all), or error (deployed but answered wrongly). */
export async function checkDeployment() {
  const rows = await Promise.all(RELAYS.map(async (r) => {
    const g = await getJSON(r.path);
    if (!g.ok || !g.json || !String(g.json.service || "").startsWith("unison")) {
      const absent = g.status === 404 || g.status === 0 || (g.ok && !g.json);
      return { ...r, state: absent ? "absent" : "error",
        detail: absent ? "No backend answered at " + r.path + "." : `The server answered ${g.status}.`,
        fix: absent ? "This copy of Unison has no server functions (the standalone file, or `npm run dev`). Deploy the project to Vercel to use them." : "Check the function logs in Vercel → your project → Logs." };
    }
    const read = r.read(g.json);
    return { ...r, state: read.ok ? "ok" : "missing", detail: read.detail,
      fix: read.ok ? "" : `Set ${r.vars.join(" and ")} in ${VERCEL}.` };
  }));

  /* "Set" is not "valid". Ask the server to use the AI key for something
     free, so a revoked or mistyped key shows up here instead of mid-draft. */
  const ai = rows.find((x) => x.id === "ai");
  if (ai?.state === "ok") {
    const m = await getJSON("/api/ai?models", 12000);
    if (m.json && m.json.ok === false && m.json.reason) {
      ai.state = /rejected|invalid/i.test(m.json.reason) ? "invalid" : ai.state;
      ai.detail = m.json.reason;
      if (ai.state === "invalid") ai.fix = `Replace GROQ_API_KEY with a working key from console.groq.com/keys in ${VERCEL}.`;
    } else if (m.json?.ok) {
      ai.detail = `GROQ_API_KEY works — ${m.json.models.length} models available.`;
      ai.verified = true;
    }
  }
  const deployed = rows.some((x) => x.state !== "absent");
  return { deployed, rows, checkedAt: new Date().toISOString() };
}
