import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  MarkdownLink,
  markdownComponents,
} from "@/components/markdown-components";
import { FileIconComponent, Sparkles } from "@/components/ui/icons";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";

export interface PromptMarkdownSkill {
  name: string;
  path?: string;
  displayName?: string;
  description?: string;
  shortDescription?: string;
  iconSmall?: string;
  iconLarge?: string;
  brandColor?: string;
  scope?: string;
}

export interface PromptMarkdownFile {
  fullPath: string;
  basename: string;
}

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
}

type PromptContextKind = "skill" | "file" | "code";

const PROMPT_CONTEXT_HASH = "#mains-prompt-context:";
const REGEX_ESC = /[.*+?^${}()|[\]\\]/g;
const CODE_SELECTION_TOKEN_SRC =
  "@(?<code>\\/[^\\s#]+#L\\d+(?:-\\d+)?)(?![\\w-])";

function contextHref(kind: PromptContextKind, value: string): string {
  return `${PROMPT_CONTEXT_HASH}${kind}:${encodeURIComponent(value)}`;
}

function parseContextHref(
  href: string | undefined,
): { kind: PromptContextKind; value: string } | null {
  if (!href?.startsWith(PROMPT_CONTEXT_HASH)) return null;
  const marker = href.slice(PROMPT_CONTEXT_HASH.length);
  const separator = marker.indexOf(":");
  if (separator < 0) return null;
  const kind = marker.slice(0, separator);
  if (kind !== "skill" && kind !== "file" && kind !== "code") return null;
  try {
    return {
      kind,
      value: decodeURIComponent(marker.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

function mentionPattern(skillNames: string[], filePaths: string[]): RegExp {
  const parts: string[] = [];
  if (skillNames.length > 0) {
    parts.push(
      `\\$(?<skill>${skillNames.map((name) => name.replace(REGEX_ESC, "\\$&")).join("|")})(?::[\\w-]+)?(?![\\w-])`,
    );
  }
  // Code selections precede files because both begin with an absolute path and
  // a code selection extends that path with a line range.
  parts.push(CODE_SELECTION_TOKEN_SRC);
  if (filePaths.length > 0) {
    parts.push(
      `@(?<file>${filePaths.map((path) => path.replace(REGEX_ESC, "\\$&")).join("|")})(?![\\w./-])`,
    );
  }
  return new RegExp(parts.join("|"), "g");
}

function splitMentionText(value: string, pattern: RegExp): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }

    const kind: PromptContextKind = match.groups?.skill
      ? "skill"
      : match.groups?.file
        ? "file"
        : "code";
    const contextValue =
      match.groups?.skill ?? match.groups?.file ?? match.groups?.code ?? "";
    nodes.push({
      type: "link",
      url: contextHref(kind, contextValue),
      children: [{ type: "text", value: match[0] }],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    nodes.push({ type: "text", value: value.slice(lastIndex) });
  }
  return nodes.length > 0 ? nodes : [{ type: "text", value }];
}

/**
 * Turns composer context tokens into inert links in the Markdown tree. The
 * custom anchor renderer below converts those links back into the same chips
 * used by the editor. Transforming parsed text nodes means tokens inside code
 * spans/fences and existing links remain literal.
 */
function createPromptContextPlugin(skillNames: string[], filePaths: string[]) {
  const pattern = mentionPattern(skillNames, filePaths);

  return function promptContextPlugin() {
    return (tree: MarkdownNode) => {
      const transform = (parent: MarkdownNode) => {
        if (!parent.children) return;
        const children: MarkdownNode[] = [];
        for (const child of parent.children) {
          if (child.type === "text" && child.value) {
            children.push(...splitMentionText(child.value, pattern));
            continue;
          }
          if (child.type !== "link" && child.type !== "linkReference") {
            transform(child);
          }
          children.push(child);
        }
        parent.children = children;
      };
      transform(tree);
    };
  };
}

function PromptSkillChip({ skill }: { skill: PromptMarkdownSkill }) {
  const [failed, setFailed] = useState(false);
  const iconPath = skill.iconLarge || skill.iconSmall;
  const resolved = useLocalImageUrl(iconPath);
  const label = skill.displayName || skill.name;
  const tooltip = skill.shortDescription || skill.description || label;

  return (
    <span
      className="inline-flex align-middle items-center gap-1 px-1.5 mb-0.5 h-6 mx-0.5 rounded-lg text-xs font-medium leading-none select-none bg-primary dark:bg-primary-300/10 dark:text-primary-200 text-primary-800"
      title={tooltip}
    >
      <span className="inline-flex items-center justify-center size-3.5 shrink-0 rounded-sm overflow-hidden">
        {iconPath && resolved && !failed ? (
          <img
            src={resolved}
            alt=""
            className="size-3 rounded object-contain"
            style={
              skill.brandColor
                ? { backgroundColor: skill.brandColor }
                : undefined
            }
            onError={() => setFailed(true)}
          />
        ) : (
          <Sparkles className="size-3 shrink-0" />
        )}
      </span>
      <span className="leading-none">{label}</span>
    </span>
  );
}

function PromptFileChip({ file }: { file: PromptMarkdownFile }) {
  const dotIndex = file.basename.lastIndexOf(".");
  const extension =
    dotIndex > 0 && dotIndex < file.basename.length - 1
      ? file.basename.slice(dotIndex + 1)
      : undefined;

  return (
    <span
      className="inline-flex align-middle items-center gap-1 px-1.5 mb-0.5 h-6 mx-0.5 rounded-lg text-xs font-medium leading-none select-none bg-primary dark:bg-primary-300/10 dark:text-primary-200 text-primary-800"
      title={file.fullPath}
    >
      <FileIconComponent
        extension={extension}
        fileName={file.basename}
        className="size-3.5 shrink-0"
      />
      <span className="leading-none">{file.basename}</span>
    </span>
  );
}

function PromptCodeChip({ token }: { token: string }) {
  const hashIndex = token.lastIndexOf("#L");
  const fullPath = token.slice(0, hashIndex);
  const range = token.slice(hashIndex + 2);
  const basename = fullPath.split("/").pop() ?? fullPath;
  const dotIndex = basename.lastIndexOf(".");
  const extension =
    dotIndex > 0 && dotIndex < basename.length - 1
      ? basename.slice(dotIndex + 1)
      : undefined;

  return (
    <span
      className="inline-flex align-middle items-center gap-1 px-1.5 mb-0.5 h-6 mx-0.5 rounded-lg text-xs font-medium leading-none select-none bg-primary dark:bg-primary-300/10 dark:text-primary-200 text-primary-800"
      title={token}
    >
      <FileIconComponent
        extension={extension}
        fileName={basename}
        className="size-3.5 shrink-0"
      />
      <span className="leading-none font-mono">{`${basename}:${range}`}</span>
    </span>
  );
}

export function promptMessageMentionsFile(
  message: string,
  fullPath: string,
): boolean {
  const escaped = fullPath.replace(REGEX_ESC, "\\$&");
  return new RegExp(`@${escaped}(?![#\\w./-])`).test(message);
}

interface PromptMarkdownProps {
  children?: string;
  skills?: PromptMarkdownSkill[];
  files?: PromptMarkdownFile[];
}

export function PromptMarkdown({
  children = "",
  skills = [],
  files = [],
}: PromptMarkdownProps) {
  const skillsByName = useMemo(
    () => new Map(skills.map((skill) => [skill.name, skill])),
    [skills],
  );
  const filesByPath = useMemo(
    () => new Map(files.map((file) => [file.fullPath, file])),
    [files],
  );
  const contextPlugin = useMemo(
    () =>
      createPromptContextPlugin(
        Array.from(skillsByName.keys()).sort((a, b) => b.length - a.length),
        Array.from(filesByPath.keys()).sort((a, b) => b.length - a.length),
      ),
    [skillsByName, filesByPath],
  );
  const components = useMemo<Components>(
    () => ({
      ...markdownComponents,
      a: ({ href, children: linkChildren }) => {
        const context = parseContextHref(href);
        if (context?.kind === "skill") {
          const skill = skillsByName.get(context.value);
          if (skill) return <PromptSkillChip skill={skill} />;
        }
        if (context?.kind === "file") {
          const file = filesByPath.get(context.value);
          if (file) return <PromptFileChip file={file} />;
        }
        if (context?.kind === "code") {
          return <PromptCodeChip token={context.value} />;
        }
        return (
          <MarkdownLink href={href}>
            {linkChildren as ReactNode}
          </MarkdownLink>
        );
      },
    }),
    [filesByPath, skillsByName],
  );

  return (
    <ReactMarkdown
      components={components}
      remarkPlugins={[remarkGfm, contextPlugin]}
    >
      {children}
    </ReactMarkdown>
  );
}
