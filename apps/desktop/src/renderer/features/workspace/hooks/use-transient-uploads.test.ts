// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  clearTransientUploads,
  clearWorkspaceTransientUploads,
  useTransientUploads,
} from "./use-transient-uploads";
import { runOwnerKey } from "../../../../shared/ui-state-keys";

describe("useTransientUploads", () => {
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
