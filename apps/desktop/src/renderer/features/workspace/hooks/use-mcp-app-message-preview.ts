import { useCallback, useLayoutEffect, useState } from "react";
import { createMcpAppMessageReview, type McpAppMessagePreview } from "../../../../shared/mcp-app-lifecycle";
export type { McpAppMessagePreview } from "../../../../shared/mcp-app-lifecycle";

/** Hold an app's message request until the user reviews its text. */
export function useMcpAppMessagePreview(ownerKey: string) {
  const [preview, setPreview] = useState<McpAppMessagePreview | null>(null);
  const [lifecycle] = useState(() => createMcpAppMessageReview(ownerKey, setPreview));
  useLayoutEffect(() => { lifecycle.setOwner(ownerKey); return () => lifecycle.release(ownerKey); }, [lifecycle, ownerKey]);
  const review = useCallback((text: string, newConversation: boolean, signal?: AbortSignal, documentSignal?: AbortSignal) => lifecycle.review(text, newConversation, signal, documentSignal), [lifecycle]);
  const confirm = useCallback((text: string) => lifecycle.confirm(preview?.id, text), [lifecycle, preview?.id]);
  const dismiss = useCallback(() => lifecycle.dismiss(preview?.id), [lifecycle, preview?.id]);
  return { preview: preview?.ownerKey === ownerKey ? preview : null, review, cancel: lifecycle.cancel, confirm, dismiss };
}
