import { runServerCli } from "./server-cli";

void runServerCli().catch((error) => {
  console.error(
    `[serve] failed to start: ${error instanceof Error ? error.stack ?? error.message : error}`,
  );
  process.exitCode = 1;
});
