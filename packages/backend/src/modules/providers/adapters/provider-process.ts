import crossSpawn from "cross-spawn";
import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

/** Native executables stay direct; Windows npm .cmd shims receive escaped argv. */
export function spawnProvider(command: string, args: string[], options: SpawnOptions): ChildProcess {
  const env = { ...(options.env ?? process.env) };
  if (process.platform === "win32") {
    const pathValue = env.PATH ?? Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1];
    for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
    if (pathValue !== undefined) env.PATH = pathValue;
  }
  const spawnOptions = { ...options, timeout: undefined, env, windowsHide: true };
  const child = process.platform === "win32" ? crossSpawn(command, args, spawnOptions) : spawn(command, args, spawnOptions);
  if (options.timeout && options.timeout > 0) {
    const timer = setTimeout(() => killProviderProcess(child, options.killSignal ?? "SIGTERM"), options.timeout);
    timer.unref();
    child.once("close", () => clearTimeout(timer));
    child.once("error", () => clearTimeout(timer));
  }
  return child;
}

/** Kill the wrapper and its agent children together on Windows. */
export function killProviderProcess(child: ChildProcess, signal: NodeJS.Signals | number = "SIGKILL"): void {
  if (process.platform === "win32" && child.pid && child.exitCode === null) {
    execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => {
      if (error && child.exitCode === null) child.kill(signal);
    });
    return;
  }
  child.kill(signal);
}
