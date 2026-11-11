import { describe, expect, it } from "vitest";
import type { WorkRunToolCallEvent } from "../../../shared/adapter.types";
import { createdPullRequestUrl, pullRequestCreationCommand } from "./created-pull-request";

const url = "https://github.com/acme/widget/pull/176";
const completion = (overrides: Partial<WorkRunToolCallEvent> = {}): WorkRunToolCallEvent => ({
  type: "tool_call", toolName: "Bash", output: url,
  metadata: { phase: "complete", exitCode: 0 }, ...overrides,
});

describe("live shell PR creation recognition", () => {
  it.each([
    "gh pr create --title 'A title' --body-file /tmp/pr.md",
    "cd /tmp/repo && git push && gh pr create --draft",
    "gh -R acme/widget pr create --base main",
    "env GH_PAGER=cat /opt/homebrew/bin/gh pr create",
    "GH_HOST=github.com gh pr create --title 'A; B && C'",
    "gh pr create --body \"$(cat <<'EOF'\nSummary\nEOF\n)\"",
    "bash -lc 'cd /tmp/repo && gh pr create --draft'",
    "gh pr create --draft\n# done",
  ])("recognizes an executed create command: %s", (command) => {
    expect(pullRequestCreationCommand({ type: "tool_call", toolName: "Bash", input: { command } })).toBe(command);
  });
  it.each([
    "echo 'gh pr create'", "printf '%s' 'gh pr create'", "cat /tmp/pr-create-example.sh",
    "gh pr view 176", "gh pr create --help", "gh pr create --dry-run", "gh pr create --web", "gh pr create || gh pr view 176",
    "gh pr create; echo https://github.com/acme/widget/pull/12", "echo gh pr create",
    "gh pr create &", "cat <<EOF\ngh pr create\nEOF", "gh pr create | cat",
  ])("does not treat mentions or ambiguous shell output as a creation: %s", (command) => {
    expect(pullRequestCreationCommand({ type: "tool_call", toolName: "Bash", input: { command } })).toBeNull();
  });
  it("does not classify non-shell tool inputs", () => {
    expect(pullRequestCreationCommand({ type: "tool_call", toolName: "Read", input: { command: "gh pr create" } })).toBeNull();
  });
  it.each(["bash", "shell", "exec_command", "functions.exec_command"])("accepts the normalized %s shell tool", (toolName) => {
    expect(pullRequestCreationCommand({ type: "tool_call", toolName, input: { cmd: "gh pr create" } })).toBe("gh pr create");
  });
  it.each([url, { stdout: url, stderr: "", interrupted: false }, { content: [{ type: "text", text: url }] }])(
    "reads the actual result shape %j", (output) => {
      expect(createdPullRequestUrl(completion({ output }))).toBe(url);
    },
  );
  it.each([
    { error: "Command failed" }, { terminalStatus: "canceled" as const },
    { metadata: { phase: "complete", exitCode: 1 } },
    { metadata: { phase: "complete", success: false } },
    { metadata: { phase: "complete", interrupted: true } },
    { metadata: { phase: "start" } },
    { output: { stdout: url, exit_code: 1 } },
    { output: { stdout: url, interrupted: true } },
    { output: "See " + url }, { output: url + "\nhttps://github.com/acme/widget/pull/177" },
    { output: "https://github.com.evil.test/acme/widget/pull/176" },
    { output: { stderr: url } },
  ])("ignores failed, pending or ambiguous results %j", (overrides) => {
    expect(createdPullRequestUrl(completion(overrides))).toBeNull();
  });
});
