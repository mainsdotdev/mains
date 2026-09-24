import type { PeerWrites, TreeDiffFile } from "../git";
import type { TurnFileChange } from "./runs.dto";

/** What one turn's own tool calls wrote, gathered by its session. */
export interface TurnWrites {
  paths: Set<string>;
  /** The turn ran something that writes files without naming them. */
  unnamed: boolean;
}

/**
 * Which of a turn's changed files are its own when someone else wrote to the
 * worktree during it — a parallel run, or the app itself (a pull, a branch
 * switch, an editor save): those its tools named, and those nobody named if it
 * ran a shell — never one only someone else named. A kept file someone else
 * may have written too is marked `shared`: its hunks can't be told apart, so
 * the turn can't be undone. See CONTEXT.md "turn changes".
 */
export function attributeTurnFiles(
  files: TreeDiffFile[],
  own: TurnWrites,
  peers: PeerWrites,
): TurnFileChange[] {
  const kept: TurnFileChange[] = [];
  for (const file of files) {
    const paths = file.oldPath ? [file.path, file.oldPath] : [file.path];
    const ownNamed = paths.some((p) => own.paths.has(p));
    const peerNamed = paths.some((p) => peers.paths.has(p));
    if (ownNamed) {
      kept.push(peerNamed ? { ...file, shared: true } : file);
    } else if (!peerNamed && own.unnamed) {
      kept.push(peers.unnamed ? { ...file, shared: true } : file);
    }
  }
  return kept;
}
