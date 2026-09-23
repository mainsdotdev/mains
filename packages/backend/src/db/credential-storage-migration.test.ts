import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const migrationsDirectory = path.resolve(__dirname, "migrations");
const migrationTag = "0025_purple_warbird";

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

describe("Credential storage format migration", () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it("restores the newest credential per runtime without reviving revoked connections", () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    for (const { tag } of journal.entries) {
      if (tag === migrationTag) break;
      apply(sqlite, tag);
    }

    sqlite.exec(`
      INSERT INTO connections(id, provider, type, status)
      VALUES
        ('active', 'github', 'api_key', 'active'),
        ('revoked', 'linear', 'api_key', 'revoked');

      INSERT INTO connection_tokens(
        connection_id, access_token_enc, is_current, created_at
      ) VALUES
        ('active', X'01020304', 0, 100),
        ('active', X'4D4E533101020304', 1, 200),
        ('revoked', X'05060708', 0, 100),
        ('revoked', X'4D4E533105060708', 0, 200);
    `);

    apply(sqlite, migrationTag);

    const active = sqlite
      .prepare(`
        SELECT encryption_format AS encryptionFormat, is_current AS isCurrent
        FROM connection_tokens
        WHERE connection_id = 'active'
        ORDER BY id
      `)
      .all();
    expect(active).toEqual([
      { encryptionFormat: "unversioned", isCurrent: 1 },
      { encryptionFormat: "mns1-aes-gcm-v1", isCurrent: 1 },
    ]);

    const revoked = sqlite
      .prepare(`
        SELECT is_current AS isCurrent
        FROM connection_tokens
        WHERE connection_id = 'revoked'
        ORDER BY id
      `)
      .all();
    expect(revoked).toEqual([{ isCurrent: 0 }, { isCurrent: 0 }]);

    expect(() =>
      sqlite!.exec(`
        INSERT INTO connection_tokens(
          connection_id, access_token_enc, encryption_format, is_current
        ) VALUES (
          'active', X'4D4E533109', 'mns1-aes-gcm-v1', 1
        )
      `),
    ).toThrow(/UNIQUE/);

    expect(() =>
      sqlite!.exec(`
        INSERT INTO connection_tokens(
          connection_id, access_token_enc, encryption_format, is_current
        ) VALUES (
          'active', X'09', 'electron-safe-storage-v1', 1
        )
      `),
    ).not.toThrow();
  });
});
