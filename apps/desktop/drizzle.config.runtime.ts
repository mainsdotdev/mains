import type { Config } from "drizzle-kit";
import { homedir } from "os";
import { join } from "path";

/**
 * Drizzle Studio configuration for RUNTIME database
 * Points to the actual database used by the running app
 */

// macOS: ~/Library/Application Support/mains/mains.db
// Linux: ~/.config/mains/mains.db (not implemented yet)
// Windows: %APPDATA%/mains/mains.db (not implemented yet)
const getRuntimeDbPath = () => {
  const platform = process.platform;
  const home = homedir();

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "mains", "mains.db");
  } else if (platform === "win32") {
    return join(home, "AppData", "Roaming", "mains", "mains.db");
  } else {
    return join(home, ".config", "mains", "mains.db");
  }
};

export default {
  dialect: "sqlite",
  schema: "./src/main/db/schema.ts",
  out: "./src/main/db/migrations",

  dbCredentials: {
    url: getRuntimeDbPath(),
  },

  verbose: true,
  strict: true,
} satisfies Config;
