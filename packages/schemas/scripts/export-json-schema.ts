/**
 * Exports the shared Zod schemas as JSON Schema so the Python engines validate the same shapes
 * (docs/DATA_MODEL.md). Output: services/engines/mira_engines/schemas/<Name>.json.
 * Run with `pnpm --filter @mira/schemas export:json-schema`; `--check` fails if files are stale.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Audit, Lab, LedgerEntry, Metric, Plan, Quote, Run, RunEvent, RunNode } from "../src";

const EXPORTS: Record<string, z.ZodType> = {
  Audit,
  Lab,
  LedgerEntry,
  Metric,
  Plan,
  Quote,
  Run,
  RunEvent,
  RunNode,
};

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = join(root, "services/engines/mira_engines/schemas");
const check = process.argv.includes("--check");
const stale: string[] = [];

mkdirSync(outDir, { recursive: true });
for (const [name, schema] of Object.entries(EXPORTS)) {
  const json = `${JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2)}\n`;
  const path = join(outDir, `${name}.json`);
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== json) stale.push(name);
  } else {
    writeFileSync(path, json);
  }
}

if (stale.length > 0) {
  console.error(`JSON Schema out of date: ${stale.join(", ")}. Run export:json-schema.`);
  process.exit(1);
}
console.log(
  check ? "JSON Schema up to date." : `Wrote ${Object.keys(EXPORTS).length} schemas to ${outDir}`,
);
