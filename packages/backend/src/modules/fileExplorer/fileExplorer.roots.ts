import { promises as fs } from "fs";
import * as path from "path";

import { projectsService } from "../projects";
import { managedExecutionRoots } from "../runs";
import { workspaceService } from "../workspace";

// ─────────────────────────────────────────────────────────────
// Content roots
//
// The directories whose files the renderer may read and write.
//
// The renderer renders markdown from sources nobody here controls — synced
// issue bodies, agent and subagent reports — and a link in that markdown can
// resolve to a file the user then opens with one click. Without a boundary,
// such a link reads any file the user can read, and the editor tab's auto-save
// makes it a write path too. The boundary therefore lives in main, where
// renderer code cannot opt out of it, and admits exactly what the file
// explorer exists to serve: every workspace root, plus the project roots and
// worktree parents those workspaces hang off. Archived rows count — Settings ›
// Archive still browses them.
//
// Plus the run directories mains manages itself (`managedExecutionRoots`).
// Work and Chat runs have no workspace, so their deliverables land under
// userData — app-owned directories the user is meant to open files from,
// which is exactly what this boundary exists to admit.
// ─────────────────────────────────────────────────────────────

/** Whether `child` is `parent` itself or sits somewhere beneath it. */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function listContentRoots(): Promise<string[]> {
  const [workspaces, projects] = await Promise.all([
    workspaceService.list(true),
    projectsService.list(true),
  ]);

  const roots = new Set<string>(managedExecutionRoots());
  for (const workspace of workspaces) {
    if (workspace.rootPath) roots.add(workspace.rootPath);
  }
  for (const project of projects) {
    if (project.rootPath) roots.add(project.rootPath);
    if (project.workspacesPath) roots.add(project.workspacesPath);
  }
  return [...roots];
}

/**
 * Reject a path that lies outside every content root.
 *
 * Callers pass an already symlink-resolved path, so a link pointing out of a
 * workspace is judged by where it lands rather than where it sits. Roots are
 * matched resolved-first and only then through `realpath`: a root can itself
 * live behind a link (`/tmp`, `/var` on macOS), and skipping that pass would
 * make every file under it look foreign. The `realpath` pass is the expensive
 * one, hence second.
 */
export async function assertWithinContentRoots(realPath: string): Promise<void> {
  const roots = await listContentRoots();

  for (const root of roots) {
    if (isWithin(path.resolve(root), realPath)) return;
  }

  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = await fs.realpath(root);
    } catch {
      // A root whose directory is gone can't contain anything — skip it.
      continue;
    }
    if (isWithin(realRoot, realPath)) return;
  }

  throw new Error("Path is outside your workspaces");
}
