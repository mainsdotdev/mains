import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { MIGRATIONS, migrateDatabase } from "../src/db/migrations.ts";
import { models } from "../src/db/schema.ts";

function syncModel(db, values) {
  // Generate the insert from syncModels' SQLite schema without native bindings.
  const query = drizzle(async () => ({ rows: [] })).insert(models).values(values).onConflictDoNothing().toSQL();
  db.prepare(query.sql).run(...query.params);
}

function migrationDatabase(db) {
  return {
    execSync: (sql) => db.exec(sql),
    getFirstSync: (sql) => db.prepare(sql).get() ?? null,
    getAllSync: (sql) => db.prepare(sql).all(),
    withTransactionSync(task) {
      db.exec("BEGIN");
      try {
        task();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function seedVersion(db, version) {
  for (const migration of MIGRATIONS.slice(0, version)) db.exec(migration);
  db.exec(`PRAGMA user_version = ${version}`);
}

test("upgrading a v14 phone preserves its chats and preferences while adding conversation settings", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedVersion(db, 14);
    db.exec("INSERT INTO runs (backend_id, id, status, mode, provider_id, model, created_at, updated_at) VALUES ('mac', 'chat', 'succeeded', 'developer', 'codex', 'original', 1, 2)");
    db.exec("INSERT INTO model_choices VALUES ('mac', 'codex', 'phone-choice')");
    db.exec("INSERT INTO preferences VALUES ('appearance', 'dark')");
    migrateDatabase(migrationDatabase(db));
    assert.equal(db.prepare("SELECT model FROM runs WHERE id = 'chat'").get().model, "original");
    assert.equal(db.prepare("SELECT config_snapshot_json FROM runs WHERE id = 'chat'").get().config_snapshot_json, null);
    assert.equal(db.prepare("SELECT value FROM preferences WHERE key = 'appearance'").get().value, "dark");
    db.prepare("INSERT INTO composer_settings VALUES (?, ?, ?, ?)").run("mac", "codex", "defaults", JSON.stringify({ model: "chat-choice", config: {} }));
    db.prepare("INSERT INTO composer_settings VALUES (?, ?, ?, ?)").run("another-mac", "codex", "defaults", JSON.stringify({ model: "other-choice", config: {} }));
    assert.equal(db.prepare("SELECT count(*) AS count FROM composer_settings").get().count, 2);
    assert.equal(db.prepare("SELECT model_id FROM model_choices").get().model_id, "phone-choice");
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, MIGRATIONS.length);
  } finally { db.close(); }
});

test("an early v15 database gains service tiers before model sync without losing local settings", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedVersion(db, 15);
    // A dev client already ran v15 before service tiers were added to that entry.
    db.exec("ALTER TABLE models DROP COLUMN service_tiers_json");
    db.exec("INSERT INTO preferences VALUES ('appearance', 'dark')");
    db.exec("INSERT INTO model_choices VALUES ('mac', 'codex', 'phone-choice')");
    db.exec("INSERT INTO composer_settings VALUES ('mac', 'codex', 'defaults', '{\"model\":\"chat-choice\",\"config\":{}}')");
    db.exec("INSERT INTO models (backend_id, provider_id, id, display_name) VALUES ('mac', 'codex', 'existing', 'Existing')");
    const migrate = migrationDatabase(db);

    migrateDatabase(migrate);
    const tiers = JSON.stringify([{ id: "fast", label: "Fast" }]);
    syncModel(db, { backendId: "mac", providerId: "codex", id: "new", displayName: "New", serviceTiersJson: tiers });

    assert.equal(db.prepare("SELECT service_tiers_json FROM models WHERE id = 'new'").get().service_tiers_json, tiers);
    assert.equal(db.prepare("SELECT display_name FROM models WHERE id = 'existing'").get().display_name, "Existing");
    assert.equal(db.prepare("SELECT value FROM preferences WHERE key = 'appearance'").get().value, "dark");
    assert.equal(db.prepare("SELECT model_id FROM model_choices").get().model_id, "phone-choice");
    assert.equal(db.prepare("SELECT settings_json FROM composer_settings").get().settings_json, '{"model":"chat-choice","config":{}}');
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, MIGRATIONS.length);
    migrateDatabase(migrate);
    assert.equal(db.prepare("SELECT count(*) AS count FROM models").get().count, 2);
  } finally { db.close(); }
});

test("a complete v15 database keeps its existing service tiers when the upgrade runs twice", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedVersion(db, 15);
    const tiers = JSON.stringify([{ id: "ultrafast", label: "Ultrafast" }]);
    db.prepare("INSERT INTO models (backend_id, provider_id, id, display_name, service_tiers_json) VALUES (?, ?, ?, ?, ?)")
      .run("mac", "codex", "existing", "Existing", tiers);
    const migrate = migrationDatabase(db);
    migrateDatabase(migrate);
    migrateDatabase(migrate);
    assert.equal(db.prepare("SELECT service_tiers_json FROM models").get().service_tiers_json, tiers);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, MIGRATIONS.length);
    assert.equal(db.prepare("PRAGMA table_info(models)").all().filter((column) => column.name === "service_tiers_json").length, 1);
  } finally { db.close(); }
});

test("a failed schema upgrade rolls back its column and version so the next launch can retry", () => {
  const db = new DatabaseSync(":memory:");
  try {
    seedVersion(db, 15);
    db.exec("ALTER TABLE models DROP COLUMN service_tiers_json");
    const migrate = migrationDatabase(db);
    const failing = {
      ...migrate,
      execSync(sql) {
        if (sql.startsWith("PRAGMA user_version =")) throw new Error("interrupted upgrade");
        migrate.execSync(sql);
      },
    };
    assert.throws(() => migrateDatabase(failing), /interrupted upgrade/);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(db.prepare("PRAGMA table_info(models)").all().some((column) => column.name === "service_tiers_json"), false);
    migrateDatabase(migrate);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, MIGRATIONS.length);
    assert.equal(db.prepare("PRAGMA table_info(models)").all().some((column) => column.name === "service_tiers_json"), true);
  } finally { db.close(); }
});
