import fs from "node:fs";
import path from "node:path";
import { generateToken } from "./ipc-kit/ws-auth";

const TOKEN_FILE_NAME = "server-token";

export interface StandaloneServerToken {
  token: string;
  path: string | null;
  created: boolean;
}

interface ResolveStandaloneServerTokenOptions {
  explicitToken?: string;
  rotate?: boolean;
}

function readStoredToken(tokenPath: string): string | null {
  try {
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    return token || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function replaceTokenFile(tokenPath: string, token: string): void {
  const temporaryPath = `${tokenPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${token}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, tokenPath);
    fs.chmodSync(tokenPath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

/**
 * Resolve the standalone server's pairing token.
 *
 * An explicit CLI/environment token is intentionally ephemeral. Otherwise the
 * generated token is stored beside the standalone database so saved Mains
 * Connect entries keep working across server restarts.
 */
export function resolveStandaloneServerToken(
  dataDir: string,
  options: ResolveStandaloneServerTokenOptions = {},
): StandaloneServerToken {
  if (options.explicitToken !== undefined) {
    if (options.rotate) {
      throw new Error("--rotate-token cannot be combined with --token");
    }
    if (!options.explicitToken.trim()) {
      throw new Error("--token must not be empty");
    }
    return {
      token: options.explicitToken,
      path: null,
      created: false,
    };
  }

  const resolvedDataDir = path.resolve(dataDir);
  fs.mkdirSync(resolvedDataDir, { recursive: true, mode: 0o700 });
  const tokenPath = path.join(resolvedDataDir, TOKEN_FILE_NAME);

  if (!options.rotate) {
    const storedToken = readStoredToken(tokenPath);
    if (storedToken) {
      fs.chmodSync(tokenPath, 0o600);
      return { token: storedToken, path: tokenPath, created: false };
    }
  }

  const token = generateToken();
  replaceTokenFile(tokenPath, token);
  return { token, path: tokenPath, created: true };
}
