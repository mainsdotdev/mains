import type { CopilotClient } from "@github/copilot-sdk";
import { expect, it, vi } from "vitest";
import { createCopilotLifecycle } from "./copilot-lifecycle";

it("retains a client acquired after shutdown when its startup rollback fails", async () => {
  let acquired!: (client: CopilotClient) => void;
  const create = vi.fn(() => new Promise<CopilotClient>((resolve) => { acquired = resolve; }));
  const initialize = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockRejectedValueOnce(new Error("release failed")).mockResolvedValue(undefined);
  const lifecycle = createCopilotLifecycle({ create, initialize, stop,
    alive: vi.fn().mockResolvedValue(true), invalidate: vi.fn() });
  const opening = lifecycle.open(undefined, vi.fn());
  const rejected = expect(opening).rejects.toThrow();
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  const closing = lifecycle.shutdown();
  const closed = expect(closing).rejects.toThrow("cleanup");
  acquired({ ping: vi.fn() } as unknown as CopilotClient);
  await Promise.all([rejected, closed]);
  expect(initialize).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledTimes(1);
  await lifecycle.shutdown();
  expect(stop).toHaveBeenCalledTimes(2);
});
