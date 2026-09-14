import { useState } from "react";
import { Text } from "@/components/ui";
import { SendMessage } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { toolOutputText } from "../../lib/parse-tool-content";

/**
 * Protocol payload variant of `message`. Teammates negotiate shutdown and plan
 * approval by sending these objects instead of plain text, echoing the
 * originating `request_id` back with an `approve` verdict.
 */
export interface SendMessageProtocol {
  type?: string;
  request_id?: string;
  approve?: boolean;
  reason?: string;
  feedback?: string;
}

/**
 * Input to the `SendMessage` tool. `to` is a teammate name (or `"main"` for the
 * parent conversation) and `message` is either plain text or a protocol object.
 * `recipient` / `content` are the equivalent fields some adapters persist
 * alongside the canonical ones — read as fallbacks so older calls still render.
 */
export interface SendMessageParams {
  to?: string;
  summary?: string;
  message?: string | SendMessageProtocol;
  recipient?: string;
  content?: string;
}

/** Delivery receipt returned by the tool, JSON-encoded inside a text block. */
interface SendMessageReceipt {
  success?: boolean;
  message?: string;
  resumedAgentId?: string;
}

const PROTOCOL_LABELS: Record<string, string> = {
  shutdown_request: "Shutdown request",
  shutdown_response: "Shutdown response",
  plan_approval_request: "Plan approval request",
  plan_approval_response: "Plan approval response",
};

function parseReceipt(output: unknown): { receipt: SendMessageReceipt; raw: string } {
  const raw = toolOutputText(output);
  if (!raw) return { receipt: {}, raw: "" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { receipt: parsed as SendMessageReceipt, raw };
    }
  } catch {
    /* Not JSON — surface the text as-is. */
  }
  return { receipt: {}, raw };
}

export function SendMessageDisplay({
  params,
  output,
  isCompact = false,
}: {
  params: SendMessageParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const recipient = params.to || params.recipient || "";

  // Only an object `message` is a protocol handshake; a string one is the
  // teammate-visible body (older calls persist that body as `content`).
  const protocol =
    params.message && typeof params.message === "object" ? params.message : undefined;
  const body =
    typeof params.message === "string" ? params.message : params.content || "";

  const { receipt, raw } = parseReceipt(output);
  // The receipt restates the delivery outcome; only show it when it adds
  // something beyond the raw JSON we already parsed.
  const receiptText = receipt.message || (receipt.success === undefined ? raw : "");

  const protocolLabel = protocol?.type
    ? PROTOCOL_LABELS[protocol.type] ?? protocol.type
    : "";
  const headline = params.summary || protocolLabel || body || "message";

  const hasDetails = !!body || !!protocol || !!receiptText;

  return (
    <div>
      <ToolHeader
        icon={<SendMessage className="size-4" />}
        verb="Sent"
        hasDetails={hasDetails}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        {recipient && (
          <Text as="span" size="inherit" tone="subtle" weight="medium" className="shrink-0 max-w-40 truncate">
            {recipient}
          </Text>
        )}
        <span className={`truncate ${TOOL_ROW_TEXT}`}>
          {headline}
        </span>
      </ToolHeader>

      {hasDetails && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody as="div" className="text-s font-sans space-y-2">
            {protocol && (
              <div className="flex flex-wrap items-center gap-2">
                <Text as="span" size="inherit" tone="inherit" weight="medium">{protocolLabel}</Text>
                {protocol.approve !== undefined && (
                  <span
                    className={`rounded px-1.5 py-px text-t font-medium ${
                      protocol.approve
                        ? "bg-success/10 text-success"
                        : "bg-danger/10 text-danger"
                    }`}
                  >
                    {protocol.approve ? "approved" : "rejected"}
                  </span>
                )}
              </div>
            )}

            {protocol && (protocol.feedback || protocol.reason) && (
              <Text as="p" size="inherit" tone="subtle" className="whitespace-pre-wrap">
                {protocol.feedback || protocol.reason}
              </Text>
            )}

            {body && (
              <p className="noscrollbar whitespace-pre-wrap max-h-48 overflow-y-auto">
                {body}
              </p>
            )}

            {(receiptText || receipt.resumedAgentId) && (
              <Text as="div" size="t" tone="subtle" className="pt-1 border-t border-primary-100 dark:border-primary/10 space-y-0.5">
                {receiptText && (
                  <p className="whitespace-pre-wrap wrap-break-word">{receiptText}</p>
                )}
                {receipt.resumedAgentId && (
                  <div className="font-mono">
                    <Text as="span" size="inherit" tone="subtle">Resumed</Text>{" "}
                    {receipt.resumedAgentId}
                  </div>
                )}
              </Text>
            )}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}
