import { shell } from "electron";
import type {
  ToolApprovalRequest,
  ToolApprovalResponse,
} from "../../runs/runs.dto";
import { requestToolApproval } from "../../runs/user-input-broker";
import { guardsService } from "../../guards/guards.service";
import type { MainsToolContext } from "./mains-tools.core";
import {
  dispatchMainsTool,
  toCodexDynamicTools,
} from "./mains-tools.registry";
import {
  createLogger,
  type AdapterLogger,
} from "./adapter.shared";

export interface CodexServerResponder {
  respondToRequest(
    id: number | string,
    result: unknown,
  ): void;
  respondToRequestError(
    id: number | string,
    code: number,
    message: string,
  ): void;
}

export interface CodexRequestRunState {
  fileChangeItems: Map<
    string,
    Array<{ path: string; kind: string; diff?: string }>
  >;
  approvedElicitationServers?: Set<string>;
}

export interface CodexServerRequest {
  server: CodexServerResponder;
  id: number | string;
  method: string;
  params: unknown;
  runId: string;
  runIsDead: boolean;
}

interface CodexRequestBrokerOptions {
  getRunState: (
    runId: string,
  ) => CodexRequestRunState | undefined;
  getMainsToolContext: (
    runId: string,
  ) => MainsToolContext | undefined;
  requestApproval?: (
    request: ToolApprovalRequest,
  ) => Promise<ToolApprovalResponse>;
  checkCommand?: (
    command: string,
  ) => Promise<{ blocked: boolean }>;
  dispatchTool?: typeof dispatchMainsTool;
  openExternal?: (url: string) => Promise<unknown>;
  logger?: AdapterLogger;
  now?: () => number;
}

/**
 * Owns Codex app-server request decisions and guarantees one protocol-shaped
 * response for every supported request.
 */
