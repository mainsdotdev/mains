import type { RunEvent } from "../types";
import {
  CLAUDE_SPAWN_TOOLS,
  CODEX_COLLAB_TOOLS,
} from "./subagent-identity";
import { eventsValueEqual } from "./run-event-mappers";

export interface EventGroup {
  id: string;
  type: "tool_calls" | "mcp_app" | "info" | "response" | "prompt_suggestion";
  events: RunEvent[];
  startTime: Date;
  endTime: Date;
  isRunning?: boolean;
}

/** Tool events rendered as PlanDisplay — same name rules as `groupEvents` standalone plan groups. */
export function toolEventPlanName(event: { type: string; content: string }): string | null {
  if (event.type !== "tool_call") return null;
  const colonIdx = event.content.indexOf(":");
  return (colonIdx !== -1 ? event.content.substring(0, colonIdx).trim() : event.content).toLowerCase();
}

function isPlanToolEvent(event: { type: string; content: string }): boolean {
  const n = toolEventPlanName(event);
  return n === "plan" || n === "exitplanmode" || n === "create plan";
}

/**
 * Spawn tool calls (Codex collab variants, Claude's Agent/Task) are persisted
 * — the subagent panel anchors on the spawn rows — but not rendered in the
 * transcript: the panel is the canonical subagent surface, and showing every
 * spawn in both places duplicated it. The names come from the shared tool
 * vocabulary in subagent-identity.
 */
function isSubagentSpawnEvent(event: { type: string; content: string }): boolean {
  const n = toolEventPlanName(event);
  return n !== null && (CODEX_COLLAB_TOOLS.has(n) || CLAUDE_SPAWN_TOOLS.has(n));
}

/**
 * A subagent's own tool call — it belongs to the session panel's flow view,
 * not the chat. `parentToolCallId` identifies one from row insert;
 * `isFromSubagent` covers rows whose linkage only landed with the completion
 * metadata.
 */
function isSubagentChildEvent(event: RunEvent): boolean {
  const m = event.metadata as Record<string, unknown> | undefined;
  return !!(m?.parentToolCallId || m?.isFromSubagent);
}

/**
 * An MCP App is an interactive user-facing deliverable, even though its wire
 * event is a tool call. Keep it out of execution-detail groups so it remains
 * visible and interactive when ordinary tool activity is collapsed or hidden.
 */
function isMcpAppEvent(event: RunEvent): boolean {
  return event.type === "tool_call" && !!event.metadata?.mcpApp;
}

function isImageViewToolEvent(event: RunEvent): boolean {
  return event.type === "tool_call" && event.metadata?.codexItemType === "imageView";
}

/** Older Codex runs persisted imageView as an internal log plus a generic image
 * artifact. Recover the tool call at display time so reopening those runs also
 * shows the inspection step rather than a full-size PDF page preview. */
function restoreLegacyImageViews(events: RunEvent[]): RunEvent[] {
  const legacyPrefix = "[codex:item:imageView] ";
  const restored = new Map<string, RunEvent>();
  const viewedPaths = new Set<string>();

  for (const event of events) {
    if (isImageViewToolEvent(event)) {
      const input = event.metadata?.input;
      const imagePath = input && typeof input === "object"
        ? (input as Record<string, unknown>).path
        : undefined;
      if (typeof imagePath === "string") viewedPaths.add(imagePath);
      continue;
    }
    if (event.type !== "log" || !event.content.startsWith(legacyPrefix)) continue;
    try {
      const item = JSON.parse(event.content.slice(legacyPrefix.length)) as Record<string, unknown>;
      if (item.type !== "imageView" || typeof item.path !== "string" || !item.path) continue;
      const input = { path: item.path };
      viewedPaths.add(item.path);
      restored.set(event.id, {
        id: `image-view-${event.id}`,
        type: "tool_call",
        content: `ImageView: ${JSON.stringify(input)}`,
        timestamp: event.timestamp,
        metadata: {
          status: "done",
          toolName: "ImageView",
          toolCallId: item.id,
          codexItemType: "imageView",
          input,
        },
      });
    } catch {
      // Keep an unparseable diagnostic log as-is.
    }
  }

  if (restored.size === 0 && viewedPaths.size === 0) return events;
  return events.flatMap((event) => {
    const recovered = restored.get(event.id);
    if (recovered) return [recovered];
    if (
      event.type === "artifact" &&
      event.metadata?.kind === "image" &&
      event.metadata?.source !== "codex_image_generation" &&
      viewedPaths.has(event.metadata?.path as string)
    ) return [];
    return [event];
  });
}

