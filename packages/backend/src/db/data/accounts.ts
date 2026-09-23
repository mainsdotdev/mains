import type { InferInsertModel } from "drizzle-orm";
import { accounts } from "../schema";

// ─────────────────────────────────────────────────────────────
// Default Account Seed Data
// ─────────────────────────────────────────────────────────────

type CreateAccountPayload = InferInsertModel<typeof accounts>;

export const seedAccounts: CreateAccountPayload[] = [
  {
    id: "default",
    displayName: "User",
    email: "user@example.com",
    company: null,
    jobTitle: null,
    timezone: "UTC",
    locale: "en-US",
    website: null,
    avatarUrl: "",
    bio: null,
  },
];