export function createCodexRequestBroker(
  options: CodexRequestBrokerOptions,
) {
  const getRunState = options.getRunState;
  const getMainsToolContext =
    options.getMainsToolContext;
  const requestApproval =
    options.requestApproval ?? requestToolApproval;
  const checkCommand =
    options.checkCommand ??
    ((command: string) => guardsService.checkCommand(command));
  const dispatchTool =
    options.dispatchTool ?? dispatchMainsTool;
  const openExternal =
    options.openExternal ??
    ((url: string) => shell.openExternal(url));
  const logger =
    options.logger ?? createLogger("[CodexRequestBroker]");
  const now = options.now ?? Date.now;
  const mainsToolNames = new Set(
    toCodexDynamicTools().map((tool) => tool.name),
  );

  function parseToolArguments(
    value: unknown,
  ): Record<string, unknown> {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : {};
      } catch {
        return {};
      }
    }
    return value &&
      typeof value === "object" &&
      !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  async function handleRequest(
    request: CodexServerRequest,
  ): Promise<void> {
    const {
      server,
      id,
      method,
      params,
      runId,
      runIsDead,
    } = request;
  // If the run was aborted or already resolved, codex shouldn't be
  // popping approval dialogs. Auto-decline anything that would surface
  // UI so a stale background turn can't grab the user's attention.
  if (runIsDead) {
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval"
    ) {
      server.respondToRequest(id, { decision: "decline" });
      return;
    }
    if (method === "item/permissions/requestApproval") {
      server.respondToRequest(id, { permissions: {}, scope: "turn" });
      return;
    }
    if (method === "item/tool/requestUserInput") {
      // Empty answers map matches the timeout/fallback shape codex expects.
      server.respondToRequest(id, { answers: {} });
      return;
    }
    if (method === "mcpServer/elicitation/request") {
      server.respondToRequest(id, {
        action: "cancel",
        content: null,
        _meta: null,
      });
      return;
    }
    // Pass through auth/tool-call requests; refusing them mid-flight can
    // wedge codex's internal state worse than letting them complete.
  }

  const p = params as Record<string, unknown> | undefined;
  switch (method) {
    // Command exec approval. Payload carries command, cwd, optional
    // commandActions/reason. Dispatch to the renderer's Bash preview.
    // Response shape: { decision: "accept" | "acceptForSession" | "decline" | "cancel" }.
    case "item/commandExecution/requestApproval": {
      const command = (p?.command as string) ?? "";
      const cwd = (p?.cwd as string) ?? undefined;
      const reason = (p?.reason as string) ?? undefined;
      const networkApprovalContext = p?.networkApprovalContext as
        | { host?: string; protocol?: string }
        | null
        | undefined;
      const displayCommand =
        command ||
        (
          networkApprovalContext?.host
            ? `Network access: ${networkApprovalContext.protocol ?? "https"}://${networkApprovalContext.host}`
            : "Command approval"
        );

      // Dependency guard check — intercept install commands before approval
      let guardResult: { blocked: boolean };
      try {
        guardResult = command
          ? await checkCommand(command)
          : { blocked: false };
      } catch (error) {
        logger.error("Command guard failed:", error);
        server.respondToRequest(id, { decision: "decline" });
        break;
      }
      if (guardResult.blocked) {
        server.respondToRequest(id, { decision: "decline" });
        break;
      }

      try {
        const result = await requestApproval({
          requestId: String(id),
          runId,
          toolName: "Bash",
          toolInput: {
            command: displayCommand,
            ...(cwd ? { cwd } : {}),
            ...(reason ? { description: reason } : {}),
            ...(networkApprovalContext
              ? { networkApprovalContext }
              : {}),
            ...(p?.commandActions
              ? { commandActions: p.commandActions }
              : {}),
            ...(p?.proposedExecpolicyAmendment
              ? {
                  proposedExecpolicyAmendment:
                    p.proposedExecpolicyAmendment,
                }
              : {}),
            ...(p?.proposedNetworkPolicyAmendments
              ? {
                  proposedNetworkPolicyAmendments:
                    p.proposedNetworkPolicyAmendments,
                }
              : {}),
            ...(p?.environmentId
              ? { environmentId: p.environmentId }
              : {}),
          },
          kind: "tool_approval",
          timestamp: now(),
        });
        const decision = !result.approved ? "decline"
          : result.answer === "acceptForSession" ? "acceptForSession"
          : "accept";
        server.respondToRequest(id, { decision });
      } catch {
        server.respondToRequest(id, { decision: "decline" });
      }
      break;
    }

    // File change approval. Payload only carries itemId/reason — look
    // up the previously-cached fileChange item details to render
    // path/kind in the approval dialog. When multiple files share the
    // same patch, we surface them under a generic "FileChange" tool so
    // the dialog falls back to the key/value table renderer.
    case "item/fileChange/requestApproval": {
      const itemId = (p?.itemId as string) ?? (p?.item_id as string) ?? "";
      const reason = (p?.reason as string) ?? undefined;
      const cached = itemId ? getRunState(runId)?.fileChangeItems.get(itemId) : undefined;

      const single = cached && cached.length === 1 ? cached[0] : undefined;
      const toolName = single
        ? (single.kind === "delete" ? "Delete"
          : (single.kind === "add" || single.kind === "create") ? "Write"
          : "Edit")
        : "FileChange";

      const kindLabel = (k: string): string =>
        k === "delete" ? "Delete"
        : k === "add" || k === "create" ? "Add"
        : "Edit";

      const toolInput: Record<string, unknown> = single
        ? {
            file_path: single.path,
            ...(single.diff ? { diff: single.diff } : {}),
            ...(reason ? { description: reason } : {}),
          }
        : {
            _meta: {
              tool_params_display: (cached ?? []).map((c) => ({
                display_name: kindLabel(c.kind),
                value: c.path,
              })),
              ...(reason ? { subtitle: reason } : {}),
            },
          };

      try {
        const result = await requestApproval({
          requestId: String(id),
          runId,
          toolName,
          toolInput,
          kind: "tool_approval",
          timestamp: now(),
        });
        const decision = !result.approved ? "decline"
          : result.answer === "acceptForSession" ? "acceptForSession"
          : "accept";
        server.respondToRequest(id, { decision });
      } catch {
        server.respondToRequest(id, { decision: "decline" });
      }
      break;
    }

    // Permissions request — model is asking for elevated network/fs permissions.
    // Response shape: { permissions: GrantedPermissionProfile, scope: "turn" | "session" }
    // (NOT a decision). See v2.rs::PermissionsRequestApprovalResponse.
    case "item/permissions/requestApproval": {
      const requestedPermissions = (p?.permissions ?? {}) as Record<string, unknown>;
      const reason = (p?.reason as string) ?? "elevated permissions";

      try {
        const result = await requestApproval({
          requestId: String(id),
          runId,
          toolName: "Permission",
          toolInput: { command: reason, permissions: requestedPermissions },
          kind: "tool_approval",
          timestamp: now(),
        });
        if (result.approved) {
          // Echo back the requested permissions to grant them; pick scope
          // based on whether the user opted into session-wide grant.
          server.respondToRequest(id, {
            permissions: requestedPermissions,
            scope: result.answer === "acceptForSession" ? "session" : "turn",
          });
        } else {
          // Empty permissions = decline (grant nothing)
          server.respondToRequest(id, { permissions: {}, scope: "turn" });
        }
      } catch {
        server.respondToRequest(id, { permissions: {}, scope: "turn" });
      }
      break;
    }

    // User input requests — Codex's structured Q&A (one or more questions
    // with optional choices). The approval dialog only renders ONE
    // question at a time, so we dispatch each question sequentially with
    // its own dialog, collect all answers, then send a single batched
    // response back to codex. If the user dismisses any question, the
    // remaining questions are auto-answered with empty arrays.
    case "item/tool/requestUserInput": {
      const questions = p?.questions as Array<Record<string, unknown>> | undefined;
      if (!questions || questions.length === 0) {
        server.respondToRequest(id, { answers: {} });
        break;
      }

      const normalizeOptions = (q: Record<string, unknown>) => {
        const raw = q.options as Array<Record<string, unknown>> | undefined;
        if (!raw || raw.length === 0) return undefined;
        return raw.map((o) => ({
          label: (o.label as string) ?? (o.description as string) ?? "",
          description: (o.description as string | undefined) ?? undefined,
        })).filter((o) => o.label);
      };

      const answers: Record<string, { answers: string[] }> = {};
      let aborted = false;
      const autoResolutionMs =
        typeof p?.autoResolutionMs === "number"
          ? p.autoResolutionMs
          : undefined;

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qId = (q.id as string) ?? (q.questionId as string);
        if (!qId) continue;

        if (aborted) {
          answers[qId] = { answers: [] };
          continue;
        }

        const text =
          (q.question as string) ??
          (q.text as string) ??
          (q.description as string) ??
          "";
        const opts = normalizeOptions(q);
        try {
          const result = await requestApproval({
            // Synthetic per-question requestId so each dialog has a
            // unique broker key while still sharing the codex JSON-RPC id.
            requestId: questions.length === 1 ? String(id) : `${id}-q${i}`,
            runId,
            toolName: "UserInput",
            kind: "ask_user",
            header: (q.header as string) || undefined,
            question: text,
            options: opts,
            multiSelect: false,
            isOther: q.isOther === true,
            isSecret: q.isSecret === true,
            autoResolutionMs,
            timestamp: now(),
          });
          if (!result.approved) {
            answers[qId] = { answers: [] };
            aborted = true;
            continue;
          }
          const parts = result.answer
            ? result.answer.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
          const fallback = opts?.[0]?.label ?? "yes";
          answers[qId] = { answers: parts.length > 0 ? parts : [fallback] };
        } catch {
          answers[qId] = { answers: [] };
          aborted = true;
        }
      }

      server.respondToRequest(id, { answers });
      break;
    }

    // Auth token refresh — the server asks the client to supply fresh tokens.
    // ChatgptAuthTokensRefreshResponse requires { accessToken, chatgptAccountId },
    // which we don't manage from the renderer. Returning an empty {} would
    // fail serde deserialization on the codex side. Reject with -32601 so
    // codex falls back to its own auth.json refresh flow.
    case "account/chatgptAuthTokens/refresh": {
      logger.info("Auth token refresh requested by app-server; deferring to codex auth.json");
      server.respondToRequestError(
        id,
        -32601,
        "Client does not manage ChatGPT tokens; use auth.json fallback",
      );
      break;
    }

    case "currentTime/read": {
      server.respondToRequest(id, {
        currentTimeAt: Math.floor(now() / 1000),
      });
      break;
    }

    // Dynamic tool calls — dispatch mains tools
    case "item/tool/call": {
      const toolParams =
        params as Record<string, unknown> | undefined;
      const toolName =
        toolParams?.tool as string | undefined;
      const toolArgs = parseToolArguments(
        toolParams?.arguments,
      );
      if (toolName && mainsToolNames.has(toolName)) {
        const ctx =
          getMainsToolContext(runId) ?? {
            workspaceId: null,
            rootPath: null,
            runId: null,
          };

        try {
          const result = await dispatchTool(
            toolName,
            toolArgs,
            ctx,
          );
          const contentItems = result.content.map((item) => ({
            type: "inputText" as const,
            text: item.text,
          }));
          server.respondToRequest(id, {
            contentItems,
            success: !result.isError,
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);
          logger.error(
            `Mains tool ${toolName} failed:`,
            message,
          );
          server.respondToRequest(id, {
            contentItems: [{
              type: "inputText",
              text: `Error: ${message}`,
            }],
            success: false,
          });
        }
      } else {
        server.respondToRequestError(
          id,
          -32601,
          `Unknown dynamic tool: ${toolName ?? "undefined"}`,
        );
      }
      break;
    }

    // App / connector action approvals (Google Calendar create event,
    // Gmail send, Notion edit, …). Codex routes app-tool approvals
    // through MCP elicitation.
    case "mcpServer/elicitation/request": {
      const serverName =
        (p?.serverName as string) ?? "App";
      const mode = (p?.mode as string) ?? "form";
      const url = p?.url as string | undefined;
      const sessionKey = serverName.toLowerCase();
      const requestedSchema = p?.requestedSchema as
        | Record<string, unknown>
        | undefined;
      const requiredFields = Array.isArray(
        requestedSchema?.required,
      )
        ? requestedSchema.required.filter(
            (field): field is string =>
              typeof field === "string",
          )
        : [];
      const canAcceptWithoutFormValues =
        mode === "url" || requiredFields.length === 0;

      if (
        mode !== "url" &&
        getRunState(runId)?.approvedElicitationServers
          ?.has(sessionKey)
      ) {
        server.respondToRequest(
          id,
          canAcceptWithoutFormValues
            ? { action: "accept", content: {}, _meta: null }
            : {
                action: "decline",
                content: null,
                _meta: null,
              },
        );
        break;
      }

      logger.info(
        `[mcpServer/elicitation/request] server=${serverName}, mode=${mode}`,
      );

      try {
        const result = await requestApproval({
          requestId: String(id),
          runId,
          toolName: serverName,
          toolInput: { ...(p ?? {}) },
          kind: "tool_approval",
          timestamp: now(),
        });

        if (!result.approved || !canAcceptWithoutFormValues) {
          server.respondToRequest(id, {
            action: "decline",
            content: null,
            _meta: null,
          });
        } else {
          if (mode === "url" && url) {
            openExternal(url).catch((error) =>
              logger.warn(
                `Failed to open elicitation URL: ${error}`,
              ),
            );
          }
          if (
            mode !== "url" &&
            result.answer === "acceptForSession"
          ) {
            const runState = getRunState(runId);
            if (runState) {
              (
                runState.approvedElicitationServers ??=
                  new Set()
              ).add(sessionKey);
            }
          }
          server.respondToRequest(id, {
            action: "accept",
            content: mode === "url" ? null : {},
            _meta: null,
          });
        }
      } catch {
        server.respondToRequest(id, {
          action: "decline",
          content: null,
          _meta: null,
        });
      }
      break;
    }

    // Unknown — error
    default: {
      logger.warn(`Unsupported server request: ${method}`);
      server.respondToRequestError(id, -32601, `Unsupported server request: ${method}`);
      break;
    }
  }
}

  function rejectInactive(
    server: CodexServerResponder,
    id: number | string,
    method: string,
  ): void {
    switch (method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        server.respondToRequest(id, { decision: "decline" });
        return;
      case "item/permissions/requestApproval":
        server.respondToRequest(id, {
          permissions: {},
          scope: "turn",
        });
        return;
      case "item/tool/requestUserInput":
        server.respondToRequest(id, { answers: {} });
        return;
      case "mcpServer/elicitation/request":
        server.respondToRequest(id, {
          action: "cancel",
          content: null,
          _meta: null,
        });
        return;
      case "currentTime/read":
        server.respondToRequest(id, {
          currentTimeAt: Math.floor(now() / 1000),
        });
        return;
      case "account/chatgptAuthTokens/refresh":
        server.respondToRequestError(
          id,
          -32601,
          "Client does not manage ChatGPT tokens; use auth.json fallback",
        );
        return;
      default:
        server.respondToRequestError(
          id,
          -32601,
          `No active run for server request: ${method}`,
        );
    }
  }

  return {
    handleRequest,
    rejectInactive,
  };
}

export type CodexRequestBroker = ReturnType<
  typeof createCodexRequestBroker
>;
