import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useSetActiveSpaceMutation,
  useGetAccountQuery,
  useCreateCollectionMutation,
} from "@/lib/redux/api";
import { toast } from "@/components/ui";
import { useWorkspaceIntake } from "./use-workspace-intake";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  openNewRunTab,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { getSpaceDefaultRoute, WORKSPACE_BASE_PATH } from "@/lib/route-utils";

export type { PendingWorkspaceClone } from "./use-workspace-intake";

/** Pull a human message out of an RTK/IPC rejection (string | {error} | Error). */
function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    typeof (error as { error: unknown }).error === "string"
  ) {
    return (error as { error: string }).error;
  }
  return fallback;
}

export function useSidebarActions() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { spaces, activeSpace } = useActiveSpace();
  const { data: account } = useGetAccountQuery();
  const accountId = account?.id || "default";
  const backendId = useAppSelector((state) => state.backends.activeBackendId ?? "local");

  const [setActiveSpace] = useSetActiveSpaceMutation();
  const [createCollection] = useCreateCollectionMutation();

  const [addProjectTab, setAddProjectTab] = useState<"clone" | "create" | null>(null);
  // Prefilled only when cloning a repository that exists on another Bridge device.
  const [cloneDraftUrl, setCloneDraftUrl] = useState("");
  const [isCreateCollectionModalOpen, setIsCreateCollectionModalOpen] =
    useState(false);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);

  const handleSpaceChange = async (spaceId: string) => {
    try {
      const selectedSpace = spaces.find((s) => s.id === spaceId);
      const defaultRoute = selectedSpace
        ? getSpaceDefaultRoute(selectedSpace)
        : "/";

      // Navigate BEFORE the mutation: the provider follows the active space,
      // so any /code/:workspaceId param must be gone before the new space's
      // provider can render against it (an interim render with the old param
      // would stamp that workspace into the new provider's persisted state).
      navigate(defaultRoute, { replace: true });
      await setActiveSpace(spaceId || null).unwrap();
    } catch (error) {
      console.error("Error changing space:", error);
      toast.error("Failed to change space");
    }
  };

  const goToWorkspace = (workspaceId: string) => {
    navigate(`${WORKSPACE_BASE_PATH}/${workspaceId}`);
  };

  const intake = useWorkspaceIntake(accountId, backendId, goToWorkspace);
  const dialogGeneration = useRef(0);
  const { isAddingLocal, isCreatingProject, pendingClones } = intake;
  const handleAddProject = async () => {
    const dialog = dialogGeneration.current;
    const result = await intake.addFolder();
    if (!result?.current()) return;
    toast.success("Workspace added");
    if (dialog === dialogGeneration.current) { setAddProjectTab(null); goToWorkspace(result.workspace.id); }
  };

  /** Top-level New is standalone; a Collection row's + supplies its id. */
  const handleNewChat = (collectionId?: string) => {
    dispatch(setSelectedCollectionId(collectionId ?? null));
    navigate(WORKSPACE_BASE_PATH);
    dispatch(openNewRunTab());
  };

  const handleOpenCreateCollectionModal = () => {
    setIsCreateCollectionModalOpen(true);
  };

  const handleCloseCreateCollectionModal = () => {
    setIsCreateCollectionModalOpen(false);
  };

  const handleCreateCollection = async (draft: {
    name: string;
    icon: string | null;
  }) => {
    if (!activeSpace || activeSpace.mode === "developer") return;
    setIsCreatingCollection(true);
    try {
      const collection = await createCollection({
        accountId: account?.id || "default",
        name: draft.name,
        ...(draft.icon ? { icon: draft.icon } : {}),
      }).unwrap();
      setIsCreateCollectionModalOpen(false);
      handleNewChat(collection.id);
    } catch (error) {
      console.error("Failed to create collection:", error);
      toast.error(getErrorMessage(error, "Failed to create project"));
    } finally {
      setIsCreatingCollection(false);
    }
  };

  const handleCloneRepo = (url: string, targetPath: string) => { setAddProjectTab(null); intake.clone(url, targetPath); };
  const handleCancelClone = intake.cancelClone;
  const handleRetryClone = intake.retry;
  const handleDismissClone = intake.dismiss;

  const handleOpenAddProjectModal = () => { dialogGeneration.current += 1; setCloneDraftUrl(""); setAddProjectTab("clone"); };
  const handleAddProjectTabChange = (tab: "clone" | "create") => {
    dialogGeneration.current += 1;
    setAddProjectTab(tab);
  };

  const handleOpenCloneModal = () => {
    dialogGeneration.current += 1;
    setCloneDraftUrl("");
    setAddProjectTab("clone");
  };

  const handleOpenCloneFor = (url: string) => {
    dialogGeneration.current += 1;
    setCloneDraftUrl(url);
    setAddProjectTab("clone");
  };

  const handleCloseAddProjectModal = () => {
    dialogGeneration.current += 1;
    setAddProjectTab(null);
  };

  const handleOpenCreateProjectModal = () => {
    dialogGeneration.current += 1;
    setAddProjectTab("create");
  };

  const handleCreateProject = async (name: string, parentPath?: string) => {
    const dialog = dialogGeneration.current;
    const result = await intake.init(name, parentPath);
    if (!result?.current()) return;
    toast.success("Project created");
    if (dialog === dialogGeneration.current) { setAddProjectTab(null); goToWorkspace(result.workspace.id); }
  };

  return {
    handleSpaceChange,
    handleOpenAddProjectModal,
    handleAddProjectTabChange,
    handleCloseAddProjectModal,
    addProjectTab,
    handleNewChat,
    handleAddProject,
    isAddingLocal,
    handleCloneRepo,
    handleOpenCloneModal,
    handleOpenCloneFor,
    cloneDraftUrl,
    pendingClones,
    handleCancelClone,
    handleRetryClone,
    handleDismissClone,
    handleCreateProject,
    handleOpenCreateProjectModal,
    isCreatingProject,
    handleCreateCollection,
    handleOpenCreateCollectionModal,
    handleCloseCreateCollectionModal,
    isCreateCollectionModalOpen,
    isCreatingCollection,
  };
}
