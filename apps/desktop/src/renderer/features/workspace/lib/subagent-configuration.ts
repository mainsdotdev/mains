import { formatEffortLevel } from "@/lib/format";
import { formatModelDisplayName } from "@/lib/model-display";
import { humanizeAgentName } from "./subagent-identity";

/** The provider's creation-time configuration, shared by list and detail. */
export function formatSubagentConfiguration(agent: { model?: string; reasoningEffort?: string; role?: string }): string {
  const effort = agent.reasoningEffort ? formatEffortLevel(agent.reasoningEffort) : "";
  return [agent.role ? humanizeAgentName(agent.role) : undefined, agent.model ? formatModelDisplayName(agent.model) : undefined,
    effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : undefined].filter(Boolean).join(" · ");
}
