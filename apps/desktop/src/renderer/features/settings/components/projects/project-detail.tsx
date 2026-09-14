import { useState, useEffect, useMemo, useReducer, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Heading2, Muted, Button, toast, Alert, Heading3 } from "@/components/ui";
import {
  useGetProjectQuery,
  useListProjectBranchesQuery,
  useUpdateProjectMutation,
  useRemoveProjectMutation,
} from "@/lib/redux/api";
import { SettingsSection, SettingsRow } from "../settings-layout";
import SpaceIconPicker from "@/components/layout/sidebar/space-icon-picker";
import { LinkResourcesModal } from "@/features/workspace/components/link-resources-modal";
import { formReducer, initialFormState } from "./project-form-reducer";
import { ProjectLinkedResources } from "./project-linked-resources";
import { ProjectScriptsSection } from "./project-scripts-section";
import { ProjectInstructionsSection } from "./project-instructions-section";
import { ProjectSaveBar } from "./project-save-bar";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { DEFAULT_ICON_COLOR, formatIcon, iconKindOf } from "@/lib/icon-registry";

interface ProjectDetailProps {
  id: string;
}

export default function ProjectDetail({ id }: ProjectDetailProps) {
  const [, setSearchParams] = useSearchParams();
  const { data: project, isLoading, refetch } = useGetProjectQuery(id);
  const [updateProject, { isLoading: saving }] = useUpdateProjectMutation();
  const [removeProject, { isLoading: removing }] = useRemoveProjectMutation();
  const [showRemoveAlert, setShowRemoveAlert] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);

  const [state, dispatch] = useReducer(formReducer, initialFormState);
  const { defaultBranch, setupScript, runScript, archiveScript, commitInstructions, prInstructions, icon, iconMode, iconColor, isIconPickerOpen, isDirty } = state;

  // Sync form state when project data loads
  if (project !== state.prevProject) {
    dispatch({ type: "SYNC_PROJECT", project });
  }

  // Live branch names (local + remote, deduped in projectsService).
  const { data: branchNames } = useListProjectBranchesQuery(id, {
    skip: !project?.rootPath,
  });
  useEffect(() => {
    if (branchNames) {
      dispatch({ type: "SET_BRANCHES", branches: branchNames });
    }
  }, [branchNames]);

  const handleSave = useCallback(async () => {
    if (saving || !project) return;
    try {
      // `iconMode` is the picker's open tab, not what was picked — read the
      // kind off the value so browsing the other tab can't mislabel it.
      const iconValue = formatIcon(iconKindOf(icon), icon, iconColor);

      await updateProject({
        id: project.id,
        payload: {
          defaultBranch: defaultBranch || undefined,
          setupScript: setupScript || undefined,
          runScript: runScript || undefined,
          archiveScript: archiveScript || undefined,
          commitInstructions: commitInstructions || undefined,
          prInstructions: prInstructions || undefined,
          icon: iconValue,
        },
      }).unwrap();
      dispatch({ type: "MARK_CLEAN" });
      toast.success("Project settings saved");
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to save project settings"));
    }
  }, [saving, project, icon, iconColor, defaultBranch, setupScript, runScript, archiveScript, commitInstructions, prInstructions, updateProject]);

  // Auto-save when the icon or its tint changes (skip syncs from project
  // load/switch via isDirty)
  const iconKey = `${icon}|${iconColor}`;
  const prevIconRef = useRef(iconKey);
  useEffect(() => {
    if (prevIconRef.current === iconKey) return;
    prevIconRef.current = iconKey;
    if (!isDirty) return;
    if (project) handleSave();
  }, [iconKey, isDirty, project, handleSave]);

  const lastSavedLabel = useMemo(() => {
    const ts = project?.updatedAt || project?.createdAt;
    if (!ts) return null;
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }, [project?.updatedAt, project?.createdAt]);

  const handleRemove = async () => {
    if (removing || !project) return;
    try {
      await removeProject(project.id).unwrap();
      toast.success("Repository removed");
      setSearchParams({});
    } catch (err: any) {
      toast.error(extractErrorMessage(err, "Failed to remove repository"));
    } finally {
      setShowRemoveAlert(false);
    }
  };

  const setField = (field: "defaultBranch" | "setupScript" | "runScript" | "archiveScript" | "commitInstructions" | "prInstructions", value: string) =>
    dispatch({ type: "SET_FIELD", field, value });

  // const formatPath = (path: string) => {
  //   const parts = path.split("/");
  //   const last = parts.pop();
  //   const prefix = parts.join("/");
  //   return (
  //     <span className="text-s text-primary-600 dark:text-primary-400 ">
  //       {prefix && <>{prefix}/</>}
  //       <span className="font-semibold text-s text-primary-900 dark:text-primary-100">
  //         {last}
  //       </span>
  //     </span>
  //   );
  // };

  if (isLoading) {
    return (
      <div>
        <Heading2 className="mb-2">Project</Heading2>
        <Muted>Loading...</Muted>
      </div>
    );
  }

  if (!project) {
    return (
      <div>
        <Heading2 className="mb-2">Project</Heading2>
        <Muted>Project not found.</Muted>
      </div>
    );
  }

  return (
    <div className="bg-primary dark:bg-primary-950 pb-16">
      <div className="mb-8">
        <Heading3>{project.name}</Heading3>
      </div>

      <SettingsSection>
        <SettingsRow
          variant="detail"
          title="Icon"
          description="Choose an emoji or icon for this project."
        >
          <SpaceIconPicker
            icon={icon}
            iconMode={iconMode}
            isOpen={isIconPickerOpen}
            onToggle={() => dispatch({ type: "SET_ICON_PICKER_OPEN", isOpen: !isIconPickerOpen })}
            onSelectEmoji={(emoji) => dispatch({ type: "SET_ICON", icon: emoji, iconMode: "emoji" })}
            onSelectIcon={(name) => dispatch({ type: "SET_ICON", icon: name, iconMode: "icon" })}
            onSwitchMode={(mode) => dispatch({ type: "SET_ICON_MODE", iconMode: mode })}
            onClose={() => dispatch({ type: "SET_ICON_PICKER_OPEN", isOpen: false })}
            onClear={() => {
              dispatch({ type: "SET_ICON_COLOR", iconColor: DEFAULT_ICON_COLOR });
              dispatch({ type: "SET_ICON", icon: "", iconMode: "emoji" });
            }}
            iconColor={iconColor}
            onSelectColor={(color) => dispatch({ type: "SET_ICON_COLOR", iconColor: color })}
          />
        </SettingsRow>
        {/* <SettingsDivider />
        <SettingsRow
          variant="detail"
          title="Root path"
          description="The main repository directory for this project."
        >
          {formatPath(project.rootPath)}
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          variant="detail"
          title="Workspaces path"
          description={
            project.workspacesPath
              ? "Directory where workspace worktrees are stored."
              : undefined
          }
        >
          {project.workspacesPath ? (
            formatPath(project.workspacesPath)
          ) : (
            <Muted>Not configured</Muted>
          )}
        </SettingsRow> */}
      </SettingsSection>

      <ProjectLinkedResources
        projectId={id}
        onManageClick={() => setShowLinkModal(true)}
      />

      <ProjectScriptsSection
        setupScript={setupScript}
        archiveScript={archiveScript}
        onFieldChange={setField}
      />

      <ProjectInstructionsSection
        commitInstructions={commitInstructions}
        prInstructions={prInstructions}
        rootPath={project.rootPath}
        onFieldChange={setField}
      />

      <SettingsSection title="Danger Zone">
        <SettingsRow
          variant="detail"
          title="Remove project"
          description="Permanently deletes this project, all associated workspaces, and their worktree files."
        >
          <Button
            type="button"
            variant="danger"
            onClick={() => setShowRemoveAlert(true)}
            disabled={removing}
          >
            Remove
          </Button>
        </SettingsRow>
      </SettingsSection>

      <ProjectSaveBar
        lastSavedLabel={lastSavedLabel}
        isDirty={isDirty}
        saving={saving}
        isLoading={isLoading}
        onRefresh={refetch}
        onSave={handleSave}
      />

      <Alert
        isOpen={showRemoveAlert}
        title="Remove repository?"
        description={`This will permanently delete "${project.name}", all its workspaces, and remove any worktree files from disk. This action cannot be undone.`}
        primaryButtonText="Remove"
        secondaryButtonText="Cancel"
        primaryButtonVariant="danger"
        onPrimary={handleRemove}
        onSecondary={() => setShowRemoveAlert(false)}
        isPrimaryLoading={removing}
      />

      <LinkResourcesModal
        projectId={id}
        workspaceName={project.name}
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
      />
    </div>
  );
}
