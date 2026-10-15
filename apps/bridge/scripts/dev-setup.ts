import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
// Exclusive creation keeps re-running setup from invalidating already-issued dev tokens.
await writeFile(new URL("../.dev.vars", import.meta.url), `BRIDGE_DEV_AUTH=true\nBRIDGE_DEV_SECRET=${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
console.log("Created local .dev.vars. Run npm run dev, then npm run dev:token -- --account demo --backend A.");
