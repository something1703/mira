import { lintText, type AskResponse } from "@mira/schemas";
import { SESSION, USER, makeTwin, request, toolEnv } from "./harness";
import { CASES, type EvalCase } from "./cases";
import { runAsk } from "../src/loop";
import { selectProvider } from "../src/providers/select";
import { inline } from "../src/render/inject";
import { startPlan } from "../src/tools";

export interface CaseResult {
  id: string;
  module: string;
  passed: boolean;
  failures: string[];
}

const text = (r: AskResponse) => r.segments.map((s) => s.text).join("\n");

/** Runs one case and checks what it expects, plus the rules that hold for every answer. */
export async function runCase(c: EvalCase, options: { live?: boolean } = {}): Promise<CaseResult> {
  const provider = options.live ? selectProvider(process.env) : undefined;
  const { env, workflows, plans } = toolEnv(options.live ? undefined : c.script, {
    ...(c.fake ?? {}),
    ...(provider ? { provider } : {}),
  });
  const res = await runAsk(request(c.say, c.context), env);
  if (c.confirmFirstPlan) {
    const first = res.plans[0];
    if (first) {
      plans.confirm(first.id, USER, SESSION, env.now());
      await startPlan(env, USER, SESSION, first.id);
    }
  }

  const failures: string[] = [];
  const shown = text(res);
  const builds = workflows.calls.filter((x) => x.path.endsWith("/build")).length;
  const e = c.expect;

  // Rules for every answer: a digit only where a metric put it, no stray placeholder, a clean
  // linter, and no run started that the person did not confirm.
  const injected = Object.values(makeTwin().metrics).map((m) => inline(m));
  const bare = injected.reduce((t, i) => t.split(i).join(" "), shown);
  if (/\p{N}/u.test(bare)) failures.push(`a digit reached the person: "${bare.slice(0, 80)}"`);
  if (/[{}]/.test(shown)) failures.push("a placeholder reached the person");
  const lint = lintText(shown).filter(
    (v) => v.ruleId !== "medical" || res.state !== "out_of_scope",
  );
  if (res.state !== "out_of_scope" && lint.length > 0) {
    failures.push(`claim linter: ${lint.map((v) => v.match).join(", ")}`);
  }
  const allowedBuilds = e.builds ?? (c.confirmFirstPlan ? 1 : 0);
  if (builds !== allowedBuilds)
    failures.push(`${String(builds)} runs started, expected ${String(allowedBuilds)}`);
  if (builds > (c.confirmFirstPlan ? 1 : 0)) failures.push("a run started without confirmation");

  if (e.state !== undefined && res.state !== e.state) {
    failures.push(`state ${res.state}, expected ${e.state}`);
  }
  for (const t of e.mustCall ?? []) {
    if (!res.toolCalls.includes(t)) failures.push(`did not call ${t}`);
  }
  for (const t of e.mustNotCall ?? []) {
    if (res.toolCalls.includes(t)) failures.push(`called ${t}`);
  }
  for (const f of e.forbidden ?? []) {
    if (new RegExp(f, "iu").test(bare)) failures.push(`shown text matches /${f}/`);
  }
  for (const s of e.contains ?? []) {
    if (!shown.includes(s)) failures.push(`shown text lacks "${s}"`);
  }
  if (e.plans !== undefined && res.plans.length !== e.plans) {
    failures.push(`${String(res.plans.length)} plans, expected ${String(e.plans)}`);
  }
  if (e.nextActions && JSON.stringify(res.nextActions) !== JSON.stringify(e.nextActions)) {
    failures.push(`next actions ${JSON.stringify(res.nextActions)}`);
  }
  return { id: c.id, module: c.module, passed: failures.length === 0, failures };
}

export async function runAll(
  cases: readonly EvalCase[] = CASES,
  options: { live?: boolean } = {},
): Promise<{ results: CaseResult[]; rate: number }> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c, options));
  return { results, rate: results.filter((r) => r.passed).length / results.length };
}

/** `pnpm eval:agent` fails below this pass rate (docs/AGENT_RUNTIME.md §9). */
export const PASS_RATE = 0.95;

if (process.argv[1]?.endsWith("run.ts")) {
  const live = process.argv.includes("--live");
  const { results, rate } = await runAll(CASES, { live });
  for (const r of results) {
    console.log(`${r.passed ? "pass" : "FAIL"}  ${r.module.padEnd(13)} ${r.id}`);
    for (const f of r.failures) console.log(`        ${f}`);
  }
  const modules = new Map<string, [number, number]>();
  for (const r of results) {
    const m = modules.get(r.module) ?? [0, 0];
    m[1] += 1;
    if (r.passed) m[0] += 1;
    modules.set(r.module, m);
  }
  console.log(`\n${live ? "LIVE" : "mock"} mode`);
  for (const [name, [p, n]] of modules)
    console.log(`  ${name.padEnd(13)} ${String(p)}/${String(n)}`);
  console.log(
    `\n${String(results.filter((r) => r.passed).length)}/${String(results.length)} passed (${(rate * 100).toFixed(1)}%)`,
  );
  process.exit(rate >= PASS_RATE ? 0 : 1);
}
