// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTransientUploads } from "./use-transient-uploads";

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
});
