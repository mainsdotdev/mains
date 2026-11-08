// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseApi } from "@/lib/redux/api/baseApi";
import workspaceReducer, { setSelectedFile, setSelectedFileContent } from "@/lib/redux/slices/workspaceSlice";
import backendsReducer from "@/lib/redux/slices/backendsSlice";
import { getTransport, resetTransport, setTransport, type Transport } from "@/lib/transport";
import { CHANNELS } from "@mains/contracts/channels";
import { useEditorSave } from "./use-editor-save";
const content = (value: string) => ({ content: value, size: value.length, isBinary: false, encoding: "utf-8" as const, mtimeMs: 1 });
const file = (fullPath: string) => ({ name: fullPath, fullPath, type: "file" as const });
function fixture(key: string, invoke = vi.fn().mockResolvedValue({ success: true, data: { size: 5, mtimeMs: 2 } })) {
  setTransport({ kind: "test", invoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} } as Transport);
  const store = configureStore({ reducer: { workspace: workspaceReducer, backends: backendsReducer, api: baseApi.reducer },
    preloadedState: { workspace: { ...workspaceReducer(undefined, { type: "init" }), activeWorkspaceId: "workspace", selectedFile: file("/file-a"), selectedFileContent: content("initial") } },
    middleware: (defaults) => defaults().concat(baseApi.middleware) });
  const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><Provider store={store}>{children}</Provider></StrictMode>;
  const options = { ownerKey: key, filePath: "/file-a", workspaceId: "workspace", backendId: null, content: "initial", mtimeMs: 1 };
  return { store, wrapper, options, invoke };
}
afterEach(() => { cleanup(); resetTransport(); });

describe("editor save view binding", () => {
  it("never installs a closed file's late save result into the newly selected file", async () => {
    let finish!: (value: unknown) => void;
    const f = fixture("late-save", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const hook = renderHook(() => useEditorSave(f.options), { wrapper: f.wrapper });
    let pending!: Promise<void>;
    act(() => { hook.result.current.edit("saved a"); pending = hook.result.current.flush(); });
    await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    hook.unmount();
    f.store.dispatch(setSelectedFile(file("/file-b"))); f.store.dispatch(setSelectedFileContent(content("file b")));
    await act(async () => { finish({ success: true, data: { size: 7, mtimeMs: 2 } }); await pending; });
    expect(f.store.getState().workspace.selectedFileContent?.content).toBe("file b");
    expect(f.invoke.mock.calls[0]).toEqual([CHANNELS.fileExplorer.writeFileText, [expect.objectContaining({ filePath: "/file-a", content: "saved a" })]]);
  });

  it("restores a failed draft after closing and reopening its file", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ success: false, error: "Disk unavailable" }).mockResolvedValue({ success: true, data: { size: 8, mtimeMs: 2 } });
    const f = fixture("recovery-draft", invoke);
    const first = renderHook(() => useEditorSave(f.options), { wrapper: f.wrapper });
    await act(async () => { first.result.current.edit("keep me"); await first.result.current.flush(); });
    expect(first.result.current.phase).toBe("error"); first.unmount();
    const second = renderHook(() => useEditorSave(f.options), { wrapper: f.wrapper });
    expect(second.result.current.draft).toBe("keep me"); expect(second.result.current.phase).toBe("error");
    await act(async () => { await second.result.current.retry(); });
    expect(f.store.getState().workspace.selectedFileContent?.content).toBe("keep me");
  });
  it("permanently retires the old save view across an A to B to A transport switch", async () => {
    let finish!: (value: unknown) => void;
    const f = fixture("transport-retirement", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const original = getTransport(), other = { ...original, invoke: vi.fn() } as Transport;
    const hook = renderHook(() => useEditorSave(f.options), { wrapper: f.wrapper });
    let pending!: Promise<void>;
    act(() => { hook.result.current.edit("first"); pending = hook.result.current.flush(); });
    await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    act(() => { hook.result.current.edit("newest"); void hook.result.current.flush(); setTransport(other); setTransport(original); });
    await act(async () => { finish({ success: true, data: { size: 5, mtimeMs: 2 } }); await pending; });
    expect(f.invoke).toHaveBeenCalledTimes(1); expect(other.invoke).not.toHaveBeenCalled();
    expect(hook.result.current.phase).toBe("closed");
    expect(f.store.getState().workspace.selectedFileContent?.content).toBe("initial");
  });

});
