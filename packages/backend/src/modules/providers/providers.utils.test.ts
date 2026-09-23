import { describe, expect, it } from "vitest";
import { mergePathDirs } from "./providers.utils";

describe("providers.utils / mergePathDirs", () => {
  it("puts login-shell dirs first, then the inherited PATH, then extras", () => {
    const merged = mergePathDirs(
      "/Users/me/.nvm/versions/node/v22.1.0/bin:/opt/homebrew/bin",
      "/usr/bin:/bin",
      ["/usr/local/bin"],
    );
    expect(merged).toBe(
      "/Users/me/.nvm/versions/node/v22.1.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin",
    );
  });

  it("dedupes while keeping the first occurrence's position", () => {
    const merged = mergePathDirs(
      "/opt/homebrew/bin:/usr/bin",
      "/usr/bin:/bin:/opt/homebrew/bin",
      ["/opt/homebrew/bin", "/bin"],
    );
    expect(merged).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  it("falls back to inherited PATH plus extras when the shell read failed", () => {
    const merged = mergePathDirs(null, "/usr/bin:/bin", ["/usr/local/bin"]);
    expect(merged).toBe("/usr/bin:/bin:/usr/local/bin");
  });

  it("drops empty segments from a malformed PATH", () => {
    const merged = mergePathDirs("", "/usr/bin::/bin:", []);
    expect(merged).toBe("/usr/bin:/bin");
  });
});
