// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSubmittedPrompts } from "./use-submitted-prompts";
import type { RunEvent } from "../types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(["persist", "reject", "unmount"])("owns image previews independently of the composer and releases them on %s", (finish) => {
  const createObjectURL = vi.fn(() => "blob:submitted-image");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; });
  const props = { ownerKey: "draft", viewKey: "local/workspace", activeRunId: null as string | null, events: [] as RunEvent[], runs: [], historical: false };
  const view = renderHook((input) => useSubmittedPrompts(input), { initialProps: props });
  const file = { file: new File(["image"], "image.png", { type: "image/png" }), type: "image" as const, preview: "blob:composer-image" };
  let id = "";
  act(() => { id = view.result.current.begin("See image", [], [file], null); });
  expect(createObjectURL).toHaveBeenCalledWith(file.file);
  expect(view.result.current.currentEvents[0].metadata?.attachments).toEqual([expect.objectContaining({ dataUrl: "blob:submitted-image" })]);
  act(() => { view.result.current.accept(id, "run-1"); });
  // Clearing the composer does not invalidate the submitted message's preview.
  URL.revokeObjectURL(file.preview);
  expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:submitted-image");
  if (finish === "persist") {
    view.rerender({ ...props, ownerKey: "run-1", activeRunId: "run-1", events: [{ id: "artifact-1", type: "artifact", content: "See image", timestamp: new Date(), metadata: { kind: "user-prompt", clientPromptId: id } }] });
    expect(view.result.current.currentEvents).toHaveLength(1);
  } else if (finish === "reject") act(() => { view.result.current.reject(id); });
  else view.unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:submitted-image");
  expect(revokeObjectURL.mock.calls.filter(([url]) => url === "blob:submitted-image")).toHaveLength(1);
});
