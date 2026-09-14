import { useState, useEffect, useMemo, useCallback, useId } from "react";
import { useNavigate } from "react-router-dom";
import { Body, Button, Caption, Checkbox, Heading3, Modal, Text, toast } from "@/components/ui";
import { extractErrorMessage } from "@/lib/extract-error-message";
import {
  useListAvailableResourcesQuery,
  useAddProjectResourceMutation,
  useRemoveProjectResourceMutation,
  type AvailableResource,
} from "@/lib/redux/api";
import { ResourceIcon } from "./provider-icon";
import { Connect } from "@/components/ui/icons";

interface LinkResourcesModalProps {
  projectId: string;
  workspaceName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function LinkResourcesModal({
  projectId,
  isOpen,
  onClose,
}: LinkResourcesModalProps) {
  const navigate = useNavigate();
  const titleId = useId();

  const goToApps = useCallback(() => {
    onClose();
    navigate("/settings?section=connections");
  }, [navigate, onClose]);

  const {
    data: resources = [],
    isLoading,
  } = useListAvailableResourcesQuery(projectId, {
    skip: !isOpen || !projectId,
    refetchOnMountOrArgChange: true,
  });

  const [addResource] = useAddProjectResourceMutation();
  const [removeResource] = useRemoveProjectResourceMutation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState("");

  // Initialize selected state from currently linked resources
  useEffect(() => {
    if (isOpen && resources.length > 0) {
      const linkedIds = new Set(
        resources.filter((r) => r.isLinked).map((r) => r.id),
      );
      queueMicrotask(() => setSelectedIds(linkedIds));
    }
  }, [isOpen, resources]);

  // Reset error when modal opens
  const [prevIsOpen, setPrevIsOpen] = useState(false);
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setError("");
  }
  if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  // Calculate changes
  const { toAdd, toRemove, hasChanges } = useMemo(() => {
    const initialLinked = new Set(
      resources.filter((r) => r.isLinked).map((r) => r.id),
    );
    const toAdd = [...selectedIds].filter((id) => !initialLinked.has(id));
    const toRemove = [...initialLinked].filter((id) => !selectedIds.has(id));
    return {
      toAdd,
      toRemove,
      hasChanges: toAdd.length > 0 || toRemove.length > 0,
    };
  }, [selectedIds, resources]);

  if (!isOpen) return null;

  const toggleResource = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!hasChanges) {
      onClose();
      return;
    }

    setSaving(true);
    setError("");

    try {
      // Remove unlinked resources
      for (const id of toRemove) {
        await removeResource({ projectId, resourceId: id }).unwrap();
      }

      // Add newly linked resources
      for (const id of toAdd) {
        await addResource({ projectId, resourceId: id }).unwrap();
      }

      const totalChanges = toAdd.length + toRemove.length;
      toast.success(
        `Updated ${totalChanges} resource${totalChanges > 1 ? "s" : ""}`,
      );
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to update resources"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setSelectedIds(
      new Set(resources.filter((r) => r.isLinked).map((r) => r.id)),
    );
    onClose();
  };


  const renderResourceItem = (resource: AvailableResource) => {
    const selected = selectedIds.has(resource.id);
    const icon = <ResourceIcon kind={resource.kind} />;

    return (
      <div
        key={resource.id}
        className={`flex items-center bg-primary transition-all duration-150 dark:bg-primary-950/50 ${
          selected
            ? ""
            : ""
        }`}
      >
        <Button
          variant="bare"
          onClick={() => toggleResource(resource.id)}
          disabled={saving}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left"
        >
          <Text as="span" size="inherit" tone="subtle">{icon}</Text>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Body as="span" weight="medium">
                {resource.name || resource.externalId}
              </Body>
              {resource.externalId !== resource.name && (
                <Caption className="mt-0.5 block truncate">
                  {resource.externalId}
                </Caption>
              )}
            </div>
          </div>
        </Button>
        <Checkbox
          checked={selected}
          onChange={() => toggleResource(resource.id)}
          disabled={saving}
          aria-label={`Link ${resource.name || resource.externalId}`}
          className="mr-4"
        />
      </div>
    );
  };

  return (
    <Modal
      isOpen
      onClose={handleCancel}
      aria-labelledby={titleId}
      className="w-full max-w-xl rounded-3xl"
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <Heading3 id={titleId}>
          Link Resources
        </Heading3>
      </div>

      {/* Content */}
      <div className="px-6 pb-6 space-y-4">
        <div className="flex items-center gap-2"></div>

        <div className="max-h-64 overflow-y-auto border border-primary-200/60 bg-primary dark:bg-primary-950/50 dark:border-primary-800/40 rounded-2xl ">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2">
                <Text as="span" size="sm" tone="inherit" className="shine-text">
                  Loading resources...
                </Text>
              </div>
            </div>
          ) : resources.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center">
              <Connect className="size-6 mb-3 text-primary-600 dark:text-primary-400" />
              <Body weight="medium">
                No resources available
              </Body>
              <Caption className="mt-1 block">
                Connect apps in{" "}
                <Button
                  type="button"
                  onClick={goToApps}
                  className="underline dark:hover:text-primary-400 hover:text-primary-600 transition-colors cursor-pointer"
                >
                  settings
                </Button>{" "}
                first
              </Caption>
            </div>
          ) : (
            <div className="divide-y divide-primary-200/60 dark:divide-primary-800/40">
              {resources.map(renderResourceItem)}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center gap-3 pt-2">
          <Button variant="ghost" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="submit"
            onClick={handleSave}
            disabled={saving}
            isLoading={saving}
          >
            {saving ? "Saving..." : "Done"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
