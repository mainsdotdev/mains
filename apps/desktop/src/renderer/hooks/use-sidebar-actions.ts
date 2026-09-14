import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useSetActiveSpaceMutation,
  useCreateWorkspaceFromSourceMutation,
  useSelectWorkspaceDirectoryMutation,
  useGetAccountQuery,
  useCreateCollectionMutation,
} from "@/lib/redux/api";
import { toast } from "@/components/ui";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useAppDispatch } from "@/lib/redux/hooks";
import {
  openNewRunTab,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { getSpaceDefaultRoute, WORKSPACE_BASE_PATH } from "@/lib/route-utils";

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

  const [setActiveSpace] = useSetActiveSpaceMutation();
  const [selectDirectory] = useSelectWorkspaceDirectoryMutation();
  const [createWorkspaceFromSource] = useCreateWorkspaceFromSourceMutation();
  const [createCollection] = useCreateCollectionMutation();

  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
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

  // Pick a folder, then hand it to the main-process workspace intake.
  const handleAddProject = async () => {
    try {
      const selectedPath = await selectDirectory().unwrap();
      if (!selectedPath) return;
      const workspace = await createWorkspaceFromSource({
        accountId: account?.id || "default",
        source: { kind: "folder", path: selectedPath },
      }).unwrap();
      toast.success("Workspace added");
      goToWorkspace(workspace.id);
    } catch (error) {
      console.error("Failed to create workspace:", error);
      toast.error(getErrorMessage(error, "Failed to create workspace"));
    }
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

  const handleCloneRepo = async (url: string, targetPath: string) => {
    setIsCloning(true);
    try {
      const workspace = await createWorkspaceFromSource({
        accountId: account?.id || "default",
        source: { kind: "clone", url, targetPath },
      }).unwrap();
      toast.success("Repository cloned and workspace created");
      setIsCloneModalOpen(false);
      goToWorkspace(workspace.id);
    } catch (error) {
      console.error("Failed to clone repository:", error);
      toast.error(getErrorMessage(error, "Failed to clone repository"));
    } finally {
      setIsCloning(false);
    }
  };

  // Fallback for direct clicks — the dropdown items handle the usual paths.
  const handleNewClick = async () => {
    handleAddProject();
  };

  const handleOpenCloneModal = () => {
    setIsCloneModalOpen(true);
  };

  const handleCloseCloneModal = () => {
    setIsCloneModalOpen(false);
  };

  const handleOpenCreateProjectModal = () => {
    setIsCreateProjectModalOpen(true);
  };

  const handleCloseCreateProjectModal = () => {
    setIsCreateProjectModalOpen(false);
  };

  const handleCreateProject = async (name: string, parentPath?: string) => {
    setIsCreatingProject(true);
    try {
      const workspace = await createWorkspaceFromSource({
        accountId: account?.id || "default",
        source: { kind: "init", name, parentPath },
      }).unwrap();
      toast.success("Project created");
      setIsCreateProjectModalOpen(false);
      goToWorkspace(workspace.id);
    } catch (error) {
      console.error("Failed to create project:", error);
      toast.error(getErrorMessage(error, "Failed to create project"));
    } finally {
      setIsCreatingProject(false);
    }
  };

  return {
    handleSpaceChange,
    handleNewClick,
    handleNewChat,
    handleAddProject,
    handleCloneRepo,
    handleOpenCloneModal,
    handleCloseCloneModal,
    isCloneModalOpen,
    isCloning,
    handleCreateProject,
    handleOpenCreateProjectModal,
    handleCloseCreateProjectModal,
    isCreateProjectModalOpen,
    isCreatingProject,
    handleCreateCollection,
    handleOpenCreateCollectionModal,
    handleCloseCreateCollectionModal,
    isCreateCollectionModalOpen,
    isCreatingCollection,
  };
}
