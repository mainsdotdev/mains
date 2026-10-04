import { useState, useRef, useCallback, useLayoutEffect, type RefObject } from "react";
import { getProviderVariant } from "@/lib/provider-variants";
import type { SkillInfo } from "@/lib/redux/api/providersApi";
import { PluginsButton } from "./plugins-button";
import { useIsMobile } from "@/lib/platform";
import { useModeConfig } from "@/hooks/use-mode-config";
import {
  CompactComposerControls,
  SendButton,
  ModelSelectDropdown,
  FileUploadDropdown,
  FastModeButton,
  GoalButton,
  PermissionModeDropdown,
  FILE_TYPES,
  type UploadedFile,
  Input,
} from "@/components/ui";
import { useClickOutside } from "@/hooks/use-click-outside";
import type { FloatingChatMode } from "../../../../shared/floating-chat";
import type { EffortLevel } from "@mains/contracts/effort-levels";
import { Microphone } from "@/components/ui/icons";
import { VoiceMuteButton } from "./voice-mute-button";
import type { ComposerPrimaryAction } from "../lib/composer-controls";

interface InputToolbarProps {
  primaryAction: ComposerPrimaryAction & { onClick: () => void };
  voiceMute?: { muted: boolean; disabled: boolean; onToggle: () => void };
  variant: "claude" | "copilot" | "codex" | "cursor";
  isLoading: boolean;
  // Model
  selectedModelDisplayName: string;
  modelDisplayNames: string[];
  modelEffortLevelsByDisplayName: Record<
    string,
    EffortLevel[] | undefined
  >;
  onModelChange: (displayName: string) => void;
  isLoadingModels: boolean;
  // Permission mode (Claude only)
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  // Plan mode (Codex only) — runs alongside the sandbox mode
  planMode?: boolean;
  onPlanModeToggle?: () => void;
  // Goal mode (Codex only) — registers the prompt as the thread's tracked goal
  goalMode?: boolean;
  onGoalModeToggle?: () => void;
  // Plugins picker (work mode) — opens the context menu narrowed to plugins
  pluginSkills?: SkillInfo[];
  pluginsMenuOpen?: boolean;
  onTogglePluginsMenu?: () => void;
  pluginsButtonRef?: RefObject<HTMLButtonElement | null>;
  // Thinking mode (Claude only)
  thinkingMode: boolean;
  onThinkingModeToggle: () => void;
  // Fast mode (Claude only)
  fastMode: boolean;
  onFastModeToggle: () => void;
  supportsFastMode: boolean;
  // Effort level (Claude only)
  effortLevel: string;
  onEffortLevelChange: (level: string) => void;
  supportedEffortLevels?: EffortLevel[];
  // Ultracode (Claude only) — bottom entry of the effort dropdown
  supportsUltracode?: boolean;
  // File uploads
  uploadedFiles: UploadedFile[];
  onUploadedFilesChange: (files: UploadedFile[]) => void;
  layout?: "default" | "floating";
  floatingChatMode?: FloatingChatMode;
}

