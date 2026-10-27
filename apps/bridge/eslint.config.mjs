import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", ".wrangler/**"] },
  js.configs.recommended, ...tseslint.configs.recommended,
  { files: ["**/*.ts", "**/*.mjs"], languageOptions: { globals: { ...globals.node, ...globals.worker } },
    rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] } }
);
