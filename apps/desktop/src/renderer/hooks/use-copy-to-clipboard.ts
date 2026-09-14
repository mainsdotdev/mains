import { useState, useCallback, useRef, useEffect } from "react";

const DEFAULT_FEEDBACK_DURATION_MS = 1500;

type CopyStatus = "idle" | "copied" | "error";

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

export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {},
): UseCopyToClipboardReturn {
  const {
    feedbackDuration = DEFAULT_FEEDBACK_DURATION_MS,
    onSuccess,
    onError,
  } = options;

  const [status, setStatus] = useState<CopyStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimeoutRef = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimeoutRef();
    setStatus("idle");
  }, [clearTimeoutRef]);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) {
        console.warn("useCopyToClipboard: Empty text provided");
        return false;
      }

      clearTimeoutRef();

      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("Clipboard API not available");
        }

        await navigator.clipboard.writeText(text);
        setStatus("copied");
        onSuccess?.(text);

        timeoutRef.current = setTimeout(() => {
          setStatus("idle");
        }, feedbackDuration);

        return true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("Failed to copy:", error.message);
        setStatus("error");
        onError?.(error);

        timeoutRef.current = setTimeout(() => {
          setStatus("idle");
        }, feedbackDuration);

        return false;
      }
    },
    [feedbackDuration, onSuccess, onError, clearTimeoutRef],
  );

  useEffect(() => clearTimeoutRef, [clearTimeoutRef]);

  return {
    status,
    isCopied: status === "copied",
    isError: status === "error",
    copy,
    reset,
  };
}
