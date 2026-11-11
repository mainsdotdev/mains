/** Safe projection of native permission discovery; never contains config or credentials. */
export interface CodexPermissionCatalog {
  profilesSupported: boolean;
  profiles: Array<{ id: string; description: string | null; allowed: boolean }>;
  allowedSandboxModes: string[] | null;
  allowedApprovalPolicies: string[] | null;
  requiresNamedProfile: boolean;
}

const PROFILE_PREFIX = "profile:";
type LegacySandboxMode = "read-only" | "workspace-write" | "danger-full-access";
const legacyModes: readonly string[] = ["read-only", "workspace-write", "danger-full-access"];
export const CODEX_BUILTIN_PERMISSION_PROFILES = {
  "read-only": ":read-only",
  "workspace-write": ":workspace",
  "danger-full-access": ":danger-full-access",
} as const;

/** Built-in profile aliases share presentation, while their saved values stay distinct. */
export function codexBuiltinSandboxMode(value: string): LegacySandboxMode | undefined {
  return (Object.keys(CODEX_BUILTIN_PERMISSION_PROFILES) as LegacySandboxMode[]).find((mode) =>
    value === mode || value === `${PROFILE_PREFIX}${CODEX_BUILTIN_PERMISSION_PROFILES[mode]}`);
}

export interface CodexPermissionChoice {
  value: string;
  sandboxMode?: LegacySandboxMode;
  profileId?: string;
  description?: string | null;
  disabledReason?: string;
}

/** One row per built-in permission. Keep a valid selected native profile;
 * otherwise prefer the compatible legacy mode, or an allowed native alias
 * when policy excludes that legacy mode. Changing storage still requires a click. */
export function codexPermissionChoices(catalog?: CodexPermissionCatalog, currentValue?: string): CodexPermissionChoice[] {
  const profiles = catalog?.profiles ?? [];
  const builtins = (Object.entries(CODEX_BUILTIN_PERMISSION_PROFILES) as Array<[LegacySandboxMode, string]>).map(([mode, id]) => {
    const nativeValue = `${PROFILE_PREFIX}${id}`;
    const profile = profiles.find((profile) => profile.id === id);
    const legacyReason = catalog ? codexPermissionBlockReason(catalog, mode) : undefined;
    const nativeReason = catalog ? codexPermissionBlockReason(catalog, nativeValue) : undefined;
    const useNative = !!profile && (
      !nativeReason && (currentValue === nativeValue || !!legacyReason) ||
      !!legacyReason && (currentValue === nativeValue || catalog?.requiresNamedProfile)
    );
    return { value: useNative ? nativeValue : mode, sandboxMode: mode,
      profileId: useNative ? id : undefined, description: useNative ? profile?.description : undefined,
      disabledReason: useNative ? nativeReason : legacyReason };
  });
  const builtinIds: readonly string[] = Object.values(CODEX_BUILTIN_PERMISSION_PROFILES);
  const custom = profiles.filter((profile) => !builtinIds.includes(profile.id)).map((profile) => ({
    value: `${PROFILE_PREFIX}${profile.id}`, profileId: profile.id, description: profile.description,
    disabledReason: catalog ? codexPermissionBlockReason(catalog, `${PROFILE_PREFIX}${profile.id}`) : undefined,
  }));
  return [...builtins, ...custom];
}

export function codexPermissionValue(config: { permissionProfile?: unknown; sandboxMode?: unknown }): string {
  return typeof config.permissionProfile === "string" && config.permissionProfile
    ? `${PROFILE_PREFIX}${config.permissionProfile}`
    : typeof config.sandboxMode === "string" ? config.sandboxMode : "workspace-write";
}

export function codexPermissionPatch(value: string): { permissionProfile: string; sandboxMode?: LegacySandboxMode } {
  if (value.startsWith(PROFILE_PREFIX) && value.length > PROFILE_PREFIX.length) return { permissionProfile: value.slice(PROFILE_PREFIX.length) };
  if (!legacyModes.includes(value)) throw new Error("Unknown Codex permission selection");
  return { permissionProfile: "", sandboxMode: value as LegacySandboxMode };
}

export function codexPermissionBlockReason(catalog: CodexPermissionCatalog, value: string): string | undefined {
  if (value.startsWith(PROFILE_PREFIX)) {
    const profile = catalog.profiles.find((profile) => `${PROFILE_PREFIX}${profile.id}` === value);
    if (!catalog.profilesSupported || !profile) return "This permission profile is unavailable. Refresh the permission list.";
    if (!profile.allowed) return "Your managed Codex policy does not allow this profile.";
  } else {
    if (!legacyModes.includes(value)) return "Unknown Codex sandbox mode.";
    if (catalog.requiresNamedProfile) return "Your managed Codex policy requires a named permission profile.";
    if (catalog.allowedSandboxModes && !catalog.allowedSandboxModes.includes(value)) return "Your managed Codex policy does not allow this sandbox mode.";
  }
  return undefined;
}
