import { useState, useCallback, useRef, useLayoutEffect } from "react";
import { createCopyFeedbackLifecycle, type CopyStatus } from "@/lib/copy-feedback-lifecycle";

const DEFAULT_FEEDBACK_DURATION_MS = 1500;

interface UseCopyToClipboardOptions {
  feedbackDuration?: number;
  onSuccess?: (text: string) => void;
  onError?: (error: Error) => void;
}

interface UseCopyToClipboardReturn {
  status: CopyStatus;
  isCopied: boolean;
  isError: boolean;
  copy: (text: string) => Promise<boolean>;
  reset: () => void;
}

export function useCopyToClipboard(options: UseCopyToClipboardOptions = {}): UseCopyToClipboardReturn {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const latest = useRef(options);
  const owner = useRef<ReturnType<typeof createCopyFeedbackLifecycle> | null>(null);
  useLayoutEffect(() => { latest.current = options; });
  useLayoutEffect(() => {
    const lifecycle = createCopyFeedbackLifecycle({
      write(text) {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API not available");
        return navigator.clipboard.writeText(text);
      },
      publish: setStatus,
      duration: () => latest.current.feedbackDuration ?? DEFAULT_FEEDBACK_DURATION_MS,
      success: (text) => latest.current.onSuccess?.(text),
      error: (error) => latest.current.onError?.(error),
    });
    owner.current = lifecycle;
    return () => { lifecycle.dispose(); if (owner.current === lifecycle) owner.current = null; };
  }, []);
  const copy = useCallback((text: string) => owner.current?.copy(text) ?? Promise.resolve(false), []);
  const reset = useCallback(() => owner.current?.reset(), []);
  return { status, isCopied: status === "copied", isError: status === "error", copy, reset };
}
