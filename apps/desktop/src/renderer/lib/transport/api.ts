import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { getTransport } from "./registry";

/**
 * Imperative backend method calls routed through the active transport — the
 * request/response counterpart of {@link appEvents}. Drop-in for the matching
 * `window.api.<ns>.<method>` calls that are NOT already wrapped in RTK Query;
 * call sites change only `window.api` → `appApi`.
 *
 * RTK Query data calls already route through the transport (via `ipcBaseQuery`).
 * This covers the remaining direct, imperative calls so they too reach a remote
 * backend. Method signatures are derived from `window.api` via `typeof` (zero
 * duplication; compile-time only).
 *
 * Only backend operations live here. Local-shell calls stay on `window.api.*`
 * because they act on the user's local machine even when the backend is remote:
 * `shell.*` (open URLs/files locally), `platform.*`, `updates.*`, `app.*`, and
 * `workspace.selectDirectory` (native dialog).
 *
 * Caveat: the WebSocket transport serializes args as JSON, so `Date`/`Buffer`
 * args don't survive a remote hop the way Electron's structured clone preserves
 * them (e.g. `runs.getToolCalls`'s optional `Date`). Tracked for a follow-up
 * (JSON reviver / superjson). See docs/design/remote-backend.md.
 */

type AsyncFn = (...args: any[]) => Promise<unknown>;

function method<F extends AsyncFn>(channel: string): F {
  return ((...args: unknown[]) => getTransport().invoke(channel, args)) as F;
}

export const appApi = {
  account: {
    get: method<typeof window.api.account.get>(CHANNELS.account.get),
  },
  runs: {
    getById: method<typeof window.api.runs.getById>(CHANNELS.runs.getById),
    getByWorkspace: method<typeof window.api.runs.getByWorkspace>(
      CHANNELS.runs.getByWorkspace,
    ),
    getToolCalls: method<typeof window.api.runs.getToolCalls>(
      CHANNELS.runToolCalls.getByRun,
    ),
    getExecutionRoot: method<typeof window.api.runs.getExecutionRoot>(
      CHANNELS.runs.getExecutionRoot,
    ),
    execute: method<typeof window.api.runs.execute>(CHANNELS.runs.execute),
    continue: method<typeof window.api.runs.continue>(CHANNELS.runs.continue),
    canResume: method<typeof window.api.runs.canResume>(CHANNELS.runs.canResume),
    fork: method<typeof window.api.runs.fork>(CHANNELS.runs.fork),
    executeReview: method<typeof window.api.runs.executeReview>(
      CHANNELS.runs.executeReview,
    ),
    archive: method<typeof window.api.runs.archive>(CHANNELS.runs.archive),
    respondToolApproval: method<typeof window.api.runs.respondToolApproval>(
      CHANNELS.runs.toolApprovalResponse,
    ),
  },
  runArtifacts: {
    getByRun: method<typeof window.api.runArtifacts.getByRun>(
      CHANNELS.runArtifacts.getByRun,
    ),
  },
  runTurns: {
    getByRun: method<typeof window.api.runTurns.getByRun>(
      CHANNELS.runTurns.getByRun,
    ),
  },
  terminal: {
    create: method<typeof window.api.terminal.create>(CHANNELS.terminal.create),
    write: method<typeof window.api.terminal.write>(CHANNELS.terminal.write),
    resize: method<typeof window.api.terminal.resize>(CHANNELS.terminal.resize),
    destroy: method<typeof window.api.terminal.destroy>(
      CHANNELS.terminal.destroy,
    ),
  },
  fileExplorer: {
    readFile: method<typeof window.api.fileExplorer.readFile>(
      CHANNELS.fileExplorer.readFile,
    ),
    readFileText: method<typeof window.api.fileExplorer.readFileText>(
      CHANNELS.fileExplorer.readFileText,
    ),
    saveFileAs: method<typeof window.api.fileExplorer.saveFileAs>(
      CHANNELS.fileExplorer.saveFileAs,
    ),
    writeFileText: method<typeof window.api.fileExplorer.writeFileText>(
      CHANNELS.fileExplorer.writeFileText,
    ),
    listDir: method<typeof window.api.fileExplorer.listDir>(
      CHANNELS.fileExplorer.listDir,
    ),
    searchFiles: method<typeof window.api.fileExplorer.searchFiles>(
      CHANNELS.fileExplorer.searchFiles,
    ),
    getPathInfo: method<typeof window.api.fileExplorer.getPathInfo>(
      CHANNELS.fileExplorer.getPathInfo,
    ),
  },
  workspace: {
    getLatestDiff: method<typeof window.api.workspace.getLatestDiff>(
      CHANNELS.workspace.getLatestDiff,
    ),
    getLatestDiffSummary: method<
      typeof window.api.workspace.getLatestDiffSummary
    >(CHANNELS.workspace.getLatestDiffSummary),
    deleteLatestDiff: method<typeof window.api.workspace.deleteLatestDiff>(
      CHANNELS.workspace.deleteLatestDiff,
    ),
  },
};
