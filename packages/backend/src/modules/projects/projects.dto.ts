// ─────────────────────────────────────────────────────────────
// Project DTOs
// ─────────────────────────────────────────────────────────────

export interface ProjectResponse {
  id: string;
  accountId: string;
  name: string;
  rootPath: string;
  workspacesPath: string | null;
  branches: string[] | null;
  remoteOrigin: string | null;
  defaultBranch: string | null;
  setupScript: string | null;
  runScript: string | null;
  archiveScript: string | null;
  icon: string | null;
  commitInstructions: string | null;
  prInstructions: string | null;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectPayload {
  id?: string;
  accountId: string;
  name: string;
  rootPath: string;
  remoteOrigin?: string | null;
  workspacesPath?: string;
  branches?: string[];
  defaultBranch?: string;
  setupScript?: string;
  runScript?: string;
  archiveScript?: string;
  icon?: string;
  commitInstructions?: string;
  prInstructions?: string;
}

export interface UpdateProjectPayload {
  name?: string;
  rootPath?: string;
  workspacesPath?: string;
  branches?: string[];
  remoteOrigin?: string | null;
  defaultBranch?: string;
  setupScript?: string;
  runScript?: string;
  archiveScript?: string;
  icon?: string | null;
  commitInstructions?: string;
  prInstructions?: string;
}

// ─────────────────────────────────────────────────────────────
// Project Resources DTOs (formerly workspaceResources/)
// ─────────────────────────────────────────────────────────────

export interface ProjectResource {
  id: string;
  projectId: string;
  resourceId: string;
  createdAt: Date;
}

export interface ProjectResourceWithDetails extends ProjectResource {
  resource: {
    id: string;
    connectionId: string;
    externalId: string;
    kind: string;
    name: string | null;
    url: string | null;
    metadata: string | null;
  };
}

export interface AvailableResource {
  id: string;
  connectionId: string;
  externalId: string;
  kind: string;
  name: string | null;
  url: string | null;
  metadata: string | null;
  isLinked: boolean;
}

export interface AddResourcePayload {
  projectId: string;
  resourceId: string;
}

export interface RemoveResourcePayload {
  projectId: string;
  resourceId: string;
}

