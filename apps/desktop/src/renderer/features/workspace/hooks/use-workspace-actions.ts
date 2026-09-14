import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useDeleteWorkspaceMutation, useArchiveWorkspaceMutation } from "@/lib/redux/api";
import { toast } from "@/components/ui";
import { useRouteType } from "@/hooks/use-route-type";
import { getBaseRoutePath } from "@/lib/route-utils";

function useNavigateAwayIfViewing() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeType = useRouteType();

  return (workspaceId: string) => {
    const basePath = getBaseRoutePath(routeType);
    if (location.pathname === `${basePath}/${workspaceId}`) {
      navigate("/");
    }
  };
}

export function useArchiveWorkspace() {
  const navigateAway = useNavigateAwayIfViewing();
  const [archiveWorkspace, { isLoading: isArchiving }] = useArchiveWorkspaceMutation();

  const handleArchiveClick = async (workspaceId: string) => {
    const archivePromise = archiveWorkspace(workspaceId).unwrap();
    toast.promise(archivePromise, {
      loading: "Archiving workspace…",
      success: "Workspace archived",
      error: "Archive failed",
    });

    try {
      await archivePromise;
      navigateAway(workspaceId);
    } catch (error) {
      console.error("Failed to archive workspace:", error);
    }
  };

  return {
    isArchiving,
    handleArchiveClick,
  };
}

export function useDeleteWorkspace() {
  const navigateAway = useNavigateAwayIfViewing();
  const [workspaceToDelete, setWorkspaceToDelete] = useState<string | null>(null);
  const [deleteWorkspace, { isLoading: isDeleting }] = useDeleteWorkspaceMutation();

  const handleDeleteClick = (workspaceId: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    setWorkspaceToDelete(workspaceId);
  };

  const handleConfirmDelete = async () => {
    if (!workspaceToDelete) return;

    // Sidebar delete leaves the directory alone; removing it from disk is an
    // opt-in offered only in Settings › Archive.
    const deletePromise = deleteWorkspace({ id: workspaceToDelete }).unwrap();
    toast.promise(deletePromise, {
      loading: "Deleting workspace…",
      success: "Workspace deleted",
      error: "Delete failed",
    });

    try {
      await deletePromise;
      navigateAway(workspaceToDelete);
      setWorkspaceToDelete(null);
    } catch (error) {
      console.error("Failed to delete workspace:", error);
    }
  };

  const handleCancelDelete = () => {
    setWorkspaceToDelete(null);
  };

  return {
    workspaceToDelete,
    isDeleting,
    handleDeleteClick,
    handleConfirmDelete,
    handleCancelDelete,
  };
}
