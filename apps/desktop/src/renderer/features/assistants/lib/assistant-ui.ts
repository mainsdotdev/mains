import type { AssistantOverview } from "@mains/contracts/assistants";

export function isAssistantWorking(overview: AssistantOverview | undefined, id: string): boolean {
    return !!overview?.activeAssistantIds?.includes(id)
        || !!overview?.assignments.some(task => task.toAssistantId === id && (task.status === "running" || task.status === "queued"))
        || !!overview?.welcomes?.some(welcome => welcome.assistantId === id && (welcome.state === "generating" || welcome.state === "starting"));
}

export function errorText(error: unknown): string { return typeof error === "object" && error && "error" in error ? String(error.error) : error instanceof Error ? error.message : String(error); }
