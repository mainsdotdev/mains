// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RunEvent } from "../../types";
const h = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/redux/api/toolsApi", () => ({ useUpdateToolCallMutation: () => [h.update] }));
vi.mock("@/hooks/use-replica-view", () => ({ useReplicaView: () => false }));
vi.mock("../../lib/transcript-view-state", async () => { const { useState } = await import("react"); return { useToolExpansion: () => useState(true) }; });
import { PlanDisplay } from "./plan-display";
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const event = { id: "tool-42", type: "tool_call", content: "Plan", timestamp: new Date(), metadata: { toolName: "Plan", input: { plan: "Build the change" } } } as RunEvent;
it("does not mark a plan applied before its execution is accepted", async () => {
  let accept!: (value: any) => void;
  const gate = new Promise<any>((resolve) => { accept = resolve; });
  h.update.mockResolvedValue({ data: undefined });
  render(<PlanDisplay event={event} onApplyPlan={() => gate} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply Plan" }));
  await act(async () => {});
  expect(screen.queryByText("Applied")).toBeNull();
  expect(h.update).not.toHaveBeenCalled();
  await act(async () => { accept({ status: "applied" }); });
});
it("keeps a failed plan decision pending and shows a retryable error", async () => {
  const apply = vi.fn().mockRejectedValueOnce(new Error("Provider unavailable")).mockResolvedValue({ status: "applied" });
  render(<PlanDisplay event={event} onApplyPlan={apply} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply Plan" }));
  await screen.findByRole("alert"); expect(screen.queryByText("Applied")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Apply Plan" }));
  await screen.findByText("Applied"); expect(apply).toHaveBeenCalledTimes(2);
});
it("never applies an old plan acknowledgement to a replacement card", async () => {
  let finish!: (result: any) => void;
  const pending = new Promise<any>((resolve) => { finish = resolve; });
  const apply = vi.fn(() => pending);
  const view = render(<PlanDisplay event={event} onApplyPlan={apply} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply Plan" }));
  view.rerender(<PlanDisplay event={{ ...event, id: "tool-43", metadata: { ...event.metadata, input: { plan: "Replacement" } } }} onApplyPlan={apply} />);
  await act(async () => { finish({ status: "applied" }); });
  expect(screen.queryByText("Applied")).toBeNull(); expect(screen.getByText("Replacement")).toBeTruthy();
});
