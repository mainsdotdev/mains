import { type ReactNode } from "react";
import { View } from "react-native";

import { ThemedText } from "@/components/ui";
import type { ToolCallRow } from "@/db/schema";
import {
  coerceToolOutput,
  parseDiff,
  parseGlobOutput,
  parseGrepOutput,
  parseReadOutput,
  parseShellOutput,
  parseToolInput,
  shortFileName,
  shortPath,
  toolFilePath,
  toolOutputText,
  toolSummary,
} from "@/lib/tool-output";
import { resolveTool } from "@/lib/tool-registry";
import { colors, spacing } from "@/theme";

import { DiffStat, ToolCodeBody, ToolDetail, ToolDiffBody, ToolRow, ToolTextBody } from "./tool-row";

/**
 * A tool call in the transcript.
 *
 * The phone's counterpart to the desktop's `tool-call-item.tsx` dispatch: the
 * resolver says which *kind* of tool this is, and one branch per kind decides
 * what the row's middle slot, its stat, and its expanded body should be. The
 * desktop keeps a file per tool because each one owns hover states, an editor
 * link, and a syntax-highlighted diff; on the phone a row is a symbol, a line
 * of text, and a card — so the whole table fits in one file.
 */
export function ToolCallDisplay({ call }: { call: ToolCallRow }) {
  const tool = resolveTool(call.toolName);
  const params = parseToolInput(call.inputJson);
  const output = coerceToolOutput(call.outputJson);
  const view = buildView(tool.kind, params, output);

  return (
    <ToolRow
      symbol={tool.symbol}
      verb={tool.verb}
      status={call.status}
      detail={view.detail ?? <ToolDetail>{toolSummary(params)}</ToolDetail>}
      stat={view.stat}
      error={call.error}
    >
      {view.body}
    </ToolRow>
  );
}

interface RowView {
  detail?: ReactNode;
  stat?: ReactNode;
  body?: ReactNode;
}

