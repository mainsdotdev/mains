import path from "node:path";
import { defineConfig } from "vitest/config";

const contractsSource = path.resolve(import.meta.dirname, "../../packages/contracts/src");

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@mains\/contracts\/(.+)$/,
        replacement: `${contractsSource}/$1.ts`,
      },
    ],
    dedupe: [
      "@linear/sdk",
      "@octokit/rest",
      "better-sqlite3",
      "drizzle-orm",
      "nanoid",
      "node-pty",
      "simple-git",
      "ws",
      "zod",
    ],
  },
});
