import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ISSUE_STATUS_IDS } from "@mains/contracts/issue-status";

const migrationsDirectory = path.resolve(__dirname, "migrations");
const migrationTag = "0041_issue_statuses";

function statements(tag: string): string[] {
  return fs
    .readFileSync(path.join(migrationsDirectory, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function apply(sqlite: Database.Database, tag: string): void {
  for (const statement of statements(tag)) sqlite.exec(statement);
}

describe("Issue statuses migration", () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  function migrateWith(rows: Array<{ id: string; provider: string; state: string; closedAt?: number; metadata?: string }>) {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    for (const { tag } of journal.entries) {
      if (tag === migrationTag) break;
      apply(sqlite, tag);
    }

    sqlite.exec(`INSERT OR IGNORE INTO accounts(id) VALUES ('default');`);
    const entity = sqlite.prepare(
      `INSERT INTO entities(id, account_id, kind, metadata) VALUES (?, 'default', 'issue', ?)`,
    );
    const issue = sqlite.prepare(
      `INSERT INTO issues(entity_id, provider, state, closed_at) VALUES (?, ?, ?, ?)`,
    );
    for (const row of rows) {
      entity.run(row.id, row.metadata ?? null);
      issue.run(row.id, row.provider, row.state, row.closedAt ?? null);
    }

    apply(sqlite, migrationTag);
    return sqlite;
  }

  function statusOf(db: Database.Database, id: string): string {
    return (db.prepare(`SELECT status_id AS statusId FROM issues WHERE entity_id = ?`).get(id) as {
      statusId: string;
    }).statusId;
  }

  it("seeds the default statuses with their categories", () => {
    const db = migrateWith([]);
    const statuses = db
      .prepare(`SELECT id, category FROM issue_statuses ORDER BY sort_order`)
      .all();
    expect(statuses).toEqual([
      { id: "backlog", category: "open" },
      { id: "todo", category: "open" },
      { id: "in_progress", category: "open" },
      { id: "in_review", category: "open" },
      { id: "done", category: "closed" },
      { id: "canceled", category: "closed" },
    ]);
    expect(statuses.map((status: any) => status.id)).toEqual([...DEFAULT_ISSUE_STATUS_IDS]);
  });

  it("guesses existing issues' statuses from their stored state names", () => {
    const db = migrateWith([
      { id: "linear-todo", provider: "linear", state: "Todo" },
      { id: "linear-backlog", provider: "linear", state: "Backlog" },
      { id: "linear-progress", provider: "linear", state: "In Progress" },
      { id: "linear-review", provider: "linear", state: "In Review" },
      { id: "linear-canceled", provider: "linear", state: "Canceled" },
      { id: "github-open", provider: "github", state: "open" },
      { id: "github-closed", provider: "github", state: "closed" },
      { id: "asana-completed", provider: "asana", state: "completed" },
      { id: "closed-at", provider: "linear", state: "Shipped", closedAt: 1_700_000_000 },
    ]);

    expect(statusOf(db, "linear-todo")).toBe("todo");
    expect(statusOf(db, "linear-backlog")).toBe("backlog");
    expect(statusOf(db, "linear-progress")).toBe("in_progress");
    expect(statusOf(db, "linear-review")).toBe("in_review");
    expect(statusOf(db, "linear-canceled")).toBe("canceled");
    expect(statusOf(db, "github-open")).toBe("todo");
    expect(statusOf(db, "github-closed")).toBe("done");
    expect(statusOf(db, "asana-completed")).toBe("done");
    expect(statusOf(db, "closed-at")).toBe("done");
  });

  it("uses Jira's stored status category over the status name", () => {
    const db = migrateWith([
      { id: "jira-qa", provider: "jira", state: "Ready for QA", metadata: JSON.stringify({ statusCategory: "indeterminate" }) },
      { id: "jira-verified", provider: "jira", state: "Verified", metadata: JSON.stringify({ statusCategory: "done" }) },
      { id: "jira-bare", provider: "jira", state: "In Progress" },
    ]);

    expect(statusOf(db, "jira-qa")).toBe("in_progress");
    expect(statusOf(db, "jira-verified")).toBe("done");
    // Without a stored category the name-based guess stands.
    expect(statusOf(db, "jira-bare")).toBe("in_progress");
  });
});
