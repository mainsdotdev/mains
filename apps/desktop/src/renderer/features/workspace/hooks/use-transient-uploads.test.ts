// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  clearTransientUploads,
  clearWorkspaceTransientUploads,
  useTransientUploads,
  moveTransientUploadsToOwner,
} from "./use-transient-uploads";
import { runOwnerKey } from "../../../../shared/ui-state-keys";

describe("useTransientUploads", () => {
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
