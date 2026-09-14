// ─────────────────────────────────────────────────────────────
// Projects Validation (hand-rolled allowlist)
// ─────────────────────────────────────────────────────────────

import type { CreateProjectPayload, UpdateProjectPayload } from "./projects.dto";

const ALLOWED_CREATE_FIELDS = new Set([
  "id",
  "accountId",
  "name",
  "rootPath",
  "remoteOrigin",
  "workspacesPath",
  "branches",
  "defaultBranch",
  "setupScript",
  "runScript",
  "archiveScript",
  "icon",
  "commitInstructions",
  "prInstructions",
]);

const ALLOWED_UPDATE_FIELDS = new Set([
  "name",
  "rootPath",
  "workspacesPath",
  "branches",
  "remoteOrigin",
  "defaultBranch",
  "setupScript",
  "runScript",
  "archiveScript",
  "icon",
  "commitInstructions",
  "prInstructions",
]);

export function validateCreateProject(
  payload: unknown,
): { valid: true; data: CreateProjectPayload } | { valid: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Payload must be an object" };
  }

  const obj = payload as Record<string, unknown>;

  // Required fields
  if (!obj.accountId || typeof obj.accountId !== "string") {
    return { valid: false, error: "accountId is required and must be a string" };
  }
  if (!obj.name || typeof obj.name !== "string") {
    return { valid: false, error: "name is required and must be a string" };
  }
  if (!obj.rootPath || typeof obj.rootPath !== "string") {
    return { valid: false, error: "rootPath is required and must be a string" };
  }
  if (
    obj.remoteOrigin !== undefined &&
    obj.remoteOrigin !== null &&
    typeof obj.remoteOrigin !== "string"
  ) {
    return { valid: false, error: "remoteOrigin must be a string when provided" };
  }

  // Strip unknown fields
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (ALLOWED_CREATE_FIELDS.has(key)) {
      sanitized[key] = obj[key];
    }
  }

  return { valid: true, data: sanitized as unknown as CreateProjectPayload };
}

export function validateUpdateProject(
  payload: unknown,
): { valid: true; data: UpdateProjectPayload } | { valid: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Payload must be an object" };
  }

  const obj = payload as Record<string, unknown>;

  // Strip unknown fields
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (ALLOWED_UPDATE_FIELDS.has(key)) {
      sanitized[key] = obj[key];
    }
  }

  if (Object.keys(sanitized).length === 0) {
    return { valid: false, error: "No valid fields to update" };
  }

  return { valid: true, data: sanitized as unknown as UpdateProjectPayload };
}
