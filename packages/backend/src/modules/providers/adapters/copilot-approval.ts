import type { PermissionRequest } from "@github/copilot-sdk";
import type { ToolApprovalRequest } from "../../runs/runs.dto";

type ApprovalDetails = Pick<ToolApprovalRequest, "toolName" | "toolInput" | "header" | "question" | "description">;

/** Copilot permission categories are not tool names. Project them into the
 * same action/input vocabulary used by the other providers' approval UI. */
export function mapCopilotPermissionApproval(request: PermissionRequest): ApprovalDetails {
  const description = permissionDescription(request);
  const common = description ? { description } : {};
  switch (request.kind) {
    case "write": {
      const diff = request.diff ?? "";
      const newFile = /^(?:--- \/dev\/null|new file mode \d+)(?:\r?$)/m.test(diff);
      const toolName = /^\+\+\+ \/dev\/null(?:\r?$)/m.test(diff) ? "Delete"
        : newFile || (!diff && request.newFileContents !== undefined) ? "Write"
        : "Edit";
      return {
        ...common,
        toolName,
        question: toolName === "Delete" ? "Allow deleting this file?"
          : newFile ? "Allow creating this file?"
          : toolName === "Write" ? "Allow writing this file?" : "Allow editing this file?",
        toolInput: {
          file_path: request.resolvedPath || request.fileName,
          ...(diff ? { diff } : {}),
          ...(request.newFileContents !== undefined ? { content: request.newFileContents } : {}),
        },
      };
    }
    case "shell":
      return { ...common, toolName: "Bash", question: "Allow running this command?", toolInput: {
        command: request.fullCommandText,
        ...(request.resolvedWorkingDirectory ? { cwd: request.resolvedWorkingDirectory } : {}),
      } };
    case "read":
      return { ...common, toolName: "Read", question: "Allow reading this file?",
        toolInput: { file_path: request.resolvedPath || request.path } };
    case "url":
      return { ...common, toolName: "WebFetch", question: "Allow accessing this URL?", toolInput: {
        url: request.url,
        ...(request.redirectedFrom ? { redirected_from: request.redirectedFrom } : {}),
      } };
    case "mcp": {
      const toolName = request.toolName.startsWith("mcp__") ? request.toolName
        : `mcp__${request.serverName}__${request.toolName}`;
      return { toolName,
        header: request.toolTitle || request.toolName,
        question: `Allow ${request.toolTitle || request.toolName}?`,
        description: `MCP server: ${request.serverName}`,
        toolInput: copilotApprovalInput(request.args, toolName) };
    }
    case "custom-tool":
      return { toolName: request.toolName, question: `Allow ${request.toolName}?`,
        description: request.toolDescription || undefined, toolInput: copilotApprovalInput(request.args, request.toolName) };
    case "hook":
      return { toolName: request.toolName, question: `Allow ${request.toolName}?`,
        description: request.hookMessage, toolInput: copilotApprovalInput(request.toolArgs, request.toolName) };
    case "memory":
      return { toolName: "Memory", question: request.action === "vote" ? "Allow updating this memory's rating?" : "Allow saving this memory?",
        description: request.reason, toolInput: displayParams([
          ["Memory", request.fact], ["Subject", request.subject], ["Scope", request.scope],
          ["Repository", request.repoNwo], ["Rating", request.direction], ["Sources", request.citations],
        ]) };
    case "extension-management":
      return { toolName: "Extension", question: `Allow extension ${request.operation}?`,
        toolInput: displayParams([["Extension", request.extensionName]]) };
    case "extension-permission-access":
      return { toolName: "Extension permissions", question: "Allow these extension capabilities?",
        toolInput: displayParams([["Extension", request.extensionName], ["Capabilities", request.capabilities.join(", ")]]) };
    case "extension-env-access":
      return { toolName: "Environment access", question: "Allow this extension to access these environment variables?",
        toolInput: displayParams([["Extension", request.extensionName], ["Variables", request.environmentVariables.join(", ")]]) };
    case "workflow":
      return { toolName: "Workflow", header: request.name, question: request.operation === "author" ? "Allow authoring this workflow?" : "Allow running this workflow?",
        description: request.description, toolInput: displayParams([
          ["Operation", request.operation],
          ["Phases", request.phases.map((phase) => phase.detail ? `${phase.title}: ${phase.detail}` : phase.title).join("\n")],
          ["AI credits", request.maxAiCredits ?? request.declaredMaxAiCredits],
          ["Concurrent subagents", request.maxConcurrentSubagents ?? request.declaredMaxConcurrentSubagents],
          ["Total subagents", request.maxTotalSubagents ?? request.declaredMaxTotalSubagents],
          ["Timeout (seconds)", request.timeoutSeconds ?? request.declaredTimeoutSeconds],
        ]) };
    default: {
      // Keep useful fields from newer external runtimes without leaking the
      // protocol ids and policy switches into the approval's parameter table.
      const { kind, toolCallId: _toolCallId, managedApprovalRequired: _managed, ...input } = request as
        PermissionRequest & { kind: string; toolCallId?: string; managedApprovalRequired?: boolean };
      return { toolName: "Permission", question: `Allow ${kind} permission?`, toolInput: input };
    }
  }
}

export function copilotApprovalInput(args: unknown, toolName?: string): Record<string, unknown> {
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { /* Preserve a literal string argument. */ }
  }
  if (args === undefined || args === null) return {};
  const input = typeof args === "object" && !Array.isArray(args)
    ? args as Record<string, unknown> : { args };
  // MCP argument names such as `message`, `url` and `_meta` are actual inputs,
  // not the host's approval metadata. The curated list keeps them visible.
  if (toolName?.startsWith("mcp__")) {
    return displayParams(Object.entries(input).map(([name, value]) => [
      name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase()), value,
    ]), true);
  }
  return input;
}

function displayParams(entries: Array<[string, unknown]>, keepEmpty = false): Record<string, unknown> {
  return { _meta: { tool_params_display: entries
    .filter(([, value]) => value !== undefined && (keepEmpty || (value !== null && value !== "")))
    .map(([display_name, value]) => ({ display_name, value })) } };
}

function permissionDescription(request: PermissionRequest): string {
  const lines: string[] = [];
  if ("intention" in request && request.intention) lines.push(request.intention);
  if ("warning" in request && request.warning) lines.push(request.warning);
  if ("requestSandboxBypass" in request && request.requestSandboxBypass) {
    lines.push(request.requestSandboxBypassReason || "Requests execution outside the sandbox.");
  } else if ("requestSandboxPermissive" in request && request.requestSandboxPermissive) {
    lines.push("Requests a more permissive sandbox.");
  }
  if ("sandboxPathGrant" in request && request.sandboxPathGrant) {
    const grant = request.sandboxPathGrant;
    lines.push(`Requests ${grant.access === "readWrite" ? "read and write" : "read"} access to ${grant.path}.`);
  }
  return [...new Set(lines)].join("\n");
}
