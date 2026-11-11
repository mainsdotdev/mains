import { captureCheckoutRevision } from "../../runtime/git-operation-lifecycle";
type Capture = (current: () => boolean) => Promise<void>;
interface Job { revision: number; queued?: { capture: Capture; rootPath?: string }; pending?: Promise<void> }
const jobs = new Map<string, Job>();
const sources = new Set<() => void>();
const reads = new Set<Promise<unknown>>();
export function acceptWorkspaceDiffRead<T>(work: () => Promise<T>): Promise<T> {
  if (phase !== "open") return Promise.reject(new Error("Workspace diff captures are shutting down"));
  const pending = work().finally(() => reads.delete(pending));
  reads.add(pending); return pending;
}
let phase: "open" | "closing" | "closed" = "open", stopping: Promise<void> | undefined;
export function openWorkspaceDiffs(): void {
  if (phase === "open") return;
  if (phase !== "closed") throw new Error("Workspace diff captures are still shutting down");
  phase = "open"; stopping = undefined;
}
export function shutdownWorkspaceDiffs(): Promise<void> {
  if (stopping) return stopping;
  phase = "closing";
  for (const cancel of [...sources]) cancel();
  stopping = Promise.allSettled([...reads, ...[...jobs.values()].flatMap((job) => job.pending ? [job.pending] : [])]).then(() => { jobs.clear(); phase = "closed"; });
  return stopping;
}

/** One capture/publisher per workspace. A refresh during capture replaces the
 * next request; every waiter joins the final publication, never an old read. */
export function captureWorkspaceDiff(workspaceId: string, capture: Capture, rootPath?: string): Promise<void> {
  if (phase !== "open") return Promise.reject(new Error("Workspace diff captures are shutting down"));
  const job = jobs.get(workspaceId) ?? { revision: 0 };
  jobs.set(workspaceId, job); job.revision++; job.queued = { capture, rootPath };
  if (job.pending) return job.pending;
  const pending = Promise.resolve().then(async () => {
    try { while (job.queued) {
      const work = job.queued, revision = job.revision; job.queued = undefined;
      try {
        const checkoutCurrent = work.rootPath ? await captureCheckoutRevision(work.rootPath) : () => true;
        await work.capture(() => job.revision === revision && checkoutCurrent());
      }
      catch (error) { if (!job.queued) throw error; }
    } } finally { if (jobs.get(workspaceId) === job) jobs.delete(workspaceId); }
  });
  job.pending = pending;
  return pending;
}

/** Debounce belongs to a source, while capture/publication belongs to the
 * workspace. Canceling one run never cancels another source's refresh. */
export function createWorkspaceDiffScheduler(workspaceId: string, capture: Capture, delay = 300, rootPath?: string) {
  let timer: ReturnType<typeof setTimeout> | undefined, revision = 0, closed = false;
  const cancel = () => { closed = true; revision++; if (timer) clearTimeout(timer); timer = undefined; sources.delete(cancel); };
  sources.add(cancel);
  return {
    schedule() {
      if (closed || phase !== "open") return;
      if (timer) clearTimeout(timer);
      const accepted = revision;
      timer = setTimeout(() => {
        timer = undefined;
        void captureWorkspaceDiff(workspaceId, (current) => capture(() => accepted === revision && current()), rootPath)
          .catch((error) => console.error("[Workspace] Live diff capture failed:", error));
      }, delay);
    },
    cancel,
  };
}
