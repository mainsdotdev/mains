import { describe, expect, it } from "vitest";
import reducer, { closeAtlasPageTab, openAtlasPageTab, updateAtlasPageChat, setAtlasCoverPosition } from "./atlasSlice";

describe("Atlas session state", () => {
  it("keeps cover framing separate from session state and isolated by backend/account/page", () => {
    let state = reducer(undefined, setAtlasCoverPosition({ ownerKey: "local/account", id: "page", coverFileId: "cover", coverPositionY: 120 }));
    state = reducer(state, setAtlasCoverPosition({ ownerKey: "remote/account", id: "page", coverFileId: "other", coverPositionY: 20 }));
    state = reducer(state, setAtlasCoverPosition({ ownerKey: "local/other-account", id: "page", coverFileId: "cover", coverPositionY: 75 }));
    state = reducer(state, setAtlasCoverPosition({ ownerKey: "local/account", id: "page", coverFileId: "cover", coverPositionY: NaN }));
    expect(state.coverPositions["local/account"].page).toEqual({ coverFileId: "cover", coverPositionY: 100 });
    expect(state.coverPositions["remote/account"].page.coverPositionY).toBe(20);
    expect(state.coverPositions["local/other-account"].page.coverPositionY).toBe(75);
    expect(state.byOwner).toEqual({});
  });
  it("keeps account/backend tab sets separate and deduplicates an existing page", () => {
    let state = reducer(undefined, openAtlasPageTab({ ownerKey: "local/account", id: "one" }));
    state = reducer(state, openAtlasPageTab({ ownerKey: "local/account", id: "one" }));
    state = reducer(state, openAtlasPageTab({ ownerKey: "remote/account", id: "two" }));
    expect(state.byOwner["local/account"].tabs).toEqual([{ id: "one" }]);
    expect(state.byOwner["remote/account"].tabs).toEqual([{ id: "two" }]);
  });

  it("retains a page's conversation and unsent draft when its tab closes", () => {
    let state = reducer(undefined, openAtlasPageTab({ ownerKey: "owner", id: "one" }));
    state = reducer(state, updateAtlasPageChat({ ownerKey: "owner", id: "one", patch: { runId: "chat", draft: "Keep this draft", spaceId: "work" } }));
    state = reducer(state, closeAtlasPageTab({ ownerKey: "owner", id: "one" }));
    expect(state.byOwner.owner.tabs).toEqual([]);
    expect(state.byOwner.owner.chats.one).toEqual({ runId: "chat", draft: "Keep this draft", spaceId: "work", mode: "input" });
  });
});
