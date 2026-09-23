export { registerProvidersIpc, unregisterProvidersIpc } from "./providers.ipc";
export { providersService } from "./providers.service";
export type {
  ProviderKind,
  ProviderConfig,
  ProviderCapabilities,
  CreateProviderPayload,
  UpdateProviderPayload,
  ProviderResponse,
  ProviderListResponse,
} from "./providers.dto";

// Adapters
export {
  createWorkAdapter,
  getWorkAdapter,
  shutdownWorkAdapter,
  shutdownAllWorkAdapters,
  clearAdapterCache,
  isSupportedWorkProvider,
  SUPPORTED_WORK_PROVIDERS,
} from "./adapters";

export type {
  WorkRunContextItem,
  WorkRunRequest,
  WorkRunLogEvent,
  WorkRunToolCallEvent,
  WorkRunArtifactEvent,
  WorkRunStatusEvent,
  WorkRunEvent,
  WorkRunArtifactSummary,
  WorkRunResult,
  WorkRunEventHandler,
  WorkRunAdapter,
  CopilotAdapterConfig,
  ClaudeCodeAdapterConfig,
  SupportedWorkProvider,
} from "./adapters";
