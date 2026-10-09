// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewComment } from "@mains/contracts/review-comments";
import { ReviewCommentsAttachment } from "./review-comments-attachment";

const comment: ReviewComment = {
  id: "comment-1", workspaceId: "ws", filePath: "src/a.ts", absolutePath: "/repo/src/a.ts",
  side: "deletions", lineNumber: 11, lineText: "oldValue", patchId: "patch", comment: "Keep the previous behavior.",
};
afterEach(cleanup);
describe("review comment attachment", () => {
  it("edits the text while preserving the addressed line and deletes only the selected comment", async () => {
    const onUpdate = vi.fn(); const onRemove = vi.fn();
    render(<ReviewCommentsAttachment comments={[comment]} onUpdate={onUpdate} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "1 review comment" }));
    expect(await screen.findByText("src/a.ts · L11")).toBeTruthy();
    expect(screen.getByText("oldValue")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit comment on L11" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Review comment" }), { target: { value: "  Updated feedback  " } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(comment.id, "Updated feedback");
    fireEvent.click(screen.getByRole("button", { name: "Delete comment on L11" }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(comment.id);
  });

  it("keeps sent comments read-only and dismisses the popup with Escape", async () => {
    render(<ReviewCommentsAttachment comments={[comment]} />);
    fireEvent.click(screen.getByRole("button", { name: "1 review comment" }));
    expect(await screen.findByText(comment.comment)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit comment/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete comment/ })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Review comments" })).toBeNull();
  });

  it("shows the full line range on a comment", async () => {
    render(<ReviewCommentsAttachment comments={[{ ...comment, endLineNumber: 13, lineText: "oldValue\nnextLine" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "1 review comment" }));
    expect(await screen.findByText("src/a.ts · L11-13")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Review comments" }).querySelector("pre")?.textContent).toBe("oldValue\nnextLine");
  });
});
