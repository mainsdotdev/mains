import { builtinModules } from "node:module";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((id) => `node:${id}`),
]);
const contractsSource = path.resolve(import.meta.dirname, "../../packages/contracts/src");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mains\/contracts\/(.+)$/,
        replacement: `${contractsSource}/$1.ts`,
      },
    ],
  },
  build: {
    target: "node22",
    outDir: ".vite/server",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: "src/server-entry.ts",
      formats: ["cjs"],
      fileName: () => "server.cjs",
    },
    rollupOptions: {
      external(id) {
        if (id === "electron" || id.startsWith("electron/")) {
          throw new Error(
            "Standalone server boundary violated: a bundled module imports Electron",
          );
        }
        if (id === "@mains/contracts" || id.startsWith("@mains/contracts/")) {
          return false;
        }
        if (id === "@mains/backend" || id.startsWith("@mains/backend/")) {
          return false;
        }
        return builtins.has(id) || (!id.startsWith(".") && !path.isAbsolute(id));
      },
    },
  },
  plugins: [
    {
      name: "copy-server-migrations",
      closeBundle() {
        const source = path.resolve(
          import.meta.dirname,
          "../../packages/backend/src/db/migrations",
        );
        const destination = path.resolve(
          import.meta.dirname,
          ".vite/server/migrations",
        );
        if (!existsSync(source)) return;
        mkdirSync(destination, { recursive: true });
        cpSync(source, destination, { recursive: true });
      },
    },
  ],
});
