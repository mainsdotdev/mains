import { memo, useMemo, useState, useEffect, useRef, type MouseEvent } from "react";
import { AgentMarkdown } from "@/components/agent-markdown";
import type { EventGroup } from "../../lib/group-events";
import { Code } from "@/components/ui/icons/space";
import {
  Picture,
  Document,
  Codex,
  External,
  ArrowUp,
  Finder,
  Mains,
} from "@/components/ui/icons";
import { ProviderIcon } from "../provider-icon";
import { ImagePreviewModal } from "../image-preview-modal";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  Text,
} from "@/components/ui";
import { useLazyGetAppsForFileQuery } from "@/lib/redux/api";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { spaceUserMessageBackground } from "@/lib/space-themes";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { useCapabilities } from "@/lib/platform";
import { DocumentArtifact } from "@/features/workspace/components/tools/document-artifact";
import { ImageGenerationLoader } from "@/features/workspace/components/tools/image-generation-loader";
import { classifyDocType, type DocType } from "@/lib/document-viewer";
import { useSmoothText } from "../../hooks/use-smooth-text";
import {
  PromptMarkdown,
  promptMessageMentionsFile,
  type PromptMarkdownSkill,
} from "../prompt-markdown";

const IMAGE_PATH_REGEX = /([~/]?[\w./-]+\.(?:png|jpe?g|webp|gif))\b/gi;

