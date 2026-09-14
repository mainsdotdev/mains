import * as pty from "node-pty";
import { existsSync } from "fs";
import os from "os";
import path from "path";

type DataCallback = (id: string, data: string) => void;

interface PtyInstance {
  process: pty.IPty;
  onDataDispose: { dispose(): void };
}

const instances = new Map<string, PtyInstance>();

const SENSITIVE_ENV_PREFIXES = [
  "APPLE_", "GITHUB_TOKEN", "GITHUB_CLIENT_SECRET",
  "RESEND_", "NOTION_", "TADDY_", "RAINDROP_",
  "LINEAR_", "JIRA_", "ASANA_",
];

function getSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_PREFIXES.some((p) => key.startsWith(p))) continue;
    env[key] = value;
  }
  return env;
}

export const terminalService = {
  create(id: string, cwd: string | undefined, onData: DataCallback): void {
    // Kill existing instance if present
    this.destroy(id);

    // Provider login terminals are workspace-less. Resolve their cwd on the
    // backend, not in the renderer, so remote backends use their own home.
    const resolved = path.resolve(cwd || os.homedir());
    if (!existsSync(resolved)) {
      throw new Error(`Terminal cwd does not exist: ${resolved}`);
    }

    const shell = process.platform === "win32" ? "powershell.exe" : "zsh";
    const proc = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: resolved,
      env: getSafeEnv(),
    });

    const onDataDispose = proc.onData((data) => {
      onData(id, data);
    });

    instances.set(id, { process: proc, onDataDispose });
  },

  write(id: string, data: string): void {
    const instance = instances.get(id);
    if (instance) {
      instance.process.write(data);
    }
  },

  resize(id: string, cols: number, rows: number): void {
    const instance = instances.get(id);
    if (instance) {
      instance.process.resize(cols, rows);
    }
  },

  destroy(id: string): void {
    const instance = instances.get(id);
    if (instance) {
      instance.onDataDispose.dispose();
      instance.process.kill();
      instances.delete(id);
    }
  },

  destroyAll(): void {
    for (const id of instances.keys()) {
      this.destroy(id);
    }
  },
};
