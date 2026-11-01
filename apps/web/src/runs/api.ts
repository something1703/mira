import { LedgerEntry, Run, RunNode } from "@mira/schemas";
import { z } from "zod";

export const RunView = z.object({
  run: Run,
  nodes: z.array(RunNode),
  ledger: z.array(LedgerEntry),
  /** True when YouCam is the synthetic double: nothing in the run is a real measurement. */
  synthetic: z.boolean(),
});
export type RunView = z.infer<typeof RunView>;

export const agentUrl = (): string => process.env.MIRA_AGENT_URL ?? "http://localhost:4010";
export const workflowsUrl = (): string => process.env.MIRA_WORKFLOWS_URL ?? "http://localhost:4020";
