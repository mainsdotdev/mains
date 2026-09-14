import { randomUUID } from "crypto";
import {
  accounts,
  projects,
  collections,
  collectionSources,
  workspaces,
  appSettings,
  connectionStates,
  workspaceActivity,
  workspaceDiffs,
  spaces,
  providers,
  runs,
  connections,
  reviews,
  reviewFindings,
  toolCalls,
  connectionResources,
  projectResources,
  entities,
  tasks,
  issues,
  runContext,
  runArtifacts,
  runTurns,
} from "../main/db/schema";
import type { DatabaseInstance } from "../main/db/types";

// ─────────────────────────────────────────────────────────────
// Test Data Factories
// Each factory inserts a real row and returns its data.
// ─────────────────────────────────────────────────────────────

export function createAccount(
  db: DatabaseInstance,
  overrides: Partial<typeof accounts.$inferInsert> = {},
) {
  const data = {
    id: overrides.id ?? "default",
    timezone: "UTC",
    locale: "en-US",
    ...overrides,
  };
  db.insert(accounts).values(data).onConflictDoNothing().run();
  return data;
}

export function createProject(
  db: DatabaseInstance,
  overrides: Partial<typeof projects.$inferInsert> = {},
) {
  // Ensure referenced account exists
  const accountId = overrides.accountId ?? "default";
  createAccount(db, { id: accountId });

  const data = {
    id: overrides.id ?? randomUUID(),
    accountId,
    name: overrides.name ?? "Test Project",
    rootPath: overrides.rootPath ?? `/tmp/test/${randomUUID()}`,
    remoteOrigin: overrides.remoteOrigin ?? `github.com/test/${randomUUID()}`,
    ...overrides,
  };
  db.insert(projects).values(data).onConflictDoNothing().run();
  return data;
}

export function createCollection(
  db: DatabaseInstance,
  overrides: Partial<typeof collections.$inferInsert> = {},
) {
  const accountId = overrides.accountId ?? "default";
  createAccount(db, { id: accountId });
  const data = {
    id: overrides.id ?? randomUUID(),
    accountId,
    name: overrides.name ?? "Test Collection",
    ...overrides,
  };
  db.insert(collections).values(data).onConflictDoNothing().run();
  return data;
}

export function createCollectionSource(
  db: DatabaseInstance,
  overrides: Partial<typeof collectionSources.$inferInsert> = {},
) {
  const collectionId = overrides.collectionId ?? randomUUID();
  createCollection(db, { id: collectionId });
  const data = {
    id: overrides.id ?? randomUUID(),
    collectionId,
    kind: overrides.kind ?? ("file" as const),
    name: overrides.name ?? "source.txt",
    mimeType: overrides.mimeType ?? "text/plain",
    byteSize: overrides.byteSize ?? 4,
    contentHash: overrides.contentHash ?? randomUUID().replace(/-/g, ""),
    storageKey:
      overrides.storageKey ??
      `collections/${collectionId}/sources/${randomUUID()}/content.txt`,
    ...overrides,
  };
  db.insert(collectionSources).values(data).onConflictDoNothing().run();
  return data;
}

export function createWorkspace(
  db: DatabaseInstance,
  overrides: Partial<typeof workspaces.$inferInsert> = {},
) {
  // Ensure referenced account exists
  const accountId = overrides.accountId ?? "default";
  createAccount(db, { id: accountId });

  const id = overrides.id ?? randomUUID();
  const rootPath = overrides.rootPath ?? `/tmp/ws/${randomUUID()}`;
  const projectId = overrides.projectId ?? `project-${id}`;
  createProject(db, {
    id: projectId,
    accountId,
    name: overrides.name ?? "Test Project",
    rootPath,
    remoteOrigin: null,
  });

  const data = {
    id,
    accountId,
    projectId,
    name: overrides.name ?? "Test Workspace",
    rootPath,
    ...overrides,
  };
  db.insert(workspaces).values(data).onConflictDoNothing().run();
  return data;
}

export function createAppSettings(
  db: DatabaseInstance,
  overrides: Partial<typeof appSettings.$inferInsert> = {},
) {
  const accountId = overrides.accountId ?? "default";
  createAccount(db, { id: accountId });

  const data = {
    id: overrides.id ?? "default",
    accountId,
    ...overrides,
  };
  db.insert(appSettings).values(data).onConflictDoNothing().run();
  return data;
}

