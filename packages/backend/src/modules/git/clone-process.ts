import { spawnNativeProcess, killNativeProcess } from "../../runtime/native-process";
import { WORKSPACE_CLONE_CANCELED } from "@mains/contracts/workspace-intake";

/** Clone owns its process group through actual close, including Git's remote
 * helpers. A forced-kill deadline escalates termination; it never releases the
 * directory while native work can still write there. */
export function runCloneProcess(url: string, staging: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error(WORKSPACE_CLONE_CANCELED));
  // Match simple-git's default environment guard: do not inherit ambient Git
  // config/command overrides. SSH_AUTH_SOCK and ordinary credentials stay usable.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("git_")));
  return new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawnNativeProcess>;
    try { child = spawnNativeProcess("git", ["-c", "core.quotePath=false", "clone", "--", url, staging], {
      env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    }); } catch (error) { reject(error); return; }
    let error: Error | undefined, stderr = "", closed = false;
    let forced: ReturnType<typeof setTimeout> | undefined;
    const kill = (termination: NodeJS.Signals) => {
      if (closed) return;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, termination);
        else killNativeProcess(child, termination);
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== "ESRCH") error ??= failure instanceof Error ? failure : new Error(String(failure));
      }
    };
    const stop = () => {
      if (closed) return;
      kill("SIGTERM");
      if (!forced) { forced = setTimeout(() => kill("SIGKILL"), 2000); forced.unref(); }
    };
    const failed = (failure: Error) => { if (closed) return; error ??= failure; stop(); };
    child.on("error", failed);
    child.stdout?.on("error", failed);
    child.stderr?.on("error", failed);
    child.stdout?.resume();
    child.stderr?.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-8192); });
    child.once("spawn", () => { if (signal?.aborted) stop(); });
    child.once("close", (code) => {
      if (closed) return; closed = true;
      clearTimeout(forced); signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(new Error(WORKSPACE_CLONE_CANCELED));
      else if (error || code !== 0) reject(error ?? new Error(stderr.trim() || `Git clone failed (exit ${code})`));
      else resolve();
    });
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
  });
}
