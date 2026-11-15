import type { AssistantOverview } from "@mains/contracts/assistants";

export function isAssistantWorking(overview: AssistantOverview | undefined, id: string): boolean {
    return !!overview?.activeAssistantIds?.includes(id)
        || !!overview?.assignments.some(task => task.toAssistantId === id && (task.status === "running" || task.status === "queued"))
        || !!overview?.welcomes?.some(welcome => welcome.assistantId === id && (welcome.state === "generating" || welcome.state === "starting"));
}

export const control = "w-full rounded-xl border border-primary-200 bg-primary px-3 py-2.5 text-sm text-primary-900 outline-none focus:border-primary-500 disabled:opacity-50 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100";
export function errorText(error: unknown): string { return typeof error === "object" && error && "error" in error ? String(error.error) : error instanceof Error ? error.message : String(error); }
