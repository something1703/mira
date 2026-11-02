/** One cheap task per feature against live YouCam, after a quote and a confirmation. Never in CI. */
import { smokeMain } from "../apps/workflows/src/tools/cli";

process.exitCode = await smokeMain(process.argv.slice(2));
