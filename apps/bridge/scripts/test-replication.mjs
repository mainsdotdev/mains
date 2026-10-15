import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const backend = fileURLToPath(new URL("../../../packages/backend/", import.meta.url));
const vitest = fileURLToPath(new URL("../../../packages/backend/node_modules/vitest/vitest.mjs", import.meta.url));
const child = spawn(process.execPath, [vitest, "run", "src/modules/bridge/bridge.replication.test.ts", "src/modules/bridge/bridge.network.test.ts", "src/modules/bridge/bridge.replicator.test.ts", "src/modules/bridge/bridge.blobs.test.ts", "--testTimeout=15000", "--hookTimeout=30000", "--maxWorkers=1"], {
  cwd: backend, env: { ...process.env, MAINS_BRIDGE_TEST_TRANSPORT: "ws" }, stdio: "inherit",
});
child.once("exit", (code) => { process.exitCode = code ?? 1; });
child.once("error", (error) => { console.error(error); process.exitCode = 1; });
