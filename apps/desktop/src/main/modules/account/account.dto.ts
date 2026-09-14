import type { accounts } from "../../db/schema";

// ─────────────────────────────────────────────────────────────
// Database Record
// ─────────────────────────────────────────────────────────────
export type AccountRecord = typeof accounts.$inferSelect;

// ─────────────────────────────────────────────────────────────
// Request DTOs
// ─────────────────────────────────────────────────────────────
export interface UpdateAccountRequest {
  displayName?: string;
  email?: string;
  company?: string;
  jobTitle?: string;
  timezone?: string;
  locale?: string;
  website?: string;
  avatarUrl?: string;
  bio?: string;
}

// ─────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────
export interface AccountResponse {
  id: string;
  displayName: string;
  email: string;
  company: string;
  jobTitle: string;
  timezone: string;
  locale: string;
  website: string;
  avatarUrl: string;
  bio: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

// ─────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────
export const DEFAULT_ACCOUNT: AccountResponse = {
  id: "default",
  displayName: "",
  email: "",
  company: "",
  jobTitle: "",
  timezone: "UTC",
  locale: "en-US",
  website: "",
  avatarUrl: "",
  bio: "",
  createdAt: null,
  updatedAt: null,
};

export function formatAccountResponse(record: AccountRecord | null): AccountResponse {
  if (!record) {
    return DEFAULT_ACCOUNT;
  }

  return {
    id: record.id,
    displayName: record.displayName ?? "",
    email: record.email ?? "",
    company: record.company ?? "",
    jobTitle: record.jobTitle ?? "",
    timezone: record.timezone ?? "UTC",
    locale: record.locale ?? "en-US",
    website: record.website ?? "",
    avatarUrl: record.avatarUrl ?? "",
    bio: record.bio ?? "",
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
  };
}
