import type {
  RunArtifact,
  RunContext,
  RunOutputFile,
  ToolCall,
} from "@/lib/redux/api";
import {
  classifyDocType,
  isDocumentRenderImage,
} from "@/lib/document-viewer";
import { resolveTool } from "@/features/workspace/lib/resolve-tool";
import {
  deliverableDedupeKey,
  documentBundleStem,
  isDocumentBundleSidecar,
} from "@/features/workspace/lib/deliverable-identity";

export type SessionResourceKind =
  | "file"
  | "folder"
  | "image"
  | "document"
  | "url"
  | "search"
  | "issue"
  | "signal"
  | "selection"
  | "note"
  | "visualization";

export type SessionResourceTarget =
  | { type: "file"; value: string }
  | { type: "url"; value: string }
  | { type: "image"; value: string };

export interface SessionResource {
  id: string;
  role: "source" | "deliverable";
  kind: SessionResourceKind;
  title: string;
  badge: string;
  detail?: string;
  target?: SessionResourceTarget;
  createdAt: number;
  /** Canonical identity used to collapse the same path/URL across turns. */
  dedupeKey: string;
}

export interface SessionResources {
  sources: SessionResource[];
  plugins: SessionPlugin[];
  deliverables: SessionResource[];
}

export interface SessionPlugin {
  id: string;
  slug: string;
  title: string;
  iconSource?: string;
  brandColor?: string;
  callCount: number;
  createdAt: number;
}

type UnknownRecord = Record<string, unknown>;

