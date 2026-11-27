import type { ModeId } from "./modes";
import type { PrRefInput, PrRevision } from "./pull-requests";
import type { ConversationSettings } from "./run-settings";
import type { ApprovalKind } from "./runs";

export const ASSISTANT_AVATAR_COLORS = ["coral", "amber", "lime", "mint", "cyan", "blue", "violet", "rose"] as const;
export const ASSISTANT_ROBOT_AVATARS = {
    "terminal-amber": "amber", "terminal-teal": "mint", "terminal-cherry": "coral", "terminal-indigo": "blue",
    "terminal-plum": "violet", "terminal-olive": "lime", "terminal-frost": "cyan",
    "clear-violet": "violet", "clear-glacier": "cyan", "clear-jade": "mint", "clear-rose": "rose",
    "clear-honey": "amber", "clear-lime": "lime", "clear-coral": "coral",
    "metal-silver": "mint", "metal-bronze": "amber", "metal-graphite": "blue", "metal-titanium": "violet",
    "metal-copper": "coral", "metal-ice": "cyan", "metal-moss": "lime",
    "specialist-travel": "mint", "specialist-kitchen": "coral", "specialist-cloud": "cyan",
    "specialist-law": "violet", "specialist-sports": "lime", "specialist-writer": "blue",
    "specialist-research": "lime", "specialist-finance": "amber", "specialist-design": "violet",
    "specialist-developer": "mint", "specialist-photo": "amber", "specialist-garden": "mint",
    "specialist-music": "coral", "specialist-language": "blue", "specialist-projects": "amber",
    "specialist-beach-palm": "lime",
} as const satisfies Record<string, typeof ASSISTANT_AVATAR_COLORS[number]>;
export type AssistantRobotShape = keyof typeof ASSISTANT_ROBOT_AVATARS;

export const ASSISTANT_AVATAR_SHAPES_BY_FAMILY = {
    mosaic: ["steps", "sphere", "cube", "flower", "weave", "lantern", "arch", "kite", "swallow", "mains"],
    badge: ["badge-card", "badge-pin", "badge-shield", "badge-ticket"],
    felt: ["felt-sprout", "felt-pebble", "felt-cloud", "felt-bloom"],
    robot: Object.keys(ASSISTANT_ROBOT_AVATARS) as readonly AssistantRobotShape[],
} as const;
export const ASSISTANT_AVATAR_SHAPES = [
    ...ASSISTANT_AVATAR_SHAPES_BY_FAMILY.mosaic,
    ...ASSISTANT_AVATAR_SHAPES_BY_FAMILY.badge,
    ...ASSISTANT_AVATAR_SHAPES_BY_FAMILY.felt,
    ...ASSISTANT_AVATAR_SHAPES_BY_FAMILY.robot,
] as const;
export interface AssistantAvatar { shape: typeof ASSISTANT_AVATAR_SHAPES[number]; color: typeof ASSISTANT_AVATAR_COLORS[number] }
export const DEFAULT_ASSISTANT_AVATAR: AssistantAvatar = { shape: "sphere", color: "blue" };
const LEGACY_AVATAR_SHAPES = new Map<string, AssistantAvatar["shape"]>([
    ["circle", "sphere"], ["square", "cube"], ["cross", "arch"],
]);

export function isAssistantRobotShape(shape: AssistantAvatar["shape"] | undefined): shape is AssistantRobotShape {
    return shape !== undefined && Object.prototype.hasOwnProperty.call(ASSISTANT_ROBOT_AVATARS, shape);
}

