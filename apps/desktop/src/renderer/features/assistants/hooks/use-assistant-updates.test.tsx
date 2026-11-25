// @vitest-environment jsdom
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { expect, it } from "vitest";
import type { AssistantTeamWorkItem } from "@mains/contracts/assistants";
import { CHANNELS } from "@mains/contracts/channels";
import { ok } from "@mains/contracts/service-response";
import { useAssistantTeamWorkQuery } from "@/lib/redux/api/assistantsApi";
import { baseApi } from "@/lib/redux/api/baseApi";
import { resetTransport, setTransport } from "@/lib/transport";
import { useAssistantUpdates } from "./use-assistant-updates";

it("refreshes visible team work when a question opens or another client answers it", async () => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const item: AssistantTeamWorkItem = {
    id: "task", kind: "assignment", assistantId: "mate", runId: "chat", title: "Review release",
    status: "running", pendingKinds: [], pullRequestKey: null, updatedAt: new Date(),
  };
  setTransport({
    kind: "fixture", status: () => "connected", onStatusChange: () => () => {},
    subscribe(channel, listener) {
      listeners.set(channel, listener);
      return () => { listeners.delete(channel); };
    },
    async invoke(channel, args) {
      expect(channel).toBe(CHANNELS.assistants.teamWork);
      expect(args).toEqual(["account", "team"]);
      return ok({ team: { id: "team", name: "Mains" }, items: [{ ...item }] });
    },
  });
  const store = configureStore({ reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: defaults => defaults({ serializableCheck: false }).concat(baseApi.middleware) });
  const { result, unmount } = renderHook(() => {
    useAssistantUpdates(true);
    return useAssistantTeamWorkQuery({ accountId: "account", teamId: "team" });
  }, { wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider> });
  try {
    const status = () => result.current.currentData?.items[0].status;
    await waitFor(() => expect(status()).toBe("running"));
    item.status = "needs_you"; item.pendingKinds = ["ask_user"];
    act(() => listeners.get(CHANNELS.runs.toolApprovalRequest)?.({ runId: "chat" }));
    await waitFor(() => expect(status()).toBe("needs_you"));
    item.status = "running"; item.pendingKinds = [];
    act(() => listeners.get(CHANNELS.runs.toolApprovalResolved)?.({ requestId: "question" }));
    await waitFor(() => expect(status()).toBe("running"));
  } finally {
    unmount();
    store.dispatch(baseApi.util.resetApiState());
    resetTransport();
  }
});
