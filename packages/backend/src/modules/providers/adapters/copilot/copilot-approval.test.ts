import { describe, expect, it } from "vitest";
import type { PermissionRequest } from "@github/copilot-sdk";
import { copilotApprovalInput, mapCopilotPermissionApproval } from "./copilot-approval";

function write(overrides: Partial<Extract<PermissionRequest, { kind: "write" }>> = {}): PermissionRequest {
  return { kind: "write", fileName: "/workspace/hero-section.tsx", intention: "Update file",
    diff: "--- a/hero-section.tsx\n+++ b/hero-section.tsx\n@@ -1,1 +1,1 @@\n-old\n+new",
    canOfferSessionApproval: true, toolCallId: "custom_call_internal", managedApprovalRequired: true, ...overrides };
}

describe("Copilot approval projection", () => {
  it("maps the screenshot's write permission to an Edit diff without protocol noise", () => {
    const input = write();
    const result = mapCopilotPermissionApproval(input);
    expect(result).toEqual({ toolName: "Edit", question: "Allow editing this file?", description: "Update file",
      toolInput: { file_path: "/workspace/hero-section.tsx", diff: input.kind === "write" ? input.diff : "" } });
    expect(JSON.stringify(result)).not.toContain("custom_call_internal");
    expect(result.toolInput).not.toHaveProperty("managedApprovalRequired");
  });

  it.each([
    ["--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+new", "Write", "Allow creating this file?"],
    ["--- a/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-old", "Delete", "Allow deleting this file?"],
  ])("distinguishes file creation and deletion from the native diff", (diff, toolName, question) => {
    expect(mapCopilotPermissionApproval(write({ diff }))).toMatchObject({ toolName, question, toolInput: { diff } });
  });

  it("retains complete file contents when an external runtime has no diff", () => {
    expect(mapCopilotPermissionApproval(write({ diff: "", newFileContents: "export const ready = true;\n" })))
      .toMatchObject({ toolName: "Write", question: "Allow writing this file?", toolInput: { content: "export const ready = true;\n" } });
  });

  it("shows the entire shell expression, cwd and actual sandbox scope and warnings", () => {
    expect(mapCopilotPermissionApproval({ kind: "shell", fullCommandText: "cd src && npm test > results.txt",
      resolvedWorkingDirectory: "/workspace", intention: "Run tests", warning: "Writes results.txt",
      requestSandboxBypass: true, requestSandboxBypassReason: "Needs network access",
      sandboxPathGrant: { path: "/shared", access: "readWrite", deniedPath: "/shared/results.txt" },
      commands: [], possiblePaths: [], possibleUrls: [], canOfferSessionApproval: true, hasWriteFileRedirection: true }))
      .toEqual({ toolName: "Bash", question: "Allow running this command?",
        description: "Run tests\nWrites results.txt\nNeeds network access\nRequests read and write access to /shared.",
        toolInput: { command: "cd src && npm test > results.txt", cwd: "/workspace" } });
  });

  it("keeps the resolved read target and redirect origin visible", () => {
    expect(mapCopilotPermissionApproval({ kind: "read", path: "link.txt", resolvedPath: "/outside/target.txt", intention: "Read target" }))
      .toMatchObject({ toolName: "Read", toolInput: { file_path: "/outside/target.txt" }, description: "Read target" });
    expect(mapCopilotPermissionApproval({ kind: "url", url: "https://destination.test", redirectedFrom: "https://origin.test", intention: "Fetch docs" }))
      .toMatchObject({ toolName: "WebFetch", toolInput: { url: "https://destination.test", redirected_from: "https://origin.test" } });
  });

  it("keeps MCP ownership, native display title and arguments without leaking permission metadata", () => {
    expect(mapCopilotPermissionApproval({ kind: "mcp", serverName: "calendar", toolName: "create_event", toolTitle: "Create calendar event",
      readOnly: false, toolCallId: "internal", args: { title: "Team sync", participants: ["Alex"] } }))
      .toEqual({ toolName: "mcp__calendar__create_event", header: "Create calendar event", question: "Allow Create calendar event?",
        description: "MCP server: calendar", toolInput: { _meta: { tool_params_display: [
          { display_name: "Title", value: "Team sync" }, { display_name: "Participants", value: ["Alex"] },
        ] } } });
  });

  it("keeps MCP message, URL and similarly named inputs separate from host metadata", () => {
    expect(copilotApprovalInput({ message: "Meeting invite", url: "https://calendar.test", kind: "invite", description: "", notify: false }, "mcp__calendar__send_invite"))
      .toEqual({ _meta: { tool_params_display: [
        { display_name: "Message", value: "Meeting invite" }, { display_name: "Url", value: "https://calendar.test" },
        { display_name: "Kind", value: "invite" },
        { display_name: "Description", value: "" }, { display_name: "Notify", value: false },
      ] } });
  });

  it("uses the actual custom or hook tool name and decodes JSON-encoded arguments", () => {
    expect(mapCopilotPermissionApproval({ kind: "custom-tool", toolName: "skill", toolDescription: "Use a skill", args: '{"skill":"frontend-design"}' }))
      .toMatchObject({ toolName: "skill", description: "Use a skill", toolInput: { skill: "frontend-design" } });
    expect(mapCopilotPermissionApproval({ kind: "hook", toolName: "edit", toolArgs: { path: "src/app.ts", old_str: "before", new_str: "after" }, hookMessage: "Review edit" }))
      .toMatchObject({ toolName: "edit", description: "Review edit", toolInput: { path: "src/app.ts", old_str: "before", new_str: "after" } });
  });

  it("shows memory and extension access details as curated parameters", () => {
    expect(mapCopilotPermissionApproval({ kind: "memory", fact: "Use npm", scope: "repository", repoNwo: "owner/repo", reason: "Project preference" }).toolInput)
      .toEqual({ _meta: { tool_params_display: [{ display_name: "Memory", value: "Use npm" },
        { display_name: "Scope", value: "repository" }, { display_name: "Repository", value: "owner/repo" }] } });
    expect(mapCopilotPermissionApproval({ kind: "extension-permission-access", extensionName: "Preview", capabilities: ["network", "filesystem"] }).toolInput)
      .toEqual({ _meta: { tool_params_display: [{ display_name: "Extension", value: "Preview" }, { display_name: "Capabilities", value: "network, filesystem" }] } });
    expect(mapCopilotPermissionApproval({ kind: "extension-env-access", extensionName: "Preview", environmentVariables: ["TOKEN", "HOST"] }).toolInput)
      .toEqual({ _meta: { tool_params_display: [{ display_name: "Extension", value: "Preview" }, { display_name: "Variables", value: "TOKEN, HOST" }] } });
  });

  it("keeps a workflow's approved limits, including zero, and phase details", () => {
    const result = mapCopilotPermissionApproval({ kind: "workflow", approvalKey: "internal-key", canPersistApproval: true,
      name: "Review", operation: "run", description: "Review the change", phases: [{ title: "Tests", detail: "Run npm test" }],
      maxAiCredits: 0, declaredMaxAiCredits: 5, maxConcurrentSubagents: 2, maxTotalSubagents: 4, timeoutSeconds: 60 });
    expect(result.toolInput).toEqual({ _meta: { tool_params_display: [
      { display_name: "Operation", value: "run" }, { display_name: "Phases", value: "Tests: Run npm test" },
      { display_name: "AI credits", value: 0 }, { display_name: "Concurrent subagents", value: 2 },
      { display_name: "Total subagents", value: 4 }, { display_name: "Timeout (seconds)", value: 60 },
    ] } });
    expect(JSON.stringify(result)).not.toContain("internal-key");
    expect(mapCopilotPermissionApproval({ kind: "workflow", approvalKey: "internal-key", canPersistApproval: false,
      name: "Review", operation: "author", description: "Create a workflow", phases: [] }).question).toBe("Allow authoring this workflow?");
  });

  it("preserves non-object tool arguments and handles absent arguments", () => {
    expect(copilotApprovalInput(undefined)).toEqual({});
    expect(copilotApprovalInput("not json")).toEqual({ args: "not json" });
    expect(copilotApprovalInput(["one", "two"])).toEqual({ args: ["one", "two"] });
  });
});
