import tseslint from "typescript-eslint";

const files = ["GeneratedWidget.tsx", "GeneratedWidget.test.tsx"];

const config = [{
  files,
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  },
  rules: {
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "no-script-url": "error",
  },
}];

export default config;
