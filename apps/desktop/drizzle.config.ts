import type { Config } from "drizzle-kit";

/**
 * Drizzle CLI configuration
 *
 * IMPORTANT:
 * - drizzle-kit is ONLY used at development time (generate / push / studio)
 * - The `dbCredentials.url` here is NOT the runtime DB 
 * - Runtime DB path is resolved inside Electron main process via:
 *     app.getPath("userData") + "/mains.db"
 */

const isCI = Boolean(process.env.CI);

export default {
  dialect: "sqlite",

  // Drizzle schema source (Electron main)
  schema: "./src/main/db/schema.ts",

  // Generated SQL migrations (bundled into app resources on build)
  out: "./src/main/db/migrations",

  // CLI-only database (never shipped to production users)
  dbCredentials: {
    url: isCI ? ":memory:" : "./.data/mains.db",
  },

  // Optional: safer defaults
  verbose: !isCI,
  strict: true,
} satisfies Config;