/** Normalize retired presets from saved profiles and older clients. */
export function normalizeAssistantAvatar(value: unknown): AssistantAvatar {
    const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const shape = typeof stored.shape === "string" ? LEGACY_AVATAR_SHAPES.get(stored.shape) ?? stored.shape : undefined;
    const normalizedShape = ASSISTANT_AVATAR_SHAPES.includes(shape as AssistantAvatar["shape"]) ? shape as AssistantAvatar["shape"] : DEFAULT_ASSISTANT_AVATAR.shape;
    return {
        shape: normalizedShape,
        color: isAssistantRobotShape(normalizedShape) ? ASSISTANT_ROBOT_AVATARS[normalizedShape]
            : ASSISTANT_AVATAR_COLORS.includes(stored.color as AssistantAvatar["color"]) ? stored.color as AssistantAvatar["color"] : DEFAULT_ASSISTANT_AVATAR.color,
    };
}
export type AssistantExecution = { mode: "work"; workspaceId?: never } | { mode: "developer"; workspaceId: string };
export const ASSISTANT_MENTION_MODES = ["developer", "work"] as const satisfies readonly ModeId[];

export function allowsAssistantMentions(mode: string, assistantId?: string | null): boolean {
    return !assistantId && ASSISTANT_MENTION_MODES.some(allowed => allowed === mode);
}

