import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default [
  { ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { "react-hooks": reactHooks, react },
    settings: { react: { version: "18.3" } },
    rules: {
      "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "react-hooks/rules-of-hooks": "error",
      "react/jsx-uses-vars": "error",
      "react/jsx-key": "warn",
      "react/jsx-no-undef": "error",
    },
  },
  {
    files: ["api/**/*.js", "*.config.js", "scripts/**/*.{js,mjs}"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node, ...globals.es2021 } },
    rules: { "no-unused-vars": ["warn", { args: "none" }], "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    /* Unit tests run in jsdom, so browser globals are legitimately available. */
    files: ["tests/**/*.{js,jsx,mjs}"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node, ...globals.browser, ...globals.es2021 } },
    rules: { "no-unused-vars": ["warn", { args: "none" }], "no-empty": ["error", { allowEmptyCatch: true }] },
  },
  {
    /* Playwright specs run in Node but evaluate snippets in the page, so they
       legitimately reference browser globals inside page.evaluate(). */
    files: ["e2e/**/*.{js,mjs}"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node, ...globals.browser, ...globals.es2021 } },
    rules: { "no-unused-vars": ["warn", { args: "none" }] },
  },
];
