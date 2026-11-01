// Shared ESLint flat config. apps/web extends this with the Next.js rules.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/** AGENTS.md §2.1: only packages/youcam-client may know YouCam's hosts. */
const youcamHostRule = {
  selector: "Literal[value=/makeupar\\.com|perfectcorp\\.com/]",
  message: "YouCam hosts live only in packages/youcam-client (AGENTS.md §2.1).",
};

/** AGENTS.md §8: components use tokens, never raw hex. */
const rawHexRule = {
  selector: "Literal[value=/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\\b/]",
  message: "Use a token from packages/ui/tokens instead of a raw hex colour (AGENTS.md §8).",
};

export const miraRules = { youcamHostRule, rawHexRule };

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.mira/**",
      "**/src/generated/**",
      "services/engines/**",
      "infra/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-syntax": ["error", youcamHostRule],
    },
  },
  {
    files: ["packages/youcam-client/**"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["packages/ui/src/**/*.{ts,tsx}", "apps/web/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", youcamHostRule, rawHexRule] },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/tests/**", "**/e2e/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
);