function buildView(
  kind: ReturnType<typeof resolveTool>["kind"],
  params: Record<string, unknown>,
  output: unknown,
): RowView {
  switch (kind) {
    case "bash": {
      const stdout = parseShellOutput(output);
      return {
        detail: <ToolDetail>{text(params.description) || text(params.command) || "command"}</ToolDetail>,
        body: stdout ? <ToolCodeBody text={stdout} /> : undefined,
      };
    }

    case "read": {
      const { content, numLines } = parseReadOutput(output);
      return {
        detail: <FileDetail path={toolFilePath(params)} />,
        stat: numLines > 0 ? `${numLines} lines` : undefined,
        body: content ? <ToolCodeBody text={content} /> : undefined,
      };
    }

    case "edit": {
      const diff = parseDiff(output, params);
      return {
        detail: <FileDetail path={toolFilePath(params)} />,
        stat: diff.lines.length > 0 ? <DiffStat added={diff.added} removed={diff.removed} /> : undefined,
        body: diff.lines.length > 0 ? <ToolDiffBody lines={diff.lines} /> : undefined,
      };
    }

    case "write": {
      // A write's own content is the truth; fall back to whatever diff the
      // provider reported when the params carry no body (Copilot's create).
      const content = text(params.content) || text(params.contents) || text(params.file_text);
      const diff = content ? null : parseDiff(output, params);
      const lineCount = content ? content.split("\n").length : 0;
      return {
        detail: <FileDetail path={toolFilePath(params)} />,
        stat: lineCount > 0 ? `${lineCount} lines` : undefined,
        body: content ? (
          <ToolCodeBody text={content} />
        ) : diff && diff.lines.length > 0 ? (
          <ToolDiffBody lines={diff.lines} />
        ) : undefined,
      };
    }

    case "delete":
      return { detail: <FileDetail path={toolFilePath(params)} /> };

    case "glob": {
      const { files, truncated } = parseGlobOutput(output);
      return {
        detail: <ToolDetail>{text(params.pattern) || text(params.path) || ""}</ToolDetail>,
        stat: files.length > 0 ? `${files.length}${truncated ? "+" : ""} files` : undefined,
        body:
          files.length > 0 ? <ToolCodeBody text={files.map(shortPath).join("\n")} /> : undefined,
      };
    }

    case "grep": {
      const { content, numFiles, numLines, totalMatches, truncated } = parseGrepOutput(output);
      const showLines = numLines > 0 && (totalMatches <= 0 || numLines !== totalMatches);
      const stat = [
        totalMatches > 0 ? `${totalMatches} matches` : null,
        showLines ? `${numLines} lines` : null,
        numFiles > 0 ? `${numFiles} files` : null,
        truncated ? "truncated" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        detail: (
          <ToolDetail>
            {text(params.pattern) || text(params.query) || text(params.regex) || ""}
          </ToolDetail>
        ),
        stat: stat || undefined,
        body: content ? <ToolCodeBody text={content} /> : undefined,
      };
    }

    case "web": {
      const body = toolOutputText(output);
      return {
        detail: <ToolDetail>{text(params.url) || text(params.query) || ""}</ToolDetail>,
        body: body ? <ToolTextBody text={body} /> : undefined,
      };
    }

    case "task": {
      const body = toolOutputText(output);
      return {
        detail: (
          <ToolDetail>
            {text(params.description) || text(params.summary) || text(params.to) || ""}
          </ToolDetail>
        ),
        body: body ? <ToolTextBody text={body} /> : undefined,
      };
    }

    case "skill": {
      const body = toolOutputText(output);
      return {
        detail: <ToolDetail>{text(params.skill) || text(params.name) || ""}</ToolDetail>,
        body: body ? <ToolTextBody text={body} /> : undefined,
      };
    }

    case "todo": {
      const todos = readTodos(params);
      if (todos.length > 0) {
        return {
          detail: <ToolDetail>{`${todos.length} item${todos.length === 1 ? "" : "s"}`}</ToolDetail>,
          body: <TodoList todos={todos} />,
        };
      }
      return {
        detail: (
          <ToolDetail>{text(params.content) || text(params.activeForm) || text(params.status) || ""}</ToolDetail>
        ),
      };
    }

    case "plan": {
      const plan = text(params.plan) || text(params.content) || toolOutputText(output);
      return {
        detail: <ToolDetail>{firstLine(plan)}</ToolDetail>,
        body: plan ? <ToolTextBody text={plan} /> : undefined,
      };
    }

    case "question": {
      const question = text(params.question) || text(params.header) || "";
      const answer = toolOutputText(output);
      return {
        detail: <ToolDetail>{question}</ToolDetail>,
        body: answer ? <ToolTextBody text={answer} /> : undefined,
      };
    }

    case "sql": {
      const rows = toolOutputText(output);
      return {
        detail: <ToolDetail>{text(params.query) || text(params.description) || ""}</ToolDetail>,
        body: rows ? <ToolCodeBody text={rows} /> : undefined,
      };
    }

    default: {
      const body = toolOutputText(output);
      const summary = toolSummary(params);
      return {
        detail: <ToolDetail>{summary}</ToolDetail>,
        body: body ? <ToolTextBody text={body} /> : undefined,
      };
    }
  }
}

/** A file path: the name alone, since a phone row has no room for the rest. */
function FileDetail({ path }: { path: string }) {
  if (!path) return <ToolDetail>{""}</ToolDetail>;
  return <ToolDetail>{shortFileName(path)}</ToolDetail>;
}

interface Todo {
  content: string;
  status: string;
}

/** Copilot writes the whole plan at once (`todos: [...]`); Claude writes one item per call. */
function readTodos(params: Record<string, unknown>): Todo[] {
  const raw = params.todos ?? params.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): Todo | null => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const content = text(obj.content) || text(obj.title) || text(obj.activeForm);
      return content ? { content, status: text(obj.status) || "pending" } : null;
    })
    .filter((t): t is Todo => t !== null);
}

function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <View style={{ gap: spacing.xs, paddingLeft: spacing.lg }}>
      {todos.map((todo, i) => {
        const done = todo.status === "completed" || todo.status === "done";
        return (
          <View key={i} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <ThemedText variant="footnote" style={{ color: colors.tertiaryLabel }}>
              {done ? "✓" : todo.status === "in_progress" ? "▸" : "•"}
            </ThemedText>
            <ThemedText
              variant="footnote"
              style={{
                flex: 1,
                color: done ? colors.tertiaryLabel : colors.secondaryLabel,
                textDecorationLine: done ? "line-through" : "none",
              }}
            >
              {todo.content}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstLine(value: string): string {
  const line = value.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.replace(/^#+\s*/, "").trim();
}