export function InputToolbar({
  primaryAction,
  voiceMute,
  variant,
  isLoading,
  selectedModelDisplayName,
  modelDisplayNames,
  modelEffortLevelsByDisplayName,
  onModelChange,
  isLoadingModels,
  permissionMode,
  onPermissionModeChange,
  planMode,
  onPlanModeToggle,
  goalMode,
  onGoalModeToggle,
  pluginSkills,
  pluginsMenuOpen = false,
  onTogglePluginsMenu,
  pluginsButtonRef,
  thinkingMode,
  onThinkingModeToggle,
  fastMode,
  onFastModeToggle,
  supportsFastMode,
  effortLevel,
  onEffortLevelChange,
  supportedEffortLevels,
  supportsUltracode,
  uploadedFiles,
  onUploadedFilesChange,
  layout = "default",
  floatingChatMode,
}: InputToolbarProps) {
  const isMobile = useIsMobile();
  const modeConfig = useModeConfig();
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [showPermissionDropdown, setShowPermissionDropdown] = useState(false);
  const permissionDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const fileDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousFloatingChatMode = useRef(floatingChatMode);

  useLayoutEffect(() => {
    const previousMode = previousFloatingChatMode.current;
    previousFloatingChatMode.current = floatingChatMode;
    if (layout !== "floating" || previousMode === floatingChatMode) return;
    setShowModelDropdown(false);
    setShowFileDropdown(false);
    setShowPermissionDropdown(false);
  }, [floatingChatMode, layout]);

  useClickOutside(fileDropdownRef, () => {
    if (showFileDropdown) setShowFileDropdown(false);
  });

  useClickOutside(permissionDropdownRef, () => {
    if (showPermissionDropdown) setShowPermissionDropdown(false);
  });

  const openFilePicker = useCallback((accept: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
    setShowFileDropdown(false);
  }, []);

  const handleImageUpload = useCallback(() => {
    openFilePicker(FILE_TYPES.IMAGE);
  }, [openFilePicker]);

  const handleDocumentUpload = useCallback(() => {
    openFilePicker(FILE_TYPES.DOCUMENT);
  }, [openFilePicker]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const newFiles: UploadedFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isImage = file.type.startsWith("image/");
        const uploaded: UploadedFile = {
          file,
          type: isImage ? "image" : "document",
          preview: isImage ? URL.createObjectURL(file) : undefined,
        };
        newFiles.push(uploaded);
      }

      onUploadedFilesChange([...uploadedFiles, ...newFiles]);
      // Reset so the same file can be selected again
      e.target.value = "";
    },
    [uploadedFiles, onUploadedFilesChange],
  );

  const actionButtons = (
    <>
      {voiceMute && <VoiceMuteButton {...voiceMute} />}
      <SendButton
        loading={primaryAction.kind === "send" && isLoading}
        showStop={primaryAction.kind === "stop"}
        label={primaryAction.label}
        stopLabel={primaryAction.label}
        onSubmit={primaryAction.onClick}
        onStop={primaryAction.onClick}
        disabled={primaryAction.disabled}
        stopDisabled={primaryAction.disabled}
        icon={<Microphone aria-hidden="true" />}
        showCustomIcon={primaryAction.kind === "voice"}
        compact={layout === "floating"}
      />
    </>
  );

  if (layout === "floating") {
    return (
      <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-center justify-between">
        <div className="pointer-events-auto flex items-center">
          <FileUploadDropdown
            isOpen={showFileDropdown}
            onToggle={() => setShowFileDropdown(!showFileDropdown)}
            onImageUpload={handleImageUpload}
            onDocumentUpload={handleDocumentUpload}
            dropdownRef={fileDropdownRef}
            openUpward
            compact
          />
          <Input
            variant="bare"
            ref={fileInputRef}
            type="file"
            className="hidden"
            aria-label="Upload files"
            multiple
            onChange={handleFileChange}
          />
        </div>
        <div className="pointer-events-auto flex items-center gap-0.75">
          <ModelSelectDropdown
            model={selectedModelDisplayName}
            models={modelDisplayNames}
            modelEffortLevelsByModel={modelEffortLevelsByDisplayName}
            onModelChange={onModelChange}
            thinkingMode={thinkingMode}
            effortLevel={effortLevel}
            onEffortLevelChange={onEffortLevelChange}
            onThinkingModeToggle={onThinkingModeToggle}
            isOpen={showModelDropdown}
            onToggle={() => setShowModelDropdown(!showModelDropdown)}
            onClose={() => setShowModelDropdown(false)}
            dropdownRef={modelDropdownRef}
            openUpward
            isLoading={isLoadingModels}
            variant={variant}
            iconOnly
          />
          <PermissionModeDropdown
            permissionMode={permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            isOpen={showPermissionDropdown}
            onToggle={() => setShowPermissionDropdown(!showPermissionDropdown)}
            dropdownRef={permissionDropdownRef}
            variant={variant}
            planMode={modeConfig.showPlanControls ? planMode : false}
            onPlanModeToggle={modeConfig.showPlanControls ? onPlanModeToggle : undefined}
            goalMode={goalMode}
            iconOnly
          />
          {actionButtons}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 px-3 pt-6">
      <div className="flex min-w-0 w-full items-end justify-between">
        {/* Wrap within the chat pane, leaving send/stop its own fixed space. */}
        <div className="relative ml-1 flex min-w-0 flex-1 flex-wrap items-center gap-0.5 gap-y-1.5 pr-2 *:max-w-full *:shrink-0">
          <FileUploadDropdown
              isOpen={showFileDropdown}
              onToggle={() => setShowFileDropdown(!showFileDropdown)}
              onImageUpload={handleImageUpload}
              onDocumentUpload={handleDocumentUpload}
              dropdownRef={fileDropdownRef}
              openUpward={true}
            />
          <Input
            variant="bare"
            ref={fileInputRef}
            type="file"
            className="hidden"
            aria-label="Upload files"
            multiple
            onChange={handleFileChange}
          />
          {isMobile ? (
            <CompactComposerControls
              variant={variant}
              model={selectedModelDisplayName}
              models={modelDisplayNames}
              onModelChange={onModelChange}
              isLoadingModels={isLoadingModels}
              thinkingMode={thinkingMode}
              effortLevel={effortLevel}
              onEffortLevelChange={onEffortLevelChange}
              onThinkingModeToggle={onThinkingModeToggle}
              supportedEffortLevels={supportedEffortLevels}
              supportsUltracode={supportsUltracode}
              fastMode={fastMode}
              onFastModeToggle={onFastModeToggle}
              supportsFastMode={supportsFastMode}
            />
          ) : (
            <>
              <ModelSelectDropdown
                model={selectedModelDisplayName}
                models={modelDisplayNames}
                modelEffortLevelsByModel={modelEffortLevelsByDisplayName}
                onModelChange={onModelChange}
                thinkingMode={thinkingMode}
                effortLevel={effortLevel}
                onEffortLevelChange={onEffortLevelChange}
                onThinkingModeToggle={onThinkingModeToggle}
                isOpen={showModelDropdown}
                onToggle={() => setShowModelDropdown(!showModelDropdown)}
                onClose={() => setShowModelDropdown(false)}
                dropdownRef={modelDropdownRef}
                openUpward={true}
                isLoading={isLoadingModels}
                variant={variant}
              />
              {supportsFastMode && (
                <FastModeButton fastMode={fastMode} onToggle={onFastModeToggle} />
              )}
            </>
          )}
          {modeConfig.showPermissionControls && (
            <PermissionModeDropdown
              permissionMode={permissionMode}
              onPermissionModeChange={onPermissionModeChange}
              isOpen={showPermissionDropdown}
              onToggle={() => setShowPermissionDropdown(!showPermissionDropdown)}
              dropdownRef={permissionDropdownRef}
              variant={variant}
              // The plan row lives inside this dropdown, so it needs its own
              // gate: a mode may keep the permission menu and still have no
              // plan (the harness pins it off there).
              planMode={modeConfig.showPlanControls ? planMode : false}
              onPlanModeToggle={
                modeConfig.showPlanControls ? onPlanModeToggle : undefined
              }
              goalMode={goalMode}
            />
          )}
          {getProviderVariant(variant).supportsGoalMode &&
            modeConfig.showGoalControls &&
            onGoalModeToggle && (
              <GoalButton goalMode={!!goalMode} onToggle={onGoalModeToggle} />
            )}
          {modeConfig.showPluginsButton &&
            onTogglePluginsMenu &&
            pluginSkills &&
            pluginSkills.length > 0 && (
              <PluginsButton
                ref={pluginsButtonRef}
                plugins={pluginSkills}
                isOpen={pluginsMenuOpen}
                onToggle={onTogglePluginsMenu}
              />
            )}
        </div>
        <div className="flex shrink-0 items-center pb-0.5">
          {actionButtons}
        </div>
      </div>
    </div>
  );
}
