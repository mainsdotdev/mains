import { readFile } from "node:fs/promises";
import { SignJWT } from "jose";
const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const accountId = arg("--account"), backendId = arg("--backend");
if (!accountId || !backendId || !/^[A-Za-z0-9_-]{1,128}$/.test(accountId) || !/^[A-Za-z0-9_-]{1,128}$/.test(backendId)) throw new Error("Use --account <id> --backend <id>");
const vars = await readFile(new URL("../.dev.vars", import.meta.url), "utf8");
const secret = /^BRIDGE_DEV_SECRET=(.+)$/m.exec(vars)?.[1];
if (!secret || secret.length < 32) throw new Error("Run npm run dev:setup first");
console.log(await new SignJWT({ accountId }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(backendId)
  .setIssuer("mains-bridge-dev").setAudience("mains-bridge").setIssuedAt().setExpirationTime("24h").sign(new TextEncoder().encode(secret)));
