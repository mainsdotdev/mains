import type { ReactNode } from "react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import type { WorkerPoolOptions, WorkerInitializationRenderOptions } from "@pierre/diffs/worker";
import DiffWorker from "@pierre/diffs/worker/worker.js?worker";

const poolOptions: WorkerPoolOptions = {
  workerFactory: () => new DiffWorker(),
  poolSize: 2,
  // Bound retained ASTs instead of keeping every file from a large review.
  totalASTLRUCacheSize: 20,
};
const highlighterOptions: WorkerInitializationRenderOptions = {
  theme: { dark: "pierre-dark", light: "pierre-light" },
  langs: ["text"],
};

/** Workers are shared by Review files and released when the last Review closes. */
export function ReviewDiffProvider({ children }: { children: ReactNode }) {
  return <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
    {children}
  </WorkerPoolContextProvider>;
}
