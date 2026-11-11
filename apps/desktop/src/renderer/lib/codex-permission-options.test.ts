import { describe, expect, it } from "vitest";
import { codexPermissionOptions, codexPermissionLabels } from "./codex-permission-options";

describe("Codex permission options", () => {
  it("shows the three built-in permissions once, followed by custom profiles", () => {
    const options = codexPermissionOptions({ profilesSupported: true,
      profiles: [":read-only", ":workspace", ":danger-full-access", "project-edit"].map((id) => ({ id, description: null, allowed: true })),
      requiresNamedProfile: false, allowedSandboxModes: null, allowedApprovalPolicies: null });
    expect(options.map((option) => option.label)).toEqual(["Read Only", "Workspace Write", "Full Access", "project-edit"]);
  });

  it("retains a selected native built-in profile behind its readable label", () => {
    const options = codexPermissionOptions({ profilesSupported: true,
      profiles: [":read-only", ":workspace", ":danger-full-access"].map((id) => ({ id, description: null, allowed: true })),
      requiresNamedProfile: false, allowedSandboxModes: null, allowedApprovalPolicies: null }, false, "profile::workspace");
    expect(options).toHaveLength(3);
    expect(options.find((option) => option.value === "profile::workspace")).toMatchObject({ label: "Workspace Write", disabledReason: undefined });
    expect(options.some((option) => option.value === "workspace-write")).toBe(false);
    expect(codexPermissionLabels(options)["profile::workspace"]).toBe("Workspace Write");
  });

  it("uses allowed native aliases when managed policy requires profiles, retaining blocked choices as disabled", () => {
    const options = codexPermissionOptions({ profilesSupported: true,
      profiles: [":read-only", ":workspace", ":danger-full-access"].map((id) => ({ id, description: null, allowed: id === ":workspace" })),
      requiresNamedProfile: true, allowedSandboxModes: null, allowedApprovalPolicies: null });
    expect(options.map((option) => option.label)).toEqual(["Read Only", "Workspace Write", "Full Access"]);
    expect(options.find((option) => option.value === "profile::workspace")?.disabledReason).toBeUndefined();
    expect(options.filter((option) => option.value !== "profile::workspace").every((option) => !!option.disabledReason)).toBe(true);
  });

  it("keeps legacy modes available when profiles are unsupported", () => {
    const options = codexPermissionOptions({ profilesSupported: false, profiles: [],
      requiresNamedProfile: false, allowedSandboxModes: ["read-only"], allowedApprovalPolicies: null });
    expect(options.map((option) => option.value)).toEqual(["read-only", "workspace-write", "danger-full-access"]);
    expect(options[0].disabledReason).toBeUndefined();
    expect(options.slice(1).every((option) => !!option.disabledReason)).toBe(true);
  });

  it("disables choices until policy is known and after a failed read", () => {
    expect(codexPermissionOptions().every((option) => option.disabledReason?.includes("Loading"))).toBe(true);
    expect(codexPermissionOptions(undefined, true).every((option) => option.disabledReason?.includes("Could not load"))).toBe(true);
  });
  it("shows project profiles while disabling managed exclusions and legacy bypasses", () => {
    const options = codexPermissionOptions({ profilesSupported: true,
      profiles: [{ id: "project-edit", description: "Write project files", allowed: true }, { id: ":danger-full-access", description: null, allowed: false }],
      requiresNamedProfile: true, allowedSandboxModes: null, allowedApprovalPolicies: null });
    expect(options.find((option) => option.value === "profile:project-edit")).toMatchObject({ label: "project-edit", disabledReason: undefined });
    expect(options.filter((option) => option.value !== "profile:project-edit").every((option) => !!option.disabledReason)).toBe(true);
  });
});
