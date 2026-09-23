// ─────────────────────────────────────────────────────────────
// Resource Types
// ─────────────────────────────────────────────────────────────
export interface GithubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string | null;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  private: boolean;
  updatedAt: string | null;
  url?: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  avatarUrl: string | null;
  description: string | null;
  isPrivate: boolean;
  url?: string;
}

export interface AsanaProject {
  gid: string;
  name: string;
  archived: boolean;
  color: string | null;
  workspaceGid: string;
  workspaceName: string;
  teamGid?: string | null;
  teamName?: string | null;
  modifiedAt: string | null;
  public: boolean;
  url?: string;
}

export interface GitlabProject {
  id: number;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
  description: string | null;
  visibility: string;
  lastActivityAt: string | null;
  stars: number;
  forks: number;
  defaultBranch: string | null;
  private: boolean;
  url?: string;
}

export interface TrelloBoard {
  id: string;
  name: string;
  shortLink: string;
  shortUrl: string;
  desc: string;
  closed: boolean;
  organizationName?: string | null;
  url?: string;
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
  dateCreated: string;
  status: string;
  organization: string;
}

export interface SocketDevOrganization {
  id: string;
  slug: string;
  name: string;
  plan: string | null;
}

export interface ConnectionResource {
  id: string;
  connectionId: string;
  externalId: string;
  kind: string;
  name: string;
  url?: string | null;
  selected: boolean;
  metadata: string | null;
  lastSeenAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Connection State Types
// ─────────────────────────────────────────────────────────────
import type { connectionStates } from "../../db/schema";

export type ConnectionStateRecord = typeof connectionStates.$inferSelect;

export interface ConnectionStateResponse {
  id: string;
  displayName: string | null;
  iconPath: string | null;
  isConnected: boolean;
  connectionId: string | null;
  category: string | null;
  sortOrder: number;
  enabledFeatures: string | null;
  config: string | null;
}

export interface UpdateConnectionStateRequest {
  isConnected: boolean;
  connectionId?: string | null;
}

// ─────────────────────────────────────────────────────────────
// Credential Types
// ─────────────────────────────────────────────────────────────
export interface SaveCredentialsPayload {
  provider: string;
  connectionId: string;
  // Provider-specific fields
  token?: string;
  apiKey?: string;
  accessToken?: string;
  apiToken?: string;
  domain?: string;
  email?: string;
  [key: string]: unknown;
}

export interface ParsedCredentials {
  secrets: Record<string, string>;
  tokensForHash: string[];
}

export interface CredentialsCheckResult {
  hasCredentials: boolean;
  status: string;
  connectionId: string;
}

export interface SaveCredentialsResult {
  message: string;
}

// ─────────────────────────────────────────────────────────────
// Payload Types
// ─────────────────────────────────────────────────────────────
export interface SaveResourcesPayload {
  provider: string;
  connectionId: string;
  resources?: unknown[];
  sources?: string[];
}

