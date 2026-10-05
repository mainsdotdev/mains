import {
  memo,
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
  type MouseEvent,
} from "react";
import { AgentMarkdown } from "@/components/agent-markdown";
import type { EventGroup } from "../../lib/group-events";
import { Code } from "@/components/ui/icons/space";
import {
  Picture,
  FileIconComponent,
  Codex,
  External,
  ArrowUp,
  Finder,
  Mains,
} from "@/components/ui/icons";
import { ProviderIcon } from "../provider-icon";
import { ImagePreviewModal } from "../image-preview-modal";
import { Button, DropdownMenu, DropdownMenuItem, Text, toast } from "@/components/ui";
import { appApi } from "@/lib/transport";
import { useAttachmentImage } from "../../lib/attachment-image";
import { AttachmentImagePreview } from "../attachment-image-preview";
import { useLazyGetAppsForFileQuery } from "@/lib/redux/api";
import { useLocalImageUrl } from "@/hooks/use-local-image-url";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { useCapabilities } from "@/lib/platform";
import { DocumentArtifact } from "@/features/workspace/components/tools/document-artifact";
import { ImageGenerationLoader } from "@/features/workspace/components/tools/image-generation-loader";
import { VisualizationArtifact } from "@/features/workspace/components/tools/visualization-artifact";
import { classifyDocType, type DocType } from "@/lib/document-viewer";
import { useSmoothText } from "../../hooks/use-smooth-text";
import {
  PromptMarkdown,
  promptMessageMentionsFile,
  type PromptMarkdownSkill,
} from "../prompt-markdown";
import type { BrowserAnnotation } from "@mains/contracts/browser-annotations";
import { readReviewComments } from "@mains/contracts/review-comments";
import { ReviewCommentsAttachment } from "../review-comments-attachment";
import { PromptBrowserAnnotations } from "./prompt-browser-annotations";
import { VoiceTaskCard } from "../voice-task-card";
import type { VoiceTaskLink } from "@mains/contracts/realtime";

interface PromptAttachment {
  attachmentId?: string;
  name: string;
  type: "image" | "document";
  mimeType: string;
  dataUrl?: string;
  captureName?: string;
  sourcePath?: string;
  /** The durable copy saved for this turn (absent on older prompts). */
  path?: string;
}

type PromptPreview = { name: string; dataUrl: string; attachmentId?: string; runId?: string };

function PromptPreviewModal({ preview, onClose }: { preview: PromptPreview; onClose: () => void }) {
  return preview.attachmentId && preview.runId
    ? <AttachmentImagePreview runId={preview.runId} attachmentId={preview.attachmentId} name={preview.name} fallbackSrc={preview.dataUrl} onClose={onClose} />
    : <ImagePreviewModal name={preview.name} src={preview.dataUrl} onClose={onClose} />;
}

function PromptImageAttachment({ attachment, runId, onPreview }: {
  attachment: PromptAttachment;
  runId?: string;
  onPreview: (image: PromptPreview) => void;
}) {
  const { observe, src: storedSrc, error: storedError } = useAttachmentImage(runId, attachment.attachmentId);
  const legacy = useLocalImageUrl(attachment.attachmentId ? undefined : (attachment.dataUrl || attachment.path ||
    (attachment.captureName ? `mains-capture://cap/${encodeURIComponent(attachment.captureName)}` : attachment.sourcePath)));
  const src = attachment.attachmentId ? storedSrc : legacy;
  return src || (attachment.attachmentId && runId) ? (
    <Button
      ref={observe}
      type="button"
      onClick={() => onPreview({ name: attachment.name, dataUrl: src ?? "", attachmentId: attachment.attachmentId, runId })}
      className="size-20 shrink-0 overflow-hidden rounded-2xl border border-primary-200 dark:border-primary-800 cursor-pointer outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent"
      title={`Click to preview · ${attachment.name}`}
      aria-label={`Preview ${attachment.name}`}
    >
      {src ? <img src={src} alt={attachment.name} draggable={false} className="size-full object-cover" />
        : <span className="flex size-full items-center justify-center bg-primary-50 dark:bg-primary-900" title={storedError}><Picture className="size-5 text-primary-500" /></span>}
    </Button>
  ) : (
    <div ref={observe} className="flex size-20 shrink-0 items-center justify-center rounded-2xl border border-primary-200 bg-primary-50 dark:border-primary-800 dark:bg-primary-900" title={storedError ?? attachment.name}>
      <Picture className="size-5 text-primary-500" />
    </div>
  );
}

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
  runId?: string;
  workspaceRootPath?: string;
  floatingChat?: boolean;
}

