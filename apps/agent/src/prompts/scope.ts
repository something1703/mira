/**
 * What MIRA does not answer (docs/AGENT_RUNTIME.md §6.6). The model is told this in the system
 * prompt, and these patterns catch the same questions before a model is called, so a refusal does
 * not depend on the model behaving. This file names the banned subjects on purpose, so it lives
 * under prompts/ and is reviewed by hand (docs/COPY.md §3).
 */
export type OutOfScope = "medical" | "identity" | "body";

const RULES: readonly { kind: OutOfScope; pattern: RegExp }[] = [
  {
    kind: "medical",
    pattern:
      /\b(?:diagnos\w*|medical\w*|medicat\w*|prescri\w*|diseases?|cancer\w*|melanoma|moles?|eczema|rosacea|psoriasis|dermatitis|infect\w*|rash(?:es)?|symptoms?|treat(?:s|ed|ing|ments?)?|cures?|cured|heal(?:s|ed|ing)?|doctors?|dermatologists?|allerg\w*|sunburn\w*|skin conditions?|is this normal|is it safe)\b/i,
  },
  {
    kind: "identity",
    pattern:
      /\b(?:ethnic\w*|race|racial|nationality|religion|caste|where am i from|where are my (?:parents|ancestors)|what am i mixed|am i (?:asian|black|white|indian|african|european))\b/i,
  },
  {
    kind: "body",
    pattern:
      /\b(?:my weight|body shape|body type|bmi|overweight|underweight|obese|skinny|chubby|am i (?:fat|ugly|pretty|attractive|beautiful|handsome)|how (?:fat|ugly|attractive) am i|lose weight|too (?:fat|big|thin))\b/i,
  },
];

export function classifyScope(message: string): OutOfScope | undefined {
  return RULES.find((r) => r.pattern.test(message))?.kind;
}
