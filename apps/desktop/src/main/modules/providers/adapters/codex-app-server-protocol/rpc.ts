import type { InitializeParams } from "./generated/InitializeParams";
import type { InitializeResponse } from "./generated/InitializeResponse";
import type { ConfigValueWriteParams } from "./generated/v2/ConfigValueWriteParams";
import type { ConfigWriteResponse } from "./generated/v2/ConfigWriteResponse";
import type { ExperimentalFeatureListParams } from "./generated/v2/ExperimentalFeatureListParams";
import type { ExperimentalFeatureListResponse } from "./generated/v2/ExperimentalFeatureListResponse";
import type { GetAccountParams } from "./generated/v2/GetAccountParams";
import type { GetAccountRateLimitsResponse } from "./generated/v2/GetAccountRateLimitsResponse";
import type { GetAccountResponse } from "./generated/v2/GetAccountResponse";
import type { ModelListParams } from "./generated/v2/ModelListParams";
import type { ModelListResponse } from "./generated/v2/ModelListResponse";
import type { PluginInstallParams } from "./generated/v2/PluginInstallParams";
import type { PluginInstallResponse } from "./generated/v2/PluginInstallResponse";
import type { PluginInstalledParams } from "./generated/v2/PluginInstalledParams";
import type { PluginInstalledResponse } from "./generated/v2/PluginInstalledResponse";
import type { PluginListParams } from "./generated/v2/PluginListParams";
import type { PluginListResponse } from "./generated/v2/PluginListResponse";
import type { PluginReadParams } from "./generated/v2/PluginReadParams";
import type { PluginReadResponse } from "./generated/v2/PluginReadResponse";
import type { PluginUninstallParams } from "./generated/v2/PluginUninstallParams";
import type { PluginUninstallResponse } from "./generated/v2/PluginUninstallResponse";
import type { ReviewStartParams } from "./generated/v2/ReviewStartParams";
import type { ReviewStartResponse } from "./generated/v2/ReviewStartResponse";
import type { SkillsListParams } from "./generated/v2/SkillsListParams";
import type { SkillsListResponse } from "./generated/v2/SkillsListResponse";
import type { ThreadArchiveParams } from "./generated/v2/ThreadArchiveParams";
import type { ThreadArchiveResponse } from "./generated/v2/ThreadArchiveResponse";
import type { ThreadDeleteParams } from "./generated/v2/ThreadDeleteParams";
import type { ThreadDeleteResponse } from "./generated/v2/ThreadDeleteResponse";
import type { ThreadForkParams } from "./generated/v2/ThreadForkParams";
import type { ThreadForkResponse } from "./generated/v2/ThreadForkResponse";
import type { ThreadGoalClearParams } from "./generated/v2/ThreadGoalClearParams";
import type { ThreadGoalClearResponse } from "./generated/v2/ThreadGoalClearResponse";
import type { ThreadGoalGetParams } from "./generated/v2/ThreadGoalGetParams";
import type { ThreadGoalGetResponse } from "./generated/v2/ThreadGoalGetResponse";
import type { ThreadGoalSetParams } from "./generated/v2/ThreadGoalSetParams";
import type { ThreadGoalSetResponse } from "./generated/v2/ThreadGoalSetResponse";
import type { ThreadReadParams } from "./generated/v2/ThreadReadParams";
import type { ThreadReadResponse } from "./generated/v2/ThreadReadResponse";
import type { ThreadResumeParams } from "./generated/v2/ThreadResumeParams";
import type { ThreadResumeResponse } from "./generated/v2/ThreadResumeResponse";
import type { ThreadStartParams } from "./generated/v2/ThreadStartParams";
import type { ThreadStartResponse } from "./generated/v2/ThreadStartResponse";
import type { ThreadUnarchiveParams } from "./generated/v2/ThreadUnarchiveParams";
import type { ThreadUnarchiveResponse } from "./generated/v2/ThreadUnarchiveResponse";
import type { ThreadUnsubscribeParams } from "./generated/v2/ThreadUnsubscribeParams";
import type { ThreadUnsubscribeResponse } from "./generated/v2/ThreadUnsubscribeResponse";
import type { TurnInterruptParams } from "./generated/v2/TurnInterruptParams";
import type { TurnInterruptResponse } from "./generated/v2/TurnInterruptResponse";
import type { TurnStartParams } from "./generated/v2/TurnStartParams";
import type { TurnStartResponse } from "./generated/v2/TurnStartResponse";

