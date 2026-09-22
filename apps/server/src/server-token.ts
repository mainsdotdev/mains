import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TOKEN_FILE_NAME = "server-token";
const MIN_OWNER_TOKEN_LENGTH = 32;
const MAX_OWNER_TOKEN_LENGTH = 256;
const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface StandaloneServerToken {
  token: string;
  path: string | null;
  created: boolean;
}

interface ResolveStandaloneServerTokenOptions {
  explicitToken?: string;
  rotate?: boolean;
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function validateStandaloneOwnerToken(
  value: string,
  source = "Owner token",
): string {
  if (!value.trim()) {
    throw new Error(`${source} must not be empty`);
  }
  if (value.length < MIN_OWNER_TOKEN_LENGTH) {
    throw new Error(
      `${source} must be at least ${MIN_OWNER_TOKEN_LENGTH} URL-safe characters`,
    );
  }
  if (!OWNER_TOKEN_PATTERN.test(value)) {
    throw new Error(`${source} must contain only URL-safe characters`);
  }
  if (value.length > MAX_OWNER_TOKEN_LENGTH) {
    throw new Error(
      `${source} must be at most ${MAX_OWNER_TOKEN_LENGTH} characters`,
    );
  }
  return value;
}

function readStoredTokenFile(tokenPath: string): string | null {
  try {
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    return token || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Read the persisted root token without creating one. */
export function readStandaloneServerToken(dataDir: string): string | null {
  return readStoredTokenFile(
    path.join(path.resolve(dataDir), TOKEN_FILE_NAME),
  );
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
 * Resolve the standalone server's full-access owner token.
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
    const token = validateStandaloneOwnerToken(
      options.explicitToken,
      "--token",
    );
    return {
      token,
      path: null,
      created: false,
    };
  }

  const resolvedDataDir = path.resolve(dataDir);
  fs.mkdirSync(resolvedDataDir, { recursive: true, mode: 0o700 });
  const tokenPath = path.join(resolvedDataDir, TOKEN_FILE_NAME);

  if (!options.rotate) {
    const storedToken = readStoredTokenFile(tokenPath);
    if (storedToken) {
      fs.chmodSync(tokenPath, 0o600);
      return { token: storedToken, path: tokenPath, created: false };
    }
  }

  const token = generateToken();
  replaceTokenFile(tokenPath, token);
  return { token, path: tokenPath, created: true };
}
