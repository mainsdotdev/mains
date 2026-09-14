import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./pulse.repo", () => ({
  pulseRepo: {
    findById: vi.fn(),
    claimNextRun: vi.fn(),
    markRun: vi.fn(),
    findNextScheduled: vi.fn().mockReturnValue(undefined),
    findDueActive: vi.fn().mockReturnValue([]),
  },
}));
vi.mock("../runs/runs.service", () => ({
  runsService: { executeRun: vi.fn().mockResolvedValue({ runId: "run-1" }) },
}));
vi.mock("../appSettings", () => ({
  appSettingsService: {
    getSettings: vi.fn().mockResolvedValue({ activeSpaceId: null }),
  },
}));
vi.mock("../space", () => ({
  spaceService: { getAll: vi.fn().mockResolvedValue([]) },
}));

import { pulseService } from "./pulse.service";
import { pulseRepo } from "./pulse.repo";
import { runsService } from "../runs/runs.service";
import { spaceService } from "../space";

function makePulse(overrides: Record<string, unknown> = {}) {
  return {
    id: "pulse-1",
    accountId: "default",
    workspaceId: "ws-1",
    collectionId: null,
    mode: "developer",
    providerId: "claude_code",
    model: "sonnet",
    title: "Digest",
    prompt: "Summarize",
    frequency: "daily",
    dayOfWeek: null,
    hour: 9,
    minute: 0,
    timezone: "Europe/Istanbul",
    thinkingMode: false,
    effortLevel: null,
    isActive: true,
    ...overrides,
  };
}

const space = (id: string, providerId: string, mode: string) => ({
  id,
  providerId,
  mode,
  isArchived: false,
});

describe("pulseService.executePulse — space resolution by the pulse's mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runsService.executeRun).mockResolvedValue({ runId: "run-1" });
    vi.mocked(pulseRepo.findNextScheduled).mockReturnValue(undefined as never);
  });

  it("runs a developer pulse in its workspace under a developer space", async () => {
    vi.mocked(pulseRepo.findById).mockReturnValue(makePulse() as never);
    vi.mocked(spaceService.getAll).mockResolvedValue([
      space("sp-chat", "claude_code", "chat"),
      space("sp-dev", "claude_code", "developer"),
    ] as never);

    await pulseService.executePulse("pulse-1");

    const payload = vi.mocked(runsService.executeRun).mock.calls[0][0];
    expect(payload.spaceId).toBe("sp-dev");
    expect(payload.workspaceId).toBe("ws-1");
    expect(payload.collectionId).toBeUndefined();
  });

  it("runs a work pulse workspace-less with its collection under a work space", async () => {
    vi.mocked(pulseRepo.findById).mockReturnValue(
      makePulse({ mode: "work", workspaceId: null, collectionId: "col-1" }) as never,
    );
    vi.mocked(spaceService.getAll).mockResolvedValue([
      space("sp-dev", "claude_code", "developer"),
      space("sp-work", "claude_code", "work"),
    ] as never);

    await pulseService.executePulse("pulse-1");

    const payload = vi.mocked(runsService.executeRun).mock.calls[0][0];
    expect(payload.spaceId).toBe("sp-work");
    expect(payload.workspaceId).toBeUndefined();
    expect(payload.collectionId).toBe("col-1");
  });

  it("fails with a readable error when no space of the pulse's mode exists", async () => {
    vi.mocked(pulseRepo.findById).mockReturnValue(
      makePulse({ mode: "chat", workspaceId: null }) as never,
    );
    vi.mocked(spaceService.getAll).mockResolvedValue([
      space("sp-dev", "claude_code", "developer"),
    ] as never);

    await expect(pulseService.executePulse("pulse-1")).rejects.toThrow(
      'No chat space is available for provider "claude_code"',
    );
    expect(runsService.executeRun).not.toHaveBeenCalled();
  });
});
