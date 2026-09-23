import { configureStore } from "@reduxjs/toolkit";
import { persistReducer, persistStore } from "redux-persist";
import { describe, expect, it } from "vitest";
import workspaceReducer, {
  activateWorkspaceView,
  setSelectedFile,
} from "./slices/workspaceSlice";
import { workspacePersistConfig } from "./workspace-persistence";

const diffFile = {
  name: "example.ts.diff",
  fullPath: "/repo/example.ts",
  type: "file" as const,
  extension: "diff",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
  };
}

async function persistedWorkspace(storage: ReturnType<typeof memoryStorage>) {
  const reducer = persistReducer(
    { ...workspacePersistConfig, storage },
    workspaceReducer,
  );
  const store = configureStore({
    reducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
  });
  let persistor!: ReturnType<typeof persistStore>;
  await new Promise<void>((resolve) => {
    persistor = persistStore(store, undefined, resolve);
  });
  return { store, persistor };
}

describe("workspace persistence — generated diffs", () => {
  it("does not save a selected diff without its transient content", async () => {
    const storage = memoryStorage();
    const { store, persistor } = await persistedWorkspace(storage);
    store.dispatch(activateWorkspaceView({ key: "repo", workspaceId: "repo", providerId: "codex" }));
    store.dispatch(setSelectedFile(diffFile));
    await persistor.flush();

    const saved = JSON.parse((await storage.getItem("persist:workspace"))!);
    expect(JSON.parse(saved.selectedFile)).toBeNull();

    const realFile = { name: "example.ts", fullPath: "/repo/example.ts", type: "file" as const };
    store.dispatch(setSelectedFile(realFile));
    await persistor.flush();
    const savedRealFile = JSON.parse((await storage.getItem("persist:workspace"))!);
    expect(JSON.parse(savedRealFile.selectedFile)).toEqual(realFile);
    persistor.pause();
  });

  it("drops a diff selection from an older saved workspace state", async () => {
    const storage = memoryStorage();
    await storage.setItem("persist:workspace", JSON.stringify({
      selectedFile: JSON.stringify(diffFile),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    }));

    const { store, persistor } = await persistedWorkspace(storage);
    expect(store.getState().selectedFile).toBeNull();
    persistor.pause();
  });
});

describe("workspace persistence — removed UI state", () => {
  it("drops previously saved subagent selections during rehydration", async () => {
    const storage = memoryStorage();
    await storage.setItem("persist:workspace", JSON.stringify({
      selectedSubagentIdByRun: JSON.stringify({ "run-a": "tool-call-a" }),
      _persist: JSON.stringify({ version: -1, rehydrated: true }),
    }));

    const { store, persistor } = await persistedWorkspace(storage);
    expect(store.getState()).not.toHaveProperty("selectedSubagentIdByRun");
    await persistor.flush();
    const saved = JSON.parse((await storage.getItem("persist:workspace"))!);
    expect(saved).not.toHaveProperty("selectedSubagentIdByRun");
    persistor.pause();
  });
});
