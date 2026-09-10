import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* A single self-contained bundle for the hosted preview: no code splitting,
   so the whole app is one script that can be inlined into one HTML file. */
export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.UNISON_PREVIEW": "true" },
  build: {
    outDir: "dist-artifact",
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: "app.js", assetFileNames: "app.[ext]" } },
  },
});
