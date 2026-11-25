import { randomUUID } from "node:crypto";
import { requestToolApproval, type RunResponse } from "../runs";
import { object, onlyKeys, text } from "./assistants.validation";

/** A required clarification returns through the waiting tool, never a later steer. */
export async function askAssistantQuestion(run: RunResponse, args: Record<string, unknown>) {
    if (run.mode !== "work" && run.mode !== "developer")
        throw new Error("Questions require a Work or Developer assistant conversation");
    if (run.status !== "running")
        throw new Error("Questions require a running assistant turn");
    onlyKeys(args, ["question", "header", "options"]);
    const question = text(args.question, "Question", 4000);
    const header = args.header === undefined ? undefined : text(args.header, "Question header", 80);
    if (args.options !== undefined && (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 5))
        throw new Error("Provide 2–5 question options or omit them for a free-text answer");
    const options = (args.options as unknown[] | undefined)?.map(value => {
        const option = object(value);
        onlyKeys(option, ["label", "description"]);
        return { label: text(option.label, "Option label", 200),
            ...(option.description === undefined ? {} : { description: text(option.description, "Option description", 1000) }) };
    });
    if (options && new Set(options.map(option => option.label)).size !== options.length)
        throw new Error("Question option labels must be unique");
    const response = await requestToolApproval({
        requestId: `assistant-question-${randomUUID()}`, runId: run.id, toolName: "AskAssistantQuestion",
        kind: "ask_user", question, header, options, multiSelect: false, isOther: true, timestamp: Date.now(),
    });
    if (response.approved && response.answer?.trim())
        return { status: "answered", question, answer: response.answer };
    return { status: "canceled", question,
        message: "No answer was received: the question was dismissed, canceled or expired. Stop work that depends on this answer and explain what information is still missing. Do not assume an answer or select a default option." };
}
