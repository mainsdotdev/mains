// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fail,
  ok,
  type ServiceResponse,
} from "../../../../shared/ipc-kit/service-response";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { baseApi } from "@/lib/redux/api/baseApi";
import type { RunTurnChanges } from "@/lib/redux/api";

vi.mock("./diff-viewer", () => ({
  DiffViewer: ({ diffText }: { diffText: string }) =>
    createElement("pre", { "data-testid": "diff" }, diffText),
}));

import { TurnChangesCard } from "./turn-changes-card";

const PATCH =
  "diff --git a/components/hero.tsx b/components/hero.tsx\n--- a/components/hero.tsx\n+++ b/components/hero.tsx\n@@ -1 +1 @@\n-old\n+new\n";

const changes: RunTurnChanges = {
  id: "c1",
  files: [
    { path: "components/hero.tsx", status: "modified", additions: 1, deletions: 1, binary: false },
  ],
  additions: 1,
  deletions: 1,
  truncated: false,
  undoneAt: null,
};

function renderCard(
  respond: () => ServiceResponse<unknown> = () => ok({ ...changes, diffText: PATCH }),
) {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === CHANNELS.runTurns.getChangesDiff) return respond();
    throw new Error(`Unexpected channel: ${channel}`);
  });
  const transport: Transport = {
    kind: "test",
    invoke,
    subscribe: () => () => undefined,
    status: () => "connected",
    onStatusChange: () => () => undefined,
  };
  setTransport(transport);
  const store = configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
  render(
    createElement(
      Provider,
      // Provider's props type requires `children`; they arrive as the third argument.
      { store } as ComponentProps<typeof Provider>,
      createElement(TurnChangesCard, { runId: "r1", turnId: 41, changes, canUndo: true }),
    ),
  );
  return { invoke };
}

describe("TurnChangesCard", () => {
  afterEach(() => {
    cleanup();
    resetTransport();
  });

  it("shows the file's diff after Review", async () => {
    const { invoke } = renderCard();
    fireEvent.click(screen.getByText("Review"));

    const diff = await screen.findByTestId("diff");
    expect(diff.textContent).toContain("diff --git a/components/hero.tsx");
    expect(invoke).toHaveBeenCalledWith(CHANNELS.runTurns.getChangesDiff, ["r1", 41]);
  });

  it("shows why the diff failed to load instead of calling it missing", async () => {
    renderCard(() => fail("No handler registered for runTurns:getChangesDiff"));
    fireEvent.click(screen.getByText("Review"));

    expect(
      await screen.findByText(/Couldn't load this diff: No handler registered/),
    ).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("says so when the turn has no stored patch", async () => {
    renderCard(() => ok(null));
    fireEvent.click(screen.getByText("Review"));

    expect(await screen.findByText("This turn's diff is no longer stored.")).toBeTruthy();
  });
});
