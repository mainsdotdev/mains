import type { Config } from "drizzle-kit";
import { homedir } from "os";
import { join } from "path";

/**
 * Drizzle Studio configuration for RUNTIME database
 * Points to the actual database used by the running app
 */

// macOS: ~/Library/Application Support/mains/mains.db
// Linux: $XDG_CONFIG_HOME/mains/mains.db (defaults to ~/.config)
// Windows: %APPDATA%/mains/mains.db
const getRuntimeDbPath = () => {
  const platform = process.platform;
  const home = homedir();

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "mains", "mains.db");
  } else if (platform === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "mains", "mains.db");
  } else {
    return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "mains", "mains.db");
  }
};

export default {
  dialect: "sqlite",
  schema: "../../packages/backend/src/db/schema.ts",
  out: "../../packages/backend/src/db/migrations",

  dbCredentials: {
    url: getRuntimeDbPath(),
  },

  verbose: true,
  strict: true,
} satisfies Config;
