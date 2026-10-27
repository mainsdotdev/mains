// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeBackendInfo } from "@mains/contracts/bridge";
import { ReplicaWorkspaceRow } from "./replica-workspace-row";

const backend: BridgeBackendInfo = { backendId: "A", label: "M4 Pro", platform: "darwin", online: false, lastSeen: "2026-10-17T12:57:00Z" };
const worktree = { id: "w2", name: "docs", baseBranch: "master", metadata: { worktree: { enabled: true, name: "mango" } } };
afterEach(cleanup);

describe("ReplicaWorkspaceRow", () => {
  it("shows the checkout's branch like a local branch row, with the device only in the accessible name", () => {
    const onClick = vi.fn();
    render(<ReplicaWorkspaceRow workspace={worktree} projectName="docs" backend={backend} layout="project" isActive={false} onClick={onClick} />);
    const row = screen.getByRole("button", { name: "docs, mango on M4 Pro, read-only" });
    expect(row.textContent).toBe("mango");
    fireEvent.click(row); expect(onClick).toHaveBeenCalledOnce();
  });

  it("adds the project line in one-list layout and distinguishes two checkouts of one repository", () => {
    render(<>
      <ReplicaWorkspaceRow workspace={worktree} projectName="docs" backend={backend} layout="list" isActive onClick={() => {}} />
      <ReplicaWorkspaceRow workspace={{ id: "w1", name: "docs", baseBranch: "master", metadata: { lastBranch: "master" } }}
        projectName="docs" backend={backend} layout="list" isActive={false} onClick={() => {}} />
    </>);
    const rows = screen.getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual(["docsmango", "docsmaster"]);
    expect(rows[0].getAttribute("aria-current")).toBe("page");
  });

  it("names the device and its presence on the Bridge mark, like a chat badge", async () => {
    const { container } = render(<ReplicaWorkspaceRow workspace={worktree} projectName="docs"
      backend={{ ...backend, online: true, lastSeen: null }} layout="project" isActive={false} onClick={() => {}} />);
    const row = screen.getByRole("button", { name: "docs, mango on M4 Pro, read-only" });
    fireEvent.mouseEnter(row);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(container.querySelector("svg")!.parentElement!);
    expect((await screen.findByRole("tooltip")).textContent).toBe("M4 Pro · Online");
  });

  it("tints the Bridge mark while the device is online and shows no presence dot", () => {
    const { container, rerender } = render(<ReplicaWorkspaceRow workspace={worktree} projectName="docs"
      backend={{ ...backend, online: true }} layout="project" isActive={false} onClick={() => {}} />);
    const mark = () => container.querySelector("svg");
    expect(mark()?.classList.contains("text-success")).toBe(true);
    expect(container.querySelector(".rounded-full")).toBeNull();

    rerender(<ReplicaWorkspaceRow workspace={worktree} projectName="docs" backend={backend} layout="project" isActive={false} onClick={() => {}} />);
    expect(mark()?.classList.contains("text-success")).toBe(false);
    expect(mark()?.classList.contains("text-primary-400")).toBe(true);
    expect(mark()?.classList.contains("dark:text-primary-600")).toBe(true);
  });
});
