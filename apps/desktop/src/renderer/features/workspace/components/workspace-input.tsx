import {
  useReducer,
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";
import type { CommandInfo, SkillInfo } from "@/lib/redux/api/providersApi";
import type { Run } from "../types";
import type { FileNode } from "@/features/workspace/types/file-explorer";
import type { ContextCodeSelection } from "@/features/workspace/lib/composer-context";
import { useComposerContext } from "../hooks/use-composer-context";
import {
  Button,
  DropdownWrapper,
  RichInputForm,
  type UploadedFile,
  type RichInputFormHandle,
  type RichSkillChipData,
  type RichFileChipData,
  type RichCodeChipData,
} from "@/components/ui";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { useModeConfig } from "@/hooks/use-mode-config";
import { spaceGlowColor, spaceGlowShadow } from "@/lib/space-themes";
import { useIsMobile } from "@/lib/platform";
import { useClickOutside } from "@/hooks/use-click-outside";
import { Chat, Check, Plus } from "@/components/ui/icons";
import {
  UnifiedContextDropdown,
  type UnifiedContextBucket,
  type UnifiedContextTrigger,
} from "@/features/workspace/components/unified-context-dropdown";
import type { IssueWithEntity } from "@/lib/redux/api/entitiesApi";
import { ContextChips } from "./context-chips";
import { InputToolbar } from "./input-toolbar";
import { ContextUsageRing } from "./context-usage-meter";
import {
  ProviderAuthNotice,
  ProviderCliUpdateNotice,
} from "./provider-auth-notice";
import { useContextUsage } from "../hooks/use-context-usage";
import { useProviderModels } from "../hooks/use-provider-models";
import { getProviderVariantById } from "@/lib/provider-variants";
import { useGetProviderAccountInfoQuery } from "@/lib/redux/api";

const EMPTY_UPLOADED_FILES: UploadedFile[] = [];

function looksLikeImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic|svg)$/i.test(file.name);
}

/** Matches toolbar document picker: pdf, doc, docx, txt */
function looksLikeDocumentFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (
    mime === "application/pdf" ||
    mime === "application/msword" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "text/plain"
  ) {
    return true;
  }
  return /\.(pdf|doc|docx|txt)$/i.test(file.name);
}

function isAttachableUpload(file: File): boolean {
  return looksLikeImageFile(file) || looksLikeDocumentFile(file);
}

/**
 * When the dropdown steals focus, caret-based DOM replace fails. Rewrites `goal` by finding
 * the active mention token (same boundary rules as caret detection: start or whitespace before trigger).
 */
function replaceMentionInGoal(
  goal: string,
  trigger: string,
  filter: string,
  replacement: string,
): string | null {
  const suffix = trigger + filter;
  let idx = goal.lastIndexOf(suffix);
  while (idx >= 0) {
    const prev = idx === 0 ? "" : goal[idx - 1];
    if (idx === 0 || /\s/.test(prev)) {
      return goal.slice(0, idx) + replacement + goal.slice(idx + suffix.length);
    }
    idx = goal.lastIndexOf(suffix, idx - 1);
  }
  return null;
}

/** Serialized token identity for a code selection: `<path>#L<start>[-<end>]`. */
function codeSelectionChipKey(sel: ContextCodeSelection): string {
  return sel.startLine === sel.endLine
    ? `${sel.filePath}#L${sel.startLine}`
    : `${sel.filePath}#L${sel.startLine}-${sel.endLine}`;
}

function codeSelectionChipLabel(sel: ContextCodeSelection): string {
  return sel.startLine === sel.endLine
    ? `${sel.fileName}:${sel.startLine}`
    : `${sel.fileName}:${sel.startLine}-${sel.endLine}`;
}

function fileToUploadedFile(file: File): UploadedFile {
  const isImage = looksLikeImageFile(file);
  return {
    file,
    type: isImage ? "image" : "document",
    preview: isImage ? URL.createObjectURL(file) : undefined,
  };
}

interface UnifiedMenuState {
  visible: boolean;
  filter: string;
  trigger: UnifiedContextTrigger;
  /** Set only by toolbar pickers; cleared whenever the menu closes. */
  bucket: UnifiedContextBucket | null;
}

