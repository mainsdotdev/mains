import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseBridgeConfig, productionConfigErrors } from "../scripts/production-config";

const staging = { name: "mains-bridge-staging", vars: { BRIDGE_AUTH_URL: "https://staging.mains.test" },
  d1_databases: [{ database_id: "00000000-0000-4000-8000-000000000001", database_name: "staging-auth" }], r2_buckets: [{ bucket_name: "staging-blobs" }] };
const config = () => ({ name: "mains-bridge-production", account_id: "a".repeat(32), main: "src/index.ts", compatibility_flags: ["nodejs_compat"], workers_dev: false, preview_urls: false,
  vars: { BRIDGE_ENV: "production", BRIDGE_DEV_AUTH: "false", BRIDGE_AUTH_URL: "https://bridge.mains.test", GITHUB_CLIENT_ID: "test-public-id" },
  routes: [{ pattern: "bridge.mains.test", custom_domain: true }],
  d1_databases: [{ binding: "AUTH_DB", database_name: "production-auth", database_id: "00000000-0000-4000-8000-000000000002", migrations_dir: "migrations" }],
  r2_buckets: [{ binding: "BLOBS", bucket_name: "production-blobs" }], durable_objects: { bindings: [{ name: "ACCOUNT_HUB", class_name: "AccountHub" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["AccountHub"] }] });

describe("offline production readiness checks", () => {
  it("accepts an isolated config and parses JSONC without a network client", () => {
    expect(productionConfigErrors(parseBridgeConfig(`// production\n${JSON.stringify(config())}`), staging)).toEqual([]);
    expect(() => parseBridgeConfig("{bad json}")).toThrow(/Invalid JSONC/);
  });
  it("refuses the unconfigured example, development credentials, reused resources and inline secrets", async () => {
    const template = parseBridgeConfig(await readFile(new URL("../wrangler.production.example.jsonc", import.meta.url), "utf8"));
    expect(productionConfigErrors(template, staging)).toContain("Replace all production placeholders.");
    const bad = config(); bad.vars.BRIDGE_DEV_AUTH = "true"; Object.assign(bad.vars, { GITHUB_CLIENT_SECRET: "must-not-be-inline" });
    bad.d1_databases[0].database_id = staging.d1_databases[0].database_id; bad.r2_buckets[0].bucket_name = staging.r2_buckets[0].bucket_name;
    const errors = productionConfigErrors(bad, staging);
    expect(errors).toContain("Production must disable development credentials explicitly.");
    expect(errors).toContain("Production must not share staging D1."); expect(errors).toContain("Production must not share staging R2.");
    expect(errors).toContain("Store credentials in Worker secrets, never inline vars.");
  });
  it("rejects unsafe origins, external DO namespaces and reset overlays", () => {
    const bad = config(); bad.main = "src/staging-reset-worker.ts"; bad.vars.BRIDGE_AUTH_URL = "http://localhost:8790";
    Object.assign(bad.durable_objects.bindings[0], { script_name: staging.name });
    const errors = productionConfigErrors(bad, staging);
    expect(errors).toContain("Use the normal Worker entry, without maintenance overlays.");
    expect(errors).toContain("Configure a public HTTPS authentication origin without a path.");
    expect(errors).toContain("Keep ACCOUNT_HUB in this production Worker's namespace.");
  });
});
