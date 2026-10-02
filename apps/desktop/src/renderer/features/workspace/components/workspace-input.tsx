import {
  useReducer,
  useRef,
  useEffect,
  useLayoutEffect,
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
  AsciiSpinner,
  Button,
  DropdownWrapper,
  RichInputForm,
  Tooltip,
  toast,
  type UploadedFile,
  type RichInputFormHandle,
  type RichSkillChipData,
  type RichFileChipData,
  type RichCodeChipData,
} from "@/components/ui";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import type { FloatingChatMode } from "../../../../shared/floating-chat";
import { useModeConfig } from "@/hooks/use-mode-config";
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
import { ComposerAttachments } from "./composer-attachments";
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
import { PROVIDER_IDS } from "../../../../shared/provider-ids";
import {
  VISUALIZATION_FOLLOW_UP_EVENT,
  type VisualizationFollowUpDetail,
} from "../lib/visualization-bridge";
import {
  useKeyboardShortcut,
  useKeyboardShortcutBinding,
} from "@/providers/keyboard-shortcuts-provider";
import { keyboardShortcutLabel } from "../../../../shared/keyboard-shortcuts";

const EMPTY_UPLOADED_FILES: UploadedFile[] = [];
const EMPTY_DIRECTORIES: string[] = [];

function directoryName(folderPath: string): string {
  return folderPath.replace(/\/+$/, "").split("/").pop() || folderPath;
}

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

