import type { GitHubCliStatus } from "@mains/contracts/github-cli";
import { Button, CopyButton } from "@/components/ui";
import { Github, Refresh } from "@/components/ui/icons";

const LOGIN_COMMAND = "gh auth login";

const HEADINGS = {
  ready: "GitHub CLI is ready",
  missing: "GitHub CLI not found",
  "signed-out": "Sign in to GitHub CLI",
  unavailable: "Couldn’t verify GitHub CLI",
};

export function GitHubCliStep({
  status,
  isChecking,
  onRecheck,
}: {
  status: GitHubCliStatus | undefined;
  isChecking: boolean;
  onRecheck: () => void;
}) {
  const needsInstall = status?.status === "missing";
  const needsLogin = needsInstall || status?.status === "signed-out";

  return (
    <section className="onboarding-install" aria-label="GitHub CLI setup">
      <Github className="onboarding-install-icon" aria-hidden="true" />
      <h2>{status ? HEADINGS[status.status] : "GitHub CLI"}</h2>
      <p role="status">
        {isChecking || !status
          ? "Checking GitHub CLI…"
          : status.status === "ready"
            ? `Signed in as @${status.login}.`
            : status.status === "missing"
              ? "Install GitHub CLI, then run this command in your terminal."
              : status.status === "signed-out"
                ? "Run this command in your terminal, then recheck here."
                : "Try again or run gh auth status in your terminal for details."}
      </p>
      {needsLogin && (
        <div className="onboarding-command glass-outline">
          <code>{LOGIN_COMMAND}</code>
          <CopyButton variant="icon" tooltip="Copy sign-in command" text={LOGIN_COMMAND} />
        </div>
      )}
      <div className="onboarding-install-actions">
        {needsInstall && (
          <Button
            variant="subtle"
            className="onboarding-text-button"
            onClick={() => void window.api.shell.openExternal("https://cli.github.com/")}
          >
            Install GitHub CLI
          </Button>
        )}
        <Button
          className="onboarding-recheck ml-auto"
          onClick={onRecheck}
          isLoading={isChecking || !status}
        >
          <Refresh className="size-3.5" /> Recheck
        </Button>
      </div>
    </section>
  );
}
