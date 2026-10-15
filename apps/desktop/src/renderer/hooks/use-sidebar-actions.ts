import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useSetActiveSpaceMutation,
  useCreateWorkspaceFromSourceMutation,
  useCancelWorkspaceCloneMutation,
  useSelectWorkspaceDirectoryMutation,
  useGetAccountQuery,
  useCreateCollectionMutation,
} from "@/lib/redux/api";
import { toast } from "@/components/ui";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { getTransport } from "@/lib/transport";
import { cloneRepositoryName, WORKSPACE_CLONE_CANCELED } from "@mains/contracts/workspace-intake";
import {
  openNewRunTab,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { getSpaceDefaultRoute, WORKSPACE_BASE_PATH } from "@/lib/route-utils";

/** A disposable sidebar row; the backend creates the real workspace after intake. */
export interface PendingWorkspaceClone {
  id: string;
  accountId: string;
  backendId: string;
  name: string;
  url: string;
  targetPath: string;
  status: "cloning" | "canceling" | "failed";
  error: string | null;
}

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
  const cloneScope = useRef({ accountId, backendId });
  useEffect(() => {
    cloneScope.current = { accountId, backendId };
  }, [accountId, backendId]);

  const [setActiveSpace] = useSetActiveSpaceMutation();
  const [selectDirectory] = useSelectWorkspaceDirectoryMutation();
  const [createWorkspaceFromSource] = useCreateWorkspaceFromSourceMutation();
  const [cancelWorkspaceClone] = useCancelWorkspaceCloneMutation();
  const [createCollection] = useCreateCollectionMutation();

  const [addProjectTab, setAddProjectTab] = useState<"clone" | "create" | null>(null);
  const [isAddingLocal, setIsAddingLocal] = useState(false);
  const [cloneJobs, setCloneJobs] = useState<PendingWorkspaceClone[]>([]);
  const activeCloneRequests = useRef(new Set<string>());
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
    setIsAddingLocal(true);
    try {
      const selectedPath = await selectDirectory().unwrap();
      if (!selectedPath) return;
      const workspace = await createWorkspaceFromSource({
        accountId: account?.id || "default",
        source: { kind: "folder", path: selectedPath },
      }).unwrap();
      toast.success("Workspace added");
      setAddProjectTab(null);
      goToWorkspace(workspace.id);
    } catch (error) {
      console.error("Failed to create workspace:", error);
      toast.error(getErrorMessage(error, "Failed to create workspace"));
    } finally {
      setIsAddingLocal(false);
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

  const runClone = async (clone: PendingWorkspaceClone) => {
    const requestKey = JSON.stringify([clone.backendId, clone.accountId, clone.url, clone.targetPath]);
    if (activeCloneRequests.current.has(requestKey)) return;
    activeCloneRequests.current.add(requestKey);
    const transport = getTransport();
    const isCurrentBackend = () => getTransport() === transport &&
      cloneScope.current.accountId === clone.accountId &&
      cloneScope.current.backendId === clone.backendId;
    setCloneJobs((jobs) => [
      ...jobs.filter((job) => job.id !== clone.id),
      { ...clone, status: "cloning", error: null },
    ]);
    try {
      const workspace = await createWorkspaceFromSource({
        accountId: clone.accountId,
        source: { kind: "clone", url: clone.url, targetPath: clone.targetPath, cloneId: clone.id },
      }).unwrap();
      setCloneJobs((jobs) => jobs.filter((job) => job.id !== clone.id));
      if (isCurrentBackend()) {
        toast.success(`${clone.name} cloned and workspace created`, {
          action: {
            label: "Open",
            onClick: () => {
              if (isCurrentBackend()) goToWorkspace(workspace.id);
            },
          },
        });
      }
    } catch (error) {
      const message = getErrorMessage(error, "Failed to clone repository");
      if (message === WORKSPACE_CLONE_CANCELED) {
        setCloneJobs((jobs) => jobs.filter((job) => job.id !== clone.id));
        return;
      }
      console.error("Failed to clone repository:", error);
      setCloneJobs((jobs) => jobs.map((job) => job.id === clone.id
        ? { ...job, status: "failed", error: message }
        : job));
      if (isCurrentBackend()) toast.error(message);
    } finally {
      activeCloneRequests.current.delete(requestKey);
    }
  };

  const handleCloneRepo = (url: string, targetPath: string) => {
    url = url.trim();
    targetPath = targetPath.trim();
    if (!url || !targetPath) return;
    const existing = cloneJobs.find((job) => job.accountId === accountId &&
      job.backendId === backendId && job.url === url && job.targetPath === targetPath);
    const clone: PendingWorkspaceClone = existing ?? {
      id: crypto.randomUUID(),
      accountId,
      backendId,
      name: cloneRepositoryName(url),
      url,
      targetPath,
      status: "cloning",
      error: null,
    };
    setAddProjectTab(null);
    void runClone(clone);
  };

  const pendingClones = cloneJobs.filter((job) => job.accountId === accountId && job.backendId === backendId);
  const handleCancelClone = async (id: string) => {
    const clone = pendingClones.find((job) => job.id === id && job.status === "cloning");
    if (!clone) return;
    const transport = getTransport();
    setCloneJobs((jobs) => jobs.map((job) => job.id === id ? { ...job, status: "canceling" } : job));
    try {
      const canceled = await cancelWorkspaceClone({ accountId: clone.accountId, cloneId: id }).unwrap();
      // The clone may already be complete and importing its workspace. Its
      // original intake response owns the final row in either race outcome.
      if (!canceled) {
        setCloneJobs((jobs) => jobs.map((job) => job.id === id && job.status === "canceling"
          ? { ...job, status: "cloning" } : job));
      }
    } catch (error) {
      setCloneJobs((jobs) => jobs.map((job) => job.id === id && job.status === "canceling"
        ? { ...job, status: "cloning" } : job));
      if (getTransport() === transport) toast.error(getErrorMessage(error, "Failed to cancel repository clone"));
    }
  };
  const handleRetryClone = (id: string) => {
    const clone = pendingClones.find((job) => job.id === id && job.status === "failed");
    if (clone) void runClone(clone);
  };
  const handleDismissClone = (id: string) => {
    setCloneJobs((jobs) => jobs.filter((job) => job.id !== id || job.status !== "failed"));
  };

  const handleOpenAddProjectModal = () => setAddProjectTab("clone");
  const handleAddProjectTabChange = (tab: "clone" | "create") => {
    setAddProjectTab(tab);
  };

  const handleOpenCloneModal = () => {
    setAddProjectTab("clone");
  };

  const handleCloseAddProjectModal = () => {
    setAddProjectTab(null);
  };

  const handleOpenCreateProjectModal = () => {
    setAddProjectTab("create");
  };

  const handleCreateProject = async (name: string, parentPath?: string) => {
    setIsCreatingProject(true);
    try {
      const workspace = await createWorkspaceFromSource({
        accountId: account?.id || "default",
        source: { kind: "init", name, parentPath },
      }).unwrap();
      toast.success("Project created");
      setAddProjectTab(null);
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
    handleOpenAddProjectModal,
    handleAddProjectTabChange,
    handleCloseAddProjectModal,
    addProjectTab,
    handleNewChat,
    handleAddProject,
    isAddingLocal,
    handleCloneRepo,
    handleOpenCloneModal,
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
