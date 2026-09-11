/* Bundles the backend into one CommonJS file: dist-server/server.cjs.
   pg stays external (plain JS dep resolved from node_modules at runtime). */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "server/src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(root, "dist-server/server.cjs"),
  external: ["pg-native"],
  logLevel: "warning",
});
console.log("built dist-server/server.cjs");