export interface ComposerSendTarget {
  /** Run the next send continues, or null for a new chat. */
  runId: string | null;
  label: string;
  options: Array<{ runId: string | null; label: string }>;
}

interface WorkspaceInputProps {
  goal: string;
  onGoalChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  activeRun: Run | undefined;
  canResume?: boolean;
  providerId?: string;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  /** When set, shows the send-target pill (editor tab): which chat the next send continues. */
  sendTarget?: ComposerSendTarget | null;
  onSendTargetChange?: (runId: string | null) => void;
  workspacePath?: string;
  projectId?: string;
  uploadedFiles?: UploadedFile[];
  onUploadedFilesChange?: (files: UploadedFile[]) => void;
  onStop?: () => void;
  /** When true (e.g. new-run draft tab active), focus the prompt after layout. */
  isNewRunTabActive?: boolean;
  /** Empty-state stack: tighter outer margins so the bar sits vertically centered with the headline. */
  layout?: "default" | "centered";
}

export function WorkspaceInput({
  goal,
  onGoalChange,
  onSubmit,
  isLoading,
  activeRun,
  canResume = false,
  providerId,
  selectedModel: externalSelectedModel,
  onModelChange: externalOnModelChange,
  sendTarget = null,
  onSendTargetChange,
  workspacePath,
  projectId,
  uploadedFiles = EMPTY_UPLOADED_FILES,
  onUploadedFilesChange,
  onStop,
  isNewRunTabActive = false,
  layout = "default",
}: WorkspaceInputProps) {
  const inputRef = useRef<RichInputFormHandle>(null);
  const unifiedContextDropdownRef = useRef<HTMLDivElement>(null);
  const pluginsButtonRef = useRef<HTMLButtonElement>(null);
  const {
    files: contextFiles,
    skills: contextSkills,
    codeSelections: contextCodeSelections,
    add: addContext,
    remove: removeContext,
  } = useComposerContext();

  const spaceProvider = useSpaceProviderVariant();
  const providerVariant = spaceProvider.variant;
  const activeProviderId = providerId ?? spaceProvider.providerId;
    // Empty-state backlight: the centered composer glows in the space's theme
  // hue. Inline because the color is derived from per-space config at runtime.
  const { activeSpace } = useActiveSpace();
  const { darkMode } = useDarkMode();
  const { composerPlaceholder } = useModeConfig();
  const spaceGlow =
    layout === "centered"
      ? spaceGlowColor(activeSpace?.themeConfig ?? null, darkMode)
      : null;
  // Built outside the JSX on purpose: calling the helper inline in `style`
  // makes the React Compiler bail on this component's manual memoization.
  const spaceGlowStyle = spaceGlow
    ? { boxShadow: spaceGlowShadow(spaceGlow, darkMode) }
    : undefined;


  const {
    selectedModelDisplayName,
    modelDisplayNames,
    modelEffortLevelsByDisplayName,
    isLoadingModels,
    isFetchingModels,
    handleModelChange,
    providerCommands,
    providerSkills,
    isLoadingSkills,
    modelsError,
    refetchModels,
    permissionMode,
    handlePermissionModeChange,
    thinkingMode,
    handleThinkingModeToggle,
    fastMode,
    handleFastModeToggle,
    effortLevel,
    handleEffortLevelChange,
    supportsUltracode,
    selectedModelInfo,
    planMode,
    handlePlanModeToggle,
    goalMode,
    handleGoalModeToggle,
  } = useProviderModels(
    activeProviderId,
    providerVariant,
    externalSelectedModel,
    externalOnModelChange,
    workspacePath,
  );

  const contextUsage = useContextUsage(activeRun?.id ?? null);

  // Preflight auth probe: catches "signed out entirely" before the first run
  // is even sent. Refresh-token failures can't be predicted from local state —
  // those surface post-run via the transcript auth notice instead.
  const {
    data: accountInfo,
    refetch: refetchAccountInfo,
    isFetching: isFetchingAccountInfo,
  } = useGetProviderAccountInfoQuery(activeProviderId, {
    skip: !activeProviderId,
    refetchOnFocus: false,
  });
  const providerSignedOut = !!accountInfo && accountInfo.account === null;
  // An unsupported (too-old) CLI also fails the account probe, so it would
  // masquerade as "signed out" — detect it first and offer an update instead.
  const cliHealth = accountInfo?.cli;
  const cliUnsupported = cliHealth?.compatibility === "unsupported";
  // The providerId prop can override the space's provider — resolve the
  // descriptor from the id actually in use.
  const activeDescriptor =
    getProviderVariantById(activeProviderId) ?? spaceProvider;

  // Cmd+P to focus input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isNewRunTabActive) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [isNewRunTabActive]);

  const [unifiedMenu, updateUnifiedMenu] = useReducer(
    (prev: UnifiedMenuState, next: Partial<UnifiedMenuState>) => {
      const merged = { ...prev, ...next };
      return merged.visible ? merged : { ...merged, bucket: null };
    },
    { visible: false, filter: "", trigger: "@", bucket: null },
  );

  // Toolbar plugins picker: opens the "$" menu narrowed to plugins without a
  // token in the text — the chip lands at the caret on select.
  const pluginSkills = useMemo(
    () =>
      providerSkills.filter(
        (skill) => skill.scope === "plugin" && skill.userInvokable !== false,
      ),
    [providerSkills],
  );
  const pluginsMenuOpen = unifiedMenu.visible && unifiedMenu.bucket === "plugins";
  const handleTogglePluginsMenu = useCallback(() => {
    if (pluginsMenuOpen) {
      updateUnifiedMenu({ visible: false, filter: "" });
      return;
    }
    updateUnifiedMenu({ visible: true, filter: "", trigger: "$", bucket: "plugins" });
  }, [pluginsMenuOpen]);

  // Detect @ / context menu when goal is set externally (e.g. quick actions)
  useEffect(() => {
    const slashMatch = goal.match(/(?:^|\s)\/(\S*)$/);
    if (slashMatch) {
      updateUnifiedMenu({ filter: slashMatch[1], visible: true, trigger: "/" });
      inputRef.current?.focus();
      return;
    }
    const atMatch = goal.match(/(?:^|\s)@(\S*)$/);
    if (atMatch) {
      updateUnifiedMenu({ filter: atMatch[1], visible: true, trigger: "@" });
      inputRef.current?.focus();
    }
  }, [goal]);

  const handleGoalChange = useCallback(
    (value: string) => {
      onGoalChange(value);
    },
    [onGoalChange],
  );

  // Triggers fire based on the text BEFORE the caret, so users can insert mentions
  // mid-text — not just at the end of the prompt.
  const handleCaretContext = useCallback((before: string) => {
    const match = before.match(/(?:^|\s)([/@#$])(\S*)$/);
    if (match) {
      updateUnifiedMenu({
        filter: match[2],
        visible: true,
        trigger: match[1] as UnifiedContextTrigger,
        bucket: null,
      });
    } else {
      updateUnifiedMenu({ visible: false, filter: "" });
    }
  }, []);

  const handleSlashCommandSelect = useCallback(
    (command: CommandInfo) => {
      const replacement = `/${command.name} `;
      const t = unifiedMenu.trigger;
      const ok =
        inputRef.current?.replaceTokenWithText(t, replacement) ?? false;
      if (!ok) {
        const next = replaceMentionInGoal(
          goal,
          t,
          unifiedMenu.filter,
          replacement,
        );
        if (next !== null) onGoalChange(next);
      }
      updateUnifiedMenu({ visible: false, filter: "" });
    },
    [goal, onGoalChange, unifiedMenu.filter, unifiedMenu.trigger],
  );

  const handleSkillSelect = useCallback(
    (skill: SkillInfo, trigger: UnifiedContextTrigger) => {
      if (trigger === "#") return; // the issues-only menu never lists skills
      updateUnifiedMenu({ visible: false, filter: "" });
      addContext({
        kind: "skill",
        name: skill.name,
        path: skill.path,
        description: skill.description,
        displayName: skill.displayName,
        shortDescription: skill.shortDescription,
        iconSmall: skill.iconSmall,
        iconLarge: skill.iconLarge,
        brandColor: skill.brandColor,
        scope: skill.scope,
      });
      inputRef.current?.replaceTokenWithSkillChip(trigger, {
        name: skill.name,
        displayName: skill.displayName,
        iconSmall: skill.iconSmall,
        iconLarge: skill.iconLarge,
        brandColor: skill.brandColor,
      });
    },
    [addContext],
  );

  const handleUnifiedSkillSelect = useCallback(
    (skill: SkillInfo) => {
      handleSkillSelect(skill, unifiedMenu.trigger);
    },
    [handleSkillSelect, unifiedMenu.trigger],
  );

  const contextSkillsRef = useRef(contextSkills);
  useEffect(() => {
    contextSkillsRef.current = contextSkills;
  }, [contextSkills]);

  const contextFilesRef = useRef(contextFiles);
  useEffect(() => {
    contextFilesRef.current = contextFiles;
  }, [contextFiles]);

  // When a file is added to context via a non-inline path (file explorer's "Add to context"),
  // there's no `@<path>` token in goal yet — append one so the chip renders and the agent sees
  // the file the same way it sees inline-mentioned ones. Inline picks already write `@<path>`
  // into goal themselves, so the check below skips them.
  const seenContextFilePathsRef = useRef<Set<string>>(
    new Set(contextFiles.map((f) => f.fullPath)),
  );
  useEffect(() => {
    const current = new Set(contextFiles.map((f) => f.fullPath));
    const additions: string[] = [];
    for (const f of contextFiles) {
      if (seenContextFilePathsRef.current.has(f.fullPath)) continue;
      const escaped = f.fullPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`@${escaped}(?![\\w./-])`).test(goal)) continue;
      additions.push(f.fullPath);
    }
    seenContextFilePathsRef.current = current;
    if (additions.length === 0) return;
    const sep = goal.length === 0 || /\s$/.test(goal) ? "" : " ";
    onGoalChange(goal + sep + additions.map((p) => `@${p}`).join(" ") + " ");
  }, [contextFiles, goal, onGoalChange]);

  // Code selections always arrive from outside the input (the code viewer's
  // "Add to chat"), so append their token here — same reveal path as context
  // files added from the file explorer.
  const seenCodeSelectionIdsRef = useRef<Set<string>>(
    new Set(contextCodeSelections.map((s) => s.id)),
  );
  useEffect(() => {
    const current = new Set(contextCodeSelections.map((s) => s.id));
    const additions: string[] = [];
    for (const s of contextCodeSelections) {
      if (seenCodeSelectionIdsRef.current.has(s.id)) continue;
      const key = codeSelectionChipKey(s);
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`@${escaped}(?![\\w-])`).test(goal)) continue;
      additions.push(key);
    }
    seenCodeSelectionIdsRef.current = current;
    if (additions.length === 0) return;
    const sep = goal.length === 0 || /\s$/.test(goal) ? "" : " ";
    onGoalChange(goal + sep + additions.map((k) => `@${k}`).join(" ") + " ");
  }, [contextCodeSelections, goal, onGoalChange]);

  const skillChipMap = useMemo(() => {
    const m = new Map<string, RichSkillChipData>();
    for (const s of contextSkills) {
      m.set(s.name, {
        name: s.name,
        displayName: s.displayName,
        iconSmall: s.iconSmall,
        iconLarge: s.iconLarge,
        brandColor: s.brandColor,
      });
    }
    return m;
  }, [contextSkills]);

  const fileChipMap = useMemo(() => {
    const m = new Map<string, RichFileChipData>();
    for (const f of contextFiles) {
      m.set(f.fullPath, { path: f.fullPath, basename: f.name });
    }
    return m;
  }, [contextFiles]);

  const codeChipMap = useMemo(() => {
    const m = new Map<string, RichCodeChipData>();
    for (const s of contextCodeSelections) {
      const key = codeSelectionChipKey(s);
      m.set(key, {
        key,
        fileName: s.fileName,
        label: codeSelectionChipLabel(s),
      });
    }
    return m;
  }, [contextCodeSelections]);

  const contextCodeSelectionsRef = useRef(contextCodeSelections);
  useEffect(() => {
    contextCodeSelectionsRef.current = contextCodeSelections;
  }, [contextCodeSelections]);

  const handleCodeChipsChange = useCallback(
    (keys: string[]) => {
      const present = new Set(keys);
      for (const sel of contextCodeSelectionsRef.current) {
        if (!present.has(codeSelectionChipKey(sel))) removeContext(sel);
      }
    },
    [removeContext],
  );

  const handleSkillChipsChange = useCallback(
    (names: string[]) => {
      const present = new Set(names);
      for (const skill of contextSkillsRef.current) {
        if (!present.has(skill.name)) removeContext(skill);
      }
    },
    [removeContext],
  );

  const handleFileChipsChange = useCallback(
    (paths: string[]) => {
      const present = new Set(paths);
      for (const file of contextFilesRef.current) {
        if (!present.has(file.fullPath)) removeContext(file);
      }
    },
    [removeContext],
  );

  const handleUnifiedFileSelect = useCallback(
    (node: FileNode) => {
      const t = unifiedMenu.trigger;
      if (t === "#" || t === "$") return; // only the combined @ / menu lists files
      // Attach first so fileChipMap has the entry by the time the sync effect rebuilds the chip
      // from a rewritten goal string in the dropdown-focus fallback path.
      addContext({ kind: "file", ...node });
      const ok =
        inputRef.current?.replaceTokenWithFileChip(t, {
          path: node.fullPath,
          basename: node.name,
        }) ?? false;
      if (!ok) {
        const next = replaceMentionInGoal(
          goal,
          t,
          unifiedMenu.filter,
          `@${node.fullPath} `,
        );
        if (next !== null) onGoalChange(next);
      }
      updateUnifiedMenu({ visible: false, filter: "" });
    },
    [addContext, goal, onGoalChange, unifiedMenu.filter, unifiedMenu.trigger],
  );

  const handleUnifiedIssueSelect = useCallback(
    (item: IssueWithEntity) => {
      const t = unifiedMenu.trigger;
      const ok = inputRef.current?.replaceTokenWithText(t, "") ?? false;
      if (!ok) {
        const next = replaceMentionInGoal(goal, t, unifiedMenu.filter, "");
        if (next !== null) onGoalChange(next);
      }
      updateUnifiedMenu({ visible: false, filter: "" });
      addContext({
        kind: "issue",
        entityId: item.issue.entityId,
        title: item.entity.title,
        body: item.entity.body,
        provider: item.issue.provider,
        number: item.issue.number,
        labels: item.issue.labels,
      });
    },
    [addContext, goal, onGoalChange, unifiedMenu.filter, unifiedMenu.trigger],
  );

  const handleUnifiedFileNavigate = useCallback(
    (dirPath: string) => {
      const t = unifiedMenu.trigger;
      const replacement = `${t}${dirPath}`;
      const ok =
        inputRef.current?.replaceTokenWithText(t, replacement) ?? false;
      if (!ok) {
        const next = replaceMentionInGoal(
          goal,
          t,
          unifiedMenu.filter,
          replacement,
        );
        if (next !== null) onGoalChange(next);
      }
      updateUnifiedMenu({ filter: dirPath });
    },
    [goal, onGoalChange, unifiedMenu.filter, unifiedMenu.trigger],
  );

  const handleSubmit = useCallback(() => {
    if (unifiedMenu.visible) return;
    onSubmit();
  }, [unifiedMenu.visible, onSubmit]);

  const [isFileDragOver, setIsFileDragOver] = useState(false);

  const sendTargetDropdownRef = useRef<HTMLDivElement>(null);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  useClickOutside(sendTargetDropdownRef, () => {
    if (targetMenuOpen) setTargetMenuOpen(false);
  });

  const handleWrapperDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setIsFileDragOver(true);
    },
    [],
  );

  const handleWrapperDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const next = e.relatedTarget as Node | null;
      if (next && e.currentTarget.contains(next)) return;
      setIsFileDragOver(false);
    },
    [],
  );

  const handleWrapperDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handleWrapperDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsFileDragOver(false);
      const merge = onUploadedFilesChange;
      if (!merge) return;
      const files = Array.from(e.dataTransfer.files).filter(isAttachableUpload);
      if (files.length === 0) return;
      const newFiles: UploadedFile[] = files.map(fileToUploadedFile);
      merge([...uploadedFiles, ...newFiles]);
    },
    [uploadedFiles, onUploadedFilesChange],
  );

  const isMobile = useIsMobile();
  const inputPlaceholder = useMemo(() => {
    if (isFileDragOver) {
      return "Drop images or documents here";
    }
    // Short, calm placeholder on mobile — the long hint wraps to 2–3 lines on a phone.
    const baseHint = isMobile
      ? "Do anything"
      : canResume
        ? composerPlaceholder.followUp
        : composerPlaceholder.initial;

    if (uploadedFiles.length === 0) {
      return baseHint;
    }

    const hasImages = uploadedFiles.some((f) => f.type === "image");
    const hasDocs = uploadedFiles.some((f) => f.type === "document");

    if (hasImages && hasDocs) {
      return "Ask about your attachments — drop more images or documents here";
    }
    if (hasImages) {
      return uploadedFiles.length === 1
        ? "Ask about this image — drop more files here anytime"
        : "Ask about these images — drop more files here anytime";
    }
    return uploadedFiles.length === 1
      ? "Ask about this document — drop more files here anytime"
      : "Ask about these documents — drop more files here anytime";
  }, [isFileDragOver, uploadedFiles, canResume, isMobile, composerPlaceholder]);

  //Copilot related TODO:
  const authErrorMessage = (() => {
    if (!modelsError) return null;
    const msg =
      typeof modelsError === "string"
        ? modelsError
        : typeof modelsError === "object" && "error" in modelsError
          ? String((modelsError as any).error)
          : null;
    if (
      msg &&
      /not authenticated|gh auth login|cursor login|agent login/i.test(msg)
    )
      return msg;
    return null;
  })();

  return (
    <>
      {cliUnsupported ? (
        <ProviderCliUpdateNotice
          providerId={activeProviderId}
          message={`${activeDescriptor.label} CLI ${cliHealth?.version ?? ""} is not supported — Mains requires ${cliHealth?.minimumVersion ?? "a newer version"} or newer`}
          onUpdated={() => {
            void refetchModels();
            void refetchAccountInfo();
          }}
          className="w-full max-w-210 mx-auto"
        />
      ) : (
        (authErrorMessage || providerSignedOut) && (
          <ProviderAuthNotice
            variant={activeDescriptor.variant}
            title="Auth required"
            message={
              authErrorMessage ??
              `${activeDescriptor.label} CLI is not signed in`
            }
            onRecheck={() => {
              void refetchModels();
              void refetchAccountInfo();
            }}
            isRechecking={isFetchingModels || isFetchingAccountInfo}
            className="w-full max-w-210 mx-auto"
          />
        )
      )}

      <div
        className={`relative w-full max-w-210 mx-auto flex flex-col pb-2 rounded-[28px] glass-surface
        cursor-pointer transition-all
        ${layout === "default" ? "mb-4" : ""}
        ${isFileDragOver ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : ""}`}
        style={spaceGlowStyle}
        onDragEnter={handleWrapperDragEnter}
        onDragLeave={handleWrapperDragLeave}
        onDragOver={handleWrapperDragOver}
        onDrop={handleWrapperDrop}
      >
        {contextUsage && (
          <div className="absolute left-full bottom-2.5 ml-3 z-10">
            <ContextUsageRing usage={contextUsage} />
          </div>
        )}
        {sendTarget && (
          <div className="flex px-4 pt-3 -mb-1">
            <div className="relative" ref={sendTargetDropdownRef}>
              <Button
                type="button"
                onClick={() => setTargetMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-full glass-button text-xs dark:text-primary-300 text-primary-700 cursor-pointer"
                title="Choose which chat this message is sent to"
                aria-haspopup="menu"
                aria-expanded={targetMenuOpen}
              >
                {sendTarget.runId ? (
                  <Chat className="size-3 shrink-0" />
                ) : (
                  <Plus className="size-3 shrink-0" />
                )}
                <span className="truncate max-w-60">{sendTarget.label}</span>
              </Button>
              <DropdownWrapper
                isOpen={targetMenuOpen}
                aria-label="Send message to"
                openUpward
                minWidth="min-w-60"
              >
                <div className="max-h-80 overflow-auto noscrollbar py-1">
                  {sendTarget.options.map((option) => {
                    const isSelected = option.runId === sendTarget.runId;
                    return (
                      <Button
                        key={option.runId ?? "new"}
                        type="button"
                        onClick={() => {
                          setTargetMenuOpen(false);
                          onSendTargetChange?.(option.runId);
                        }}
                        className={`w-full text-left px-3 py-2 cursor-pointer text-sm transition-colors flex items-center gap-2 ${
                          isSelected
                            ? "bg-primary-200/60 dark:bg-primary-200/10 text-primary-950 dark:text-primary"
                            : "hover:bg-primary-200/30 dark:hover:bg-primary-800 text-primary-700 dark:text-primary-300"
                        }`}
                        role="menuitemradio"
                        aria-checked={isSelected}
                      >
                        {option.runId ? (
                          <Chat className="size-3.5 shrink-0" />
                        ) : (
                          <Plus className="size-3.5 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {option.label}
                        </span>
                        {isSelected && <Check className="size-3.5 shrink-0" />}
                      </Button>
                    );
                  })}
                </div>
              </DropdownWrapper>
            </div>
          </div>
        )}
        <ContextChips />
        <div className="relative">
          <RichInputForm
            ref={inputRef}
            query={goal}
            onQueryChange={handleGoalChange}
            onSubmit={handleSubmit}
            // Mirrors the toolbar: while the agent works, Enter waits too.
            submitDisabled={activeRun?.status === "running" || activeRun?.status === "queued"}
            onSkillChipsChange={handleSkillChipsChange}
            onFileChipsChange={handleFileChipsChange}
            onCodeChipsChange={handleCodeChipsChange}
            onCaretContextChange={handleCaretContext}
            skillChipMap={skillChipMap}
            fileChipMap={fileChipMap}
            codeChipMap={codeChipMap}
            placeholder={inputPlaceholder}
          />
          <UnifiedContextDropdown
            isOpen={unifiedMenu.visible}
            trigger={unifiedMenu.trigger}
            bucket={unifiedMenu.bucket}
            filterText={unifiedMenu.filter}
            workspacePath={workspacePath}
            projectId={projectId}
            commands={providerCommands}
            skills={providerSkills}
            isLoadingSkills={isLoadingSkills}
            onSelectCommand={handleSlashCommandSelect}
            onSelectSkill={handleUnifiedSkillSelect}
            onSelectFile={handleUnifiedFileSelect}
            onNavigateFile={handleUnifiedFileNavigate}
            onSelectIssue={handleUnifiedIssueSelect}
            onClose={() => updateUnifiedMenu({ visible: false, filter: "" })}
            dropdownRef={unifiedContextDropdownRef}
            triggerRef={pluginsButtonRef}
          />
        </div>
        <InputToolbar
          variant={providerVariant}
          isLoading={isLoading}
          onSubmit={handleSubmit}
          onGoalChange={onGoalChange}
          selectedModelDisplayName={selectedModelDisplayName}
          modelDisplayNames={modelDisplayNames}
          modelEffortLevelsByDisplayName={modelEffortLevelsByDisplayName}
          onModelChange={handleModelChange}
          isLoadingModels={isLoadingModels}
          permissionMode={permissionMode}
          onPermissionModeChange={handlePermissionModeChange}
          planMode={planMode}
          onPlanModeToggle={handlePlanModeToggle}
          goalMode={goalMode}
          onGoalModeToggle={handleGoalModeToggle}
          pluginSkills={pluginSkills}
          pluginsMenuOpen={pluginsMenuOpen}
          onTogglePluginsMenu={handleTogglePluginsMenu}
          pluginsButtonRef={pluginsButtonRef}
          thinkingMode={thinkingMode}
          onThinkingModeToggle={handleThinkingModeToggle}
          fastMode={fastMode}
          onFastModeToggle={handleFastModeToggle}
          supportsFastMode={selectedModelInfo?.supportsFastMode ?? false}
          effortLevel={effortLevel}
          onEffortLevelChange={handleEffortLevelChange}
          supportedEffortLevels={selectedModelInfo?.supportedEffortLevels}
          supportsUltracode={supportsUltracode}
          isRunning={activeRun?.status === "running"}
          onStop={onStop}
          uploadedFiles={uploadedFiles}
          onUploadedFilesChange={onUploadedFilesChange ?? (() => {})}
          disabled={
            !!authErrorMessage ||
            (!isLoadingModels && modelDisplayNames.length === 0)
          }
        />
      </div>
    </>
  );
}
