import nextVitals from "eslint-config-next/core-web-vitals";
import root from "../../eslint.config.js";

// Next's rules first; the shared config after them so its TypeScript parser and rules win.
const config = [
  ...nextVitals,
  ...root,
  {
    ignores: [
      ".next/**",
      ".next-e2e/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];

export default config;
