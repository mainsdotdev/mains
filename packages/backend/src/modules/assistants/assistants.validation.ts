import { canonicalPrRef, type PrRefInput, type PrRevision } from "@mains/contracts/pull-requests";

export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid assistant request");
    return value as Record<string, unknown>;
}

export function readPullRequestReviewRef(input: unknown): PrRefInput {
    const ref = object(input);
    onlyKeys(ref, ["provider", "owner", "repo", "number"]);
    const provider = ref.provider === undefined ? "github" : text(ref.provider, "Provider");
    const owner = text(ref.owner, "Repository owner", 100), repo = text(ref.repo, "Repository name", 100);
    if (!/^[\w.-]+\/[\w.-]+$/.test(`${owner}/${repo}`) || owner === "." || owner === ".." || repo === "." || repo === "..")
        throw new Error("Choose a valid repository");
    if (typeof ref.number !== "number" || !Number.isInteger(ref.number) || ref.number < 1 || ref.number > 2_147_483_647)
        throw new Error("Choose a valid pull request");
    return canonicalPrRef({ provider, owner, repo, number: ref.number });
}

export function readPullRequestRevision(input: unknown): PrRevision {
    const revision = object(input);
    onlyKeys(revision, ["baseOid", "headOid"]);
    const baseOid = text(revision.baseOid, "Base commit", 64).toLowerCase();
    const headOid = text(revision.headOid, "Head commit", 64).toLowerCase();
    if (![baseOid, headOid].every(oid => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)))
        throw new Error("Refresh the pull request to load its commits");
    return { baseOid, headOid };
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
