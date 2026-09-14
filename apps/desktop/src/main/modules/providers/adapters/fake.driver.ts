// ─────────────────────────────────────────────────────────────
// Fake ProviderDriver for tests.
//
// Records every call and lets tests script the outcome of each method.
// Used by work-run-core.test.ts to drive the lifecycle without an SDK.
// ─────────────────────────────────────────────────────────────

import type {
  AcquiredSession,
  DriverOutcome,
  ProviderDriver,
  WorkRunContinueRequest,
  WorkRunEvent,
  WorkRunEventHandler,
  WorkRunForkRequest,
  WorkRunRequest,
  WorkRunReviewRequest,
} from "../../../../shared/adapter.types";

export interface FakeDriverScript {
  /** Events the driver should push during executePrompt, in order. */
  events?: WorkRunEvent[];
  /** Outcome to resolve executePrompt with. */
  outcome?: DriverOutcome;
  /** When set, executePrompt rejects with this error before any events. */
  throws?: Error;
  /** When true, executePrompt awaits the AbortSignal and returns canceled when it fires. */
  awaitAbort?: boolean;
  /** Override the prompt the acquisition methods report. */
  prompt?: string;
  /** Override the sessionId the acquisition methods report (undefined to omit). */
  sessionId?: string | null;
  /** When set, the matching acquire method throws. */
  acquireThrows?: Error;
}

export interface FakeDriverCalls {
  createSession: WorkRunRequest[];
  resumeSession: WorkRunContinueRequest[];
  forkSession: WorkRunForkRequest[];
  reviewSession: WorkRunReviewRequest[];
  executePrompt: Array<{ session: unknown; prompt: string; signalAborted: boolean }>;
  cleanup: unknown[];
  shutdown: number;
}

export interface FakeDriverHandle {
  driver: ProviderDriver;
  calls: FakeDriverCalls;
  /** Reset call log + script. */
  reset(): void;
  /** Set the script for the next executePrompt. */
  script(s: FakeDriverScript): void;
  /** Enable optional methods so Core attaches the matching verbs. */
  enable(method: keyof Omit<ProviderDriver, "createSession" | "executePrompt">): void;
}

export function createFakeDriver(initial?: FakeDriverScript): FakeDriverHandle {
  const calls: FakeDriverCalls = {
    createSession: [],
    resumeSession: [],
    forkSession: [],
    reviewSession: [],
    executePrompt: [],
    cleanup: [],
    shutdown: 0,
  };
  let current: FakeDriverScript = { ...initial };

  const acquire = (
    request: WorkRunRequest | WorkRunContinueRequest | WorkRunForkRequest | WorkRunReviewRequest,
  ): AcquiredSession => {
    if (current.acquireThrows) throw current.acquireThrows;
    return {
      session: { id: request.runId },
      prompt: current.prompt ?? "fake-prompt",
      sessionId:
        current.sessionId === null
          ? undefined
          : (current.sessionId ?? `session-${request.runId}`),
    };
  };

  const driver: ProviderDriver = {
    async createSession(request) {
      calls.createSession.push(request);
      return acquire(request);
    },
    async executePrompt(session, prompt, onEvent: WorkRunEventHandler, signal) {
      const slot = { session, prompt, signalAborted: signal.aborted };
      calls.executePrompt.push(slot);

      if (current.throws) throw current.throws;

      for (const event of current.events ?? []) {
        await onEvent(event);
      }

      if (current.awaitAbort) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            slot.signalAborted = true;
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              slot.signalAborted = true;
              resolve();
            },
            { once: true },
          );
        });
        return current.outcome ?? { status: "canceled" };
      }

      return current.outcome ?? { status: "succeeded" };
    },
    async cleanup(session) {
      calls.cleanup.push(session);
    },
  };

  const handle: FakeDriverHandle = {
    driver,
    calls,
    reset() {
      calls.createSession.length = 0;
      calls.resumeSession.length = 0;
      calls.forkSession.length = 0;
      calls.reviewSession.length = 0;
      calls.executePrompt.length = 0;
      calls.cleanup.length = 0;
      calls.shutdown = 0;
      current = {};
    },
    script(s) {
      current = { ...s };
    },
    enable(method) {
      switch (method) {
        case "resumeSession":
          driver.resumeSession = async (request) => {
            calls.resumeSession.push(request);
            return acquire(request);
          };
          break;
        case "forkSession":
          driver.forkSession = async (request) => {
            calls.forkSession.push(request);
            return acquire(request);
          };
          break;
        case "reviewSession":
          driver.reviewSession = async (request) => {
            calls.reviewSession.push(request);
            return acquire(request);
          };
          break;
        case "shutdown":
          driver.shutdown = async () => {
            calls.shutdown += 1;
          };
          break;
        case "cleanup":
        default:
          // cleanup is always present on this fake.
          break;
      }
    },
  };

  return handle;
}