function extractImagePaths(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(IMAGE_PATH_REGEX)) {
    const p = m[1];
    if (!p || p.includes("://")) continue;
    const idx = m.index ?? 0;
    const before = text.slice(Math.max(0, idx - 12), idx);
    if (before.includes("://")) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function resolveImagePath(
  rawPath: string,
  workspaceRoot?: string,
): string | null {
  if (!rawPath) return null;
  if (rawPath.startsWith("~")) return rawPath;
  if (rawPath.startsWith("/")) return rawPath;
  if (!workspaceRoot) return null;
  const sep = workspaceRoot.endsWith("/") ? "" : "/";
  return `${workspaceRoot}${sep}${rawPath}`;
}

interface InfoGroupProps {
  group: EventGroup;
  workspaceRootPath?: string;
}

function InfoGroupImpl({ group, workspaceRootPath }: InfoGroupProps) {
  const event = group.events[0];
  const [previewAtt, setPreviewAtt] = useState<{
    name: string;
    dataUrl: string;
  } | null>(null);
    // User bubble is tinted from the space theme at runtime, so it can't be a
  // static Tailwind class; null keeps the neutral fallback classes.
  const { activeSpace } = useActiveSpace();
  const { darkMode } = useDarkMode();
  const userBubbleBg = spaceUserMessageBackground(
    activeSpace?.themeConfig ?? null,
    darkMode,
  );
  if (!event) return null;

  if (event.type === "artifact" && event.metadata?.kind === "user-prompt") {
    const message = (event.content ?? "").trim();
    const isReview = event.metadata?.isReview === true;
    const issues = (event.metadata?.issues ?? []) as Array<{
      provider: string;
      number?: number | null;
      title: string;
    }>;
    const signals = (event.metadata?.signals ?? []) as Array<{
      source: string;
      level: string;
      title: string;
    }>;
    const files = (
      (event.metadata?.files ?? []) as Array<{ path: string }>
    ).map((f) => {
      const lastSlash = f.path.lastIndexOf("/");
      const fileName = f.path.substring(lastSlash + 1);
      const dir = f.path.substring(0, lastSlash);
      const parentSlash = dir.lastIndexOf("/");
      const parent = dir.substring(parentSlash + 1);
      return {
        fullPath: f.path,
        basename: fileName,
        displayName: parent ? `${parent}/${fileName}` : fileName,
      };
    });
    const attachments = (event.metadata?.attachments ?? []) as Array<{
      name: string;
      type: "image" | "document";
      mimeType: string;
      dataUrl?: string;
      captureName?: string;
      sourcePath?: string;
    }>;
    const skills = (event.metadata?.skills ?? []) as PromptMarkdownSkill[];

    if (isReview) {
      const reviewTarget = event.metadata?.reviewTarget as string | undefined;
      const targetLabel =
        reviewTarget === "uncommittedChanges"
          ? "Uncommitted Changes"
          : reviewTarget === "baseBranch"
            ? "Branch Diff"
            : reviewTarget === "commit"
              ? "Commit"
              : "Code";

      return (
        <div className="w-full overflow-hidden">
          <div className="w-full py-2 flex justify-end">
          <div
              className="px-3.5 py-2 rounded-2xl bg-primary-50 dark:bg-primary/5"
              style={
                userBubbleBg ? { backgroundColor: userBubbleBg } : undefined
              }
            >              <div className="px-4 py-2 rounded-2xl bg-accent/10 dark:bg-accent/10 border border-accent/60 dark:border-accent/10">
                <div className="flex items-center gap-2 text-accent">
                  <Codex className="size-3.5 shrink-0" />
                  <div className="flex items-center gap-1.5">
                    <Text as="span" size="xs" tone="inherit">
                      {targetLabel}
                    </Text>
                  </div>
                </div>
                {message && (
                  <Text size="xs" tone="inherit" className="text-accent mt-1.5">
                    {message}
                  </Text>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    const externalFiles = files.filter(
      (file) => !promptMessageMentionsFile(message, file.fullPath),
    );
    return (
      <div className="w-full overflow-hidden">
        <div className="w-full py-2 flex justify-end">
          <div className="flex min-w-0 max-w-[80%] flex-col items-end gap-2">
            <div className="min-w-0 max-w-full px-3.5 py-2 rounded-2xl bg-primary-50 dark:bg-primary/5">
              <div className="prose prose-sm dark:prose-invert max-w-none text-left">
                <PromptMarkdown skills={skills} files={files}>
                  {message}
                </PromptMarkdown>
              </div>
            </div>
            {previewAtt && (
              <ImagePreviewModal
                name={previewAtt.name}
                src={previewAtt.dataUrl}
                onClose={() => setPreviewAtt(null)}
              />
            )}
            {(externalFiles.length > 0 ||
              attachments.length > 0 ||
              issues.length > 0 ||
              signals.length > 0) && (
              <div className="flex flex-wrap gap-1.5 justify-end">
                {issues.map((issue) => (
                  <div
                    key={`${issue.provider}-${issue.number ?? issue.title}`}
                    className={`flex items-center gap-1.5 px-2 py-2 rounded-xl text-xs bg-primary-200/40 dark:bg-primary-200/20 text-primary-800 dark:text-primary-200`}
                  >
                    <ProviderIcon
                      provider={issue.provider}
                      className="w-3 h-3"
                      fallback="text"
                    />
                    <span className="truncate max-w-60">
                      {issue.number ? `#${issue.number} ` : ""}
                      {issue.title}
                    </span>
                  </div>
                ))}
                {signals.map((signal) => (
                  <div
                    key={`${signal.source}-${signal.title}`}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-xl text-xs bg-primary-200 dark:bg-primary-400 text-primary-600 dark:text-primary-400"
                  >
                    <ProviderIcon
                      provider={signal.source}
                      className="w-3 h-3"
                      fallback="text"
                    />
                    <span className="truncate max-w-60">{signal.title}</span>
                  </div>
                ))}
                {externalFiles.map((file) => (
                  <div
                    key={file.fullPath}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-primary-200/40 dark:bg-primary-200/20 text-xs text-primary-800 dark:text-primary-200"
                    title={file.fullPath}
                  >
                    <Code className="size-3 dark:text-primary-300 text-primary-700" />
                    <Text as="span" size="inherit" tone="muted">
                      {file.displayName}
                    </Text>
                  </div>
                ))}
                {attachments.map((att) => {
                  const imgSrc =
                    att.dataUrl ||
                    (att.captureName
                      ? `mains-capture://cap/${att.captureName}`
                      : undefined);
                  return att.type === "image" && imgSrc ? (
                    <Button
                      key={att.name}
                      onClick={() =>
                        setPreviewAtt({ name: att.name, dataUrl: imgSrc })
                      }
                      className="flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-xl bg-primary-200/40 dark:bg-primary-200/20 text-xs text-primary-800 dark:text-primary-200 hover:bg-primary-100 dark:hover:bg-primary-700/30 transition-colors cursor-pointer"
                      title={`Click to preview · ${att.name}`}
                    >
                      <img
                        src={imgSrc}
                        alt={att.name}
                        className="h-6 w-6 rounded-lg object-cover  border border-primary-200/60 dark:border-primary-700/40"
                      />
                      <Text as="span" size="inherit" tone="muted" className="truncate max-w-40">
                        {att.name}
                      </Text>
                    </Button>
                  ) : (
                    <div
                      key={att.name}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary-50 dark:bg-primary-700/10 text-xs"
                      title={att.name}
                    >
                      {att.type === "image" ? (
                        <Picture className="size-3 dark:text-primary-300 text-primary-700" />
                      ) : (
                        <Document className="size-3 dark:text-primary-300 text-primary-700" />
                      )}
                      <Text as="span" size="inherit" tone="muted">
                        {att.name}
                      </Text>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  //TODO: Show SDK user messages
  if (event.type === "log" && event.metadata?.level === "sdk-user") {
    return <div className="display-none" />;
  }

  if (event.type === "artifact" && event.metadata?.kind === "image") {
    // Consecutive image artifacts arrive merged into one group (see
    // `groupEvents`) — a single image keeps the file-card layout, several
    // render side by side as a gallery of tiles.
    const images = group.events
      .filter(
        (e) => e.type === "artifact" && e.metadata?.kind === "image",
      )
      .map((e) => {
        const absPath = (e.metadata?.path as string | undefined) ?? "";
        return {
          absPath,
          fileName:
            (e.metadata?.fileName as string | undefined) ??
            absPath.split("/").pop() ??
            "image",
        };
      })
      .filter((img) => img.absPath);
    if (images.length === 0) return null;
    return (
      <div className="overflow-hidden">
        {images.length === 1 ? (
          <ImageArtifact
            key={images[0].absPath}
            absPath={images[0].absPath}
            fileName={images[0].fileName}
            onPreview={setPreviewAtt}
          />
        ) : (
          <div
            className={`grid gap-2 ${
              images.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"
            }`}
          >
            {images.map((img) => (
              <ImageArtifact
                key={img.absPath}
                absPath={img.absPath}
                fileName={img.fileName}
                onPreview={setPreviewAtt}
                variant="tile"
              />
            ))}
          </div>
        )}
        {previewAtt && (
          <ImagePreviewModal
            name={previewAtt.name}
            src={previewAtt.dataUrl}
            onClose={() => setPreviewAtt(null)}
          />
        )}
      </div>
    );
  }

  if (event.type === "artifact" && event.metadata?.kind === "image_generation") {
    return <ImageGenerationLoader startedAt={event.timestamp} />;
  }

  if (event.type === "artifact" && event.metadata?.kind === "document") {
    const absPath = (event.metadata?.path as string | undefined) ?? "";
    if (!absPath) return null;
    const fileName =
      (event.metadata?.fileName as string | undefined) ??
      absPath.split("/").pop() ??
      "document";
    const docType =
      (event.metadata?.docType as DocType | undefined) ?? classifyDocType(fileName);
    if (!docType) return null;
    return (
      <div className="overflow-hidden">
        <DocumentArtifact absPath={absPath} fileName={fileName} docType={docType} />
      </div>
    );
  }

  if (event.type === "artifact") {
    const content = event.content;
    const isStreaming = event.metadata?.streaming === true;

    return (
      <ArtifactBody
        content={content}
        isStreaming={isStreaming}
        previewAtt={previewAtt}
        onPreview={setPreviewAtt}
        workspaceRootPath={workspaceRootPath}
      />
    );
  }

  // A warning or an error is the one kind of log the reader has to notice, so
  // it does not wear the same recessive tone as the rest of the system chrome.
  const logLevel = event.type === "log" ? event.metadata?.level : undefined;
  const tone =
    logLevel === "error" ? "danger" : logLevel === "warn" ? "warning" : "subtle";

  return (
    <div className="py-1.5 flex items-start gap-2">
      <Text as="span" tone={tone}>
        {event.content}
      </Text>
    </div>
  );
}

function ImageArtifact({
  absPath,
  fileName,
  onPreview,
  variant = "card",
}: {
  absPath: string;
  fileName: string;
  onPreview: (att: { name: string; dataUrl: string }) => void;
  /** `card` = full-width file row; `tile` = compact gallery cell for multi-image groups. */
  variant?: "card" | "tile";
}) {
  const url = useLocalImageUrl(absPath);
  const { revealInFolder } = useCapabilities();
  const [thumbFailed, setThumbFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const [fetchApps, { data: handlerApps = [], isFetching }] =
    useLazyGetAppsForFileQuery();

  const ext = fileName.includes(".")
    ? (fileName.split(".").pop() ?? "").toUpperCase()
    : "";

  useEffect(() => {
    if (menuOpen) {
      void fetchApps(absPath);
    }
  }, [menuOpen, absPath, fetchApps]);

  const openInMains = () => {
    if (!url) return;
    setMenuOpen(false);
    onPreview({ name: fileName, dataUrl: url });
  };

  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (openBtnRef.current) {
      const r = openBtnRef.current.getBoundingClientRect();
      const menuWidth = 240;
      setMenuPos({
        x: Math.max(8, r.right - menuWidth),
        y: r.bottom + 6,
      });
    }
    setMenuOpen(true);
  };

  const openWithBundle = (bundleId: string) => {
    setMenuOpen(false);
    void window.api.shell.openFileWithBundle(absPath, bundleId);
  };

  const showInFinder = () => {
    setMenuOpen(false);
    void window.api.shell.showItemInFolder(absPath);
  };

  const menu = (
    <DropdownMenu
      isOpen={menuOpen}
      aria-label="Image actions"
      position={menuPos}
      onClose={() => setMenuOpen(false)}
      minWidth={240}
      origin="top-right"
    >
      <DropdownMenuItem onClick={openInMains}>
        <Mains className="size-4 shrink-0" />
        Show Image
      </DropdownMenuItem>
      {revealInFolder && (
        <DropdownMenuItem onClick={showInFinder}>
          <Finder className="size-4 shrink-0" />
          Show in Finder
        </DropdownMenuItem>
      )}
      {isFetching ? (
        <Text as="div" size="xs" tone="subtle" className="px-3 py-2">
          Loading applications…
        </Text>
      ) : (
        handlerApps.map((app) => (
          <DropdownMenuItem
            key={app.bundleId}
            onClick={() => openWithBundle(app.bundleId)}
          >
            {app.icon ? (
              <img
                src={app.icon}
                alt=""
                draggable={false}
                className="size-4 shrink-0 rounded-sm"
              />
            ) : (
              <External className="size-4 shrink-0 opacity-70" />
            )}
            <span className="truncate">{app.name}</span>
          </DropdownMenuItem>
        ))
      )}
    </DropdownMenu>
  );

  if (variant === "tile") {
    return (
      <div
        className="group/image-tile my-4 relative overflow-hidden rounded-3xl bg-primary-50 dark:bg-primary-900/85 shadow-sm"
        title={absPath}
      >
        <Button
          type="button"
          onClick={openInMains}
          className="block w-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          aria-label={`Preview ${fileName} in Mains`}
        >
          <div className="aspect-4/3 w-full flex items-center justify-center overflow-hidden">
            {url && !thumbFailed ? (
              <img
                src={url}
                alt={fileName}
                className="size-full object-cover"
                loading="lazy"
                draggable={false}
                onError={() => setThumbFailed(true)}
              />
            ) : (
              <Picture className="size-7 text-primary-600 dark:text-primary-400" />
            )}
          </div>
        </Button>
        <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-6 bg-linear-to-t from-black/60 to-transparent opacity-0 group-hover/image-tile:opacity-100 transition-opacity pointer-events-none">
          <Text as="span" size="xs" tone="inherit" className="block text-white truncate">
            {fileName}
          </Text>
        </div>
        <Button
          ref={openBtnRef}
          type="button"
          onClick={openMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white bg-black/50 hover:bg-black/70 opacity-0 group-hover/image-tile:opacity-100 transition-opacity cursor-pointer"
        >
          Open
          <ArrowUp className="size-3 rotate-180" />
        </Button>
        {menu}
      </div>
    );
  }

  return (
    <div
      className="relative flex items-center gap-3 w-full max-w-xl rounded-2xl bg-primary-50 dark:bg-primary-900/85 px-3 py-2.5 shadow-sm"
      title={absPath}
    >
      <Button
        type="button"
        onClick={openInMains}
        className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary-400 overflow-hidden"
        aria-label={`Preview ${fileName} in Mains`}
      >
        <div className="size-10 rounded-lg border border-primary-700/40 dark:border-primary-600/30 bg-primary-900 dark:bg-primary-950/80 flex items-center justify-center overflow-hidden">
          {url && !thumbFailed ? (
            <img
              src={url}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              draggable={false}
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <Picture className="size-5 text-primary-100 dark:text-primary-200" />
          )}
        </div>
      </Button>
      <Button
        type="button"
        onClick={openInMains}
        className="flex-1 min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-400 rounded-md"
      >
        <Text as="div" tone="contrast" weight="medium" className="truncate">
          {fileName}
        </Text>
        <Text as="div" size="xs" tone="subtle" className="mt-0.5">
          Image{ext ? ` · ${ext}` : ""}
        </Text>
      </Button>
      <Button
        ref={openBtnRef}
        type="button"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-primary-800 dark:text-primary-200  bg-primary-100/80 dark:bg-primary-800/40 hover:bg-primary-200/60 dark:hover:bg-primary-700/35 transition-colors cursor-pointer"
      >
        Open
        <ArrowUp className="size-3.5  rotate-180" />
      </Button>
      {menu}
    </div>
  );
}

function InlineMarkdownImage({
  abs,
  name,
  onPreview,
  onError,
}: {
  abs: string;
  name: string;
  onPreview: (att: { name: string; dataUrl: string }) => void;
  onError: () => void;
}) {
  const url = useLocalImageUrl(abs);
  if (!url) return null;
  return (
    <Button
      type="button"
      onClick={() => onPreview({ name, dataUrl: url })}
      className="block w-full overflow-hidden rounded-xl glass-surface cursor-pointer"
      title={abs}
    >
      <img
        src={url}
        alt={name}
        className="w-full max-h-120 object-contain"
        loading="lazy"
        onError={onError}
      />
    </Button>
  );
}

function ArtifactBody({
  content,
  isStreaming,
  previewAtt,
  onPreview,
  workspaceRootPath,
}: {
  content: string;
  isStreaming: boolean;
  previewAtt: { name: string; dataUrl: string } | null;
  onPreview: (att: { name: string; dataUrl: string } | null) => void;
  workspaceRootPath?: string;
}) {
  // Bursty SDK chunks are revealed a few characters per frame so the text
  // flows instead of popping in chunk-sized jumps. Instant when not streaming.
  const displayContent = useSmoothText(content, isStreaming);

  const resolvedImages = useMemo(() => {
    const out: Array<{ key: string; raw: string; abs: string; name: string }> =
      [];
    const seen = new Set<string>();
    for (const raw of extractImagePaths(displayContent)) {
      const abs = resolveImagePath(raw, workspaceRootPath);
      if (!abs || seen.has(abs)) continue;
      seen.add(abs);
      out.push({ key: abs, raw, abs, name: raw.split("/").pop() ?? raw });
    }
    return out;
  }, [displayContent, workspaceRootPath]);

  // Track images whose load failed so we hide them instead of leaving a
  // broken icon. The extractor pulls path-like substrings from the markdown,
  // resolves them against the workspace root, and renders an <img> for each;
  // when the file doesn't actually live there (codex saves to ~/.codex/…
  // etc.) the protocol returns 404 and the browser falls back to a broken
  // image glyph. Mirrors ImageArtifact's onError behavior.
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const visibleImages = resolvedImages.filter(
    (img) => !failedImages.has(img.key),
  );

  return (
    <div className="overflow-hidden">
      <div className="prose prose-sm dark:prose-invert max-w-none relative">
        <AgentMarkdown className={isStreaming ? "streaming-text" : undefined}>
          {displayContent}
        </AgentMarkdown>
      </div>
      {visibleImages.length > 0 && (
        <div className="mt-3 flex flex-col gap-3">
          {visibleImages.map(({ key, abs, name }) => (
            <InlineMarkdownImage
              key={key}
              abs={abs}
              name={name}
              onPreview={onPreview}
              onError={() =>
                setFailedImages((prev) => {
                  if (prev.has(key)) return prev;
                  const next = new Set(prev);
                  next.add(key);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
      {previewAtt && (
        <ImagePreviewModal
          name={previewAtt.name}
          src={previewAtt.dataUrl}
          onClose={() => onPreview(null)}
        />
      )}
    </div>
  );
}

/**
 * Memoized so a streamed token re-renders only the changed message, not every
 * historical one. Relies on `reconcileEventGroups` keeping `group` referentially
 * stable for unchanged groups (see `group-events.ts`).
 */
export const InfoGroup = memo(InfoGroupImpl);
