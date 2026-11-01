/**
 * Bundles a Node service (run from its package directory) into dist/main.js with esbuild, so the
 * Cloud Run image ships one file plus the few dependencies that cannot be bundled.
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { name: string };

await build({
  entryPoints: [join(cwd, "src/main.ts")],
  outfile: join(cwd, "dist/main.js"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  legalComments: "none",
  // Google Cloud clients load protos from disk at runtime; they stay as node_modules.
  external: ["@google-cloud/*", "google-gax", "@grpc/*"],
  banner: {
    // ESM bundles of CommonJS dependencies still call require().
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});

console.log(`Built ${pkg.name} → dist/main.js`);
