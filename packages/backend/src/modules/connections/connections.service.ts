import { captureConnectionLease, connectionsAccepting, mutateConnection, readConnection, type ConnectionLease } from "./connection-lifecycle";
import { Octokit } from "@octokit/rest";
import { LinearClient } from "@linear/sdk";
import { connectionsRepo } from "./connections.repo";
import {
  startGitHubDeviceFlow,
  pollGitHubDeviceFlow,
  type GitHubDeviceAuthorization,
  type GitHubDevicePollResult,
} from "./github-device-flow";
import {
  parseConnectionMetadata,
  parseResourceMetadata,
  encryptSecrets,
  decryptSecrets,
  tryDecryptSecrets,
  createTokenHash,
  parseProviderCredentials,
} from "./connections.utils";
import {
  validateConnectionStateId,
  validateUpdateStatePayload,
} from "./connections.validation";
import type {
  GithubRepo,
  LinearTeam,
  JiraProject,
  AsanaProject,
  GitlabProject,
  TrelloBoard,
  SentryProject,
  SocketDevOrganization,
  SaveResourcesPayload,
  SaveCredentialsPayload,
  SaveCredentialsResult,
  CredentialsCheckResult,
  ConnectionStateResponse,
} from "./connections.dto";
import { getBackendRuntime } from "../../runtime/backend-runtime";

// ─────────────────────────────────────────────────────────────
// Non-secret metadata fields per provider
// ─────────────────────────────────────────────────────────────
const PROVIDER_METADATA_FIELDS: Record<string, string[]> = {
  jira: ["domain", "email"],
  gitlab: ["domain"],
  sentry: ["organization"],
  socketdev: ["organization"],
};

const PROVIDER_METADATA_DEFAULTS: Record<string, Record<string, string>> = {
  gitlab: { domain: "gitlab.com" },
};

async function getRuntimeCredentialSecrets(
  connectionId: string,
): Promise<Record<string, string> | null> {
  const format = getBackendRuntime().secretStorage.format;
  const current = await connectionsRepo.findCurrentToken(connectionId, format);
  if (current?.accessTokenEnc) {
    return decryptSecrets(current.accessTokenEnc as Buffer);
  }

  // Rows written before encryption formats were persisted are retained as an
  // upgrade bridge. Either runtime may probe them; an incompatible host simply
  // treats the credential as unavailable and asks for its own authorization.
  const unversioned = await connectionsRepo.findCurrentToken(
    connectionId,
    "unversioned",
  );
  if (!unversioned?.accessTokenEnc) return null;
  return tryDecryptSecrets(unversioned.accessTokenEnc as Buffer);
}

// ─────────────────────────────────────────────────────────────
// Cross-module helper: hand callers a connection + decrypted secrets.
// Exported from index.ts as the single named entry point used by
// sync, guards, and imageProxy. Internal callers in this service use
// `getConnectionAndSecrets` below, which also surfaces the typed
// connection row for follow-up queries on metadata.
// ─────────────────────────────────────────────────────────────
export async function getConnectionWithSecrets(
  provider: string,
  connectionId?: string,
): Promise<{
  id: string;
  secrets: Record<string, string>;
  metadata: Record<string, unknown>;
  lease?: ConnectionLease;
} | null> {
  if (!connectionsAccepting()) return null;
  return readConnection(async () => {
    const lease = captureConnectionLease(provider);
    if (!lease.current()) return null;
    // Identity and fingerprint share one synchronous read boundary. Capturing
    // the fingerprint after an awaited identity could bind old metadata/status
    // to a newer credential snapshot.
    const connection = connectionsRepo.credentialIdentity(provider, connectionId);
    if (!connection || connection.provider !== provider || connection.status !== "active") return null;

    const fingerprint = connectionsRepo.credentialFingerprint(connection.id);
    const secrets = await getRuntimeCredentialSecrets(connection.id);
    const current = () => lease.current() && connectionsRepo.credentialFingerprint(connection.id) === fingerprint;
    if (!secrets || !current()) return null;

    return {
      lease: {
        revision: lease.revision, current,
        assertCurrent() {
          if (!current()) throw new Error("This connection changed. Refresh it and try again.");
        },
      },
      id: connection.id,
      secrets,
      metadata: parseConnectionMetadata(connection.metadata),
    };
  });
}

