import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listen } from "@mira/runtime";
import { buildApp } from "./app";

// Local runs read secrets from the repo's .env.local (gitignored). Variables already set win, and
// a deployed service has no such file.
const envFile = fileURLToPath(new URL("../../../.env.local", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const ctx = buildApp(undefined, {
  pump: true,
  ...(process.env.MIRA_DATA_DIR ? { dataDir: process.env.MIRA_DATA_DIR } : {}),
});
await listen(ctx);
