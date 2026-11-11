import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "shared/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["test/global-setup.ts"],
    // Migrated SQLite backends and real encrypted transfers compete for CPU
    // and disk. Keep their deadlines meaningful under a full-suite run.
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      "@mains/contracts": path.resolve(import.meta.dirname, "../contracts/src"),
    },
  },
});
