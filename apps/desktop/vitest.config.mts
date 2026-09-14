// Vitest configuration for the Tests
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/global-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/main/**"],
      exclude: [
        "src/main/**/*.ipc.ts",
        "src/main/**/*.dto.ts",
        "src/main/index.ts",
        "src/main/db/migrations/**",
        "src/main/db/client.ts",
        "src/main/windows/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/renderer"),
    },
  },
});