export function createSpace(
  db: DatabaseInstance,
  overrides: Partial<typeof spaces.$inferInsert> = {},
) {
  const accountId = overrides.accountId ?? "default";
  createAccount(db, { id: accountId });

  const data = {
    id: overrides.id ?? randomUUID(),
    accountId,
    name: overrides.name ?? "Test Space",
    slug: overrides.slug ?? `test-space-${randomUUID().slice(0, 8)}`,
    ...overrides,
  };
  db.insert(spaces).values(data).onConflictDoNothing().run();
  return data;
}

export function createConnectionState(
  db: DatabaseInstance,
  overrides: Partial<typeof connectionStates.$inferInsert> = {},
) {
  const data = {
    id: overrides.id ?? `connection-${randomUUID().slice(0, 8)}`,
    ...overrides,
  };
  db.insert(connectionStates).values(data).onConflictDoNothing().run();
  return data;
}

export function createProvider(
  db: DatabaseInstance,
  overrides: Partial<typeof providers.$inferInsert> = {},
) {
  const data = {
    id: overrides.id ?? "copilot_cli",
    kind: overrides.kind ?? ("agent_runtime" as const),
    displayName: overrides.displayName ?? "Copilot CLI",
    ...overrides,
  };
  db.insert(providers).values(data).onConflictDoNothing().run();
  return data;
}

export function createRun(
  db: DatabaseInstance,
  overrides: Partial<typeof runs.$inferInsert> = {},
) {
  const accountId = overrides.accountId ?? "default";
  createAccount(db, { id: accountId });
  const providerId = overrides.providerId ?? "copilot_cli";
  createProvider(db, { id: providerId });

  const data = {
    id: overrides.id ?? randomUUID(),
    accountId,
    providerId,
    ...overrides,
  };
  db.insert(runs).values(data).onConflictDoNothing().run();
  return data;
}

export function createConnection(
  db: DatabaseInstance,
  overrides: Partial<typeof connections.$inferInsert> = {},
) {
  const data = {
    id: overrides.id ?? randomUUID(),
    provider: overrides.provider ?? "github",
    type: overrides.type ?? "oauth",
    ...overrides,
  };
  db.insert(connections).values(data).onConflictDoNothing().run();
  return data;
}

export function createWorkspaceActivity(
  db: DatabaseInstance,
  overrides: Partial<typeof workspaceActivity.$inferInsert> = {},
) {
  const workspaceId = overrides.workspaceId ?? "ws-default";

  const data = {
    id: overrides.id ?? randomUUID(),
    workspaceId,
    type: overrides.type ?? ("commit" as const),
    title: overrides.title ?? "Test Activity",
    ...overrides,
  };
  db.insert(workspaceActivity).values(data).run();
  return data;
}

export function createWorkspaceDiff(
  db: DatabaseInstance,
  overrides: Partial<typeof workspaceDiffs.$inferInsert> = {},
) {
  const workspaceId = overrides.workspaceId ?? "ws-default";

  const data = {
    id: overrides.id ?? randomUUID(),
    workspaceId,
    diffText: overrides.diffText ?? "diff --git a/file.ts b/file.ts",
    ...overrides,
  };
  db.insert(workspaceDiffs).values(data).run();
  return data;
}

export function createReview(
  db: DatabaseInstance,
  overrides: Partial<typeof reviews.$inferInsert> = {},
) {
  // Auto-create workspace if workspaceId is provided
  if (overrides.workspaceId) {
    createWorkspace(db, { id: overrides.workspaceId });
  }
  // Auto-create run if runId is provided
  if (overrides.runId) {
    createRun(db, { id: overrides.runId });
  }

  const data = {
    id: overrides.id ?? randomUUID(),
    title: overrides.title ?? "Test Review",
    status: overrides.status ?? ("open" as const),
    ...overrides,
  };
  db.insert(reviews).values(data).onConflictDoNothing().run();
  return data;
}

export function createReviewFinding(
  db: DatabaseInstance,
  overrides: Partial<typeof reviewFindings.$inferInsert> = {},
) {
  // Auto-create review if reviewId is provided
  if (overrides.reviewId) {
    createReview(db, { id: overrides.reviewId });
  }

  const data = {
    id: overrides.id ?? randomUUID(),
    reviewId: overrides.reviewId ?? "review-default",
    severity: overrides.severity ?? ("warning" as const),
    file: overrides.file ?? "src/index.ts",
    message: overrides.message ?? "Test finding message",
    reason: overrides.reason ?? "Test reason",
    ...overrides,
  };
  db.insert(reviewFindings).values(data).onConflictDoNothing().run();
  return data;
}

