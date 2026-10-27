import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { buildElicitationContent, getElicitationDefaultValues, validateElicitationContent } from "@mains/contracts/mcp-elicitation";
import { approvalRow } from "../src/backend/approval-projection.ts";
import { MIGRATIONS } from "../src/db/migrations.ts";
import { pendingApprovals } from "../src/db/schema.ts";
import { parseApprovalForm } from "../src/lib/elicitation.ts";

const schema = {
  type: "object",
  properties: {
    calendar: { type: "string", oneOf: [{ const: "work", title: "Work calendar" }, { const: "personal", title: "Personal calendar" }], default: "work" },
    seats: { type: "integer", minimum: 1, maximum: 5, default: 2 },
    notify: { type: "boolean", default: true },
    people: { type: "array", items: { anyOf: [{ const: "okan", title: "Okan" }, { const: "alex", title: "Alex" }] }, minItems: 1, default: ["okan"] },
    apiKey: { type: "string", minLength: 3 },
  },
  required: ["calendar", "seats", "people", "apiKey"],
};
const request = { requestId: "form", runId: "run", kind: "elicitation", toolName: "Calendar", elicitationMode: "form", timestamp: 1000, requestedSchema: schema };

test("a pushed or refreshed request keeps its schema through the phone's SQLite projection", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migrations = { execSync: (sql) => database.exec(sql), getAllSync: (sql) => database.prepare(sql).all() };
    for (const migration of MIGRATIONS) {
      if (typeof migration === "string") database.exec(migration);
      else migration(migrations);
    }
    const row = approvalRow("mac", request, 2000);
    const query = drizzle(async () => ({ rows: [] })).insert(pendingApprovals).values(row).toSQL();
    database.prepare(query.sql).run(...query.params);
    const cached = database.prepare("SELECT * FROM pending_approvals").get();
    const parsed = parseApprovalForm(cached.requested_schema_json);
    assert.equal(cached.elicitation_mode, "form");
    assert.deepEqual(parsed.unsupported, []);
    assert.equal(parsed.fields.length, 5);
    assert.deepEqual(parsed.fields[0].enumLabels, ["Work calendar", "Personal calendar"]);
    assert.equal(parsed.fields.find((field) => field.name === "apiKey").isSecret, true);
    assert.equal(Object.hasOwn(cached, "answer"), false);
  } finally { database.close(); }
});

test("typed phone answers with defaults pass the backend's exact form validation", () => {
  const { fields } = parseApprovalForm(approvalRow("mac", request, 2000).requestedSchemaJson);
  const defaults = getElicitationDefaultValues(fields);
  assert.equal(defaults.seats, "2");
  const result = buildElicitationContent(fields, { ...defaults, seats: "3", notify: false, people: ["alex"], apiKey: "local-secret" });
  assert.equal(result.ok, true);
  const answer = JSON.stringify(result.content);
  assert.deepEqual(JSON.parse(answer), { calendar: "work", seats: 3, notify: false, people: ["alex"], apiKey: "local-secret" });
  assert.equal(validateElicitationContent(schema, JSON.parse(answer)).ok, true);
  assert.deepEqual(getElicitationDefaultValues(fields), defaults);
  assert.equal(defaults.apiKey, undefined); // Answers are never stored in the request/defaults.
});

test("missing or invalid values stop submission with errors for the right fields", () => {
  const { fields } = parseApprovalForm(JSON.stringify(schema));
  const defaults = getElicitationDefaultValues(fields);
  for (const seats of ["abc", "1.5", "0", "6", "Infinity"]) {
    const result = buildElicitationContent(fields, { ...defaults, seats, apiKey: "key" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.seats);
  }
  const result = buildElicitationContent(fields, { ...defaults, calendar: "other", people: [], apiKey: "" });
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors), ["calendar", "people", "apiKey"]);
});

test("missing, damaged and unsupported schemas cannot become empty confirmations", () => {
  for (const json of [null, "broken", "null", "[]", '{"properties":{"nested":{"type":"object"}}}']) {
    assert.ok(parseApprovalForm(json).unsupported.length > 0);
  }
  assert.deepEqual(parseApprovalForm('{"type":"object","properties":{}}').unsupported, []);
});

test("one-call permissions survive projection without changing questions or URL elicitations", () => {
  const row = approvalRow("mac", { ...request, suppressAlwaysAllowRule: true }, 2000);
  assert.equal(row.suppressAlwaysAllowRule, true);
  const question = approvalRow("mac", { ...request, kind: "ask_user", requestedSchema: undefined, question: "Proceed?", options: [{ label: "Yes" }], multiSelect: true, isOther: true, isSecret: true }, 2000);
  assert.equal(question.requestedSchemaJson, null);
  assert.equal(question.optionsJson, '[{"label":"Yes"}]');
  assert.equal(question.multiSelect, true);
  assert.equal(question.isOther, true);
  assert.equal(question.isSecret, true);
  const url = approvalRow("mac", { ...request, elicitationMode: "url", url: "https://mains.dev/confirm" }, 2000);
  assert.equal(url.url, "https://mains.dev/confirm");
});
