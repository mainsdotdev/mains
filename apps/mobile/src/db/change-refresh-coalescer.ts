type CancelScheduledTask = () => void;

export type ChangeRefreshScheduler = (
  callback: () => void,
  delayMs: number,
) => CancelScheduledTask;

type ChangeRefreshCoalescerOptions = {
  maxWaitMs?: number;
  schedule?: ChangeRefreshScheduler;
  settleMs?: number;
};

const scheduleWithTimeout: ChangeRefreshScheduler = (callback, delayMs) => {
  const timeout = setTimeout(callback, delayMs);
  return () => clearTimeout(timeout);
};

/**
 * Collapses a burst of row-level database events into one refresh. The maximum
 * wait prevents a continuously-written table from starving its reader.
 */
export function createChangeRefreshCoalescer(
  refresh: () => void,
  options: ChangeRefreshCoalescerOptions = {},
) {
  const {
    maxWaitMs = 250,
    schedule = scheduleWithTimeout,
    settleMs = 32,
  } = options;
  let cancelSettle: CancelScheduledTask | null = null;
  let cancelMaxWait: CancelScheduledTask | null = null;
  let disposed = false;

  const cancelPending = () => {
    cancelSettle?.();
    cancelMaxWait?.();
    cancelSettle = null;
    cancelMaxWait = null;
  };

  const flush = () => {
    if (disposed) return;
    cancelPending();
    refresh();
  };

  return {
    request() {
      if (disposed) return;
      cancelSettle?.();
      cancelSettle = schedule(flush, settleMs);
      cancelMaxWait ??= schedule(flush, maxWaitMs);
    },
    dispose() {
      disposed = true;
      cancelPending();
    },
  };
}
