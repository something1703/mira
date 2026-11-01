/** Records one real YouCam task into packages/fixtures (costs units; asks first). */
import { recordMain } from "../apps/workflows/src/tools/cli";

process.exitCode = await recordMain(process.argv.slice(2));
