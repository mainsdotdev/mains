import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { getDb } from "../../db/client";
import { safeJsonParse } from "../../db/utils";
import {
  workspaces,
  workspaceActivity,
  workspaceDiffs,
  reviews,
  reviewFindings,
} from "../../db/schema";
import type {
  CreateWorkspacePayload,
  UpdateWorkspacePayload,
  WorkspaceResponse,
  WorkspaceStatus,
  ActivityResponse,
  CreateActivityPayload,
  WorkspaceDiffResponse,
  CreateDiffPayload,
  UpdateDiffPayload,
  ReviewResponse,
  CreateReviewPayload,
  UpdateReviewPayload,
  ReviewFindingResponse,
  CreateReviewFindingPayload,
  UpdateReviewFindingPayload,
} from "./workspace.dto";

// ─────────────────────────────────────────────────────────────
// ── Workspace ──
// ─────────────────────────────────────────────────────────────
export const workspaceRepo = {
  async findAll(includeArchived = false): Promise<WorkspaceResponse[]> {
    const db = getDb();
    const query = db.select().from(workspaces);
    const rows = includeArchived
      ? await query.orderBy(desc(workspaces.updatedAt))
      : await query
          .where(eq(workspaces.isArchived, false))
          .orderBy(desc(workspaces.updatedAt));
    return rows.map(mapWorkspaceRow);
  },

  /**
   * The archived rows only — the complement of `findAll()`'s default.
   *
   * Ordered by `updatedAt`, which `archive()` bumps, so the list reads as
   * "most recently archived first".
   */
  async findArchived(): Promise<WorkspaceResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.isArchived, true))
      .orderBy(desc(workspaces.updatedAt));
    return rows.map(mapWorkspaceRow);
  },

  async findById(id: string): Promise<WorkspaceResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1);
    return rows[0] ? mapWorkspaceRow(rows[0]) : null;
  },

  async findByAccountId(
    accountId: string,
    includeArchived = false,
  ): Promise<WorkspaceResponse[]> {
    const db = getDb();
    const condition = includeArchived
      ? eq(workspaces.accountId, accountId)
      : and(
          eq(workspaces.accountId, accountId),
          eq(workspaces.isArchived, false),
        );
    const rows = await db
      .select()
      .from(workspaces)
      .where(condition)
      .orderBy(desc(workspaces.updatedAt));
    return rows.map(mapWorkspaceRow);
  },

  async findByRootPath(
    accountId: string,
    rootPath: string,
  ): Promise<WorkspaceResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.accountId, accountId),
          eq(workspaces.rootPath, rootPath),
        ),
      )
      .limit(1);
    return rows[0] ? mapWorkspaceRow(rows[0]) : null;
  },

  async findByProjectId(projectId: string): Promise<WorkspaceResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.projectId, projectId))
      .orderBy(desc(workspaces.updatedAt));
    return rows.map(mapWorkspaceRow);
  },

  async insert(
    payload: CreateWorkspacePayload & { id: string },
  ): Promise<string> {
    const db = getDb();
    await db.insert(workspaces).values({
      id: payload.id,
      accountId: payload.accountId,
      projectId: payload.projectId,
      name: payload.name,
      rootPath: payload.rootPath,
      repoUrl: payload.repoUrl,
      baseBranch: payload.baseBranch,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      status:
        (payload as CreateWorkspacePayload & { status?: WorkspaceStatus })
          .status ?? "todo",
    });
    return payload.id;
  },

  async update(
    id: string,
    payload: UpdateWorkspacePayload,
  ): Promise<WorkspaceResponse | null> {
    const db = getDb();
    const updateData: Record<string, unknown> = {
      updatedAt: sql`(unixepoch())`,
    };

    if (payload.name !== undefined) updateData.name = payload.name;
    if (payload.rootPath !== undefined) updateData.rootPath = payload.rootPath;
    if (payload.repoUrl !== undefined) updateData.repoUrl = payload.repoUrl;
    if (payload.baseBranch !== undefined)
      updateData.baseBranch = payload.baseBranch;
    if (payload.metadata !== undefined)
      updateData.metadata = JSON.stringify(payload.metadata);
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.projectId !== undefined)
      updateData.projectId = payload.projectId;

    await db.update(workspaces).set(updateData).where(eq(workspaces.id, id));
    return this.findById(id);
  },

  async delete(id: string): Promise<void> {
    const db = getDb();
    await db.delete(workspaces).where(eq(workspaces.id, id));
  },

  async deleteByProjectId(projectId: string): Promise<void> {
    const db = getDb();
    await db.delete(workspaces).where(eq(workspaces.projectId, projectId));
  },

  async archive(id: string): Promise<WorkspaceResponse | null> {
    const db = getDb();
    await db
      .update(workspaces)
      .set({ isArchived: true, updatedAt: sql`(unixepoch())` })
      .where(eq(workspaces.id, id));
    return this.findById(id);
  },

  async unarchive(id: string): Promise<WorkspaceResponse | null> {
    const db = getDb();
    await db
      .update(workspaces)
      .set({ isArchived: false, updatedAt: sql`(unixepoch())` })
      .where(eq(workspaces.id, id));
    return this.findById(id);
  },

  // ─────────────────────────────────────────────────────────────
  // ── Activity ──
  // ─────────────────────────────────────────────────────────────

  async findActivityByWorkspace(
    workspaceId: string,
    limit = 50,
  ): Promise<ActivityResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceActivity)
      .where(eq(workspaceActivity.workspaceId, workspaceId))
      .orderBy(desc(workspaceActivity.createdAt))
      .limit(limit);
    return rows.map(mapActivityRow);
  },

  async insertActivity(payload: CreateActivityPayload): Promise<string> {
    const db = getDb();
    const id = payload.id || generateId();
    await db.insert(workspaceActivity).values({
      id,
      workspaceId: payload.workspaceId,
      type: payload.type,
      title: payload.title,
      summary: payload.summary ?? null,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      refId: payload.refId ?? null,
    });
    return id;
  },

  async insertManyActivity(
    payloads: CreateActivityPayload[],
  ): Promise<string[]> {
    const db = getDb();
    const ids = payloads.map((p) => p.id || generateId());
    await db.insert(workspaceActivity).values(
      payloads.map((p, i) => ({
        id: ids[i],
        workspaceId: p.workspaceId,
        type: p.type,
        title: p.title,
        summary: p.summary ?? null,
        metadata: p.metadata ? JSON.stringify(p.metadata) : null,
        refId: p.refId ?? null,
      })),
    );
    return ids;
  },

  async deleteActivity(id: string): Promise<void> {
    const db = getDb();
    await db.delete(workspaceActivity).where(eq(workspaceActivity.id, id));
  },

  // ─────────────────────────────────────────────────────────────
  // ── Diffs ──
  // ─────────────────────────────────────────────────────────────

  async insertDiff(payload: CreateDiffPayload): Promise<string> {
    const db = getDb();
    await db.insert(workspaceDiffs).values({
      id: payload.id,
      workspaceId: payload.workspaceId,
      runId: payload.runId ?? null,
      baseRef: payload.baseRef ?? null,
      diffText: payload.diffText,
      filesJson: payload.filesJson ?? null,
      statsJson: payload.statsJson ?? null,
      untrackedJson: payload.untrackedJson ?? null,
    });
    return payload.id;
  },

  async updateDiff(id: string, payload: UpdateDiffPayload): Promise<void> {
    const db = getDb();
    await db
      .update(workspaceDiffs)
      .set({
        diffText: payload.diffText,
        filesJson: payload.filesJson ?? null,
        statsJson: payload.statsJson ?? null,
        untrackedJson: payload.untrackedJson ?? null,
        ...(payload.baseRef !== undefined ? { baseRef: payload.baseRef } : {}),
      })
      .where(eq(workspaceDiffs.id, id));
  },

  async findDiffsByWorkspace(
    workspaceId: string,
    limit = 20,
  ): Promise<WorkspaceDiffResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceDiffs)
      .where(eq(workspaceDiffs.workspaceId, workspaceId))
      .orderBy(desc(workspaceDiffs.createdAt))
      .limit(limit);
    return rows.map(mapDiffRow);
  },

  async findLatestDiffByWorkspace(
    workspaceId: string,
  ): Promise<WorkspaceDiffResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceDiffs)
      .where(eq(workspaceDiffs.workspaceId, workspaceId))
      .orderBy(desc(workspaceDiffs.createdAt))
      .limit(1);
    return rows[0] ? mapDiffRow(rows[0]) : null;
  },

  async findLatestDiffSummaryByWorkspace(
    workspaceId: string,
  ): Promise<Omit<WorkspaceDiffResponse, "diffText"> | null> {
    const db = getDb();
    const rows = await db
      .select({
        id: workspaceDiffs.id,
        workspaceId: workspaceDiffs.workspaceId,
        runId: workspaceDiffs.runId,
        baseRef: workspaceDiffs.baseRef,
        filesJson: workspaceDiffs.filesJson,
        statsJson: workspaceDiffs.statsJson,
        untrackedJson: workspaceDiffs.untrackedJson,
        createdAt: workspaceDiffs.createdAt,
      })
      .from(workspaceDiffs)
      .where(eq(workspaceDiffs.workspaceId, workspaceId))
      .orderBy(desc(workspaceDiffs.createdAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      runId: row.runId,
      baseRef: row.baseRef,
      files: safeJsonParse<string[]>(row.filesJson),
      stats: safeJsonParse(row.statsJson),
      untrackedFiles: safeJsonParse<string[]>(row.untrackedJson),
      createdAt: row.createdAt,
    };
  },

  async findDiffByRun(runId: string): Promise<WorkspaceDiffResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceDiffs)
      .where(eq(workspaceDiffs.runId, runId))
      .limit(1);
    return rows[0] ? mapDiffRow(rows[0]) : null;
  },

  async findDiffByWorkspaceAndBaseRef(
    workspaceId: string,
    baseRef: string,
  ): Promise<WorkspaceDiffResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(workspaceDiffs)
      .where(
        and(
          eq(workspaceDiffs.workspaceId, workspaceId),
          eq(workspaceDiffs.baseRef, baseRef),
        ),
      )
      .limit(1);
    return rows[0] ? mapDiffRow(rows[0]) : null;
  },

  async deleteDiffsByWorkspace(workspaceId: string): Promise<void> {
    const db = getDb();
    await db
      .delete(workspaceDiffs)
      .where(eq(workspaceDiffs.workspaceId, workspaceId));
  },

  async deleteDiffsByRun(runId: string): Promise<void> {
    const db = getDb();
    await db.delete(workspaceDiffs).where(eq(workspaceDiffs.runId, runId));
  },

  async deleteLatestDiffByWorkspace(workspaceId: string): Promise<void> {
    const db = getDb();
    const rows = await db
      .select({ id: workspaceDiffs.id })
      .from(workspaceDiffs)
      .where(eq(workspaceDiffs.workspaceId, workspaceId))
      .orderBy(desc(workspaceDiffs.createdAt))
      .limit(1);
    if (rows[0]) {
      await db.delete(workspaceDiffs).where(eq(workspaceDiffs.id, rows[0].id));
    }
  },

  // ─────────────────────────────────────────────────────────────
  // ── Reviews ──
  // ─────────────────────────────────────────────────────────────

  async findReviewsByWorkspace(
    workspaceId: string,
    limit = 50,
  ): Promise<ReviewResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.workspaceId, workspaceId))
      .orderBy(desc(reviews.updatedAt))
      .limit(limit);
    return rows.map(mapReviewRow);
  },

  async findReviewById(id: string): Promise<ReviewResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(reviews)
      .where(eq(reviews.id, id))
      .limit(1);
    return rows[0] ? mapReviewRow(rows[0]) : null;
  },

  async insertReview(payload: CreateReviewPayload): Promise<string> {
    const db = getDb();
    const id = payload.id || generateId();
    await db.insert(reviews).values({
      id,
      workspaceId: payload.workspaceId,
      title: payload.title,
      summary: payload.summary,
      status: payload.status ?? "open",
      runId: payload.runId,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    });
    return id;
  },

  async updateReview(
    id: string,
    payload: UpdateReviewPayload,
  ): Promise<ReviewResponse | null> {
    const db = getDb();
    const updateData: Record<string, unknown> = {
      updatedAt: sql`(unixepoch())`,
    };

    if (payload.title !== undefined) updateData.title = payload.title;
    if (payload.summary !== undefined) updateData.summary = payload.summary;
    if (payload.status !== undefined) updateData.status = payload.status;
    if (payload.runId !== undefined) updateData.runId = payload.runId;
    if (payload.metadata !== undefined)
      updateData.metadata = JSON.stringify(payload.metadata);

    await db.update(reviews).set(updateData).where(eq(reviews.id, id));
    return this.findReviewById(id);
  },

  async deleteReview(id: string): Promise<void> {
    const db = getDb();
    await db.delete(reviews).where(eq(reviews.id, id));
  },

  async deleteReviewsByWorkspace(workspaceId: string): Promise<void> {
    const db = getDb();
    await db.delete(reviews).where(eq(reviews.workspaceId, workspaceId));
  },

  // ─────────────────────────────────────────────────────────────
  // ── Findings ──
  // ─────────────────────────────────────────────────────────────

  async findFindingsByReview(
    reviewId: string,
    limit = 200,
  ): Promise<ReviewFindingResponse[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.reviewId, reviewId))
      .orderBy(desc(reviewFindings.createdAt))
      .limit(limit);
    return rows.map(mapFindingRow);
  },

  async findFindingsByWorkspace(
    workspaceId: string,
    limit = 500,
  ): Promise<(ReviewFindingResponse & { reviewCreatedAt: Date })[]> {
    const db = getDb();
    const rows = await db
      .select({
        finding: reviewFindings,
        reviewCreatedAt: reviews.createdAt,
      })
      .from(reviewFindings)
      .innerJoin(reviews, eq(reviewFindings.reviewId, reviews.id))
      .where(eq(reviews.workspaceId, workspaceId))
      .orderBy(desc(reviewFindings.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      ...mapFindingRow(r.finding),
      reviewCreatedAt: r.reviewCreatedAt,
    }));
  },

  async findFindingById(id: string): Promise<ReviewFindingResponse | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(reviewFindings)
      .where(eq(reviewFindings.id, id))
      .limit(1);
    return rows[0] ? mapFindingRow(rows[0]) : null;
  },

  async insertFinding(payload: CreateReviewFindingPayload): Promise<string> {
    const db = getDb();
    const id = payload.id || generateId();
    await db.insert(reviewFindings).values({
      id,
      reviewId: payload.reviewId,
      severity: payload.severity,
      file: payload.file,
      lineStart: payload.lineStart,
      lineEnd: payload.lineEnd,
      message: payload.message,
      reason: payload.reason,
      suggestion: payload.suggestion,
      validated: payload.validated ?? false,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    });
    return id;
  },

  async insertManyFindings(
    payloads: CreateReviewFindingPayload[],
  ): Promise<string[]> {
    const db = getDb();
    const ids: string[] = [];
    const values = payloads.map((payload) => {
      const id = payload.id || generateId();
      ids.push(id);
      return {
        id,
        reviewId: payload.reviewId,
        severity: payload.severity,
        file: payload.file,
        lineStart: payload.lineStart,
        lineEnd: payload.lineEnd,
        message: payload.message,
        reason: payload.reason,
        suggestion: payload.suggestion,
        validated: payload.validated ?? false,
        metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      };
    });
    await db.insert(reviewFindings).values(values);
    return ids;
  },

  async updateFinding(
    id: string,
    payload: UpdateReviewFindingPayload,
  ): Promise<ReviewFindingResponse | null> {
    const db = getDb();
    const updateData: Record<string, unknown> = {};

    if (payload.severity !== undefined) updateData.severity = payload.severity;
    if (payload.file !== undefined) updateData.file = payload.file;
    if (payload.lineStart !== undefined)
      updateData.lineStart = payload.lineStart;
    if (payload.lineEnd !== undefined) updateData.lineEnd = payload.lineEnd;
    if (payload.message !== undefined) updateData.message = payload.message;
    if (payload.reason !== undefined) updateData.reason = payload.reason;
    if (payload.suggestion !== undefined)
      updateData.suggestion = payload.suggestion;
    if (payload.validated !== undefined)
      updateData.validated = payload.validated;
    if (payload.isApproved !== undefined)
      updateData.isApproved = payload.isApproved;
    if (payload.metadata !== undefined)
      updateData.metadata =
        payload.metadata !== null ? JSON.stringify(payload.metadata) : null;

    if (Object.keys(updateData).length > 0) {
      await db
        .update(reviewFindings)
        .set(updateData)
        .where(eq(reviewFindings.id, id));
    }
    return this.findFindingById(id);
  },

  async deleteFinding(id: string): Promise<void> {
    const db = getDb();
    await db.delete(reviewFindings).where(eq(reviewFindings.id, id));
  },

  async deleteFindingsByWorkspace(workspaceId: string): Promise<void> {
    const db = getDb();
    const rows = await db
      .select({ id: reviewFindings.id })
      .from(reviewFindings)
      .innerJoin(reviews, eq(reviewFindings.reviewId, reviews.id))
      .where(eq(reviews.workspaceId, workspaceId));
    if (rows.length > 0) {
      await db
        .delete(reviewFindings)
        .where(
          inArray(
            reviewFindings.id,
            rows.map((r) => r.id),
          ),
        );
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Row mappers
// ─────────────────────────────────────────────────────────────

function mapWorkspaceRow(
  row: typeof workspaces.$inferSelect,
): WorkspaceResponse {
  return {
    id: row.id,
    accountId: row.accountId,
    projectId: row.projectId,
    name: row.name,
    rootPath: row.rootPath,
    repoUrl: row.repoUrl,
    baseBranch: row.baseBranch,
    metadata: safeJsonParse(row.metadata),
    status: row.status as WorkspaceStatus,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapActivityRow(
  row: typeof workspaceActivity.$inferSelect,
): ActivityResponse {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type,
    title: row.title,
    summary: row.summary,
    metadata: safeJsonParse(row.metadata),
    refId: row.refId,
    createdAt: row.createdAt,
  };
}

function mapDiffRow(
  row: typeof workspaceDiffs.$inferSelect,
): WorkspaceDiffResponse {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runId: row.runId,
    baseRef: row.baseRef,
    diffText: row.diffText,
    files: safeJsonParse<string[]>(row.filesJson),
    stats: safeJsonParse(row.statsJson),
    untrackedFiles: safeJsonParse<string[]>(row.untrackedJson),
    createdAt: row.createdAt,
  };
}

function mapReviewRow(row: typeof reviews.$inferSelect): ReviewResponse {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    summary: row.summary,
    status: row.status,
    runId: row.runId,
    metadata: safeJsonParse(row.metadata),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapFindingRow(
  row: typeof reviewFindings.$inferSelect,
): ReviewFindingResponse {
  return {
    id: row.id,
    reviewId: row.reviewId,
    severity: row.severity,
    file: row.file,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    message: row.message,
    reason: row.reason,
    suggestion: row.suggestion,
    validated: row.validated,
    isApproved: row.isApproved,
    metadata: safeJsonParse(row.metadata),
    createdAt: row.createdAt,
  };
}

function generateId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
