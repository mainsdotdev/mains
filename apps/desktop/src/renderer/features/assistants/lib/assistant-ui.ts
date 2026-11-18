import type { AssistantOverview } from "@mains/contracts/assistants";

export function isAssistantWorking(overview: AssistantOverview | undefined, id: string): boolean {
    return !!overview?.activeAssistantIds?.includes(id)
        || !!overview?.assignments.some(task => task.toAssistantId === id && (task.status === "running" || task.status === "queued"))
        || !!overview?.welcomes?.some(welcome => welcome.assistantId === id && (welcome.state === "generating" || welcome.state === "starting"));
}

export function assignmentDisplayTitle(title: string, taskKey: unknown): string {
    return title === "Assistant request" && typeof taskKey === "string" && taskKey.startsWith("mention:") ? "Mate request" : title;
}

const serviceErrorCopy = new Map([
    ["Invalid assistant request", "Invalid mate request"],
    ["Assistant is unavailable", "Mate is unavailable"],
    ["Assistant not found", "Mate not found"],
    ["This account has reached the assistant limit", "This account has reached the mate limit"],
    ["Assistants V1 supports Claude and Codex", "Mates support Claude and Codex"],
    ["Enable this provider before creating an assistant", "Enable this provider before creating a mate"],
    ["Assistant does not belong to this team", "This mate does not belong to the team"],
    ["Assistant team changed. Retry this assignment", "The mate’s team changed. Retry this assignment"],
    ["This assistant’s team changed. Reopen the editor to review the latest version.", "This mate’s team changed. Reopen the editor to review the latest version."],
    ["Finish setting up this assistant’s profile first", "Finish setting up this mate’s profile first"],
    ["Stop this assistant’s running conversations before changing teams", "Stop this mate’s running conversations before changing teams"],
    ["Finish or cancel this assistant’s assignments and pending deliveries before changing teams", "Finish or cancel this mate’s assignments and pending deliveries before changing teams"],
    ["Wait for this assistant’s welcome to finish before changing teams", "Wait for this mate’s welcome to finish before changing teams"],
    ["Finish or cancel this assistant's assignments before archiving", "Finish or cancel this mate’s assignments before archiving"],
    ["Stop this assistant’s running conversations before archiving", "Stop this mate’s running conversations before archiving"],
    ["Wait for this assistant's current turn to finish", "Wait for this mate’s current turn to finish"],
    ["This assistant has no profile setup", "This mate has no profile setup"],
    ["Could not read this assistant’s setup response. Try again", "Could not read this mate’s setup response. Try again"],
    ["Enable this assistant’s provider, then retry the welcome", "Enable this mate’s provider, then retry the welcome"],
    ["Routine not found for this assistant", "Routine not found for this mate"],
    ["Assistant work is shutting down. Try again after reconnecting", "The service is shutting down. Try again after reconnecting"],
    ["This assistant was interrupted when the backend stopped. Inspect the conversation and continue when ready.", "This mate was interrupted when the backend stopped. Inspect the conversation and continue when ready."],
]);

export function errorText(error: unknown): string {
    const message = typeof error === "object" && error && "error" in error ? String(error.error) : error instanceof Error ? error.message : String(error);
    return serviceErrorCopy.get(message) ?? message;
}