export function isPlanToolCallGroup(group: EventGroup): boolean {
  if (group.type !== "tool_calls") return false;
  return group.events.some((ev) => isPlanToolEvent(ev));
}

export function groupEvents(events: RunEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let currentToolGroup: RunEvent[] = [];

  const flushToolGroup = () => {
    if (currentToolGroup.length > 0) {
      groups.push({
        id: `tools-${currentToolGroup[0].id}`,
        type: "tool_calls",
        events: [...currentToolGroup],
        startTime: currentToolGroup[0].timestamp,
        endTime: currentToolGroup[currentToolGroup.length - 1].timestamp,
      });
      currentToolGroup = [];
    }
  };

  for (const event of restoreLegacyImageViews(events)) {
    if (event.type === "tool_call") {
      // Subagent machinery lives in the session panel, not the chat: spawn
      // calls (Codex collab variants and Claude's Agent/Task) and the
      // sub-agents' own tool calls are dropped here without flushing, so the
      // surrounding accordion doesn't split around them.
      if (isSubagentSpawnEvent(event) || isSubagentChildEvent(event)) {
        continue;
      }
      // Plan/ExitPlanMode tool calls render standalone, never inside a group
      if (isPlanToolEvent(event)) {
        flushToolGroup();
        groups.push({
          id: `plan-${event.id}`,
          type: "tool_calls",
          events: [event],
          startTime: event.timestamp,
          endTime: event.timestamp,
        });
      } else if (isMcpAppEvent(event)) {
        flushToolGroup();
        groups.push({
          id: `mcp-app-${event.id}`,
          type: "mcp_app",
          events: [event],
          startTime: event.timestamp,
          endTime: event.timestamp,
        });
      } else {
        // Image inspection is its own activity. Keep adjacent image views
        // together and separate them from commands that created the files.
        if (
          currentToolGroup.length > 0 &&
          isImageViewToolEvent(currentToolGroup[0]) !== isImageViewToolEvent(event)
        ) flushToolGroup();
        currentToolGroup.push(event);
      }
    } else if (event.type === "artifact") {
      // A subagent's messages belong to its detail tab, not the parent chat.
      // Skipped before the flush so they don't split a tool accordion either.
      if (event.metadata?.isFromSubagent) {
        continue;
      }
      flushToolGroup();
      // Cursor agent thought stream — UI-only (e.g. loader), not a chat bubble
      if (event.metadata?.kind === "thinking") {
        continue;
      }
      const isUserPrompt = event.metadata?.kind === "user-prompt";
      const isPromptSuggestion = event.metadata?.kind === "prompt_suggestion";
      const isImage = event.metadata?.kind === "image";

      if (isImage) {
        // Merge consecutive image artifacts into one group so multiple
        // generated images render side by side as a gallery row.
        const lastGroup = groups[groups.length - 1];
        const lastIsImageGroup =
          lastGroup?.type === "response" &&
          lastGroup.events[0]?.type === "artifact" &&
          lastGroup.events[0]?.metadata?.kind === "image";
        if (lastIsImageGroup) {
          lastGroup.events.push(event);
          lastGroup.endTime = event.timestamp;
        } else {
          groups.push({
            id: `response-${event.id}`,
            type: "response",
            events: [event],
            startTime: event.timestamp,
            endTime: event.timestamp,
          });
        }
      } else if (isPromptSuggestion) {
        // Merge consecutive suggestions into one group
        const lastGroup = groups[groups.length - 1];
        if (lastGroup?.type === "prompt_suggestion") {
          lastGroup.events.push(event);
          lastGroup.endTime = event.timestamp;
        } else {
          groups.push({
            id: `suggestion-${event.id}`,
            type: "prompt_suggestion",
            events: [event],
            startTime: event.timestamp,
            endTime: event.timestamp,
          });
        }
      } else {
        groups.push({
          id: `${isUserPrompt ? "user" : "response"}-${event.id}`,
          type: isUserPrompt ? "info" : "response",
          events: [event],
          startTime: event.timestamp,
          endTime: event.timestamp,
        });
      }
    } else if (event.type === "log") {
      // Skip start/resume level logs (internal system messages)
      const level = event.metadata?.level as string | undefined;
      if (level === "start" || level === "resume") {
        continue;
      }

      // SDK user messages - show as special info group
      if (level === "sdk-user") {
        flushToolGroup();
        groups.push({
          id: `sdk-user-${event.id}`,
          type: "info",
          events: [event],
          startTime: event.timestamp,
          endTime: event.timestamp,
        });
        continue;
      }

      // Check if this is a system/info log we want to show.
      //
      // `warn` and `error` are shown on their level alone. The shape heuristic
      // below treats a leading "[" as internal chrome, which is also how every
      // provider tags the things a user most needs to hear — a rate limit, a
      // denied tool call, a model refusal — so judging those by prefix hid
      // exactly the wrong set.
      const content = event.content;
      const isImportant =
        level === "warn" ||
        level === "error" ||
        content.includes("Session initialized") ||
        content.includes("Starting") ||
        content.includes("Resuming") ||
        (!content.startsWith("[") && content.length < 200);

      if (isImportant) {
        flushToolGroup();
        groups.push({
          id: `info-${event.id}`,
          type: "info",
          events: [event],
          startTime: event.timestamp,
          endTime: event.timestamp,
        });
      }
      // Skip non-important logs (they're internal)
    } else if (event.type === "status") {
      // Status events are important
      flushToolGroup();
      groups.push({
        id: `status-${event.id}`,
        type: "info",
        events: [event],
        startTime: event.timestamp,
        endTime: event.timestamp,
      });
    }
  }

  // Flush any remaining tool calls (and mark as running if at the end)
  if (currentToolGroup.length > 0) {
    groups.push({
      id: `tools-${currentToolGroup[0].id}`,
      type: "tool_calls",
      events: [...currentToolGroup],
      startTime: currentToolGroup[0].timestamp,
      endTime: currentToolGroup[currentToolGroup.length - 1].timestamp,
      isRunning: true, // Last group might still be running
    });
  }

  return groups;
}

