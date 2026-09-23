import { describe, it, expect } from "vitest";
import { parseInstallCommand } from "./guards.utils";

describe("parseInstallCommand", () => {
  it("ignores dependency restore commands without package names", () => {
    const commands = [
      "npm install",
      "npm ci",
      "npm install --legacy-peer-deps",
      "npm install --include dev",
      "npm install && npm run lint",
      "pnpm install",
      "yarn install",
      "bun install",
    ];

    for (const command of commands) {
      expect(parseInstallCommand(command), command).toBeNull();
    }
  });

  it("extracts named packages from package add commands", () => {
    expect(parseInstallCommand("npm install axios")).toEqual({
      ecosystem: "npm",
      packages: [{ name: "axios", ecosystem: "npm" }],
    });

    expect(parseInstallCommand("npm i @types/node@22 -D")).toEqual({
      ecosystem: "npm",
      packages: [{ name: "@types/node", version: "22", ecosystem: "npm" }],
    });

    expect(parseInstallCommand("pnpm add zod")).toEqual({
      ecosystem: "npm",
      packages: [{ name: "zod", ecosystem: "npm" }],
    });

    expect(parseInstallCommand("pip install requests==2.31.0")).toEqual({
      ecosystem: "pypi",
      packages: [{ name: "requests", version: "2.31.0", ecosystem: "pypi" }],
    });

    expect(parseInstallCommand("cargo add serde")).toEqual({
      ecosystem: "cargo",
      packages: [{ name: "serde", ecosystem: "cargo" }],
    });
  });

  it("stops package parsing at shell command separators", () => {
    expect(parseInstallCommand("npm install axios && npm test")).toEqual({
      ecosystem: "npm",
      packages: [{ name: "axios", ecosystem: "npm" }],
    });

    expect(parseInstallCommand("npm install && npm test")).toBeNull();
  });

  it("ignores flags, local paths, URLs, and git specs", () => {
    const command = "npm install --registry https://registry.npmjs.org ./local /tmp/pkg github:user/repo git+https://github.com/user/repo.git";

    expect(parseInstallCommand(command)).toBeNull();
  });
});