interface RpcMethod<Params, Result> {
  params: Params;
  result: Result;
}

/**
 * Typed request/result pairs for every app-server RPC currently emitted by
 * codex.driver.ts, against Codex's generated 0.153.4 bindings. The snapshot is
 * generated with `--experimental`, so experimental fields the driver actually
 * sends — `collaborationMode` on turn/start, `dynamicTools` on thread/start —
 * are typed here rather than patched in at the call site.
 */
export interface CodexAppServerRpc {
  initialize: RpcMethod<InitializeParams, InitializeResponse>;
  "account/read": RpcMethod<GetAccountParams, GetAccountResponse>;
  "account/rateLimits/read": RpcMethod<
    undefined,
    GetAccountRateLimitsResponse
  >;
  "experimentalFeature/list": RpcMethod<
    ExperimentalFeatureListParams,
    ExperimentalFeatureListResponse
  >;
  "skills/list": RpcMethod<SkillsListParams, SkillsListResponse>;

  "config/value/write": RpcMethod<ConfigValueWriteParams, ConfigWriteResponse>;
  "model/list": RpcMethod<ModelListParams, ModelListResponse>;
  "plugin/install": RpcMethod<PluginInstallParams, PluginInstallResponse>;
  "plugin/installed": RpcMethod<PluginInstalledParams, PluginInstalledResponse>;
  "plugin/list": RpcMethod<PluginListParams, PluginListResponse>;
  "plugin/read": RpcMethod<PluginReadParams, PluginReadResponse>;
  "plugin/uninstall": RpcMethod<
    PluginUninstallParams,
    PluginUninstallResponse
  >;
  "review/start": RpcMethod<ReviewStartParams, ReviewStartResponse>;
  "thread/archive": RpcMethod<ThreadArchiveParams, ThreadArchiveResponse>;
  "thread/delete": RpcMethod<ThreadDeleteParams, ThreadDeleteResponse>;
  "thread/fork": RpcMethod<ThreadForkParams, ThreadForkResponse>;
  "thread/goal/clear": RpcMethod<
    ThreadGoalClearParams,
    ThreadGoalClearResponse
  >;
  "thread/goal/get": RpcMethod<ThreadGoalGetParams, ThreadGoalGetResponse>;
  "thread/goal/set": RpcMethod<ThreadGoalSetParams, ThreadGoalSetResponse>;
  "thread/read": RpcMethod<ThreadReadParams, ThreadReadResponse>;
  "thread/resume": RpcMethod<ThreadResumeParams, ThreadResumeResponse>;
  "thread/start": RpcMethod<ThreadStartParams, ThreadStartResponse>;
  "thread/unarchive": RpcMethod<ThreadUnarchiveParams, ThreadUnarchiveResponse>;
  "thread/unsubscribe": RpcMethod<
    ThreadUnsubscribeParams,
    ThreadUnsubscribeResponse
  >;
  "turn/interrupt": RpcMethod<TurnInterruptParams, TurnInterruptResponse>;
  "turn/start": RpcMethod<TurnStartParams, TurnStartResponse>;
}

export type CodexAppServerMethod = keyof CodexAppServerRpc;
export type CodexAppServerParams<Method extends CodexAppServerMethod> =
  CodexAppServerRpc[Method]["params"];
export type CodexAppServerResult<Method extends CodexAppServerMethod> =
  CodexAppServerRpc[Method]["result"];