const OUTPUT_KINDS = new Set(["file", "image", "document", "visualization"]);
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function timestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    // SQLite timestamps can cross the remote transport as epoch seconds while
    // local Electron IPC retains Date objects. Normalise both for one sort.
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function basename(value: string): string {
  const clean = value.split(/[?#]/, 1)[0].replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).pop() || value;
}

function extension(value: string): string {
  const name = basename(value);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : "File";
}

function urlTitle(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, "");
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${host}${path}${url.search}`;
  } catch {
    return value;
  }
}

function targetKey(target: SessionResourceTarget | undefined): string | null {
  if (!target) return null;
  if (target.type === "url") {
    try {
      const url = new URL(target.value);
      url.hash = "";
      return `url:${url.toString()}`;
    } catch {
      return `url:${target.value}`;
    }
  }
  return `${target.type}:${target.value}`;
}

function withDedupeKey(
  resource: Omit<SessionResource, "dedupeKey">,
): SessionResource {
  return {
    ...resource,
    dedupeKey:
      targetKey(resource.target) ??
      `${resource.role}:${resource.kind}:${resource.title.toLocaleLowerCase()}`,
  };
}

function contextResources(context: readonly RunContext[]): SessionResource[] {
  const resources: SessionResource[] = [];

  for (const item of context) {
    if (!item.ref && !item.content) continue;
    if (!["file", "selection", "note"].includes(item.kind)) continue;

    const metadata = record(item.metadata) ?? {};
    const ref = item.ref ?? "";
    const source = text(metadata.source);
    const origin = text(metadata.origin);
    const createdAt = timestamp(item.createdAt);

    if (source === "browser") {
      const url = text(metadata.url) ?? (ref.startsWith("http") ? ref : undefined);
      const title = text(metadata.title) ?? (url ? urlTitle(url) : "Browser selection");
      resources.push(
        withDedupeKey({
          id: `context-${item.id}`,
          role: "source",
          kind: url ? "url" : "selection",
          title,
          badge: "Browser",
          detail: text(metadata.selector),
          target: url ? { type: "url", value: url } : undefined,
          createdAt,
        }),
      );
      continue;
    }

    if (source === "editor") {
      const path = text(metadata.filePath) ?? ref.split("#L", 1)[0];
      const start = metadata.startLine;
      const end = metadata.endLine;
      const range =
        typeof start === "number"
          ? start === end
            ? `Line ${start}`
            : `Lines ${start}-${String(end ?? start)}`
          : undefined;
      resources.push(
        withDedupeKey({
          id: `context-${item.id}`,
          role: "source",
          kind: "selection",
          title: text(metadata.fileName) ?? basename(path),
          badge: "You",
          detail: range,
          target: path ? { type: "file", value: path } : undefined,
          createdAt,
        }),
      );
      continue;
    }

    const path = ref || undefined;
    const isProjectSource = origin === "collection-source";
    resources.push(
      withDedupeKey({
        id: `context-${item.id}`,
        role: "source",
        kind: item.kind === "note" ? "note" : "file",
        title: path ? basename(path) : (item.content?.split("\n", 1)[0] ?? "Note"),
        badge: isProjectSource ? "Project" : "User",
        detail: isProjectSource ? "Project source" : undefined,
        target: path ? { type: "file", value: path } : undefined,
        createdAt,
      }),
    );
  }

  return resources;
}

function promptResources(artifacts: readonly RunArtifact[]): SessionResource[] {
  const resources: SessionResource[] = [];

  for (const artifact of artifacts) {
    // `user-prompt` is a provider event kind persisted by RunSession. It is
    // intentionally not a public output-artifact kind, hence the string cast.
    if (String(artifact.kind) !== "user-prompt") continue;
    const metadata = record(artifact.metadata) ?? {};
    const createdAt = timestamp(artifact.createdAt);

    list(metadata.attachments).forEach((raw, index) => {
      const attachment = record(raw);
      if (!attachment) return;
      const name = text(attachment.name) ?? "Attachment";
      const type = text(attachment.type);
      const mime = text(attachment.mimeType);
      const isImage = type === "image" || mime?.startsWith("image/") === true;
      const captureName = text(attachment.captureName);
      const path = text(attachment.path) ?? text(attachment.sourcePath);
      const imageSrc =
        (captureName
          ? `mains-capture://cap/${encodeURIComponent(captureName)}`
          : undefined) ??
        text(attachment.dataUrl) ??
        path;
      const target: SessionResourceTarget | undefined = isImage
        ? imageSrc
          ? { type: "image", value: imageSrc }
          : undefined
        : path
          ? { type: "file", value: path }
          : undefined;

      resources.push(
        withDedupeKey({
          id: `artifact-${artifact.id}-attachment-${index}`,
          role: "source",
          kind: isImage ? "image" : "document",
          title: name,
          badge: "User",
          detail: mime,
          target,
          createdAt,
        }),
      );
    });

    list(metadata.files).forEach((raw, index) => {
      const file = record(raw);
      const path = file ? text(file.path) : undefined;
      if (!path) return;
      const isDirectory = text(file?.type) === "directory";
      resources.push(
        withDedupeKey({
          id: `artifact-${artifact.id}-file-${index}`,
          role: "source",
          kind: isDirectory ? "folder" : "file",
          title: basename(path),
          badge: "User",
          detail: path,
          target: { type: "file", value: path },
          createdAt,
        }),
      );
    });

    list(metadata.issues).forEach((raw, index) => {
      const issue = record(raw);
      if (!issue) return;
      const title = text(issue.title);
      if (!title) return;
      const provider = text(issue.provider) ?? "Issue";
      const number = typeof issue.number === "number" ? `#${issue.number} ` : "";
      resources.push(
        withDedupeKey({
          id: `artifact-${artifact.id}-issue-${index}`,
          role: "source",
          kind: "issue",
          title: `${number}${title}`,
          badge: provider,
          createdAt,
        }),
      );
    });

    list(metadata.signals).forEach((raw, index) => {
      const signal = record(raw);
      if (!signal) return;
      const title = text(signal.title);
      if (!title) return;
      resources.push(
        withDedupeKey({
          id: `artifact-${artifact.id}-signal-${index}`,
          role: "source",
          kind: "signal",
          title,
          badge: text(signal.source) ?? "Signal",
          detail: text(signal.level),
          createdAt,
        }),
      );
    });
  }

  return resources;
}

interface PromptPlugin {
  keys: Set<string>;
  name: string;
  displayName?: string;
  iconSource?: string;
  brandColor?: string;
}

function pluginKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s._-]+/g, "");
}

