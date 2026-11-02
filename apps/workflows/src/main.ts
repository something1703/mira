import { listen } from "@mira/runtime";
import { buildApp } from "./app";

const ctx = buildApp(undefined, {
  pump: true,
  ...(process.env.MIRA_DATA_DIR ? { dataDir: process.env.MIRA_DATA_DIR } : {}),
});
await listen(ctx);
