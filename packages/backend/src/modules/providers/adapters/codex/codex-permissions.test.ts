import { describe, expect, it, vi } from "vitest";
import { codexPermissionPatch, codexPermissionValue } from "@mains/contracts/codex-permissions";
import type { CodexAppServer } from "./codex-app-server.client";
import { readCodexPermissions, validateCodexPermissions } from "./codex-permissions";

const profile = { id: "project-edit", description: "Only project files", allowed: true };
function harness(requirements: Record<string, unknown> | null = null) {
  const sendRequest = vi.fn<(method: string, params?: unknown) => Promise<any>>(async (method) => method === "configRequirements/read"
    ? { requirements } : { data: [profile], nextCursor: null });
  return { sendRequest, server: { sendRequest } as unknown as CodexAppServer };
}

describe("Codex permission discovery and execution policy", () => {
  it("reads every page in the selected project, including an empty intermediate page", async () => {
    const h = harness();
    h.sendRequest.mockResolvedValueOnce({ requirements: null })
      .mockResolvedValueOnce({ data: [], nextCursor: "page-2" })
      .mockResolvedValueOnce({ data: [profile], nextCursor: null });
    expect((await readCodexPermissions(h.server, "/project")).profiles).toEqual([profile]);
    expect(h.sendRequest.mock.calls.slice(1)).toEqual([
      ["permissionProfile/list", { cwd: "/project" }],
      ["permissionProfile/list", { cwd: "/project", cursor: "page-2" }],
    ]);
  });

  it("rejects a repeated cursor instead of publishing a partial list", async () => {
    const h = harness();
    h.sendRequest.mockImplementation(async (method) => method === "configRequirements/read"
      ? { requirements: null } : { data: [profile], nextCursor: "again" });
    await expect(readCodexPermissions(h.server)).rejects.toThrow("repeated");
  });

  it.each([{}, { requirements: "invalid" }, { requirements: { allowedSandboxModes: "read-only" } }])("rejects malformed requirements instead of enabling unrestricted choices", async (response) => {
    const h = harness();
    h.sendRequest.mockResolvedValueOnce(response);
    await expect(readCodexPermissions(h.server)).rejects.toThrow("invalid managed");
  });

  it("keeps old CLIs on legacy modes only when the native method is missing", async () => {
    const h = harness();
    h.sendRequest.mockResolvedValueOnce({ requirements: null })
      .mockRejectedValueOnce(Object.assign(new Error("Method not found"), { code: -32601 }));
    const catalog = await readCodexPermissions(h.server);
    expect(catalog).toMatchObject({ profilesSupported: false, profiles: [] });
    expect(() => validateCodexPermissions(catalog, { sandboxMode: "read-only" }, "on-request")).not.toThrow();
    expect(() => validateCodexPermissions(catalog, { permissionProfile: profile.id }, "on-request")).toThrow("unavailable");
  });

  it.each(["configRequirements/read", "permissionProfile/list"])("never treats a failed %s as unrestricted", async (method) => {
    const h = harness();
    h.sendRequest.mockImplementation(async (called) => {
      if (called === method) throw Object.assign(new Error("Connection closed"), { code: -32000 });
      return { requirements: null };
    });
    await expect(readCodexPermissions(h.server)).rejects.toThrow("Connection closed");
  });

  it("blocks disallowed legacy modes and approval policies, preserving an empty allowlist", async () => {
    const h = harness({ allowedSandboxModes: ["read-only"], allowedApprovalPolicies: ["on-request"] });
    const catalog = await readCodexPermissions(h.server);
    expect(() => validateCodexPermissions(catalog, { sandboxMode: "workspace-write" }, "on-request")).toThrow("sandbox mode");
    expect(() => validateCodexPermissions(catalog, { sandboxMode: "read-only" }, "never")).toThrow("approval policy");
    expect(() => validateCodexPermissions({ ...catalog, allowedSandboxModes: [] }, { sandboxMode: "read-only" }, "on-request")).toThrow("sandbox mode");
  });

  it("enforces a complete named-profile allowlist even if a profile claims to be allowed", async () => {
    const h = harness({ allowedPermissionProfiles: { "project-edit": false }, allowedSandboxModes: null });
    const catalog = await readCodexPermissions(h.server);
    expect(catalog.profiles[0].allowed).toBe(false);
    expect(() => validateCodexPermissions(catalog, { permissionProfile: profile.id }, "on-request")).toThrow("does not allow this profile");
    expect(() => validateCodexPermissions(catalog, { sandboxMode: "danger-full-access" }, "on-request")).toThrow("requires a named");
    expect(() => validateCodexPermissions(catalog, { permissionProfile: "deleted" }, "on-request")).toThrow("unavailable");
  });

  it("keeps named selections distinct and explicitly clears them when switching to a legacy mode", () => {
    expect(codexPermissionValue({ permissionProfile: ":workspace", sandboxMode: "danger-full-access" })).toBe("profile::workspace");
    expect(codexPermissionPatch("profile:project-edit")).toEqual({ permissionProfile: "project-edit" });
    expect(codexPermissionPatch("read-only")).toEqual({ permissionProfile: "", sandboxMode: "read-only" });
  });
});
