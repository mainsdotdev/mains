import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as schema from "../../db/schema";
import { createAccount, createWorkspace, createRun } from "../../../test/factories";
import type { DatabaseInstance } from "../../db/types";

describe("assistant execution migration", () => {
    it("keeps accepted Code jobs on their original workspace while adding avatar defaults without deleting children", () => {
        const sqlite = new Database(":memory:"); sqlite.pragma("foreign_keys = ON");
        const dir = resolve(__dirname, "../../db/migrations");
        const journal = JSON.parse(readFileSync(resolve(dir, "meta/_journal.json"), "utf8"));
        const apply = (tag: string) => readFileSync(resolve(dir, `${tag}.sql`), "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean).forEach(sql => sqlite.exec(sql));
        try {
            for (const entry of journal.entries) { if (entry.tag === "0045_assistant_execution_avatar") break; apply(entry.tag); }
            const db = drizzle(sqlite, { schema }) as DatabaseInstance;
            createAccount(db); const workspace = createWorkspace(db, { id: "legacy-workspace" });
            sqlite.prepare("INSERT INTO assistant_teams (id, account_id, name) VALUES ('team', 'default', 'Mains')").run();
            sqlite.prepare("INSERT INTO assistants (id, account_id, team_id, name, instructions, space_id, provider_id, mode, model, effort, settings, space_snapshot, workspace_id) VALUES ('assistant', 'default', 'team', 'TestFlight', 'Check builds', 'codex', 'codex', 'developer', 'model', 'high', '{}', '{}', ?)").run(workspace.id);
            createRun(db, { id: "legacy-worker", assistantId: "assistant", workspaceId: workspace.id, mode: "developer" });
            for (const [id, worker] of [["queued", null], ["running", "legacy-worker"]]) sqlite.prepare("INSERT INTO assistant_assignments (id, account_id, team_id, to_assistant_id, task_key, dedupe_key, title, prompt, worker_run_id) VALUES (?, 'default', 'team', 'assistant', ?, ?, 'Check', 'Check build', ?)").run(id, id, id, worker);
            sqlite.prepare("INSERT INTO assistant_memories (id, account_id, team_id, title, content) VALUES ('memory', 'default', 'team', 'Release', 'Build 42')").run();
            apply("0045_assistant_execution_avatar");
            const jobs = sqlite.prepare("SELECT execution FROM assistant_assignments").all() as Array<{ execution: string }>;
            expect(jobs.map(row => JSON.parse(row.execution))).toEqual([{ mode: "developer", workspaceId: workspace.id }, { mode: "developer", workspaceId: workspace.id }]);
            expect(sqlite.prepare("SELECT count(*) as n FROM assistant_memories").get()).toEqual({ n: 1 });
            expect(sqlite.prepare("SELECT count(*) as n FROM runs WHERE id = 'legacy-worker'").get()).toEqual({ n: 1 });
            expect(JSON.parse((sqlite.prepare("SELECT avatar FROM assistants").get() as { avatar: string }).avatar)).toEqual({ shape: "circle", color: "blue" });
            expect(sqlite.pragma("foreign_key_check")).toEqual([]);
        } finally { sqlite.close(); }
    });
});
