export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid assistant request");
    return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 200, optional = false): string {
    if (optional && (value === undefined || value === null || value === ""))
        return "";
    if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
        throw new Error(`${name} must contain 1–${max} characters`);
    return value.trim();
}
export function onlyKeys(value: Record<string, unknown>, allowed: string[]): void {
    for (const key of Object.keys(value))
        if (!allowed.includes(key))
            throw new Error(`Unknown assistant field: ${key}`);
}

export function execution(input: unknown): import("@mains/contracts/assistants").AssistantExecution {
    if (input === undefined) return { mode: "work" };
    const value = object(input);
    onlyKeys(value, ["mode", "workspaceId"]);
    if (value.mode === "work" && value.workspaceId === undefined) return { mode: "work" };
    if (value.mode === "developer") return { mode: "developer", workspaceId: text(value.workspaceId, "Workspace") };
    throw new Error("Choose Work or a Code workspace for this task");
}
