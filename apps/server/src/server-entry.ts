import { DatabaseOwnershipError } from "@mains/backend/db/database-ownership";
import { runServerCli } from "./server-cli";

function isDatabaseOwnershipError(error: unknown): boolean {
  return (
    error instanceof DatabaseOwnershipError ||
    (error instanceof Error && error.name === "DatabaseOwnershipError")
  );
}

void runServerCli().catch((error) => {
  const details =
    error instanceof Error ? error.stack ?? error.message : String(error);
  if (
    process.env.MAINS_SERVER_SERVICE === "1" &&
    isDatabaseOwnershipError(error)
  ) {
    console.warn(
      `[serve] Mains data is already owned; background service will remain stopped: ${details}`,
    );
    process.exitCode = 0;
    return;
  }

  console.error(
    `[serve] failed to start: ${details}`,
  );
  process.exitCode = 1;
});
