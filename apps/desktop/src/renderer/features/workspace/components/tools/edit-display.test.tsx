// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditDisplay } from "./edit-display";
import { ToolCallItem } from "./tool-call-item";
import { mapToolCallToEvent } from "../../lib/run-event-mappers";

vi.mock("../../hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => vi.fn() }));
vi.mock("../../hooks", () => ({ usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (name: string) => name }));

afterEach(cleanup);

describe("Edit tool change counts", () => {
  it.each([
    { provider: "Claude", params: { file_path: "/workspace/example.txt", old_string: "shared\nbefore\nshared\n", new_string: "shared\nafter\nshared\n" } },
    { provider: "Copilot", params: { path: "/workspace/example.txt", old_str: "shared\nbefore\nshared\n", new_str: "shared\nafter\nshared\n" } },
    { provider: "OpenCode", params: { path: "/workspace/example.txt", oldString: "shared\nbefore\nshared\n", newString: "shared\nafter\nshared\n" } },
  ])("keeps $provider replacement-string counts unchanged", ({ params }) => {
    render(<EditDisplay params={params} />);
    expect(screen.getByText("+4")).toBeTruthy();
    expect(screen.getByText("-4")).toBeTruthy();
    expect(screen.getByText("example.txt")).toBeTruthy();
  });

  it.each([
    { providerId: "cursor", count: 1 },
    { providerId: "claude_code", count: 4 },
    { providerId: "copilot_cli", count: 4 },
    { providerId: "codex", count: 4 },
    { providerId: "opencode", count: 4 },
    { providerId: undefined, count: 4 },
  ])("selects the snapshot diff only for the recorded Cursor provider: $providerId", ({ providerId, count }) => {
    const event = mapToolCallToEvent({ id: 1, providerId, toolName: "Edit", status: "done",
      input: { file_path: "/workspace/example.txt", old_string: "shared\nbefore\nshared\n", new_string: "shared\nafter\nshared\n" } })!;
    render(<ToolCallItem event={event} isCompact={false} />);
    expect(screen.getByText(`+${count}`)).toBeTruthy();
    expect(screen.getByText(`-${count}`)).toBeTruthy();
  });

  it.each([
    { provider: "Claude", output: { structuredPatch: [{ lines: [" shared", "-before", "+after"] }] } },
    { provider: "Copilot", output: { detailedContent: "--- a/example.txt\n+++ b/example.txt\n@@ -1,2 +1,2 @@\n shared\n-before\n+after\n" } },
  ])("keeps $provider native diff output authoritative over text parameters", ({ output }) => {
    render(<EditDisplay params={{ file_path: "/workspace/example.txt", old_string: "old one\nold two\n", new_string: "new one\nnew two\n" }} output={output} />);
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.queryByText("+2")).toBeNull();
    expect(screen.queryByText("-2")).toBeNull();
  });

  it("counts changed lines in Cursor's full-file snapshots rather than every line", () => {
    const before = Array.from({ length: 1973 }, (_, index) => `unchanged line ${index}`);
    const after = [...before];
    after.splice(980, 1, "replacement", "added 1", "added 2", "added 3", "added 4", "added 5");
    render(<EditDisplay fullFileSnapshots params={{ file_path: "/workspace/browser-panel.tsx", old_string: before.join("\n") + "\n", new_string: after.join("\n") + "\n" }} />);
    expect(screen.getByText("+6")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
    expect(screen.queryByText("+1979")).toBeNull();
    expect(screen.queryByText("-1974")).toBeNull();
  });

  it.each([
    { old_string: "", new_string: "one\ntwo\n", expected: "+2", absent: "-1" },
    { old_string: "one\ntwo\n", new_string: "", expected: "-2", absent: "+1" },
  ])("counts empty sides and trailing newlines correctly: $expected", ({ expected, absent, ...params }) => {
    render(<EditDisplay fullFileSnapshots params={{ file_path: "/workspace/example.txt", ...params }} />);
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText(absent)).toBeNull();
  });

  it("shows no change counts when both snapshots are identical", () => {
    render(<EditDisplay fullFileSnapshots params={{ file_path: "/workspace/example.txt", old_string: "one\ntwo\n", new_string: "one\ntwo\n" }} />);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
    expect(screen.queryByText(/^-\d+$/)).toBeNull();
  });
});
