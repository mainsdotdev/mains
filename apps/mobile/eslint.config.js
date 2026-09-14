// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(?:^|/)components/ui/.+",
              message: "Import shared UI from @/components/ui instead of a deep path.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(?:^|/)components/ui/.+",
              message: "Import shared UI from @/components/ui instead of a deep path.",
            },
            {
              regex: "(?:^|/)(?:features|backend|db)/",
              message: "Shared UI cannot depend on an application feature, backend, or database module.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(?:^|/)(?:components|features)/",
              message: "Shared lib modules cannot depend on UI or application features.",
            },
          ],
        },
      ],
    },
  },
]);