function humanizePluginSlug(slug: string): string {
  return slug
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

/** Plugin identities attached to prompts form the catalog; tool calls prove use. */
function sessionPlugins(
  artifacts: readonly RunArtifact[],
  toolCalls: readonly ToolCall[],
): SessionPlugin[] {
  const catalog: PromptPlugin[] = [];

  for (const artifact of artifacts) {
    if (String(artifact.kind) !== "user-prompt") continue;
    const metadata = record(artifact.metadata) ?? {};
    for (const raw of list(metadata.skills)) {
      const skill = record(raw);
      if (!skill || text(skill.scope)?.toLocaleLowerCase() !== "plugin") continue;
      const name = text(skill.name);
      if (!name) continue;
      const displayName = text(skill.displayName);
      const keys = new Set(
        [name, displayName].filter((value): value is string => !!value).map(pluginKey),
      );
      const existing = catalog.find((plugin) =>
        Array.from(keys).some((key) => plugin.keys.has(key)),
      );
      if (existing) {
        keys.forEach((key) => existing.keys.add(key));
        existing.displayName = displayName ?? existing.displayName;
        existing.iconSource =
          text(skill.iconSmall) ?? text(skill.iconLarge) ?? existing.iconSource;
        existing.brandColor = text(skill.brandColor) ?? existing.brandColor;
        continue;
      }
      catalog.push({
        keys,
        name,
        displayName,
        iconSource: text(skill.iconSmall) ?? text(skill.iconLarge),
        brandColor: text(skill.brandColor),
      });
    }
  }

  const used = new Map<string, SessionPlugin>();
  for (const call of toolCalls) {
    if (call.status === "canceled" || !call.toolName.toLocaleLowerCase().startsWith("mcp__")) {
      continue;
    }
    const vendorId = resolveTool(call.toolName).vendorId;
    if (!vendorId) continue;
    const key = pluginKey(vendorId);
    const plugin = catalog.find((candidate) => candidate.keys.has(key));
    // An MCP call is not necessarily an installed plugin (for example the
    // built-in Mains server). Prompt metadata is the authority for that line.
    if (!plugin) continue;

    const createdAt = timestamp(call.createdAt);
    const existing = used.get(key);
    if (existing) {
      existing.callCount += 1;
      existing.createdAt = Math.max(existing.createdAt, createdAt);
      continue;
    }
    used.set(key, {
      id: `plugin-${key}`,
      slug: vendorId,
      title: plugin.displayName || humanizePluginSlug(vendorId) || plugin.name,
      iconSource: plugin.iconSource,
      brandColor: plugin.brandColor,
      callCount: 1,
      createdAt,
    });
  }

  return Array.from(used.values()).sort(
    (a, b) => b.createdAt - a.createdAt || a.title.localeCompare(b.title),
  );
}

function isWebTool(toolName: string): boolean {
  const key = toolName.toLocaleLowerCase().replace(/[^a-z]/g, "");
  return (
    key.includes("websearch") ||
    key.includes("webfetch") ||
    key.includes("webrun") ||
    key.includes("browser")
  );
}

function collectWebInput(value: unknown): { urls: string[]; queries: string[] } {
  const urls: string[] = [];
  const queries: string[] = [];
  const queryKeys = new Set(["q", "query", "queries"]);

  const visit = (next: unknown, key = "", depth = 0) => {
    if (depth > 6 || next == null) return;
    if (typeof next === "string") {
      const trimmed = next.trim();
      if (/^https?:\/\//i.test(trimmed)) urls.push(trimmed);
      else if (queryKeys.has(key) && trimmed) queries.push(trimmed);
      return;
    }
    if (Array.isArray(next)) {
      next.forEach((item) => visit(item, key, depth + 1));
      return;
    }
    const object = record(next);
    if (!object) return;
    Object.entries(object).forEach(([childKey, child]) =>
      visit(child, childKey.toLocaleLowerCase(), depth + 1),
    );
  };

  visit(value);
  return { urls, queries };
}

function webResources(toolCalls: readonly ToolCall[]): SessionResource[] {
  const resources: SessionResource[] = [];
  const queries = new Set<string>();
  let newestSearchAt = 0;

  for (const call of toolCalls) {
    if (!isWebTool(call.toolName) || call.status === "error" || call.status === "canceled") {
      continue;
    }
    const createdAt = timestamp(call.createdAt);
    const input = collectWebInput(call.input);
    for (const query of input.queries) {
      queries.add(query);
      newestSearchAt = Math.max(newestSearchAt, createdAt);
    }
    input.urls.forEach((url, index) => {
      resources.push(
        withDedupeKey({
          id: `tool-${call.id}-url-${index}`,
          role: "source",
          kind: "url",
          title: urlTitle(url),
          badge: "Web",
          detail: url,
          target: { type: "url", value: url },
          createdAt,
        }),
      );
    });
  }

  if (queries.size > 0) {
    resources.push(
      withDedupeKey({
        id: "web-research",
        role: "source",
        kind: "search",
        title: "Web research",
        badge: `${queries.size} ${queries.size === 1 ? "search" : "searches"}`,
        detail: Array.from(queries).join(" · "),
        createdAt: newestSearchAt,
      }),
    );
  }

  return resources;
}

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;

function trimUrlPunctuation(value: string): string {
  let result = value.replace(/[.,;:!?]+$/, "");

  // Markdown and prose often leave a closing bracket immediately after a URL.
  // Keep balanced brackets that genuinely belong to the URL path, but peel off
  // unmatched punctuation from the end.
  const pairs = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const;
  for (const [opening, closing] of pairs) {
    while (
      result.endsWith(closing) &&
      result.split(closing).length > result.split(opening).length
    ) {
      result = result.slice(0, -1);
    }
  }

  return result;
}

/** Links written into either side of the conversation are useful references
 * even when they were not the direct input to a web tool. */
function conversationLinkResources(
  artifacts: readonly RunArtifact[],
): SessionResource[] {
  const resources: SessionResource[] = [];

  for (const artifact of artifacts) {
    const kind = String(artifact.kind);
    if (kind !== "report" && kind !== "user-prompt") continue;
    const content = artifact.content;
    if (!content) continue;
    const metadata = record(artifact.metadata) ?? {};
    const isAssistantMessage =
      kind === "report" && text(metadata.source) === "assistant.message";
    if (kind === "report" && !isAssistantMessage) continue;

    Array.from(content.matchAll(HTTP_URL_PATTERN)).forEach((match, index) => {
      const url = trimUrlPunctuation(match[0]);
      if (!url) return;
      resources.push(
        withDedupeKey({
          id: `artifact-${artifact.id}-link-${index}`,
          role: "source",
          kind: "url",
          title: urlTitle(url),
          badge: kind === "user-prompt" ? "User" : "Chat",
          detail: url,
          target: { type: "url", value: url },
          createdAt: timestamp(artifact.createdAt),
        }),
      );
    });
  }

  return resources;
}

function deliverableResources(artifacts: readonly RunArtifact[]): SessionResource[] {
  const documentPaths = artifacts
    .filter((artifact) => String(artifact.kind) === "document")
    .map((artifact) => artifact.path ?? text(record(artifact.metadata)?.path))
    .filter((path): path is string => !!path);
  const resources: SessionResource[] = [];

  for (const artifact of artifacts) {
    const kind = String(artifact.kind);
    if (!OUTPUT_KINDS.has(kind)) continue;
    const metadata = record(artifact.metadata) ?? {};
    const path = artifact.path ?? text(metadata.path);
    if (!path) continue;
    if (kind === "image" && isDocumentRenderImage(path, documentPaths)) continue;

    const title = text(metadata.fileName) ?? basename(path);
    const resourceKind = kind as Extract<
      SessionResourceKind,
      "file" | "image" | "document" | "visualization"
    >;
    const resource = withDedupeKey({
      id: `artifact-${artifact.id}`,
      role: "deliverable",
      kind: resourceKind,
      title,
      badge: kind === "visualization" ? "Interactive" : extension(title),
      detail: path,
      target:
        kind === "image"
          ? { type: "image", value: path }
          : { type: "file", value: path },
      createdAt: timestamp(artifact.createdAt),
    });
    // Agents commonly emit draft/render/final copies under different folders
    // with the same display name. The shelf represents the latest usable
    // deliverable, not every intermediate location from the transcript.
    resources.push({
      ...resource,
      dedupeKey: `deliverable:${deliverableDedupeKey(title)}`,
    });
  }

  return resources;
}

/**
 * The managed execution directory is the authority for workspace-less output:
 * it catches files created through Write, shell commands, and provider-native
 * tools even when no explicit artifact event was emitted.
 */
function executionFileResources(
  files: readonly RunOutputFile[],
): SessionResource[] {
  const documentPaths = files
    .filter((file) => classifyDocType(file.absolutePath) !== null)
    .map((file) => file.absolutePath);
  const documentStems = new Set(
    files
      .map((file) => documentBundleStem(file.fileName))
      .filter((stem): stem is string => !!stem),
  );
  const resources: SessionResource[] = [];

  for (const file of files) {
    if (isDocumentBundleSidecar(file.fileName, documentStems)) continue;
    const ext = extension(file.fileName).toLocaleLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(ext);
    if (isImage && isDocumentRenderImage(file.absolutePath, documentPaths)) {
      continue;
    }

    const kind: Extract<
      SessionResourceKind,
      "file" | "image" | "document"
    > = isImage
      ? "image"
      : classifyDocType(file.absolutePath)
        ? "document"
        : "file";
    const resource = withDedupeKey({
      id: `output-${file.relativePath}`,
      role: "deliverable",
      kind,
      title: file.fileName,
      badge: extension(file.fileName),
      detail:
        file.relativePath === file.fileName ? undefined : file.relativePath,
      target: isImage
        ? { type: "image", value: file.absolutePath }
        : { type: "file", value: file.absolutePath },
      createdAt: file.modifiedAt,
    });
    resources.push({
      ...resource,
      dedupeKey: `deliverable:${deliverableDedupeKey(file.fileName)}`,
    });
  }

  return resources;
}

/** Keep the newest sighting of a canonical resource, then order newest-first. */
function dedupe(resources: SessionResource[]): SessionResource[] {
  const indexed = resources.map((resource, index) => ({ resource, index }));
  const winnerByKey = new Map<string, (typeof indexed)[number]>();

  for (const candidate of indexed) {
    const winner = winnerByKey.get(candidate.resource.dedupeKey);
    if (
      !winner ||
      candidate.resource.createdAt > winner.resource.createdAt ||
      (candidate.resource.createdAt === winner.resource.createdAt &&
        candidate.index > winner.index)
    ) {
      winnerByKey.set(candidate.resource.dedupeKey, candidate);
    }
  }

  return indexed
    .filter(
      (candidate) =>
        winnerByKey.get(candidate.resource.dedupeKey)?.index === candidate.index,
    )
    .sort(
      (a, b) =>
        b.resource.createdAt - a.resource.createdAt || a.index - b.index,
    )
    .map(({ resource }) => resource);
}

/**
 * Pure projection of the three persisted run ledgers into the compact session
 * shelf. It never mutates those ledgers: Sources are inputs/references;
 * Deliverables are agent-created files and media.
 */
export function buildSessionResources(args: {
  context: readonly RunContext[];
  artifacts: readonly RunArtifact[];
  toolCalls: readonly ToolCall[];
  outputFiles?: readonly RunOutputFile[];
}): SessionResources {
  const artifactDeliverables = deliverableResources(args.artifacts);
  const artifactFileNames = new Set(
    artifactDeliverables.map((resource) =>
      resource.title.normalize("NFKC").toLocaleLowerCase(),
    ),
  );
  const discoveredDeliverables = executionFileResources(
    args.outputFiles ?? [],
  ).filter(
    (resource) =>
      !artifactFileNames.has(
        resource.title.normalize("NFKC").toLocaleLowerCase(),
      ),
  );

  return {
    sources: dedupe([
      ...contextResources(args.context),
      ...promptResources(args.artifacts),
      ...webResources(args.toolCalls),
      ...conversationLinkResources(args.artifacts),
    ]),
    plugins: sessionPlugins(args.artifacts, args.toolCalls),
    // Explicit artifacts keep their richer kind/metadata. Directory discovery
    // fills only the gaps, including files created by shell commands.
    deliverables: dedupe([
      ...discoveredDeliverables,
      ...artifactDeliverables,
    ]),
  };
}