export interface AssistantTeam {
    id: string;
    accountId: string;
    name: string;
    createdAt: Date;
}
export const MATE_CODEX_APPROVAL_MODES = ["on-request", "untrusted", "never"] as const;
export type MateCodexApprovalMode = (typeof MATE_CODEX_APPROVAL_MODES)[number];
export const MAX_MATE_SKILLS = 20;
export interface AssistantSkill {
    id: string;
    name: string;
    description: string;
    storage?: "local";
}
export interface AssistantSkillDraft {
    name: string;
    title: string;
    description: string;
    markdown: string;
    examplePrompt?: string;
}
export interface AssistantSkillCatalog {
    skills: AssistantSkill[];
    pluginSkillIds: string[];
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
    pinnedAt?: Date | null;
    conversationSettings: ConversationSettings;
    skills?: AssistantSkill[];
    codexApprovalMode?: MateCodexApprovalMode;
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
export interface SetAssistantPinned { accountId: string; id: string; pinned: boolean }
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
export type AssistantProfile = Pick<Assistant, "name" | "description" | "instructions" | "avatar">;
export interface AssistantModelChange {
    model: string;
    effort: string;
    expectedModel: string;
    expectedEffort: string;
}
export interface UpdateAssistantProfile {
    accountId: string;
    id: string;
    profile: AssistantProfile;
    expectedProfile: AssistantProfile;
    teamChange?: { teamId: string | null; expectedTeamId: string | null };
    modelChange?: AssistantModelChange;
    skillChange?: { ids: string[]; expectedIds: string[] };
    permissionChange?: {
        mode: string;
        expectedMode: string;
        approvalMode?: MateCodexApprovalMode | null;
        expectedApprovalMode?: MateCodexApprovalMode | null;
    };
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
export interface AssistantPullRequestContext {
    key: string;
    revision: PrRevision;
    truncated: boolean;
    focus?: string;
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
    pullRequestReview?: AssistantPullRequestContext;
}

export interface AssistantTeamWorkItem {
    id: string;
    kind: "assignment" | "conversation";
    assistantId: string;
    runId: string | null;
    title: string;
    status: "needs_you" | "needs_attention" | "running" | "waiting_for_teammate" | "queued" | "completed" | "canceled";
    pendingKinds: ApprovalKind[];
    pullRequestKey: string | null;
    updatedAt: Date;
}

export interface AssistantTeamWork {
    team: Pick<AssistantTeam, "id" | "name">;
    items: AssistantTeamWorkItem[];
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
    expectedTeamId?: string;
    taskKey: string;
    title: string;
    prompt: string;
    execution?: AssistantExecution;
}

export interface ReviewPullRequestWithAssistant {
    accountId: string;
    assistantId: string;
    pr: PrRefInput;
    revision: PrRevision;
    focus?: string;
}

export interface AssistantPullRequestReview {
    assignment: AssistantAssignment;
    revision: PrRevision;
    truncated: boolean;
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
    turns: Array<{ question: string; answer: string; questionAt?: number }>;
    questionAt?: number;
    draft?: AssistantProfileDraft;
    saved?: true;
    savedAt?: number;
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
    updatedAt?: Date;
}

export type MobileMateIdentity = Pick<Assistant, "id" | "name" | "avatar" | "isArchived">;

export interface MobileMateDirectory {
    mates: Array<MobileMateIdentity & Pick<Assistant, "description" | "teamId" | "providerId" | "model" | "pinnedAt"> & {
        needsSetup: boolean;
        welcome: Pick<AssistantWelcome, "runId" | "state" | "question" | "error"> | null;
        details?: Pick<Assistant, "effort" | "instructions"> & { spaceName: string; runtime?: MobileMateRuntimeSettings };
    }>;
    teams: Array<Pick<AssistantTeam, "id" | "name">>;
}

export type MobileMateChat = Pick<AssistantConversation, "id" | "title" | "updatedAt">;
export type MobileMateAssignment = Pick<AssistantAssignment, "id" | "title" | "status" | "result" | "error" | "workerRunId"> & {
    assignee: MobileMateIdentity | null;
};

export const MOBILE_MATE_INFO_CAPABILITY = "mateInfo";
export const MOBILE_MATE_TEAM_CREATION_CAPABILITY = "mateTeamCreation";
export const MOBILE_MATE_MODEL_EDITING_CAPABILITY = "mateModelEditing";
export const MOBILE_MATE_PINNING_CAPABILITY = "matePinning";
export const MOBILE_MATE_RUNTIME_SETTINGS_CAPABILITY = "mateRuntimeSettings";

export interface MobileMateRuntimeSettings {
    skills: AssistantSkill[];
    permissionMode: string;
    codexApprovalMode?: MateCodexApprovalMode;
    providerApprovalMode?: string;
}

export interface MobileMateSkillPage {
    items: AssistantSkill[];
    nextOffset: number | null;
    unavailableIds: string[];
    pluginSkillIds: string[];
}

/** List responses carry a content preview. A selected id returns the entire note. */
export type MobileMateMemory = Pick<AssistantMemory, "id" | "title" | "content" | "pinned" | "revision"> & { shared: boolean };

export interface MobileMateTask extends MobileMateAssignment {
    brief: string;
    evidence: string[];
}

export interface MobileMateTasks {
    items: MobileMateTask[];
    activeCount: number;
    hasMore: boolean;
}

export interface MobileMateSchedule {
    title: string;
    prompt: string;
    frequency: "hourly" | "daily" | "weekdays" | "weekly";
    dayOfWeek: number | null;
    hour: number;
    minute: number;
    timezone: string;
}

/** List responses carry a prompt preview. A selected id returns the complete schedule. */
export interface MobileMateRoutine extends MobileMateSchedule {
    id: string;
    workspaceId: string | null;
    isActive: boolean;
    nextRunAt: Date | null;
    lastRunId: string | null;
    lastAssignmentStatus: string | null;
    lastError: string | null;
    revision: string;
}

export interface MobileMateRoutines {
    items: MobileMateRoutine[];
    nextOffset: number | null;
}

export type MobileMateChange =
    | ({ action: "updateProfile" } & Pick<UpdateAssistantProfile, "profile" | "expectedProfile" | "teamChange" | "modelChange" | "skillChange" | "permissionChange">)
    | { action: "archive"; archived: boolean }
    | { action: "setPinned"; pinned: boolean }
    | { action: "saveMemory"; note: MobileMateMemory; expectedTeamId: string | null }
    | { action: "deleteMemory"; id: string; revision: number }
    | { action: "assign"; title: string; prompt: string }
    | { action: "cancelTask" | "checkTask"; id: string }
    | { action: "followup"; id: string; message: string }
    | { action: "createRoutine"; schedule: MobileMateSchedule; workspaceId: string | null }
    | { action: "updateRoutine"; id: string; schedule: MobileMateSchedule; revision: string }
    | { action: "toggleRoutine"; id: string; isActive: boolean }
    | { action: "deleteRoutine" | "runRoutine"; id: string };
