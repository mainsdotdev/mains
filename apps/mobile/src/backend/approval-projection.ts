import type { ToolApprovalRequest } from "@mains/contracts/runs";

import type { PendingApprovalRow } from "../db/schema";

/** Cache the request, never the user's local form answers. */
export function approvalRow(backendId: string, request: ToolApprovalRequest, expiresAt: number): PendingApprovalRow {
  return {
    backendId,
    requestId: request.requestId,
    runId: request.runId,
    kind: request.kind,
    toolName: request.toolName,
    header: request.header ?? null,
    question: request.question ?? null,
    optionsJson: request.options ? JSON.stringify(request.options) : null,
    multiSelect: Boolean(request.multiSelect),
    description: request.description ?? null,
    toolInputJson: request.toolInput ? JSON.stringify(request.toolInput) : null,
    requestedAt: new Date(request.timestamp),
    expiresAt: new Date(expiresAt),
    isOther: Boolean(request.isOther),
    isSecret: Boolean(request.isSecret),
    elicitationMode: request.elicitationMode ?? null,
    requestedSchemaJson: request.requestedSchema ? JSON.stringify(request.requestedSchema) : null,
    suppressAlwaysAllowRule: Boolean(request.suppressAlwaysAllowRule),
    url: request.url ?? null,
  };
}
