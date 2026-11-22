import { existsSync } from "node:fs";

const entry = new URL("../admin/local.ts", import.meta.url);
if (existsSync(entry)) {
  await import(entry.href);
} else {
  console.error("Bridge Admin is missing. Add the local dashboard under apps/bridge/admin/.");
  process.exitCode = 1;
}
