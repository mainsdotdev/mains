import ts from "typescript";

type Config = Record<string, any>;
export function parseBridgeConfig(source: string, file = "wrangler.jsonc"): Config {
  const parsed = ts.parseConfigFileTextToJson(file, source);
  if (parsed.error || !parsed.config || typeof parsed.config !== "object" || Array.isArray(parsed.config)) throw new Error(`Invalid JSONC configuration: ${file}`);
  return parsed.config;
}

/** Offline checks only: never resolves a hostname, reads secrets or calls Cloudflare. */
export function productionConfigErrors(config: Config, staging: Config): string[] {
  const errors: string[] = [], vars = config.vars ?? {};
  const require = (ok: unknown, message: string) => { if (!ok) errors.push(message); };
  require(!/REPLACE_WITH|replace-with|example\.(com|org|net)/i.test(JSON.stringify(config)), "Replace all production placeholders.");
  require(typeof config.name === "string" && config.name !== staging.name && !/local|staging/i.test(config.name), "Use a separate production Worker name.");
  require(/^[a-f0-9]{32}$/.test(config.account_id ?? ""), "Set the Cloudflare account ID.");
  require(config.main === "src/index.ts", "Use the normal Worker entry, without maintenance overlays.");
  require(config.compatibility_flags?.includes("nodejs_compat"), "Enable nodejs_compat for authentication.");
  require(vars.BRIDGE_ENV === "production" && vars.BRIDGE_DEV_AUTH === "false", "Production must disable development credentials explicitly.");
  require(config.workers_dev === false && config.preview_urls === false, "Disable workers.dev and preview URLs for this custom-domain configuration.");
  let origin: URL | undefined;
  try { origin = new URL(vars.BRIDGE_AUTH_URL); } catch { /* Report below without leaking configuration values. */ }
  require(origin?.protocol === "https:" && !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash && !origin.port &&
    origin.hostname !== "localhost" && !/^(127\.|\[::1\])/.test(origin.hostname), "Configure a public HTTPS authentication origin without a path.");
  require(origin && Array.isArray(config.routes) && config.routes.some((route: Config) => route.custom_domain === true && route.pattern === origin!.hostname), "Configure the authentication host as a custom-domain route.");
  require(vars.BRIDGE_AUTH_URL !== staging.vars?.BRIDGE_AUTH_URL, "Production must not use the staging authentication origin.");
  require(typeof vars.GITHUB_CLIENT_ID === "string" && vars.GITHUB_CLIENT_ID.length > 0 || typeof vars.MAIL_FROM === "string" && vars.MAIL_FROM.includes("@"), "Configure a GitHub client ID or an email sender; provision their secrets separately.");
  require(!Object.keys(vars).some((key) => /SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY/i.test(key)), "Store credentials in Worker secrets, never inline vars.");
  require(vars.BRIDGE_MAIL_POLICY === undefined && staging.vars?.BRIDGE_MAIL_POLICY === undefined, "Deployed hubs keep the closed-beta mail policy and its daily limit.");
  const database = config.d1_databases?.find((entry: Config) => entry.binding === "AUTH_DB");
  require(database && /^[a-f0-9-]{36}$/i.test(database.database_id ?? "") && typeof database.database_name === "string" && database.migrations_dir === "migrations", "Configure AUTH_DB with its production D1 ID and migrations directory.");
  require(database && !staging.d1_databases?.some((entry: Config) => entry.database_id === database.database_id || entry.database_name === database.database_name), "Production must not share staging D1.");
  const bucket = config.r2_buckets?.find((entry: Config) => entry.binding === "BLOBS");
  require(bucket && typeof bucket.bucket_name === "string" && bucket.bucket_name.length >= 3, "Configure the private production R2 bucket.");
  require(bucket && !staging.r2_buckets?.some((entry: Config) => entry.bucket_name === bucket.bucket_name), "Production must not share staging R2.");
  const archive = config.r2_buckets?.find((entry: Config) => entry.binding === "BLOB_ARCHIVE");
  require(archive && typeof archive.bucket_name === "string" && archive.bucket_name !== bucket?.bucket_name &&
    !staging.r2_buckets?.some((entry: Config) => entry.bucket_name === archive.bucket_name), "Configure a separate private ciphertext archive bucket.");
  const observability = config.observability;
  require(observability?.enabled === true && observability.redact_query_string === true && observability.logs?.enabled === true &&
    observability.logs.invocation_logs === false && observability.traces?.enabled === false && observability.issues?.enabled === false,
    "Enable redacted application logs without invocation logs, traces or raw exception issues.");
  require(config.version_metadata?.binding === "CF_VERSION_METADATA", "Include deployment version metadata in diagnostics.");
  const hub = config.durable_objects?.bindings?.find((entry: Config) => entry.name === "ACCOUNT_HUB");
  require(hub?.class_name === "AccountHub" && !hub.script_name && !hub.environment, "Keep ACCOUNT_HUB in this production Worker's namespace.");
  require(config.migrations?.some((entry: Config) => entry.new_sqlite_classes?.includes("AccountHub")), "Declare the SQLite AccountHub migration for the new Worker.");
  return errors;
}
