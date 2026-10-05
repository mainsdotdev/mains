import { useCallback, useEffect, useRef, useState } from "react";

export interface McpAppMessagePreview {
  id: string;
  ownerKey: string;
  text: string;
  newConversation: boolean;
}

/** Hold an app's message request until the user reviews its text. */
export function useMcpAppMessagePreview(ownerKey: string) {
  const [preview, setPreview] = useState<McpAppMessagePreview | null>(null);
  const pending = useRef<{
    id: string;
    resolve: (text: string | null) => void;
    removeAbortListener: () => void;
  } | null>(null);

  const finish = useCallback((text: string | null) => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    request.removeAbortListener();
    setPreview(null);
    request.resolve(text);
  }, []);

  const cancel = useCallback(() => finish(null), [finish]);
  const confirm = useCallback((text: string) => {
    const value = text.trim();
    if (value && value.length <= 32_000) finish(value);
  }, [finish]);

  const review = useCallback((text: string, newConversation: boolean, signal?: AbortSignal): Promise<string | null> => {
    if (pending.current) return Promise.reject(new Error("Review or cancel the app's current prompt first"));
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      pending.current = { id, resolve, removeAbortListener: () => signal?.removeEventListener("abort", cancel) };
      signal?.addEventListener("abort", cancel, { once: true });
      setPreview({ id, ownerKey, text, newConversation });
    });
  }, [ownerKey, cancel]);

  // Navigation, a revoked app document, or a canceled RPC must never send later.
  useEffect(() => cancel, [ownerKey, cancel]);

  return { preview: preview?.ownerKey === ownerKey ? preview : null, review, cancel, confirm };
}
