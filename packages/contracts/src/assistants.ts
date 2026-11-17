import type { ModeId } from "./modes";
import type { ConversationSettings } from "./run-settings";
export const ASSISTANT_AVATAR_SHAPES = ["steps", "sphere", "cube", "flower", "weave", "lantern", "arch", "kite", "swallow"] as const;
export const ASSISTANT_AVATAR_COLORS = ["coral", "amber", "lime", "mint", "cyan", "blue", "violet", "rose"] as const;
export interface AssistantAvatar { shape: typeof ASSISTANT_AVATAR_SHAPES[number]; color: typeof ASSISTANT_AVATAR_COLORS[number] }
export const DEFAULT_ASSISTANT_AVATAR: AssistantAvatar = { shape: "sphere", color: "blue" };
const LEGACY_AVATAR_SHAPES = new Map<string, AssistantAvatar["shape"]>([
    ["circle", "sphere"], ["square", "cube"], ["cross", "arch"],
]);
/** Normalize retired presets from saved profiles and older clients. */
export function normalizeAssistantAvatar(value: unknown): AssistantAvatar {
    const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const shape = typeof stored.shape === "string" ? LEGACY_AVATAR_SHAPES.get(stored.shape) ?? stored.shape : undefined;
    return {
        shape: ASSISTANT_AVATAR_SHAPES.includes(shape as AssistantAvatar["shape"]) ? shape as AssistantAvatar["shape"] : DEFAULT_ASSISTANT_AVATAR.shape,
        color: ASSISTANT_AVATAR_COLORS.includes(stored.color as AssistantAvatar["color"]) ? stored.color as AssistantAvatar["color"] : DEFAULT_ASSISTANT_AVATAR.color,
    };
}
export type AssistantExecution = { mode: "work"; workspaceId?: never } | { mode: "developer"; workspaceId: string };
export interface AssistantTeam {
    id: string;
    accountId: string;
    name: string;
    createdAt: Date;
}
export interface Assistant {
    id: string;
    accountId: string;
    teamId: string | null;
    name: string;
    description: string;
    instructions: string;
    spaceId: string;
    providerId: string;
    avatar: AssistantAvatar;
    model: string;
    effort: string;
    isArchived: boolean;
    conversationSettings: ConversationSettings;
    spaceSnapshot: {
        id: string;
        accountId: string;
        name: string;
        providerId: string;
        mode: ModeId;
        systemPrompt: string | null;
    };
    createdAt: Date;
    updatedAt: Date;
}
export interface CreateAssistant {
    accountId: string;
    name: string;
    description?: string;
    instructions?: string;
    profileSetup?: boolean;
    spaceId: string;
    model: string;
    effort: string;
    teamId?: string | null;
    avatar?: AssistantAvatar;
}
export interface ChangeAssistantTeam {
    accountId: string;
    id: string;
    teamId: string | null;
}
export interface AssistantMemory {
    id: string;
    accountId: string;
    teamId: string | null;
    assistantId: string | null;
    title: string;
    content: string;
    pinned: boolean;
    revision: number;
    sourceRunId: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface SaveAssistantMemory {
    accountId: string;
    teamId: string | null;
    assistantId?: string | null;
    id?: string;
    title: string;
    content: string;
    pinned?: boolean;
    expectedRevision?: number;
}
export const ASSIGNMENT_STATUSES = ["queued", "running", "blocked", "completed", "failed", "canceled", "uncertain"] as const;
export type AssignmentStatus = typeof ASSIGNMENT_STATUSES[number];
export type AssistantTaskMessageKind = "request" | "followup" | "status" | "result";
export interface AssistantTaskInput {
    assignmentId: string;
    messageId: string;
    kind: AssistantTaskMessageKind;
}
export function readAssistantTaskInput(value: unknown): AssistantTaskInput | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.assignmentId !== "string" || !item.assignmentId || typeof item.messageId !== "string" || !item.messageId || !["request", "followup", "status", "result"].includes(String(item.kind))) return null;
    return { assignmentId: item.assignmentId, messageId: item.messageId, kind: item.kind as AssistantTaskMessageKind };
}
export interface AssistantTaskActivity {
    id: string;
    kind: AssistantTaskMessageKind;
    content: string;
    deliveryStatus: "queued" | "dispatching" | "delivered" | "uncertain" | "canceled";
    error: string | null;
    createdAt: Date;
}
export interface AssistantAssignment {
    id: string;
    accountId: string;
    teamId: string | null;
    fromAssistantId: string | null;
    toAssistantId: string;
    fromRunId: string | null;
    parentId: string | null;
    taskKey: string;
    title: string;
    prompt: string;
    status: AssignmentStatus;
    execution: AssistantExecution;
    workerRunId: string | null;
    result: string | null;
    evidence: string[];
    error: string | null;
    createdAt: Date;
    updatedAt: Date;
    activity?: AssistantTaskActivity[];
}
export function canAccessAssistantAssignment(
    assistant: Pick<Assistant, "id" | "accountId" | "teamId">,
    task: Pick<AssistantAssignment, "accountId" | "teamId" | "toAssistantId">,
): boolean {
    return assistant.accountId === task.accountId &&
        (task.teamId === null ? task.toAssistantId === assistant.id : task.teamId === assistant.teamId);
}
export interface AssignAssistantTask {
    accountId: string;
    toAssistantId: string;
    taskKey: string;
    title: string;
    prompt: string;
    execution?: AssistantExecution;
}
export interface AssistantConversation {
    id: string;
    title: string | null;
    goal: string | null;
    status: string;
    mode: ModeId;
    workspaceId: string | null;
    workspaceName: string | null;
    projectName: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface AssistantOverview {
    activeAssistantIds?: string[];
    teams: AssistantTeam[];
    assistants: Assistant[];
    memories: AssistantMemory[];
    assignments: AssistantAssignment[];
    welcomes?: AssistantWelcome[];
}

/** The same explicit prompt context accepted by ordinary run conversations. */
export interface AssistantMessageContext {
    attachments?: import("./runs").FileAttachment[];
    initialContext?: Array<{ kind: "file" | "diff" | "selection" | "note"; ref?: string; content?: string; metadata?: Record<string, unknown> }>;
    contextIssues?: Array<{ provider: string; number?: number | null; title: string; body?: string | null }>;
    contextFiles?: Array<{ path: string; type?: "file" | "directory" }>;
    contextSignals?: Array<{ source: string; level: string; category: string; title: string; body?: string | null; stackTrace?: string | null; eventCount?: number }>;
    contextSkills?: Array<{ name: string; path?: string; mentionPath?: string; displayName?: string; description?: string; shortDescription?: string; iconSmall?: string; iconLarge?: string; brandColor?: string; scope?: string }>;
}
export interface SendAssistantMessage {
    accountId: string;
    assistantId: string;
    message: string;
    requestId: string;
    runId?: string;
    context?: AssistantMessageContext;
    execution?: AssistantExecution;
}

export interface AssistantProfileDraft {
    description: string;
    instructions: string;
}
export interface AssistantProfileSetup {
    turns: Array<{ question: string; answer: string }>;
    draft?: AssistantProfileDraft;
    saved?: true;
}
export type AssistantProfileSetupAction =
    | { action: "answer"; step: number; answer: string }
    | { action: "save"; profile: AssistantProfileDraft };

export interface AssistantWelcomeQuestion {
    profileSetup?: AssistantProfileSetup;
    header: string;
    question: string;
    options: Array<{ label: string; description: string }>;
    idleMessage: string;
}
/** Application-origin setup; its internal prompt is never a user message. */
export interface AssistantWelcome {
    assistantId: string;
    runId: string;
    state: "pending" | "generating" | "ready" | "skipped" | "starting" | "started" | "failed";
    wasSkipped: boolean;
    question: AssistantWelcomeQuestion | null;
    answer: string | null;
    error: string | null;
    execution?: AssistantExecution;
    createdAt: Date;
}