function eventGroupsEqual(a: EventGroup, b: EventGroup): boolean {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.type !== b.type ||
    a.isRunning !== b.isRunning ||
    a.events.length !== b.events.length ||
    a.endTime.getTime() !== b.endTime.getTime()
  ) {
    return false;
  }
  for (let i = 0; i < a.events.length; i++) {
    // `eventsValueEqual` compares rebuilt object metadata by value, so a tool
    // event re-mapped from an unchanged row still reads equal (and the group is
    // reused) instead of forcing a spurious re-render.
    if (!eventsValueEqual(a.events[i], b.events[i])) return false;
  }
  return true;
}

/**
 * Structural sharing for grouped events. `groupEvents` rebuilds every group
 * object on each call, so a single streamed token would otherwise hand every
 * row a brand-new `group` prop and defeat `React.memo`. This reuses the prior
 * call's group objects (matched by stable `id`) wherever the content is
 * unchanged, so only the groups that actually changed get a fresh reference —
 * and the whole array reference is preserved when nothing changed at all.
 */
export function reconcileEventGroups(
  prev: EventGroup[] | null,
  next: EventGroup[],
): EventGroup[] {
  if (!prev || prev.length === 0) return next;
  const prevById = new Map<string, EventGroup>();
  for (const g of prev) prevById.set(g.id, g);

  let changed = prev.length !== next.length;
  const out: EventGroup[] = new Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const g = next[i];
    const p = prevById.get(g.id);
    if (p && eventGroupsEqual(p, g)) {
      out[i] = p; // reuse the stable reference
      if (p !== prev[i]) changed = true; // same content but order shifted
    } else {
      out[i] = g;
      changed = true;
    }
  }
  return changed ? out : prev;
}
