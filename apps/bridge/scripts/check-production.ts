import { readFile } from "node:fs/promises";
import { parseBridgeConfig, productionConfigErrors } from "./production-config";

const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith("--")) throw new Error("Usage: npm run production:check -- [wrangler.production.jsonc]");
const file = args[0] ?? "wrangler.production.jsonc";
try {
  const [production, staging] = await Promise.all([readFile(file, "utf8"), readFile("wrangler.staging.jsonc", "utf8")]);
  const errors = productionConfigErrors(parseBridgeConfig(production, file), parseBridgeConfig(staging, "wrangler.staging.jsonc"));
  if (errors.length) { for (const error of errors) console.error(`- ${error}`); process.exitCode = 1; }
  else console.log("Production configuration passed offline checks. Resource existence, DNS and deployed secrets still need verification during provisioning.");
} catch (error) {
  console.error(error instanceof Error && "code" in error && error.code === "ENOENT" ? "Copy wrangler.production.example.jsonc to wrangler.production.jsonc and fill its resource IDs and host first." : "Could not validate production configuration.");
  process.exitCode = 1;
}
