/**
 * Claim linter (docs/COPY.md §3). Runs in CI over UI copy, the README and the Devpost description,
 * and at runtime over every agent answer. Matching is case-insensitive on word stems.
 *
 * Each rule lists the word forms it bans instead of a bare prefix, so that "health", "secure" or
 * "lighting conditions" do not trip "heal", "cure" or "condition". Context-dependent terms
 * ("condition when describing skin") are matched only in that context.
 */

export type ClaimCategory = "medical" | "judging" | "certainty";

export interface ClaimRule {
  readonly id: string;
  readonly category: ClaimCategory;
  readonly pattern: RegExp;
}

export interface ClaimViolation {
  readonly ruleId: string;
  readonly category: ClaimCategory;
  readonly match: string;
  readonly index: number;
  readonly line: number;
  readonly column: number;
}

/** The one sentence allowed to name what MIRA does not do (docs/COPY.md §3, scope exceptions). */
export const DISCLAIMER =
  "MIRA is a cosmetic and appearance tool. It does not diagnose, treat or give medical advice.";

const rule = (id: string, category: ClaimCategory, source: string): ClaimRule => ({
  id,
  category,
  pattern: new RegExp(source, "giu"),
});

export const CLAIM_RULES: readonly ClaimRule[] = [
  // Medical and treatment
  rule("diagnose", "medical", String.raw`\bdiagnos(?:e|es|ed|ing|is|tic|tics)\b`),
  rule("treat", "medical", String.raw`\btreat(?:s|ed|ing|ments?|able)?\b`),
  rule("cure", "medical", String.raw`\bcur(?:e|es|ed|ing|ative)\b`),
  rule("heal", "medical", String.raw`\bheal(?:s|ed|ing|ers?)?\b`),
  rule("therapy", "medical", String.raw`\btherap(?:y|ies|ist|ists|eutic|eutically)\b`),
  rule("prescribe", "medical", String.raw`\bprescri(?:be|bes|bed|bing|ption|ptions)\b`),
  rule("medical", "medical", String.raw`\bmedic(?:al|ally|ine|ines|inal|ated|ation|ations)\b`),
  rule("clinical", "medical", String.raw`\bclinical(?:ly)?\b`),
  rule(
    "dermatologist-approved",
    "medical",
    String.raw`\bdermatologist[-\s]+(?:approved|tested|recommended)\b`,
  ),
  rule("disease", "medical", String.raw`\bdiseases?\b`),
  rule("disorder", "medical", String.raw`\bdisorders?\b`),
  rule(
    "condition",
    "medical",
    String.raw`\b(?:skin|facial|face)\s+conditions?\b|\bconditions?\s+(?:of|on)\s+(?:your|the|my|their)\s+(?:skin|face)\b|\b(?:your|my|their)\s+(?:skin\s+)?condition\b`,
  ),
  rule("infection", "medical", String.raw`\binfect(?:ion|ions|ed|ious)\b`),
  rule("inflammation", "medical", String.raw`\binflam(?:mation|mations|ed|matory)\b`),
  rule("eczema", "medical", String.raw`\beczema\b`),
  rule("rosacea", "medical", String.raw`\brosacea\b`),
  rule("psoriasis", "medical", String.raw`\bpsoriasis\b`),
  rule("melasma", "medical", String.raw`\bmelasma\b`),
  rule("dermatitis", "medical", String.raw`\bdermatitis\b`),
  rule("lesion", "medical", String.raw`\blesions?\b`),
  rule("symptom", "medical", String.raw`\bsymptom(?:s|atic)?\b`),

  // Judging bodies
  rule("flaw", "judging", String.raw`\bflaw(?:s|ed|less|lessly)?\b`),
  rule("imperfection", "judging", String.raw`\bimperfect(?:ion|ions)?\b`),
  rule("problem-area", "judging", String.raw`\bproblem\s+areas?\b`),
  rule(
    "fix-your",
    "judging",
    String.raw`\b(?:fix|fixes|fixing|correct|corrects|correcting)\s+your\b`,
  ),
  rule("anti-ageing", "judging", String.raw`\banti[-\s]?ag(?:e)?ing\b`),
  rule("perfect-skin", "judging", String.raw`\bperfect\s+skin\b`),
  rule("ugly", "judging", String.raw`\bugl(?:y|ier|iest|iness)\b`),
  rule("bad-skin", "judging", String.raw`\bbad\s+skin\b`),
  rule("good-skin", "judging", String.raw`\bgood\s+skin\b`),
  rule("better-looking", "judging", String.raw`\bbetter[-\s]looking\b`),
  rule("attractive", "judging", String.raw`\b(?:un)?attractive(?:ness)?\b`),

  // False certainty
  rule("guaranteed", "certainty", String.raw`\bguarantee(?:s|d|ing)?\b`),
  rule("100-percent", "certainty", String.raw`(?<![\d.])100\s?%`),
  rule("proven-to", "certainty", String.raw`\bproven\s+to\b`),
  rule("always-works", "certainty", String.raw`\balways\s+works?\b`),
  rule("scientifically-proven", "certainty", String.raw`\bscientifically\s+proven\b`),
];

function position(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: index - lastBreak };
}

/** Blanks out allowlisted sentences while keeping offsets, so reported positions stay true. */
function maskAllowlisted(text: string): string {
  return text.split(DISCLAIMER).join(" ".repeat(DISCLAIMER.length));
}

export function lintText(text: string): ClaimViolation[] {
  const masked = maskAllowlisted(text);
  const violations: ClaimViolation[] = [];
  for (const r of CLAIM_RULES) {
    r.pattern.lastIndex = 0;
    for (const m of masked.matchAll(r.pattern)) {
      violations.push({
        ruleId: r.id,
        category: r.category,
        match: m[0],
        index: m.index,
        ...position(text, m.index),
      });
    }
  }
  return violations.sort((a, b) => a.index - b.index);
}

export function isClean(text: string): boolean {
  return lintText(text).length === 0;
}

/**
 * Files exempt from the banned-stem check (docs/COPY.md §3): prompts and refusal templates must
 * name what to refuse; they are reviewed by hand and covered by the agent evals.
 */
export const CLAIM_LINT_EXEMPT = [
  /(^|\/)apps\/agent\/src\/prompts\//,
  /(^|\/)apps\/agent\/src\/fallbacks\.ts$/,
  /(^|\/)packages\/schemas\/src\/claim-linter\.ts$/,
  /\.test\.tsx?$/,
  /(^|\/)(tests|e2e|evals)\//,
] as const;

export function isExempt(path: string): boolean {
  const normalised = path.replaceAll("\\", "/");
  return CLAIM_LINT_EXEMPT.some((re) => re.test(normalised));
}
