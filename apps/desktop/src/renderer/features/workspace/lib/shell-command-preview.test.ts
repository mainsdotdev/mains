import { describe, expect, it } from "vitest";
import { parseShellCommandPreview } from "./shell-command-preview";

describe("parseShellCommandPreview", () => {
  it("separates a zsh login wrapper from its command", () => {
    expect(
      parseShellCommandPreview(
        `/bin/zsh -lc "pwd && rg --files -g 'AGENTS.md'"`,
      ),
    ).toEqual({
      shell: "zsh -lc",
      command: "pwd && rg --files -g 'AGENTS.md'",
    });
  });

  it("leaves an ordinary command unchanged", () => {
    expect(parseShellCommandPreview("npm run typecheck")).toEqual({
      command: "npm run typecheck",
    });
  });

  it("keeps ambiguous shell quoting visible", () => {
    const raw = `/bin/zsh -lc "printf "unsafe""`;
    expect(parseShellCommandPreview(raw)).toEqual({ command: raw });
  });
});
