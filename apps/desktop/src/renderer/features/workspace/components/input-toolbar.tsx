/* eslint-disable @typescript-eslint/no-unused-vars */
import { useState, useRef, useCallback, useEffect, type RefObject } from "react";
import { getProviderVariant } from "@/lib/provider-variants";
import type { SkillInfo } from "@/lib/redux/api/providersApi";
import { PluginsButton } from "./plugins-button";
import { useIsMobile } from "@/lib/platform";
import { useModeConfig } from "@/hooks/use-mode-config";
import {
  CompactComposerControls,
  SendButton,
  DictationButton,
  ModelSelectDropdown,
  FileUploadDropdown,
  FastModeButton,
  GoalButton,
  PermissionModeDropdown,
  FILE_TYPES,
  type UploadedFile,
  Button,
  Input,
} from "@/components/ui";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useClickOutside } from "@/hooks/use-click-outside";

type EffortLevel = "minimal" | "low" | "medium" | "high" | "max" | "xhigh";

interface InputToolbarProps {
  variant: "claude" | "copilot" | "codex" | "cursor";
  isLoading: boolean;
  onSubmit: () => void;
  onGoalChange: (value: string) => void;
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
  // Stop run (active run is running)
  isRunning: boolean;
  onStop?: () => void;
  // File uploads
  uploadedFiles: UploadedFile[];
  onUploadedFilesChange: (files: UploadedFile[]) => void;
  // Disable send
  disabled?: boolean;
}

export function InputToolbar({
  variant,
  isLoading,
  onSubmit,
  onGoalChange,
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
  isRunning,
  onStop,
  uploadedFiles,
  onUploadedFilesChange,
  disabled,
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

  const { isRecording, toggle: toggleDictation } = useSpeechRecognition(
    (value) => onGoalChange(value),
  );

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

  const handleRemoveFile = useCallback(
    (index: number) => {
      const file = uploadedFiles[index];
      if (file.preview) {
        URL.revokeObjectURL(file.preview);
      }
      onUploadedFilesChange(uploadedFiles.filter((_, i) => i !== index));
    },
    [uploadedFiles, onUploadedFilesChange],
  );

  return (
    <div className="flex items-start space-x-2 px-3 pt-6">
      <div className="flex items-center justify-between w-full">
        <div
          className={`relative ml-1 flex min-w-0 flex-1 items-center gap-0.5 pr-2 ${
            isMobile ? "flex-wrap gap-y-1.5" : ""
          }`}
        >
          <FileUploadDropdown
              isOpen={showFileDropdown}
              onToggle={() => setShowFileDropdown(!showFileDropdown)}
              onImageUpload={handleImageUpload}
              onDocumentUpload={handleDocumentUpload}
              dropdownRef={fileDropdownRef}
              openUpward={true}
              uploadedFiles={uploadedFiles}
              onRemoveFile={handleRemoveFile}
              variant={variant}
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
        <div className="flex items-center ">
          <SendButton
            loading={isLoading || isRunning}
            onSubmit={onSubmit}
            onStop={isRunning ? onStop : undefined}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
