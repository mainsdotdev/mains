// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeBackendInfo } from "@mains/contracts/bridge";
import { ReplicaWorkspaceRow } from "./replica-workspace-row";

const backend: BridgeBackendInfo = { backendId: "A", label: "M4 Pro", platform: "darwin", online: false, lastSeen: "2026-10-17T12:57:00Z" };
const worktree = { id: "w2", name: "docs", baseBranch: "master", metadata: { worktree: { enabled: true, name: "mango" } } };
afterEach(cleanup);

describe("ReplicaWorkspaceRow", () => {
  it("shows the checkout's branch with the device beside it, like a local branch row", () => {
    const onClick = vi.fn();
    render(<ReplicaWorkspaceRow workspace={worktree} projectName="docs" backend={backend} layout="project" isActive={false} onClick={onClick} />);
    const row = screen.getByRole("button", { name: "docs, mango on M4 Pro, read-only" });
    expect(row.textContent).toBe("mangoM4 Pro");
    fireEvent.click(row); expect(onClick).toHaveBeenCalledOnce();
  });

  it("adds the project line in one-list layout and distinguishes two checkouts of one repository", () => {
    render(<>
      <ReplicaWorkspaceRow workspace={worktree} projectName="docs" backend={backend} layout="list" isActive onClick={() => {}} />
      <ReplicaWorkspaceRow workspace={{ id: "w1", name: "docs", baseBranch: "master", metadata: { lastBranch: "master" } }}
        projectName="docs" backend={backend} layout="list" isActive={false} onClick={() => {}} />
    </>);
    const rows = screen.getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual(["docsmangoM4 Pro", "docsmasterM4 Pro"]);
    expect(rows[0].getAttribute("aria-current")).toBe("page");
  });
});
