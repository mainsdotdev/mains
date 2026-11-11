import type { CodexPermissionCatalog } from "@mains/contracts/codex-permissions";
import { codexPermissionBlockReason, codexPermissionValue } from "@mains/contracts/codex-permissions";
import type { CodexAppServer } from "./codex-app-server.client";
import type { PermissionProfileSummary } from "./codex-app-server-protocol/generated/v2/PermissionProfileSummary";

const missingMethod = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === -32601;

/** Read fresh policy for the original server/cwd. A transport or policy read
 * failure never becomes an unrestricted catalog or an execution fallback. */
export async function readCodexPermissions(server: CodexAppServer, cwd?: string): Promise<CodexPermissionCatalog> {
  const requirements = await server.sendRequest("configRequirements/read", undefined).then(
    (result) => {
      if (!result || !("requirements" in result) || result.requirements !== null && (typeof result.requirements !== "object" || Array.isArray(result.requirements))) {
        throw new Error("Codex returned an invalid managed permission policy.");
      }
      const policy = result.requirements;
      for (const values of [policy?.allowedSandboxModes, policy?.allowedApprovalPolicies]) {
        if (values != null && !Array.isArray(values)) throw new Error("Codex returned an invalid managed permission allowlist.");
      }
      if (policy?.allowedPermissionProfiles != null && (typeof policy.allowedPermissionProfiles !== "object" || Array.isArray(policy.allowedPermissionProfiles))) {
        throw new Error("Codex returned an invalid managed profile allowlist.");
      }
      return policy;
    },
    (error) => { if (missingMethod(error)) return null; throw error; },
  );
  const profiles: PermissionProfileSummary[] = [];
  let profilesSupported = true;
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    let page;
    try {
      page = await server.sendRequest("permissionProfile/list", { ...(cwd ? { cwd } : {}), ...(cursor ? { cursor } : {}) });
    } catch (error) {
      if (missingMethod(error) && !cursor) { profilesSupported = false; break; }
      throw error;
    }
    profiles.push(...page.data);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error("Codex returned a repeated permission profile page. Refresh and try again.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  const allowed = requirements?.allowedPermissionProfiles;
  return {
    profilesSupported,
    profiles: profiles.map(({ id, description, allowed: nativeAllowed }) => ({
      id, description, allowed: nativeAllowed && (allowed == null || allowed[id] === true),
    })),
    allowedSandboxModes: requirements?.allowedSandboxModes ?? null,
    allowedApprovalPolicies: requirements?.allowedApprovalPolicies?.filter((policy): policy is Exclude<typeof policy, object> => typeof policy === "string") ?? null,
    requiresNamedProfile: allowed != null,
  };
}

export function validateCodexPermissions(catalog: CodexPermissionCatalog, config: { permissionProfile?: unknown; sandboxMode?: unknown }, approvalPolicy: string): void {
  const blocked = codexPermissionBlockReason(catalog, codexPermissionValue(config));
  if (blocked) throw new Error(blocked);
  if (catalog.allowedApprovalPolicies && !catalog.allowedApprovalPolicies.includes(approvalPolicy)) {
    throw new Error("Your managed Codex policy does not allow this approval policy. Choose an allowed policy in Codex settings.");
  }
}
