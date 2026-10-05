import type { FileAttachment, WorkRunContextItem, WorkRunRequest } from "../../../../shared/adapter.types";
import { appendPromptSections, formatContextSection, attachmentPromptParts } from "./adapter.shared";
import type { CodexAppServerParams } from "./codex-app-server-protocol/rpc";
import type { CodexSubAgentRunMeta } from "./codex-event-mapper";

type TurnInput = CodexAppServerParams<"turn/start">["input"];

interface TurnInputRequest {
  clientUserMessageId?: string;
  runId: string;
  context?: WorkRunContextItem[];
  contextIssues?: WorkRunRequest["contextIssues"];
  contextSignals?: WorkRunRequest["contextSignals"];
  contextFiles?: WorkRunRequest["contextFiles"];
  skills?: WorkRunRequest["skills"];
  attachments?: FileAttachment[];
}


export function buildCodexTurnInput(
  message: string,
  request: TurnInputRequest,
  interruptedSubAgents: CodexSubAgentRunMeta[] = [],
): TurnInput {
  let prompt =
    request.context && request.context.length > 0
      ? `Context:\n${formatContextSection(request.context)}\n\n---\n\n ${message}`
      : message;

  prompt = appendPromptSections(prompt, {
    contextIssues: request.contextIssues,
    contextSignals: request.contextSignals,
    contextFiles: request.contextFiles,
    runId: request.runId,
  });

  if (interruptedSubAgents.length > 0) {
    const agents = interruptedSubAgents.map((agent) => ({
      id: agent.threadId,
      ...(agent.nickname ? { name: agent.nickname } : {}),
      ...(agent.role ? { role: agent.role } : {}),
    }));
    prompt +=
      "\n\n<mains_interrupted_subagents>\n" +
      "The previous turn was stopped, so these subagents are interrupted and are not making progress:\n" +
      `${JSON.stringify(agents)}\n` +
      "If the user's current request still depends on their work, do not call wait_agent on them yet. " +
      "First call resume_agent for each interrupted id, then call send_input asking it to continue its previously assigned task. " +
      "If an agent cannot be resumed, spawn a replacement for that task. " +
      "If the current request no longer depends on them, continue without waiting for them.\n" +
      "</mains_interrupted_subagents>";
  }

  const input: TurnInput = [{
    type: "text",
    text: prompt,
    text_elements: [],
  }];

  for (const skill of request.skills ?? []) {
    if (skill.name && skill.mentionPath) {
      input.push({
        type: "mention",
        name: skill.displayName || skill.name,
        path: skill.mentionPath,
      });
    } else if (skill.name && skill.path) {
      input.push({
        type: "skill",
        name: skill.name,
        path: skill.path,
      });
    }
  }

  if (request.attachments && request.attachments.length > 0) {
    const { savedPaths, inlineTexts } = attachmentPromptParts(
      request.attachments,
    );
    let attachmentPrompt = prompt;
    if (inlineTexts.length > 0) {
      attachmentPrompt +=
        "\n\n---\n\nAttached documents:\n" + inlineTexts.join("\n\n");
    }

    const filePaths: string[] = [];
    for (const attachmentPath of savedPaths) {
      const lowerPath = attachmentPath.toLowerCase();
      if (
        lowerPath.endsWith(".png") ||
        lowerPath.endsWith(".jpg") ||
        lowerPath.endsWith(".jpeg") ||
        lowerPath.endsWith(".gif") ||
        lowerPath.endsWith(".webp") ||
        lowerPath.endsWith(".bmp")
      ) {
        input.push({
          type: "localImage",
          path: attachmentPath,
        });
      } else {
        // App-server turn input has no document variant. Keep other files on
        // disk and pass their paths so Codex can read them with its tools.
        filePaths.push(attachmentPath);
      }
    }
    if (filePaths.length > 0) {
      attachmentPrompt +=
        "\n\n---\n\nAttached files:\n" +
        filePaths.map((filePath) => `- ${filePath}`).join("\n");
    }
    if (input[0].type === "text") input[0].text = attachmentPrompt;
  }

  return input;
}