export function createToolCall(
  db: DatabaseInstance,
  overrides: Partial<typeof toolCalls.$inferInsert> = {},
) {
  const accountId = overrides.accountId ?? "default";
  createAccount(db, { id: accountId });

  // Auto-create run if runId is provided
  if (overrides.runId) {
    createRun(db, { id: overrides.runId });
  }
  // Auto-create provider if providerId is provided
  if (overrides.providerId) {
    createProvider(db, { id: overrides.providerId });
  }

  const data = {
    accountId,
    toolName: overrides.toolName ?? "Bash",
    ...overrides,
  };
  const result = db.insert(toolCalls).values(data).returning().all();
  return result[0];
}

export function createConnectionResource(
  db: DatabaseInstance,
  overrides: Partial<typeof connectionResources.$inferInsert> = {},
) {
  const connectionId = overrides.connectionId ?? "conn-default";

  const data = {
    id: overrides.id ?? randomUUID(),
    connectionId,
    externalId: overrides.externalId ?? `ext-${randomUUID().slice(0, 8)}`,
    kind: overrides.kind ?? "github_repo",
    ...overrides,
  };
  db.insert(connectionResources).values(data).onConflictDoNothing().run();
  return data;
}

export function createProjectResource(
  db: DatabaseInstance,
  overrides: Partial<typeof projectResources.$inferInsert> = {},
) {
  const data = {
    id: overrides.id ?? randomUUID(),
    projectId: overrides.projectId ?? "proj-default",
    resourceId: overrides.resourceId ?? "res-default",
    ...overrides,
  };
  db.insert(projectResources).values(data).onConflictDoNothing().run();
  return data;
}

export function createEntity(
  db: DatabaseInstance,
  overrides: Partial<typeof entities.$inferInsert> = {},
) {
  const accountId = overrides.accountId ?? "default";
  createAccount(db, { id: accountId });

  const data = {
    id: overrides.id ?? randomUUID(),
    accountId,
    kind: overrides.kind ?? "task",
    title: overrides.title ?? "Test Entity",
    ...overrides,
  };
  db.insert(entities).values(data).onConflictDoNothing().run();
  return data;
}

export function createTask(
  db: DatabaseInstance,
  overrides: {
    entity?: Partial<typeof entities.$inferInsert>;
    task?: Partial<typeof tasks.$inferInsert>;
  } = {},
) {
  const entityId = overrides.entity?.id ?? randomUUID();
  const entity = createEntity(db, { id: entityId, kind: "task", ...overrides.entity });

  const taskData = {
    entityId,
    status: overrides.task?.status ?? ("todo" as const),
    priority: overrides.task?.priority ?? 0,
    ...overrides.task,
  };
  db.insert(tasks).values(taskData).onConflictDoNothing().run();
  return { entity, task: taskData };
}

export function createIssue(
  db: DatabaseInstance,
  overrides: {
    entity?: Partial<typeof entities.$inferInsert>;
    issue?: Partial<typeof issues.$inferInsert>;
  } = {},
) {
  const entityId = overrides.entity?.id ?? randomUUID();
  const entity = createEntity(db, { id: entityId, kind: "issue", ...overrides.entity });

  const issueData = {
    entityId,
    provider: overrides.issue?.provider ?? "github",
    state: overrides.issue?.state ?? "open",
    ...overrides.issue,
  };
  db.insert(issues).values(issueData).onConflictDoNothing().run();
  return { entity, issue: issueData };
}

export function createRunContext(
  db: DatabaseInstance,
  overrides: Partial<typeof runContext.$inferInsert> = {},
) {
  const runId = overrides.runId ?? "run-default";
  if (overrides.runId) {
    createRun(db, { id: overrides.runId });
  }

  const data = {
    runId,
    kind: overrides.kind ?? ("file" as const),
    ...overrides,
  };
  const result = db.insert(runContext).values(data).returning().all();
  return result[0];
}

export function createRunArtifact(
  db: DatabaseInstance,
  overrides: Partial<typeof runArtifacts.$inferInsert> = {},
) {
  const runId = overrides.runId ?? "run-default";
  if (overrides.runId) {
    createRun(db, { id: overrides.runId });
  }

  const data = {
    runId,
    kind: overrides.kind ?? ("file" as const),
    ...overrides,
  };
  const result = db.insert(runArtifacts).values(data).returning().all();
  return result[0];
}

export function createRunTurn(
  db: DatabaseInstance,
  overrides: Partial<typeof runTurns.$inferInsert> = {},
) {
  const runId = overrides.runId ?? "run-default";
  if (overrides.runId) {
    createRun(db, { id: overrides.runId });
  }

  const data = {
    runId,
    turnIndex: overrides.turnIndex ?? 0,
    status: overrides.status ?? ("active" as const),
    ...overrides,
  };
  const result = db.insert(runTurns).values(data).returning().all();
  return result[0];
}
