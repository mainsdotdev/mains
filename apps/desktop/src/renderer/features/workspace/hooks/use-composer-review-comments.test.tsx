// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";
import workspaceReducer, { addContextItem, setContextItemsForKey, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import type { ContextItem, ContextReviewItem } from "../lib/composer-context";
import { useComposerContextActions, useComposerReviewComments } from "./use-composer-context";

const comment = (id: string, filePath: string, workspaceId = "ws"): ContextReviewItem => ({
  kind: "review", id, workspaceId, filePath, absolutePath: `/repo/${filePath}`,
  side: "additions", lineNumber: 1, lineText: "const value = 1;", patchId: "patch", comment: "Check this.",
});

function setup(items: ContextItem[] = []) {
  const store = configureStore({ reducer: { workspace: workspaceReducer } });
  store.dispatch(setContextItemsForKey({ key: "default", items }));
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
  return { store, wrapper };
}

describe("Review comment subscriptions", () => {
  it("does not redraw other files, workspaces or action-only consumers when context changes", () => {
    const { store, wrapper } = setup([comment("a", "a.ts"), comment("b", "b.ts")]);
    let fileRenders = 0;
    let workspaceRenders = 0;
    let actionRenders = 0;
    const file = renderHook(() => { fileRenders++; return useComposerReviewComments("ws", "a.ts"); }, { wrapper });
    renderHook(() => { workspaceRenders++; return useComposerReviewComments("other"); }, { wrapper });
    renderHook(() => { actionRenders++; return useComposerContextActions(); }, { wrapper });
    const original = file.result.current;

    act(() => store.dispatch(addContextItem(comment("b2", "b.ts"))));
    act(() => store.dispatch(addContextItem({ kind: "code", id: "selection", filePath: "/repo/c.ts", fileName: "c.ts", startLine: 1, endLine: 2, text: "code" })));

    expect(fileRenders).toBe(1);
    expect(workspaceRenders).toBe(1);
    expect(actionRenders).toBe(1);
    expect(file.result.current).toBe(original);

    act(() => store.dispatch(addContextItem(comment("a2", "a.ts"))));
    expect(fileRenders).toBe(2);
    expect(file.result.current.map((item) => item.id)).toEqual(["a", "a2"]);
  });

  it("updates the affected file on edit/removal and switches to the current conversation owner", () => {
    const { store, wrapper } = setup([comment("a", "a.ts"), comment("b", "b.ts")]);
    const file = renderHook(() => useComposerReviewComments("ws", "a.ts"), { wrapper });
    const workspace = renderHook(() => useComposerReviewComments("ws"), { wrapper });
    act(() => store.dispatch(setContextItemsForKey({ key: "default", items: [{ ...comment("a", "a.ts"), comment: "Edited." }] })));
    expect(file.result.current[0].comment).toBe("Edited.");
    expect(workspace.result.current).toHaveLength(1);

    act(() => store.dispatch(setComposerContextKey("another-chat")));
    expect(file.result.current).toHaveLength(0);
    act(() => store.dispatch(setComposerContextKey("default")));
    expect(file.result.current[0].comment).toBe("Edited.");
    act(() => store.dispatch(setContextItemsForKey({ key: "default", items: [] })));
    expect(file.result.current).toHaveLength(0);
  });
});