function skillMentionToken(skill: { name: string; displayName?: string; scope?: string }): string {
  return skill.scope === "computer"
    ? `@${skill.displayName || skill.name}`
    : `$${skill.name}`;
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
  additionalDirectories?: string[];
  onAdditionalDirectoriesChange?: (directories: string[]) => void;
  onStop?: () => void;
  /** When true (e.g. new-run draft tab active), focus the prompt after layout. */
  isNewRunTabActive?: boolean;
  /** Empty-state stack: tighter outer margins so the bar sits vertically centered with the headline. */
  layout?: "default" | "centered" | "floating";
  floatingChatMode?: FloatingChatMode;
  onFloatingFocus?: () => void;
  floatingAutoFocus?: boolean;
  /** Selected run activity shown in the compact floating composer while idle. */
  floatingStatusPlaceholder?: string | null;
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
  additionalDirectories = EMPTY_DIRECTORIES,
  onAdditionalDirectoriesChange,
  onStop,
  isNewRunTabActive = false,
  layout = "default",
  floatingChatMode,
  onFloatingFocus,
  floatingAutoFocus = false,
  floatingStatusPlaceholder,
}: WorkspaceInputProps) {
  const inputRef = useRef<RichInputFormHandle>(null);
  useEffect(() => {
    if (layout !== "floating" || !floatingAutoFocus) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [layout, floatingAutoFocus]);
  const unifiedContextDropdownRef = useRef<HTMLDivElement>(null);
  const pluginsButtonRef = useRef<HTMLButtonElement>(null);
  const {
    files: contextFiles,
    skills: contextSkills,
    codeSelections: contextCodeSelections,
    browserSelections: contextBrowserSelections,
    add: addContext,
    remove: removeContext,
  } = useComposerContext();

  const spaceProvider = useSpaceProviderVariant();
  const providerVariant = spaceProvider.variant;
  const activeProviderId = providerId ?? spaceProvider.providerId;
  // Empty-state backlight: the centered composer glows in the accent.
  const { composerPlaceholder } = useModeConfig();
  // Built outside the JSX on purpose: calling the helper inline in `style`
  // makes the React Compiler bail on this component's manual memoization.



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

  const contextUsage = useContextUsage(layout === "floating" ? null : (activeRun?.id ?? null));

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

  useKeyboardShortcut(
    "app.focusComposer",
    () => inputRef.current?.focus(),
    { allowInEditable: true },
  );
  const focusComposerShortcut = keyboardShortcutLabel(
    useKeyboardShortcutBinding("app.focusComposer"),
  );

  useEffect(() => {
    if (!isNewRunTabActive) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [isNewRunTabActive]);

  // Interactive visualizations never submit autonomously. A drill-down action
  // places its proposed follow-up in the composer so the user can review,
  // edit, and explicitly send it.
  useEffect(() => {
    const handleVisualizationFollowUp = (event: Event) => {
      const detail = (event as CustomEvent<VisualizationFollowUpDetail>).detail;
      if (!detail?.prompt) return;
      onGoalChange(detail.prompt);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener(
      VISUALIZATION_FOLLOW_UP_EVENT,
      handleVisualizationFollowUp,
    );
    return () => {
      window.removeEventListener(
        VISUALIZATION_FOLLOW_UP_EVENT,
        handleVisualizationFollowUp,
      );
    };
  }, [onGoalChange]);

  const [unifiedMenu, updateUnifiedMenu] = useReducer(
    (prev: UnifiedMenuState, next: Partial<UnifiedMenuState>) => {
      const merged = { ...prev, ...next };
      return merged.visible ? merged : { ...merged, bucket: null };
    },
    { visible: false, filter: "", trigger: "@", bucket: null },
  );

  // The toolbar plugin picker is a Codex-only capability. Other providers may
  // still expose skills through the context menu, but they do not show this button.
  const pluginSkills = useMemo(
    () =>
      activeProviderId === PROVIDER_IDS.codex
        ? providerSkills.filter(
            (skill) => skill.scope === "plugin" && skill.userInvokable !== false,
          )
        : [],
    [activeProviderId, providerSkills],
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
    if (/^\/add-dir\s+/.test(goal)) {
      updateUnifiedMenu({ visible: false, filter: "" });
      return;
    }
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
    if (/^\/add-dir\s+/.test(before)) {
      updateUnifiedMenu({ visible: false, filter: "" });
      return;
    }
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

  const addAdditionalDirectory = useCallback((folderPath: string) => {
    const normalized = folderPath.trim();
    if (!normalized.startsWith("/")) {
      toast.error("Enter an absolute folder path on the Mac running Mains.");
      return;
    }
    if (!additionalDirectories.includes(normalized)) {
      onAdditionalDirectoriesChange?.([...additionalDirectories, normalized]);
    }
  }, [additionalDirectories, onAdditionalDirectoriesChange]);

  const pickAdditionalDirectory = useCallback(async () => {
    try {
      const result = await window.api.workspace.selectDirectory();
      if (!result.success) {
        toast.error(result.error || "Could not open the folder picker. You can type /add-dir /absolute/path instead.");
        return;
      }
      if (result.data) addAdditionalDirectory(result.data);
    } catch {
      toast.error("Could not open the folder picker. You can type /add-dir /absolute/path instead.");
    }
  }, [addAdditionalDirectory]);

  const handleSlashCommandSelect = useCallback(
    (command: CommandInfo) => {
      if (command.name === "add-dir" &&
        activeDescriptor.supportsAdditionalDirectories) {
        const t = unifiedMenu.trigger;
        const ok = inputRef.current?.replaceTokenWithText(t, "") ?? false;
        if (!ok) {
          const next = replaceMentionInGoal(goal, t, unifiedMenu.filter, "");
          if (next !== null) onGoalChange(next);
        }
        updateUnifiedMenu({ visible: false, filter: "" });
        void pickAdditionalDirectory();
        return;
      }
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
    [activeDescriptor.supportsAdditionalDirectories, goal, onGoalChange, pickAdditionalDirectory, unifiedMenu.filter, unifiedMenu.trigger],
  );

  const handleSkillSelect = useCallback(
    (skill: SkillInfo, trigger: UnifiedContextTrigger) => {
      if (trigger === "#") return; // the issues-only menu never lists skills
      updateUnifiedMenu({ visible: false, filter: "" });
      addContext({
        kind: "skill",
        name: skill.name,
        path: skill.path,
        mentionPath: skill.mentionPath,
        description: skill.description,
        displayName: skill.displayName,
        shortDescription: skill.shortDescription,
        iconSmall: skill.iconSmall,
        iconLarge: skill.iconLarge,
        brandColor: skill.brandColor,
        scope: skill.scope,
      });
      const token = skillMentionToken(skill);
      const replaced = inputRef.current?.replaceTokenWithSkillChip(trigger, {
        name: skill.name,
        displayName: skill.displayName,
        iconSmall: skill.iconSmall,
        iconLarge: skill.iconLarge,
        brandColor: skill.brandColor,
        token,
      }, skill.scope !== "computer");
      if (skill.scope === "computer" && !replaced) {
        const next = replaceMentionInGoal(goal, trigger, unifiedMenu.filter, `${token} `);
        if (next !== null) onGoalChange(next);
      }
    },
    [addContext, goal, onGoalChange, unifiedMenu.filter],
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
      m.set(skillMentionToken(s), {
        name: s.name,
        displayName: s.displayName,
        iconSmall: s.iconSmall,
        iconLarge: s.iconLarge,
        brandColor: s.brandColor,
        token: skillMentionToken(s),
      });
    }
    return m;
  }, [contextSkills]);

  const fileChipMap = useMemo(() => {
    const m = new Map<string, RichFileChipData>();
    for (const f of contextFiles) {
      m.set(f.fullPath, {
        path: f.fullPath,
        basename: f.name,
        isDirectory: f.type === "directory",
      });
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
          isDirectory: node.type === "directory",
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
    if (activeDescriptor.supportsAdditionalDirectories) {
      const match = goal.trim().match(/^\/add-dir(?:\s+(.+))?$/);
      if (match) {
        if (match[1]) {
          const folderPath = match[1].trim().replace(/^(["'])(.*)\1$/, "$2");
          addAdditionalDirectory(folderPath);
        } else {
          void pickAdditionalDirectory();
        }
        onGoalChange("");
        return;
      }
    }
    if (unifiedMenu.visible) return;
    onSubmit();
  }, [unifiedMenu.visible, activeDescriptor.supportsAdditionalDirectories, goal, addAdditionalDirectory, pickAdditionalDirectory, onGoalChange, onSubmit]);

  const [isFileDragOver, setIsFileDragOver] = useState(false);

  const sendTargetDropdownRef = useRef<HTMLDivElement>(null);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const previousFloatingChatMode = useRef(floatingChatMode);
  useLayoutEffect(() => {
    const previousMode = previousFloatingChatMode.current;
    previousFloatingChatMode.current = floatingChatMode;
    if (layout !== "floating" || previousMode === floatingChatMode) return;
    updateUnifiedMenu({ visible: false, filter: "" });
    setTargetMenuOpen(false);
  }, [floatingChatMode, layout]);
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

  const handlePasteFiles = useCallback(
    (clipboardFiles: File[]): boolean => {
      if (!onUploadedFilesChange) return false;
      const files = clipboardFiles.filter(isAttachableUpload);
      if (files.length === 0) return false;
      onUploadedFilesChange([...uploadedFiles, ...files.map(fileToUploadedFile)]);
      return true;
    },
    [uploadedFiles, onUploadedFilesChange],
  );

  const handleRemoveUploadedFile = useCallback(
    (index: number) => {
      const removed = uploadedFiles[index];
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      onUploadedFilesChange?.(uploadedFiles.filter((_, i) => i !== index));
    },
    [uploadedFiles, onUploadedFilesChange],
  );

  const isMobile = useIsMobile();
  const contextBrowserSelectionCount = contextBrowserSelections.length;
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

    const imageCount =
      uploadedFiles.filter((file) => file.type === "image").length +
      contextBrowserSelectionCount;
    const documentCount = uploadedFiles.filter(
      (file) => file.type === "document",
    ).length;

    if (imageCount === 0 && documentCount === 0) {
      return baseHint;
    }

    if (imageCount > 0 && documentCount > 0) {
      return "Ask about your attachments — drop more images or documents here";
    }
    if (imageCount > 0) {
      return imageCount === 1
        ? "Ask about this image — drop more files here anytime"
        : "Ask about these images — drop more files here anytime";
    }
    return documentCount === 1
      ? "Ask about this document — drop more files here anytime"
      : "Ask about these documents — drop more files here anytime";
  }, [
    isFileDragOver,
    uploadedFiles,
    contextBrowserSelectionCount,
    canResume,
    isMobile,
    composerPlaceholder,
  ]);
  const floatingRunStatus = layout === "floating" && !isFileDragOver
    ? floatingStatusPlaceholder
    : null;

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

  const toolbar = (
    <InputToolbar
      floatingChatMode={floatingChatMode}
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
      disabled={!!authErrorMessage || (!isLoadingModels && modelDisplayNames.length === 0)}
      layout={layout === "floating" ? "floating" : "default"}
    />
  );

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
        className={`@container/composer relative mx-auto flex min-w-0 w-full max-w-210 flex-col cursor-pointer transition-all
        ${layout === "floating"
          ? "rounded-[28px] text-primary-950 dark:text-primary-50"
          : "rounded-[28px] glass-surface pb-2"}
        ${layout === "default" ? "mb-4" : ""}
        ${isFileDragOver ? "ring dark:ring-primary/50 ring-primary-950/50 ring-offset-2 " : ""}`}
        onFocusCapture={(event) => {
          if (layout === "floating" && event.target instanceof HTMLElement && event.target.getAttribute("role") === "textbox") {
            onFloatingFocus?.();
          }
        }}
        onDragEnter={handleWrapperDragEnter}
        onDragLeave={handleWrapperDragLeave}
        onDragOver={handleWrapperDragOver}
        onDrop={handleWrapperDrop}
      >
        {layout !== "floating" && contextUsage && (
          <div className="absolute left-full bottom-2.5 ml-3 z-10">
            <ContextUsageRing usage={contextUsage} />
          </div>
        )}
        {sendTarget && (
          <div className="flex px-4 pt-3 -mb-1">
            <div className="relative min-w-0 max-w-full" ref={sendTargetDropdownRef}>
              <Button
                type="button"
                onClick={() => setTargetMenuOpen((open) => !open)}
                className="flex max-w-full items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-full glass-button text-xs dark:text-primary-300 text-primary-700 cursor-pointer"
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
                minWidth="min-w-20"
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
        {additionalDirectories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {additionalDirectories.map((folderPath) => (
              <Tooltip
                key={folderPath}
                content={folderPath}
                hideOnClick
                className="max-w-xs whitespace-normal wrap-break-word"
              >
                <Button
                  type="button"
                  aria-label={`Remove access to ${folderPath}`}
                  onClick={() => onAdditionalDirectoriesChange?.(
                    additionalDirectories.filter((entry) => entry !== folderPath),
                  )}
                  className="min-w-0 max-w-64 flex items-center gap-1.5 rounded-full glass-button px-2.5 py-1 text-xs text-primary-700 dark:text-primary-300"
                >
                  <span className="min-w-0 truncate">{directoryName(folderPath)}</span>
                  <span aria-hidden="true" className="shrink-0 text-primary-500">×</span>
                </Button>
              </Tooltip>
            ))}
          </div>
        )}
        <ComposerAttachments
          files={uploadedFiles}
          onRemove={handleRemoveUploadedFile}
        />
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
            onPasteFiles={handlePasteFiles}
            skillChipMap={skillChipMap}
            fileChipMap={fileChipMap}
            codeChipMap={codeChipMap}
            placeholder={floatingRunStatus || inputPlaceholder}
            placeholderIcon={floatingRunStatus
              ? <AsciiSpinner
                  variant={providerVariant}
                  kind={activeRun?.status === "queued" ? "circle" : "square"}
                />
              : undefined}
            focusShortcutLabel={layout === "floating" ? undefined : focusComposerShortcut}
            compact={layout === "floating"}
          />
          <UnifiedContextDropdown
            isOpen={unifiedMenu.visible}
            trigger={unifiedMenu.trigger}
            providerId={activeProviderId}
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
          {layout === "floating" && toolbar}
        </div>
        {layout !== "floating" && toolbar}
      </div>
    </>
  );
}
