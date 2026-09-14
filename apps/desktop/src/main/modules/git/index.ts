// The git module is main-process-internal: no IPC surface, no preload
// namespace. Renderer-triggered git effects go through workspace/gitFlow
// operations. See CONTEXT.md "git module".
export { gitService } from "./git.service";
export type {
  GitStatusResponse,
  GitLogEntry,
  GitRemote,
  WorktreeImportResult,
  WorktreeImportOptions,
  DirectImportResult,
} from "./git.service";
export {
  hashContent,
  buildPerFileDiffHashes,
  parsePerFileDiffStats,
  type DiffSnapshot,
  type FileDiffStat,
} from "./git-snapshot";