/** Identity for sync admission/coalescing, without exposing credentials. */
export function connectionSyncRevision(provider: string): string {
  return `${captureConnectionLease(provider).revision}:${connectionsRepo.syncScopeFingerprint(provider)}`;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Bind discovery to an active account of the requested provider. */
async function getConnectionAndSecrets(connectionId: string, provider: string) {
  if (!connectionId) throw new Error("connectionId is required");
  const result = await getConnectionWithSecrets(provider, connectionId);
  if (!result) throw new Error("Connection not found or credentials unavailable for this provider");
  return { connection: { metadata: JSON.stringify(result.metadata) }, secrets: result.secrets, lease: result.lease! };
}

async function deleteOwnedResource(resourceId: string) {
  const connection = connectionsRepo.findResourceOwner(resourceId);
  if (!connection) return [];
  return mutateConnection({ provider: connection.provider, resourceId }, "remove", async (lease) => {
    lease.assertCurrent();
    return connectionsRepo.deleteResource(resourceId);
  });
}

// ─────────────────────────────────────────────────────────────
// Provider configs
// ─────────────────────────────────────────────────────────────

type ResourceMapper = (resource: any) => {
  externalId: string;
  kind: string;
  name: string;
  url?: string;
  metadata: Record<string, unknown>;
};

const RESOURCE_MAPPERS: Record<string, ResourceMapper> = {
  github: (repo: GithubRepo) => ({
    externalId: repo.fullName,
    kind: "github_repo",
    name: repo.fullName,
    url: repo.htmlUrl,
    metadata: { private: repo.private, description: repo.description, language: repo.language, stars: repo.stars, forks: repo.forks, defaultBranch: repo.defaultBranch, htmlUrl: repo.htmlUrl, updatedAt: repo.updatedAt },
  }),
  linear: (team: LinearTeam) => ({
    externalId: team.key,
    kind: "linear_team",
    name: team.name,
    url: team.url,
    metadata: { id: team.id, name: team.name, key: team.key, description: team.description, icon: team.icon, color: team.color, private: team.private, updatedAt: team.updatedAt },
  }),
  jira: (project: JiraProject) => ({
    externalId: project.key,
    kind: "jira_project",
    name: project.name,
    url: project.url,
    metadata: { id: project.id, name: project.name, key: project.key, projectTypeKey: project.projectTypeKey, avatarUrl: project.avatarUrl, description: project.description, isPrivate: project.isPrivate },
  }),
  asana: (project: AsanaProject) => ({
    externalId: project.gid,
    kind: "asana_project",
    name: project.name,
    url: project.url,
    metadata: { gid: project.gid, name: project.name, color: project.color, workspaceGid: project.workspaceGid, workspaceName: project.workspaceName, teamGid: project.teamGid, teamName: project.teamName, modifiedAt: project.modifiedAt, public: project.public },
  }),
  gitlab: (project: GitlabProject) => ({
    externalId: String(project.id),
    kind: "gitlab_project",
    name: project.pathWithNamespace,
    url: project.webUrl,
    metadata: { private: project.private, visibility: project.visibility, description: project.description, stars: project.stars, forks: project.forks, defaultBranch: project.defaultBranch, htmlUrl: project.webUrl, lastActivityAt: project.lastActivityAt, pathWithNamespace: project.pathWithNamespace },
  }),
  trello: (board: TrelloBoard) => ({
    externalId: board.id,
    kind: "trello_board",
    name: board.name,
    url: board.shortUrl,
    metadata: { id: board.id, name: board.name, shortLink: board.shortLink, desc: board.desc, closed: board.closed, organizationName: board.organizationName },
  }),
  sentry: (project: SentryProject) => ({
    externalId: project.slug,
    kind: "sentry_project",
    name: project.name,
    metadata: { id: project.id, slug: project.slug, name: project.name, platform: project.platform, dateCreated: project.dateCreated, status: project.status, organization: project.organization },
  }),
  socketdev: (org: SocketDevOrganization) => ({
    externalId: org.slug,
    kind: "socketdev_org",
    name: org.name,
    metadata: { id: org.id, slug: org.slug, name: org.name, plan: org.plan },
  }),
};

const SELECTED_RESOURCE_CONFIGS: Record<string, {
  kind: string;
  responseKey: string;
  formatItem: (r: any) => Record<string, unknown>;
}> = {
  github: {
    kind: "github_repo",
    responseKey: "repos",
    formatItem: (r) => ({ id: r.id, fullName: r.externalId, name: r.name || r.externalId, metadata: parseResourceMetadata(r.metadata) }),
  },
  linear: {
    kind: "linear_team",
    responseKey: "teams",
    formatItem: (r) => ({ id: r.id, key: r.externalId, name: r.name || r.externalId, metadata: parseResourceMetadata(r.metadata) }),
  },
  jira: {
    kind: "jira_project",
    responseKey: "projects",
    formatItem: (r) => ({ id: r.id, key: r.externalId, name: r.name || r.externalId, metadata: parseResourceMetadata(r.metadata) }),
  },
  asana: {
    kind: "asana_project",
    responseKey: "projects",
    formatItem: (r) => ({ id: r.id, gid: r.externalId, name: r.name || r.externalId, metadata: parseResourceMetadata(r.metadata) }),
  },
  gitlab: {
    kind: "gitlab_project",
    responseKey: "projects",
    formatItem: (r) => ({ id: r.id, externalId: r.externalId, name: r.name || r.externalId, metadata: parseResourceMetadata(r.metadata) }),
  },
  trello: {
    kind: "trello_board",
    responseKey: "boards",
    formatItem: (r) => ({ id: r.id, boardId: r.externalId, name: r.name || r.externalId, metadata: parseResourceMetadata(r.metadata) }),
  },
  sentry: {
    kind: "sentry_project",
    responseKey: "projects",
    formatItem: (r) => ({ id: r.id, slug: r.externalId, name: r.name || r.externalId, metadata: parseResourceMetadata(r.metadata) }),
  },
  socketdev: {
    kind: "socketdev_org",
    responseKey: "organizations",
    formatItem: (r) => ({ id: r.id, slug: r.externalId, name: r.name || r.externalId, metadata: parseResourceMetadata(r.metadata) }),
  },
};

// ─────────────────────────────────────────────────────────────
// Connections Service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// ─────────────────────────────────────────────────────────────
export const connectionsService = {
  // GitHub — OAuth device flow (token acquisition only; the renderer
  // saves the resulting token via the normal saveCredentials path)
  async startGithubDeviceFlow(): Promise<GitHubDeviceAuthorization> {
    return startGitHubDeviceFlow();
  },

  async pollGithubDeviceFlow(deviceCode: string): Promise<GitHubDevicePollResult> {
    return pollGitHubDeviceFlow(deviceCode);
  },

  // GitHub
  async getGithubRepos(connectionId: string): Promise<{ repos: GithubRepo[] }> {
    return readConnection(async () => {
      try {
        const result = await getConnectionAndSecrets(connectionId, "github");

        const octokit = new Octokit({ auth: result.secrets.token });
        const { data: repos } = await octokit.repos.listForAuthenticatedUser({
          sort: "updated",
          per_page: 100,
          affiliation: "owner,collaborator",
        });

        const formattedRepos: GithubRepo[] = repos.map((repo) => ({
          id: repo.id,
          fullName: repo.full_name,
          name: repo.name,
          owner: repo.owner.login,
          private: repo.private,
          description: repo.description,
          language: repo.language,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          defaultBranch: repo.default_branch,
          htmlUrl: repo.html_url,
          updatedAt: repo.updated_at,
        }));

        result.lease.assertCurrent();
        return { repos: formattedRepos };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Linear
  async getLinearTeams(connectionId: string): Promise<{ teams: LinearTeam[] }> {
    return readConnection(async () => {
      try {
        const result = await getConnectionAndSecrets(connectionId, "linear");

        const linearClient = new LinearClient({ apiKey: result.secrets.apiKey });
        const [teamsConnection, organization] = await Promise.all([linearClient.teams(), linearClient.organization]);
        const orgUrlKey = organization.urlKey;

        const formattedTeams: LinearTeam[] = teamsConnection.nodes.map((team) => ({
          id: team.id,
          key: team.key,
          name: team.name,
          description: team.description || null,
          icon: team.icon || null,
          color: team.color || null,
          private: team.private,
          updatedAt: team.updatedAt ? new Date(team.updatedAt).toISOString() : null,
          url: `https://linear.app/${orgUrlKey}/team/${team.key}`,
        }));

        result.lease.assertCurrent();
        return { teams: formattedTeams };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Jira
  async getJiraProjects(connectionId: string): Promise<{ projects: JiraProject[] }> {
    return readConnection(async () => {
      try {
        const result = await getConnectionAndSecrets(connectionId, "jira");

        const metadata = result.connection.metadata ? JSON.parse(result.connection.metadata) : {};
        const domain = metadata.domain as string;
        const email = metadata.email as string;

        if (!domain || !email) {
          throw new Error("Jira domain and email are required in connection metadata");
        }

        const credentials = Buffer.from(`${email}:${result.secrets.apiToken}`).toString("base64");
        const baseUrl = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/rest/api/3`;

        const response = await fetch(`${baseUrl}/project/search?maxResults=100`, {
          headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Jira API error (${response.status}):`, errorText);
          throw new Error(`Jira API error: ${response.status}`);
        }

        const data: any = await response.json();
        const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const formattedProjects: JiraProject[] = (data.values || []).map(
          (project: Record<string, unknown>) => ({
            id: project.id as string,
            key: project.key as string,
            name: project.name as string,
            projectTypeKey: project.projectTypeKey as string,
            avatarUrl: (project.avatarUrls as Record<string, string>)?.["48x48"] || null,
            description: (project.description as string) || null,
            isPrivate: (project.isPrivate as boolean) ?? false,
            url: `https://${cleanDomain}/browse/${project.key}`,
          })
        );

        result.lease.assertCurrent();
        return { projects: formattedProjects };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Asana
  async getAsanaProjects(connectionId: string): Promise<{ projects: AsanaProject[] }> {
    return readConnection(async () => {
      try {
        const result = await getConnectionAndSecrets(connectionId, "asana");

        const headers = { Authorization: `Bearer ${result.secrets.accessToken}`, Accept: "application/json" };

        const workspacesResponse = await fetch("https://app.asana.com/api/1.0/workspaces", { headers });

        if (!workspacesResponse.ok) {
          const errorText = await workspacesResponse.text();
          console.error(`Asana API error fetching workspaces (${workspacesResponse.status}):`, errorText);
          throw new Error(`Asana API error: ${workspacesResponse.status}`);
        }

        const workspacesData: any = await workspacesResponse.json();
        const workspaces = workspacesData.data || [];

        result.lease.assertCurrent();
        if (workspaces.length === 0) return { projects: [] };

        const allProjects: AsanaProject[] = [];

        for (const workspace of workspaces) {
          const workspaceGid = workspace.gid as string;
          const workspaceName = workspace.name as string;

          const url = `https://app.asana.com/api/1.0/workspaces/${workspaceGid}/projects?opt_fields=gid,name,archived,color,modified_at,public,team.gid,team.name&limit=100`;
          const response = await fetch(url, { headers });

          if (!response.ok) {
            console.error(`Asana API error fetching projects for workspace ${workspaceGid}:`, await response.text());
            continue;
          }

          const data: any = await response.json();
          const projects = (data.data || [])
            .filter((project: Record<string, unknown>) => !project.archived)
            .map((project: Record<string, unknown>) => {
              const team = project.team as Record<string, unknown> | null;
              return {
                gid: project.gid as string,
                name: project.name as string,
                archived: project.archived as boolean,
                color: (project.color as string) || null,
                workspaceGid,
                workspaceName,
                teamGid: team?.gid as string || null,
                teamName: team?.name as string || null,
                modifiedAt: (project.modified_at as string) || null,
                public: (project.public as boolean) ?? false,
                url: `https://app.asana.com/0/${project.gid}`,
              };
            });

          allProjects.push(...projects);
        }

        result.lease.assertCurrent();
        return { projects: allProjects };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // GitLab
  async getGitlabProjects(connectionId: string): Promise<{ projects: GitlabProject[] }> {
    return readConnection(async () => {
      try {
        const result = await getConnectionAndSecrets(connectionId, "gitlab");

        const metadata = result.connection.metadata ? JSON.parse(result.connection.metadata) : {};
        const domain = (metadata.domain as string) || "gitlab.com";
        const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const baseUrl = `https://${cleanDomain}/api/v4`;

        const response = await fetch(
          `${baseUrl}/projects?membership=true&per_page=100&order_by=last_activity_at`,
          { headers: { "PRIVATE-TOKEN": result.secrets.token, Accept: "application/json" } }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`GitLab API error (${response.status}):`, errorText);
          throw new Error(`GitLab API error: ${response.status}`);
        }

        const data: any = await response.json();
        const formattedProjects: GitlabProject[] = (data || []).map(
          (project: Record<string, unknown>) => ({
            id: project.id as number,
            name: project.name as string,
            pathWithNamespace: project.path_with_namespace as string,
            webUrl: project.web_url as string,
            description: (project.description as string) || null,
            visibility: project.visibility as string,
            lastActivityAt: (project.last_activity_at as string) || null,
            stars: (project.star_count as number) || 0,
            forks: (project.forks_count as number) || 0,
            defaultBranch: (project.default_branch as string) || null,
            private: project.visibility === "private",
          })
        );

        result.lease.assertCurrent();
        return { projects: formattedProjects };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Trello
  async getTrelloBoards(connectionId: string): Promise<{ boards: TrelloBoard[] }> {
    return readConnection(async () => {
      try {
        const result = await getConnectionAndSecrets(connectionId, "trello");

        const { apiKey, token } = result.secrets;

        if (!apiKey || !token) {
          throw new Error("Trello API key and token are required");
        }

        const authParams = `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;
        const response = await fetch(
          `https://api.trello.com/1/members/me/boards?${authParams}&fields=id,name,shortLink,shortUrl,closed,desc,prefs,organization&filter=open`,
          { headers: { Accept: "application/json" } }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Trello API error (${response.status}):`, errorText);
          throw new Error(`Trello API error: ${response.status}`);
        }

        const data: any = await response.json();
        const formattedBoards: TrelloBoard[] = (data || [])
          .filter((board: Record<string, unknown>) => !board.closed)
          .map((board: Record<string, unknown>) => ({
            id: board.id as string,
            name: board.name as string,
            shortLink: board.shortLink as string,
            shortUrl: board.shortUrl as string,
            desc: (board.desc as string) || "",
            closed: board.closed as boolean,
            organizationName: (board.organization as Record<string, unknown>)?.displayName as string || null,
            url: board.shortUrl as string,
          }));

        result.lease.assertCurrent();
        return { boards: formattedBoards };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Sentry
  async getSentryProjects(connectionId: string): Promise<{ projects: SentryProject[] }> {
    return readConnection(async () => {
      try {
        const result = await getConnectionAndSecrets(connectionId, "sentry");

        const metadata = result.connection.metadata ? JSON.parse(result.connection.metadata) : {};
        const organization = metadata.organization as string;

        if (!organization) {
          throw new Error("Sentry organization slug is required");
        }

        const response = await fetch(
          `https://sentry.io/api/0/organizations/${encodeURIComponent(organization)}/projects/?per_page=100`,
          { headers: { Authorization: `Bearer ${result.secrets.token}`, Accept: "application/json" } }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Sentry API error (${response.status}):`, errorText);
          throw new Error(`Sentry API error: ${response.status}`);
        }

        const data: any = await response.json();
        const formattedProjects: SentryProject[] = (data || []).map(
          (project: Record<string, unknown>) => ({
            id: String(project.id),
            slug: project.slug as string,
            name: project.name as string,
            platform: (project.platform as string) || null,
            dateCreated: (project.dateCreated as string) || "",
            status: (project.status as string) || "active",
            organization,
          })
        );

        result.lease.assertCurrent();
        return { projects: formattedProjects };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Socket.dev
  async getSocketDevOrganizations(connectionId: string): Promise<{ organizations: SocketDevOrganization[] }> {
    return readConnection(async () => {
      try {
        const result = await getConnectionAndSecrets(connectionId, "socketdev");

        const response = await fetch(
          "https://api.socket.dev/v0/organizations",
          { headers: { Authorization: `Bearer ${result.secrets.apiToken}`, Accept: "application/json" } }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Socket.dev API error (${response.status}):`, errorText);
          throw new Error(`Socket.dev API error: ${response.status}`);
        }

        const data: any = await response.json();
        const orgs = data?.organizations ?? data?.data ?? [];
        const formattedOrgs: SocketDevOrganization[] = (Array.isArray(orgs) ? orgs : Object.entries(orgs).map(([slug, org]: [string, any]) => ({ id: org.id || slug, slug, name: org.name || slug, plan: org.plan || null }))).map(
          (org: Record<string, unknown>) => ({
            id: String(org.id || org.slug),
            slug: (org.slug as string) || String(org.id),
            name: (org.name as string) || (org.slug as string) || String(org.id),
            plan: (org.plan as string) || null,
          })
        );

        result.lease.assertCurrent();
        return { organizations: formattedOrgs };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Save resources
  async saveResources(
    payload: SaveResourcesPayload
  ): Promise<{ message: string; count: number; revision: string }> {
    return mutateConnection(payload, "resources", async (lease) => {
      try {
        const { provider, connectionId, resources } = payload;

        if (!provider || !connectionId) {
          throw new Error("Provider and connectionId are required");
        }

        const mapper = RESOURCE_MAPPERS[provider];
        if (!mapper) throw new Error(`Unsupported provider: ${provider}`);

        if (!resources?.length) throw new Error("Resources are required");

        const connection = await connectionsRepo.findById(connectionId);
        if (!connection || connection.provider !== provider || connection.status !== "active") throw new Error("This connection is no longer active");
        const mapped = resources.map(mapper);
        if (mapped.some((r) => !r.externalId || !r.name)) throw new Error("Resource identity and name are required");
        lease.assertCurrent();
        connectionsRepo.saveResources(connectionId, mapped);

        return {
          message: `${resources.length} resource(s) saved successfully`,
          count: resources.length,
          revision: lease.revision,
        };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Remove resource
  async removeResource(resourceId: string): Promise<{ message: string }> {
    return readConnection(async () => {
      try {
        if (!resourceId) throw new Error("Resource ID is required");

        const decodedResourceId = decodeURIComponent(resourceId);
        const rows = await deleteOwnedResource(decodedResourceId);

        if (rows.length === 0) throw new Error("Resource not found");

        return { message: "Resource removed successfully" };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Get connection by provider
  async getByProvider(provider: string): Promise<{
    connection: {
      id: string;
      provider: string;
      displayName: string | null;
      status: string;
      revision: string;
      metadata: Record<string, unknown>;
    };
  }> {
    return readConnection(async () => {
      try {
        if (!provider) throw new Error("Provider is required");

        const lease = captureConnectionLease(provider);
        const connection = await connectionsRepo.findByProvider(provider);
        if (!connection) throw new Error(`${provider} connection not found`);

        lease.assertCurrent();
        return {
          connection: {
            id: connection.id,
            provider: connection.provider,
            displayName: connection.displayName,
            status: connection.status,
            revision: lease.revision,
            metadata: parseConnectionMetadata(connection.metadata),
          },
        };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Get selected resources
  async getSelectedResources(provider: string): Promise<unknown> {
    return readConnection(async () => {
      try {
        if (!provider) throw new Error("Provider is required");

        const config = SELECTED_RESOURCE_CONFIGS[provider];
        if (!config) throw new Error(`Unsupported provider: ${provider}`);

        const lease = captureConnectionLease(provider);
        const connection = await connectionsRepo.findByProvider(provider);
        if (!connection) throw new Error(`${provider} connection not found`);

        const resources = await connectionsRepo.findResourcesByConnectionAndKind(connection.id, config.kind, true);

        lease.assertCurrent();
        return {
          [config.responseKey]: resources.map(config.formatItem),
          connectionId: connection.id,
          revision: lease.revision,
        };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Delete resource
  async deleteResource(resourceId: string): Promise<void> {
    return readConnection(async () => {
      try {
        if (!resourceId) throw new Error("Resource ID is required");

        await deleteOwnedResource(resourceId);
        return;
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // Revoke connection
  async revoke(provider: string): Promise<void> {
    return mutateConnection({ provider }, "revoke", async (lease) => {
      try {
        if (!provider) throw new Error("Provider is required");

        const connection = await connectionsRepo.findByProvider(provider);
        if (!connection) throw new Error(`${provider} connection not found`);

        lease.assertCurrent();
        connectionsRepo.revokeConnection(provider, connection.id, connection.metadata || "{}");

        return;
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // ─────────────────────────────────────────────────────────────
  // Connection states (the integration metadata table that powers
  // the Settings page list of supported providers).
  // ─────────────────────────────────────────────────────────────
  async listStates(): Promise<ConnectionStateResponse[]> {
    return readConnection(async () => {
      try {
        const states = await connectionsRepo.findAllStates();
        return states;
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  async updateState(id: unknown, payload: unknown): Promise<null> {
    return readConnection(async () => {
      try {
        const idError = validateConnectionStateId(id);
        if (idError) throw new Error(idError);

        const { data, error } = validateUpdateStatePayload(payload);
        if (error || !data) throw new Error(error ?? "Invalid payload");

        await connectionsRepo.updateStateById(id as string, data);
        return null;
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  // ─────────────────────────────────────────────────────────────
  // Credentials: save (with token rotation) and check.
  // ─────────────────────────────────────────────────────────────
  async saveCredentials(
    payload: SaveCredentialsPayload
  ): Promise<SaveCredentialsResult> {
    return mutateConnection(payload, "credentials", async (lease) => {
      try {
        const { provider, connectionId, ...credentials } = payload;

        if (!provider || !connectionId) {
          throw new Error("Provider and connectionId are required");
        }

        const parseResult = parseProviderCredentials(provider, credentials);
        if (!parseResult.success) {
          throw new Error(parseResult.error);
        }

        const { secrets, tokensForHash } = parseResult.data;

        const connection = await connectionsRepo.findById(connectionId);
        if (!connection) throw new Error("Connection not found");
        if (connection.provider !== provider) throw new Error("Connection does not belong to this provider");

        const tokenHash = createTokenHash(tokensForHash);
        const encryptedSecrets = encryptSecrets(secrets);



        const currentMetadata = parseConnectionMetadata(connection.metadata);
        const updatedMetadata: Record<string, unknown> = {
          ...currentMetadata,
          lastCredentialUpdate: new Date().toISOString(),
        };

        const metadataFields = PROVIDER_METADATA_FIELDS[provider];
        if (metadataFields) {
          const defaults = PROVIDER_METADATA_DEFAULTS[provider] || {};
          for (const field of metadataFields) {
            const value = (payload as Record<string, unknown>)[field];
            updatedMetadata[field] =
              value || defaults[field] || updatedMetadata[field];
          }
        }

        lease.assertCurrent();
        connectionsRepo.activateCredentials(provider, JSON.stringify(updatedMetadata), {
          connectionId,
          accessTokenEnc: encryptedSecrets,
          refreshTokenEnc: null,
          tokenType: "bearer",
          expiresAt: null,
          tokenHash,
          keyVersion: 1,
          encryptionFormat: getBackendRuntime().secretStorage.format,
        });

        return { message: "Credentials saved successfully", revision: lease.revision };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },

  async checkCredentials(
    provider: string
  ): Promise<CredentialsCheckResult> {
    return readConnection(async () => {
      try {
        if (!provider) throw new Error("Provider is required");

        const connection = await connectionsRepo.findByProvider(provider);
        if (!connection) throw new Error("Connection not found");

        const hasCredentials = connection.status === "active" && Boolean(await getConnectionWithSecrets(provider, connection.id));

        return {
          hasCredentials,
          status: connection.status,
          connectionId: connection.id,
        };
      } catch (error) {
        console.error(error);
        throw error;
      }
    });
  },
};
