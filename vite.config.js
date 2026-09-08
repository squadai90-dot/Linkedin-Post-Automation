import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `vercel dev` serves /api alongside this; plain `vite` has no /api, in which
// case Unison falls back gracefully (AI fallbacks + direct publish attempt).
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1600 },
});
