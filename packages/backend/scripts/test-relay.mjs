import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const backend = path.resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "mains-relay-test-"));
try {
  const binary = path.join(temporary, process.platform === "win32" ? "mains-relay.exe" : "mains-relay");
  const build = spawnSync(process.env.MAINS_GO ?? "go", ["build", "-o", binary, "./cmd/mains-relay"], {
    cwd: path.resolve(backend, "../../apps/relay"), stdio: "inherit",
  });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exitCode = build.status ?? 1;
  else {
    const tests = spawnSync(process.execPath, [path.join(backend, "node_modules/vitest/vitest.mjs"), "run", "integration/relay.test.ts"], {
      cwd: backend, stdio: "inherit", env: { ...process.env, MAINS_RELAY_BINARY: binary },
    });
    if (tests.error) throw tests.error;
    process.exitCode = tests.status ?? 1;
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
