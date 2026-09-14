export type PluginAvailability = "AVAILABLE" | "DISABLED_BY_ADMIN";

export type PluginDisabledReason =
  | "disabled_by_admin"
  | "plan_not_eligible"
  | "required_app_unavailable"
  | "unknown";

export interface PluginInstallAvailability {
  installPolicy: "NOT_AVAILABLE" | "AVAILABLE" | "INSTALLED_BY_DEFAULT";
  availability?: PluginAvailability;
  disabledReason?: PluginDisabledReason | null;
  eligiblePlanTypes?: string[] | null;
}

/** User-facing reason why a plugin cannot currently be installed. */
export function getPluginInstallBlockReason(
  plugin: PluginInstallAvailability,
): string | null {
  switch (plugin.disabledReason) {
    case "disabled_by_admin":
      return "This plugin is disabled by your administrator.";
    case "plan_not_eligible": {
      const eligiblePlans = plugin.eligiblePlanTypes?.filter(Boolean) ?? [];
      const suffix = eligiblePlans.length > 0
        ? ` Eligible plans: ${eligiblePlans.join(", ")}.`
        : "";
      return `This plugin is not available on your current plan.${suffix}`;
    }
    case "required_app_unavailable":
      return "A required app is unavailable for this plugin.";
    case "unknown":
      return "This plugin is currently unavailable.";
  }

  if (plugin.availability === "DISABLED_BY_ADMIN") {
    return "This plugin is disabled by your administrator.";
  }
  if (plugin.installPolicy === "NOT_AVAILABLE") {
    return "This plugin is not available for installation.";
  }
  return null;
}
