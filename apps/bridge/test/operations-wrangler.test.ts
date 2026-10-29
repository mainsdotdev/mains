import { beforeEach, expect, it, vi } from "vitest";
import { runWrangler } from "../scripts/operations";

const mocks = vi.hoisted(() => ({ failure: new Error("Provider failure") }));
vi.mock("node:child_process", () => ({
  execFile: (_file: unknown, _args: unknown, _options: unknown, callback: (error: Error) => void) => callback(mocks.failure),
}));
beforeEach(() => { mocks.failure = new Error("Provider failure"); });

it("retains only exit and Cloudflare error codes when a backup subprocess fails", async () => {
  mocks.failure = Object.assign(new Error("Command failed: secret-token"), {
    code: 1,
    stdout: "Download https://private.invalid/auth.sql?token=secret-token\n[code: 10000]",
    stderr: "\u001b[31mAuthentication error [code: 10000]\u001b[0m\nINSERT INTO user VALUES ('private@example.test');",
  });
  await expect(runWrangler(["d1", "export", "AUTH_DB"])).rejects.toMatchObject({
    message: "Wrangler d1 export failed (exit 1; Cloudflare codes: 10000); no backup is complete until verification succeeds",
  });
});

it("reports a killed subprocess without exposing its command or provider output", async () => {
  mocks.failure = Object.assign(new Error("secret-token"), { killed: true, signal: "SIGTERM", stderr: "private SQL" });
  await expect(runWrangler(["d1", "export", "AUTH_DB"])).rejects.toMatchObject({
    message: "Wrangler d1 export failed (process terminated); no backup is complete until verification succeeds",
  });
});

it("keeps unknown provider failures content-free", async () => {
  mocks.failure = Object.assign(new Error("secret-token"), { code: "ENOENT", stderr: "private SQL [code: secret-token]" });
  await expect(runWrangler(["d1", "export", "AUTH_DB"])).rejects.toMatchObject({
    message: "Wrangler d1 export failed; no backup is complete until verification succeeds",
  });
});
