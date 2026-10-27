import type { ReactNode } from "react";
import type { BridgeBackendInfo } from "@mains/contracts/bridge";
import { Muted, Text, Tooltip } from "@/components/ui";
import { Bridge, ProjectFolder } from "@/components/ui/icons";
import type { Workspace } from "@/lib/redux/api/workspaceApi";
import { bridgePresence } from "../lib/backends";
import { replicaBranch } from "../lib/repo-identity";

const ACTIVE = "bg-primary/50 glass-outline-soft glass-outline dark:bg-primary/5 hover:bg-primary/90 dark:hover:bg-primary/10";
const IDLE = "bg-transparent hover:bg-primary/50 dark:hover:bg-primary/5";

/** Another device's checkout, laid out like a local workspace row: its branch where a
 * local row shows its live branch, and the Bridge mark where local rows show
 * diff stats. The mark takes the success tint while that device is online, and
 * its tooltip names the device and presence the same way a chat badge does.
 * `list` adds the project line used when workspaces are shown in one list. */
export function ReplicaWorkspaceRow({ workspace, projectName, projectIcon, backend, layout, isActive, onClick }: {
  workspace: Pick<Workspace, "id" | "name" | "metadata" | "baseBranch">; projectName: string; projectIcon?: ReactNode;
  backend: BridgeBackendInfo; layout: "project" | "list"; isActive: boolean; onClick(): void;
}) {
  const { branch } = replicaBranch(workspace);
  return <button type="button" aria-label={`${projectName}, ${branch} on ${backend.label}, read-only`} aria-current={isActive ? "page" : undefined}
    onClick={onClick}
    className={`block w-full min-w-0 cursor-pointer px-2.5 py-1.25 text-left transition-all duration-200 ease-out ${layout === "list" ? "rounded-2xl" : "rounded-[10px]"} ${isActive ? ACTIVE : IDLE}`}>
    {layout === "list" && <span className="mb-0.5 flex min-w-0 items-center gap-1">
      <span className="shrink-0">{projectIcon ?? <ProjectFolder className="size-3.5 text-primary-800 dark:text-primary-200" />}</span>
      <Text as="span" size="s" tone="contrast" className="truncate">{projectName}</Text>
    </span>}
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      <Muted size="s" tone="secondary" className="min-w-0 flex-1 truncate">{branch}</Muted>
      <Tooltip content={`${backend.label} · ${bridgePresence(backend)}`}>
        <Bridge aria-hidden="true" className={`size-3.75 shrink-0 ${backend.online === true ? "text-success" : "dark:text-primary-600 text-primary-400"}`} />
      </Tooltip>
    </span>
  </button>;
}