function InfoGroupImpl({ group, runId, workspaceRootPath, floatingChat = false }: InfoGroupProps) {
  const event = group.events[0];
  const [previewAtt, setPreviewAtt] = useState<PromptPreview | null>(null);
  if (!event) return null;
  if (event.type === "artifact" && event.metadata?.kind === "voice-task") {
    const task = event.metadata.voiceTask as VoiceTaskLink | undefined;
    return task && typeof task.id === "string" ? <VoiceTaskCard task={task} /> : null;
  }

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
      (event.metadata?.files ?? []) as Array<{
        path: string;
        type?: "file" | "directory";
      }>
    ).map((f) => {
      const lastSlash = f.path.lastIndexOf("/");
      const fileName = f.path.substring(lastSlash + 1);
      const dir = f.path.substring(0, lastSlash);
      const parentSlash = dir.lastIndexOf("/");
      const parent = dir.substring(parentSlash + 1);
      return {
        fullPath: f.path,
        basename: fileName,
        isDirectory: f.type === "directory",
        displayName: parent ? `${parent}/${fileName}` : fileName,
      };
    });
    const attachments = (event.metadata?.attachments ?? []) as PromptAttachment[];
    const annotations = ((event.metadata?.browserAnnotations ?? []) as BrowserAnnotation[])
      .filter((annotation) => Array.isArray(annotation.elements) && annotation.elements.length > 0);
    const reviewComments = readReviewComments(event.metadata?.reviewComments);
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
            {/* Tinted with the accent, which follows the app theme. */}
            <div className="px-3.5 py-2 rounded-2xl bg-accent/12 dark:bg-accent/15">
              {" "}
              <div className="px-4 py-2 rounded-2xl bg-accent/10 dark:bg-accent/10 border border-accent/60 dark:border-accent/10">
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
    const imageAttachments = attachments.filter((att) => att.type === "image");
    const documentAttachments = attachments.filter(
      (att) => att.type !== "image",
    );
    return (
      <div className="w-full overflow-hidden">
        <div className="w-full py-2 flex justify-end">
          <div className="flex min-w-0 max-w-[80%] flex-col items-end gap-2">
            {!!event.metadata?.voiceDelegation && (
              <Text as="span" size="xs" tone="muted" className="flex items-center gap-1.5">
                <Codex className="size-3" /> Sent from voice conversation
              </Text>
            )}
            {imageAttachments.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                {imageAttachments.map((attachment, index) => (
                  <PromptImageAttachment key={`${attachment.name}-${index}`} attachment={attachment} runId={runId} onPreview={setPreviewAtt} />
                ))}
              </div>
            )}
            {documentAttachments.map((att, index) => (
              <AttachmentDocumentCard
                key={`${att.name}-${index}`}
                name={att.name}
                filePath={att.path}
                runId={runId}
                attachmentId={att.attachmentId}
              />
            ))}
            {annotations.length > 0 && <PromptBrowserAnnotations annotations={annotations} />}
            {reviewComments.length > 0 && <ReviewCommentsAttachment comments={reviewComments} />}
            {message && (
              <div className={`min-w-0 max-w-full px-3.5 py-2 rounded-2xl ${floatingChat ? "bg-primary-200/70" : "bg-primary-50"} dark:bg-primary/5`}>
                <div className="prose prose-sm dark:prose-invert max-w-none text-left">
                  <PromptMarkdown skills={skills} files={files}>
                    {message}
                  </PromptMarkdown>
                </div>
              </div>
            )}
            {previewAtt && (
              <PromptPreviewModal preview={previewAtt} onClose={() => setPreviewAtt(null)} />
            )}
            {(externalFiles.length > 0 ||
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
    // `groupEvents`) — a single image keeps its usual preview, while several
    // share a selected preview and a compact thumbnail rail.
    const images = group.events
      .filter((e) => e.type === "artifact" && e.metadata?.kind === "image")
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
          <ImageArtifactGallery images={images} onPreview={setPreviewAtt} />
        )}
        {previewAtt && (
          <PromptPreviewModal preview={previewAtt} onClose={() => setPreviewAtt(null)} />
        )}
      </div>
    );
  }

  if (
    event.type === "artifact" &&
    event.metadata?.kind === "image_generation"
  ) {
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
      (event.metadata?.docType as DocType | undefined) ??
      classifyDocType(fileName);
    if (!docType) return null;
    return (
      <div className="overflow-hidden">
        <DocumentArtifact
          absPath={absPath}
          fileName={fileName}
          docType={docType}
        />
      </div>
    );
  }

  if (event.type === "artifact" && event.metadata?.kind === "visualization") {
    const absPath = (event.metadata?.path as string | undefined) ?? "";
    if (!absPath) return null;
    const title = event.metadata?.title as string | undefined;
    const mode = event.metadata?.mode === "wide" ? "wide" : undefined;
    return (
      <VisualizationArtifact
        absPath={absPath}
        title={title}
        mode={mode}
      />
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
    logLevel === "error"
      ? "danger"
      : logLevel === "warn"
        ? "warning"
        : "subtle";

  return (
    <div className="py-1.5 flex items-start gap-2">
      <Text as="span" tone={tone}>
        {event.content}
      </Text>
    </div>
  );
}

/**
 * A document attached to a sent prompt: type icon, file name, and type label.
 * Opens in the document viewer when the prompt recorded its on-disk copy and
 * the viewer can render the format.
 */
function AttachmentDocumentCard({
  name,
  filePath,
  runId,
  attachmentId,
}: {
  name: string;
  filePath?: string;
  runId?: string;
  attachmentId?: string;
}) {
  const { open } = useDocumentViewer();
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : undefined;
  const docType = filePath || (runId && attachmentId) ? classifyDocType(name) : null;
  const className =
    "flex w-60 max-w-full glass-card items-center gap-3 rounded-2xl  p-1.5 pr-3  ";
  const content = (
    <>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-950">
        <FileIconComponent
          fileName={name}
          extension={extension}
          className="size-5"
        />
      </div>
      <div className="flex min-w-0 flex-col text-left">
        <Text as="span" size="sm" tone="contrast" className="truncate">
          {name}
        </Text>
        <Text as="span" size="xs" tone="subtle">
          {extension ? extension.toUpperCase() : "Document"}
        </Text>
      </div>
    </>
  );

  if ((!filePath && !(runId && attachmentId)) || !docType) {
    return (
      <div className={className} title={name}>
        {content}
      </div>
    );
  }
  return (
    <Button
      type="button"
      onClick={async () => {
        try {
          let resolved = filePath;
          if (!resolved && runId && attachmentId) {
            const result = await appApi.runArtifacts.resolveAttachmentPath({ runId, attachmentId });
            if (!result.success) throw new Error(result.error);
            resolved = result.data;
          }
          if (resolved) open({ path: resolved, fileName: name, docType });
        } catch (error) { toast.error(error instanceof Error ? error.message : "Could not open attachment"); }
      }}
      className={`${className} cursor-pointer outline-none transition-colors hover:bg-primary-100 focus-visible:ring-2 focus-visible:ring-accent dark:hover:bg-primary-800/60`}
      title={`Open ${name}`}
      aria-label={`Open ${name}`}
    >
      {content}
    </Button>
  );
}

function ImageArtifactGallery({
  images,
  onPreview,
}: {
  images: Array<{ absPath: string; fileName: string }>;
  onPreview: (att: { name: string; dataUrl: string }) => void;
}) {
  const [selectedPath, setSelectedPath] = useState(images[0].absPath);
  const selected = images.find((image) => image.absPath === selectedPath) ?? images[0];
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop > 4;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
    setFade((current) =>
      current.top === top && current.bottom === bottom
        ? current
        : { top, bottom },
    );
  }, []);

  useEffect(() => {
    updateFade();
    const observer = new ResizeObserver(updateFade);
    if (scrollRef.current) observer.observe(scrollRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [updateFade]);

  const mask = `linear-gradient(to bottom, ${
    fade.top ? "transparent, black 3rem" : "black"
  }, ${fade.bottom ? "black calc(100% - 3rem), transparent" : "black"})`;

  return (
    <div className="relative my-4 w-full max-w-165">
      <div className="mr-17 min-w-0 sm:mr-21">
        <ImageArtifact
          key={selected.absPath}
          absPath={selected.absPath}
          fileName={selected.fileName}
          onPreview={onPreview}
          variant="gallery"
        />
      </div>
      <div
        ref={scrollRef}
        role="group"
        aria-label="Generated images"
        onScroll={updateFade}
        className="noscrollbar absolute inset-y-0 right-0 w-14 overflow-y-auto sm:w-18"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      >
        <div ref={contentRef} className="flex flex-col gap-2 p-0.5">
          {images.map((image, index) => (
            <ImageGalleryThumbnail
              key={`${image.absPath}-${index}`}
              image={image}
              index={index}
              total={images.length}
              selected={image.absPath === selected.absPath}
              onSelect={() => setSelectedPath(image.absPath)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ImageGalleryThumbnail({
  image,
  index,
  total,
  selected,
  onSelect,
}: {
  image: { absPath: string; fileName: string };
  index: number;
  total: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const url = useLocalImageUrl(image.absPath);
  const [thumbFailed, setThumbFailed] = useState(false);

  return (
    <Button
      type="button"
      onClick={onSelect}
      aria-label={`Select image ${index + 1} of ${total}: ${image.fileName}`}
      aria-pressed={selected}
      title={image.fileName}
      className={`flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl  transition-colors focus-visible:ring-2 focus-visible:ring-accent/20 ${
        selected
          ? "border border-accent/40 outline-none"
          : "glass-outline"
      }  `}
    >
      {url && !thumbFailed ? (
        <img
          src={url}
          alt=""
          className="size-full object-contain"
          loading="lazy"
          draggable={false}
          onError={() => setThumbFailed(true)}
        />
      ) : (
        <Picture className="size-5 text-primary-500" aria-hidden />
      )}
    </Button>
  );
}

function ImageArtifact({
  absPath,
  fileName,
  onPreview,
  variant = "preview",
}: {
  absPath: string;
  fileName: string;
  onPreview: (att: { name: string; dataUrl: string }) => void;
  /** `gallery` fills the selected-image stage; `preview` keeps the single-image size. */
  variant?: "preview" | "gallery";
}) {
  const url = useLocalImageUrl(absPath);
  const { revealInFolder } = useCapabilities();
  const [thumbFailed, setThumbFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const [fetchApps, { data: handlerApps = [], isFetching }] =
    useLazyGetAppsForFileQuery();

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

  return (
    <div
      className={`group/image-preview relative ${variant === "gallery" ? "w-full" : "my-4 w-fit max-w-full"}`}
      title={absPath}
    >
      <Button
        type="button"
        onClick={openInMains}
        className={`block max-w-full overflow-hidden rounded-3xl outline-none focus-visible:ring-2 focus-visible:ring-accent ${variant === "gallery" ? "w-full bg-primary-50 dark:bg-primary-900/85" : ""}`}
        aria-label={`Preview ${fileName} in Mains`}
      >
        <div className={`flex items-center justify-center overflow-hidden ${variant === "gallery" ? "aspect-square w-full max-h-144" : "max-h-144 max-w-[24rem]"}`}>
          {url && !thumbFailed ? (
            <img
              src={url}
              alt={fileName}
              className={variant === "gallery" ? "block size-full object-contain" : "block h-auto max-h-144 w-auto max-w-full object-contain"}
              loading="lazy"
              draggable={false}
              onError={() => setThumbFailed(true)}
            />
          ) : (
            <div className={`flex items-center justify-center rounded-2xl bg-primary-100/70 dark:bg-primary-900/70 ${variant === "gallery" ? "size-full" : "h-44 w-72"}`}>
              <Picture className="size-7 text-primary-500" />
            </div>
          )}
        </div>
      </Button>
      <Button
        ref={openBtnRef}
        type="button"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Open actions for ${fileName}`}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-lg glass-outline bg-primary-950/20 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-primary-950/50 group-hover/image-preview:opacity-100 group-focus-within/image-preview:opacity-100 focus-visible:opacity-100"
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
