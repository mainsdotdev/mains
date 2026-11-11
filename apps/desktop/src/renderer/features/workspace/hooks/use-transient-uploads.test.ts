// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  clearTransientUploads,
  clearWorkspaceTransientUploads,
  setTransientUploadsForOwner,
  getTransientUploadsForOwner,
  useTransientUploads,
  moveTransientUploadsToOwner,
} from "./use-transient-uploads";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import { createUploadSubmission } from "../lib/document-lifecycle";

describe("useTransientUploads", () => {
  it("merges remaining draft files into a newly accepted run without discarding that run's newer files", () => {
    const earlier = { file: new File(["draft"], "draft.txt"), type: "document" as const };
    const newer = { file: new File(["run"], "run.txt"), type: "document" as const };
    setTransientUploadsForOwner("accepted-draft", [earlier]);
    setTransientUploadsForOwner("accepted-run", [newer]);
    try {
      moveTransientUploadsToOwner("accepted-draft", "accepted-run", { merge: true });
      expect(getTransientUploadsForOwner("accepted-run")).toEqual([earlier, newer]);
      expect(getTransientUploadsForOwner("accepted-draft")).toEqual([]);
    } finally { clearTransientUploads("accepted-draft"); clearTransientUploads("accepted-run"); }
  });
  it.each(["accepted", "rejected", "unknown"])("retains a submitted preview through %s delivery and preserves newer files", (outcome) => {
    const previous = URL.revokeObjectURL, revoke = vi.fn(); URL.revokeObjectURL = revoke;
    const owner = `submission-${outcome}`;
    const submitted = { file: new File(["old"], "old.png"), type: "image" as const, preview: `blob:${outcome}` };
    const later = { file: new File(["new"], "new.txt"), type: "document" as const };
    setTransientUploadsForOwner(owner, [submitted]);
    const input = createUploadSubmission(getTransientUploadsForOwner(owner));
    try {
      setTransientUploadsForOwner(owner, [submitted, later]);
      if (outcome === "accepted") setTransientUploadsForOwner(owner, input.accept(getTransientUploadsForOwner(owner)));
      expect(revoke).not.toHaveBeenCalled();
      input.close(); input.close();
      expect(getTransientUploadsForOwner(owner)).toEqual(outcome === "accepted" ? [later] : [submitted, later]);
      expect(revoke.mock.calls).toEqual(outcome === "accepted" ? [[`blob:${outcome}`]] : []);
    } finally { input.close(); clearTransientUploads(owner); URL.revokeObjectURL = previous; }
  });
  it("does not revoke a preview when a replacement wrapper still references the same URL", () => {
    const previous = URL.revokeObjectURL, revoke = vi.fn(); URL.revokeObjectURL = revoke;
    const upload = { file: new File(["image"], "same.png"), type: "image" as const, preview: "blob:same-wrapper" };
    try {
      setTransientUploadsForOwner("replace-wrapper", [upload]);
      setTransientUploadsForOwner("replace-wrapper", [{ ...upload }]);
      expect(revoke).not.toHaveBeenCalled();
      clearTransientUploads("replace-wrapper");
      expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:same-wrapper");
    } finally { clearTransientUploads("replace-wrapper"); URL.revokeObjectURL = previous; }
  });
  it("keeps a shared preview alive until its last draft or queue owner releases it", () => {
    const previous = URL.revokeObjectURL, revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const upload = { file: new File(["image"], "shared.png"), type: "image" as const, preview: "blob:shared" };
    try {
      setTransientUploadsForOwner("shared-draft", [upload]);
      setTransientUploadsForOwner("shared-queue", [{ ...upload }]);
      clearTransientUploads("shared-draft");
      expect(revoke).not.toHaveBeenCalled();
      clearTransientUploads("shared-queue");
      expect(revoke.mock.calls).toEqual([["blob:shared"]]);
    } finally {
      clearTransientUploads("shared-draft"); clearTransientUploads("shared-queue"); URL.revokeObjectURL = previous;
    }
  });
  it("moves draft attachments to the selected context without revoking their previews", () => {
    const revoke = vi.fn();
    const previous = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    const from = renderHook(() => useTransientUploads("retarget-from"));
    const to = renderHook(() => useTransientUploads("retarget-to"));
    const upload = { file: new File(["image"], "draft.png"), type: "image" as const, preview: "blob:draft" };
    const oldUpload = { file: new File(["old"], "old.png"), type: "image" as const, preview: "blob:old" };
    try {
      act(() => {
        from.result.current[1]([upload]);
        to.result.current[1]([oldUpload]);
      });
      act(() => moveTransientUploadsToOwner("retarget-from", "retarget-to"));
      expect(from.result.current[0]).toEqual([]);
      expect(to.result.current[0]).toEqual([upload]);
      expect(revoke.mock.calls).toEqual([["blob:old"]]);
      act(() => clearTransientUploads("retarget-from"));
      expect(revoke.mock.calls).toEqual([["blob:old"]]);
      act(() => clearTransientUploads("retarget-to"));
      expect(revoke.mock.calls).toEqual([["blob:old"], ["blob:draft"]]);
    } finally {
      from.unmount();
      to.unmount();
      URL.revokeObjectURL = previous;
    }
  });

  it("keeps unsent files through an unmount and isolates conversations", () => {
    const upload = {
      file: new File(["draft"], "draft.txt", { type: "text/plain" }),
      type: "document" as const,
    };
    const first = renderHook(() => useTransientUploads("draft-a"));
    act(() => first.result.current[1]([upload]));
    first.unmount();

    const restored = renderHook(({ owner }) => useTransientUploads(owner), {
      initialProps: { owner: "draft-a" },
    });
    expect(restored.result.current[0]).toEqual([upload]);
    restored.rerender({ owner: "draft-b" });
    expect(restored.result.current[0]).toEqual([]);
    restored.rerender({ owner: "draft-a" });
    expect(restored.result.current[0]).toEqual([upload]);
    act(() => restored.result.current[1]([]));
    restored.unmount();
  });

  it("drops deleted owners' uploads while preserving surviving run uploads", () => {
    const draft = JSON.stringify(["local", "draft", "space", "codex", "developer", "ws-a", null]);
    const run = runOwnerKey("local", "run-a");
    const upload = {
      file: new File(["draft"], "draft.txt", { type: "text/plain" }),
      type: "document" as const,
    };
    const draftFiles = renderHook(() => useTransientUploads(draft));
    const runFiles = renderHook(() => useTransientUploads(run));
    act(() => {
      draftFiles.result.current[1]([upload]);
      runFiles.result.current[1]([upload]);
    });

    act(() => clearWorkspaceTransientUploads("local", "ws-a"));
    expect(draftFiles.result.current[0]).toEqual([]);
    expect(runFiles.result.current[0]).toEqual([upload]);
    act(() => clearTransientUploads(run));
    expect(runFiles.result.current[0]).toEqual([]);
    draftFiles.unmount();
    runFiles.unmount();
  });
});
