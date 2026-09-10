import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/* Vite inlines every VITE_* variable into the bundle. That is the intended
   behaviour and it is fine for a build the marketing team runs locally, but
   it means a key in .env.local ends up readable inside any dist/ that gets
   deployed to a URL. Silence there is the dangerous part, so say it out loud
   on every build that does it. The artifact and e2e scripts blank these vars
   so a handover file can never carry a key at all. */
const warnOnInlinedKeys = (mode) => ({
  name: "unison-key-warning",
  apply: "build",
  buildStart() {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    const named = ["VITE_GROQ_API_KEY", "VITE_ANTHROPIC_API_KEY"].filter((k) => env[k]);
    if (!named.length) return;
    console.warn(
      `\n\x1b[33m▲ ${named.join(" and ")} will be inlined into dist/ and readable by anyone who opens the page.\x1b[0m\n` +
      `  Fine for a local build. Before deploying to a URL, either clear it —\n` +
      `      VITE_GROQ_API_KEY= npm run build\n` +
      `  and let each person add their own key under Settings → AI, or deploy api/ai.js\n` +
      `  with GROQ_API_KEY set server-side so the browser never sees it.\n`
    );
  },
});

// `vercel dev` serves /api alongside this; plain `vite` has no /api, in which
// case Unison falls back gracefully (AI fallbacks + direct publish attempt).
export default defineConfig(({ mode }) => ({
  plugins: [react(), warnOnInlinedKeys(mode)],
  build: { chunkSizeWarningLimit: 1600 },
}));
