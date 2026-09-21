import fs from "node:fs";
import path from "node:path";

const STATE_FILE_NAME = "server-state.json";

export interface StandaloneServerState {
  schemaVersion: 1;
  pid: number;
  host: string;
  port: number;
  controlUrl: string;
  endpoints: string[];
  appVersion: string;
  startedAt: string;
}

export function serverStatePath(dataDir: string): string {
  return path.join(path.resolve(dataDir), STATE_FILE_NAME);
}

export function readServerState(dataDir: string): StandaloneServerState | null {
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(serverStatePath(dataDir), "utf8"),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const state = parsed as Partial<StandaloneServerState>;
    if (
      state.schemaVersion !== 1 ||
      typeof state.pid !== "number" ||
      typeof state.host !== "string" ||
      typeof state.port !== "number" ||
      typeof state.controlUrl !== "string" ||
      !Array.isArray(state.endpoints) ||
      !state.endpoints.every((value) => typeof value === "string") ||
      typeof state.appVersion !== "string" ||
      typeof state.startedAt !== "string"
    ) {
      return null;
    }
    return state as StandaloneServerState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export function writeServerState(
  dataDir: string,
  state: StandaloneServerState,
): string {
  const statePath = serverStatePath(dataDir);
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, statePath);
    fs.chmodSync(statePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return statePath;
}

export function clearServerState(dataDir: string, pid = process.pid): void {
  const state = readServerState(dataDir);
  if (state?.pid !== pid) return;
  fs.rmSync(serverStatePath(dataDir), { force: true });
}
