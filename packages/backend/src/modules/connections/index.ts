export { registerConnectionsHandlers, unregisterConnectionsHandlers } from "./connections.ipc";
export { connectionsService, getConnectionWithSecrets } from "./connections.service";

// Only safe-to-share helpers leak across the seam. Crypto / provider-secret
// parsing stay private — cross-module callers should use the named helper
// `getConnectionWithSecrets` instead of touching the crypto layer.
export {
  formatSourceName,
  parseConnectionMetadata,
  parseResourceMetadata,
} from "./connections.utils";

export type {
  GithubRepo,
  LinearTeam,
  JiraProject,
  AsanaProject,
  GitlabProject,
  TrelloBoard,
  SentryProject,
  SocketDevOrganization,
  ConnectionResource,
  ConnectionStateRecord,
  ConnectionStateResponse,
  UpdateConnectionStateRequest,
  SaveResourcesPayload,
  SaveCredentialsPayload,
  ParsedCredentials,
  CredentialsCheckResult,
  SaveCredentialsResult,
} from "./connections.dto";
