import { Answer, METRIC_ID_PATTERN, type MetricStore } from "@mira/schemas";

/**
 * Checks on model text before anything is shown (docs/AGENT_RUNTIME.md §5, steps 1–2). The model
 * never types a number: a digit, or a number written out, is refused, and so is a placeholder it
 * did not list or that no metric backs.
 */
export interface Problem {
  code:
    | "not_json"
    | "schema"
    | "digit"
    | "number_word"
    | "placeholder_unlisted"
    | "placeholder_unknown"
    | "placeholder_malformed"
    | "stray_brace";
  detail: string;
}

/** Any Unicode number: ASCII digits, full-width digits, superscripts and vulgar fractions. */
const NUMERAL = /\p{N}/u;
/**
 * Numbers written out. "one" is allowed ("one reading"): it is not a quantity the model can
 * invent a measurement with, and refusing it would reject ordinary sentences.
 */
const NUMBER_WORDS =
  /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|percent|per\s+cent|half|dozen)\b/iu;

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** The placeholders in a text, in order. */
export function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? "");
}

export function checkText(text: string, refs: readonly string[], store: MetricStore): Problem[] {
  const problems: Problem[] = [];
  const bare = text.replace(PLACEHOLDER, " ");
  const numeral = NUMERAL.exec(bare);
  if (numeral) problems.push({ code: "digit", detail: `The text contains "${numeral[0]}".` });
  const word = NUMBER_WORDS.exec(bare);
  if (word) problems.push({ code: "number_word", detail: `The text writes out "${word[0]}".` });
  if (/[{}]/.test(bare)) problems.push({ code: "stray_brace", detail: "Unmatched brace." });
  for (const id of placeholders(text)) {
    if (!METRIC_ID_PATTERN.test(id)) {
      problems.push({ code: "placeholder_malformed", detail: `{${id}} is not a metric id.` });
    } else if (!refs.includes(id)) {
      problems.push({ code: "placeholder_unlisted", detail: `{${id}} is not in metric_refs.` });
    } else if (!(id in store)) {
      problems.push({ code: "placeholder_unknown", detail: `No metric ${id} is available.` });
    }
  }
  return problems;
}

/** Parses the model's output as an Answer, from an object or from JSON text. */
export function parseAnswer(
  raw: unknown,
): { ok: true; answer: Answer } | { ok: false; problem: Problem } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, problem: { code: "not_json", detail: "The reply was not JSON." } };
    }
  }
  const parsed = Answer.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      problem: {
        code: "schema",
        detail: `${first?.path.join(".") ?? "answer"}: ${first?.message ?? "invalid"}`,
      },
    };
  }
  return { ok: true, answer: parsed.data };
}

export function checkAnswer(answer: Answer, store: MetricStore): Problem[] {
  return answer.segments.flatMap((s) => checkText(s.text, s.metric_refs, store));
}
