import type { RunResponse } from "../runs";
import { pulseService, type CreateAssistantRoutineInput, type Pulse, type UpdatePulseInput } from "../pulse";
import { assertOwnedRecord } from "../bridge";
import { onlyKeys, text } from "./assistants.validation";

export const routineTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const ASSISTANT_ROUTINE_TOOLS: readonly string[] = ["ListAssistantRoutines", "ReadAssistantRoutine", "CreateAssistantRoutine", "UpdateAssistantRoutine", "DeleteAssistantRoutine"];
const settings = ["title", "prompt", "frequency", "dayOfWeek", "hour", "minute", "timezone", "isActive"];
const summary = (pulse: Pulse) => ({
  id: pulse.id, title: pulse.title, prompt: pulse.prompt, isActive: pulse.isActive,
  frequency: pulse.frequency, dayOfWeek: pulse.dayOfWeek, hour: pulse.hour, minute: pulse.minute, timezone: pulse.timezone,
  mode: pulse.mode, workspaceId: pulse.workspaceId, nextRunAt: pulse.nextRunAt, lastRunAt: pulse.lastRunAt,
  lastRunId: pulse.lastRunId, lastAssignmentStatus: pulse.lastAssignmentStatus ?? null, lastError: pulse.lastError,
});

function ownRoutine(accountId: string, assistantId: string, id: unknown): Pulse {
  const pulse = pulseService.getById(text(id, "Routine"));
  if (!pulse || pulse.accountId !== accountId || pulse.assistantId !== assistantId) throw new Error("Routine not found for this assistant");
  assertOwnedRecord("pulses", pulse.id);
  return pulse;
}

/** Actor identity and execution come from the persisted conversation, never model-supplied fields. */
export function assistantRoutineTool(run: Pick<RunResponse, "id" | "accountId" | "mode" | "workspaceId">, assistantId: string, name: string, args: Record<string, unknown>) {
  if (run.mode !== "work" && run.mode !== "developer") throw new Error("Routines require a Work or Developer assistant conversation");
  if (name === "ListAssistantRoutines") {
    onlyKeys(args, ["offset"]);
    const offset = args.offset ?? 0;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error("Choose a valid routine offset");
    const routines = pulseService.forAssistant(run.accountId, assistantId, offset);
    return { defaultTimezone: routineTimezone(), defaultExecution: { mode: run.mode, workspaceId: run.workspaceId }, nextOffset: routines.length > 100 ? offset + 100 : null,
      routines: routines.slice(0, 100).map(pulse => ({ ...summary(pulse), prompt: pulse.prompt.slice(0, 600) })) };
  }
  if (name === "CreateAssistantRoutine") {
    onlyKeys(args, ["requestId", ...settings]);
    const requestId = text(args.requestId, "Routine request key");
    const { requestId: _request, ...schedule } = args;
    const input = { ...schedule, title: text(args.title, "Routine name"), prompt: text(args.prompt, "Routine task", 24000),
      timezone: args.timezone === undefined ? routineTimezone() : text(args.timezone, "Timezone", 100), mode: run.mode,
      workspaceId: run.mode === "developer" ? run.workspaceId : null };
    // The request key is not a Pulse setting. Scope it to this accepted conversation.
    return summary(pulseService.createRoutine(run.accountId, assistantId, input as CreateAssistantRoutineInput, JSON.stringify([run.id, requestId])));
  }
  const routine = ownRoutine(run.accountId, assistantId, args.routineId);
  if (name === "ReadAssistantRoutine") { onlyKeys(args, ["routineId"]); return summary(routine); }
  if (name === "DeleteAssistantRoutine") {
    onlyKeys(args, ["routineId"]);
    pulseService.delete(routine.id);
    return { deleted: true, id: routine.id, title: routine.title, message: "Future runs stopped. Already accepted tasks and chats are preserved." };
  }
  if (name !== "UpdateAssistantRoutine") throw new Error("Unknown assistant routine tool");
  onlyKeys(args, ["routineId", ...settings]);
  const { routineId: _id, ...patch } = args;
  if (!Object.keys(patch).length) throw new Error("Provide a routine setting to update");
  if (patch.title !== undefined) patch.title = text(patch.title, "Routine name");
  if (patch.prompt !== undefined) patch.prompt = text(patch.prompt, "Routine task", 24000);
  if (patch.frequency !== undefined && patch.frequency !== "weekly" && patch.dayOfWeek === undefined) patch.dayOfWeek = null;
  return summary(pulseService.update(routine.id, patch as UpdatePulseInput)!);
}
