import { cloneRepositoryName, WORKSPACE_CLONE_CANCELED, type WorkspaceIntakePayload, type CancelWorkspaceClonePayload } from "@mains/contracts/workspace-intake";
import { extractErrorMessage } from "./extract-error-message";
import { getTransport, type Transport } from "./transport";
import type { Workspace } from "./redux/api/workspaceApi";

export interface PendingWorkspaceClone {
  id: string; accountId: string; backendId: string; name: string; url: string; targetPath: string;
  status: "cloning" | "canceling" | "completing" | "failed"; error: string | null;
}
interface View { accountId: string; backendId: string; transport: Transport }
interface Attempt { id: string; view: View }
interface CloneOwner { row: PendingWorkspaceClone; attempt?: Attempt; completed?: string }
interface Snapshot { view: View | null; rows: PendingWorkspaceClone[]; folder: View | null; init: View | null }

/** Sidebar projection: cloning -> canceling -> canceled/complete or failed ->
 * explicit retry. Each retry has a fresh native identity. Rows belong to an
 * account/backend; effects and Open actions belong to one immutable view lease.
 * Only the intake reply settles a row; a cancellation ACK never removes it. */
export function createWorkspaceIntakeController(options: {
  create(payload: WorkspaceIntakePayload): Promise<Workspace>;
  cancel(payload: CancelWorkspaceClonePayload): Promise<boolean>;
  selectDirectory(): Promise<string | null>;
  openWorkspace(id: string): void;
  succeeded(message: string, open: () => void): void;
  failed(message: string): void;
}) {
  const jobs = new Map<string, CloneOwner>();
  const foreground = new Map<"folder" | "init", { view: View }>();
  const listeners = new Set<() => void>();
  let scope: View | null = null;
  let live = false;
  let snapshot: Snapshot = { view: null, rows: [], folder: null, init: null };
  const current = (view: View | null): view is View => !!view && live && scope === view && getTransport() === view.transport;
  const changed = () => {
    if (!live) return;
    snapshot = { view: scope, rows: [...jobs.values()].map((owner) => owner.row),
      folder: foreground.get("folder")?.view ?? null, init: foreground.get("init")?.view ?? null };
    for (const listener of listeners) listener();
  };
  const visible = (view: View, owner: CloneOwner) => owner.row.accountId === view.accountId && owner.row.backendId === view.backendId;
  const runClone = async (view: View, owner: CloneOwner) => {
    if (!current(view) || (owner.attempt && owner.row.status !== "failed")) return;
    const attempt: Attempt = { id: crypto.randomUUID(), view };
    owner.attempt = attempt; owner.row = { ...owner.row, status: "cloning", error: null };
    jobs.set(owner.row.id, owner); changed();
    const owns = () => live && jobs.get(owner.row.id) === owner && owner.attempt === attempt;
    try {
      const workspace = await options.create({ accountId: owner.row.accountId, source: {
        kind: "clone", url: owner.row.url, targetPath: owner.row.targetPath, cloneId: owner.row.id, attemptId: attempt.id,
      } });
      if (!owns()) return;
      // Keep the projection until the subscribed workspace list acknowledges
      // it; RTK's cache write can precede React's batched list notification.
      if (current(attempt.view)) { owner.completed = workspace.id; owner.row = { ...owner.row, status: "completing" }; }
      else jobs.delete(owner.row.id);
      changed();
      if (current(attempt.view)) options.succeeded(`${owner.row.name} cloned and workspace created`, () => { if (current(attempt.view)) options.openWorkspace(workspace.id); });
    } catch (error) {
      if (!owns()) return;
      const message = extractErrorMessage(error, "Failed to clone repository");
      if (message === WORKSPACE_CLONE_CANCELED) jobs.delete(owner.row.id);
      else {
        owner.row = { ...owner.row, status: "failed", error: message };
        if (current(attempt.view)) options.failed(message);
      }
      changed();
    }
  };
  const clone = (view: View, url: string, targetPath: string) => {
    if (!current(view)) return;
    url = url.trim(); targetPath = targetPath.trim();
    if (!url || !targetPath) return;
    const existing = [...jobs.values()].find((owner) => visible(view, owner) && owner.row.url === url && owner.row.targetPath === targetPath);
    const owner = existing ?? { row: { id: crypto.randomUUID(), accountId: view.accountId, backendId: view.backendId, url, targetPath,
      name: cloneRepositoryName(url), status: "cloning" as const, error: null } };
    void runClone(view, owner);
  };
  const cancelClone = async (view: View, id: string) => {
    const owner = jobs.get(id), attempt = owner?.attempt;
    if (!current(view) || !owner || !visible(view, owner) || !attempt || owner.completed || owner.row.status !== "cloning") return;
    owner.row = { ...owner.row, status: "canceling" }; changed();
    const owns = () => live && jobs.get(id) === owner && owner.attempt === attempt && owner.row.status === "canceling";
    try {
      const canceled = await options.cancel({ accountId: owner.row.accountId, cloneId: id, attemptId: attempt.id });
      if (owns() && !canceled) { owner.row = { ...owner.row, status: "cloning" }; changed(); }
    } catch (error) {
      if (!owns()) return;
      owner.row = { ...owner.row, status: "cloning" }; changed();
      if (current(view)) options.failed(extractErrorMessage(error, "Failed to cancel repository clone"));
    }
  };
  const runForeground = async (view: View, kind: "folder" | "init", work: () => Promise<Workspace | null>) => {
    if (!current(view) || foreground.get(kind)?.view === view) return null;
    const owner = { view }; foreground.set(kind, owner); changed();
    try {
      const workspace = await work();
      return workspace && current(view) ? { workspace, current: () => current(view) } : null;
    } catch (error) {
      if (current(view)) options.failed(extractErrorMessage(error, kind === "folder" ? "Failed to create workspace" : "Failed to create project"));
      return null;
    } finally {
      if (foreground.get(kind) === owner) foreground.delete(kind);
      changed();
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate(accountId: string, backendId: string, transport: Transport) {
      for (const [id, owner] of jobs) if (owner.completed) jobs.delete(id);
      live = true; scope = { accountId, backendId, transport }; changed();
    },
    acknowledge(view: View, workspaceIds: string[]) {
      if (!current(view)) return;
      const ids = new Set(workspaceIds);
      let updated = false;
      for (const [id, owner] of jobs) {
        if (visible(view, owner) && owner.completed && ids.has(owner.completed)) { jobs.delete(id); updated = true; }
      }
      if (updated) changed();
    },
    retire() { live = false; scope = null; },
    clone, cancelClone,
    retry(view: View, id: string) { const owner = jobs.get(id); if (owner && visible(view, owner) && owner.row.status === "failed") void runClone(view, owner); },
    dismiss(view: View, id: string) { const owner = jobs.get(id); if (current(view) && owner && visible(view, owner) && owner.row.status === "failed") { jobs.delete(id); changed(); } },
    addFolder: (view: View) => runForeground(view, "folder", async () => {
      const selected = await options.selectDirectory();
      if (!selected || !current(view)) return null;
      return options.create({ accountId: view.accountId, source: { kind: "folder", path: selected } });
    }),
    init: (view: View, name: string, parentPath?: string) => runForeground(view, "init", () => options.create({ accountId: view.accountId, source: { kind: "init", name, parentPath } })),
  };
}
