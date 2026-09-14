import { Button, Caption, Muted, Text, toast } from "@/components/ui";
import { useListProjectResourcesQuery, useRemoveProjectResourceMutation } from "@/lib/redux/api";
import { SettingsSection, SettingsDivider } from "../settings-layout";
import { Close, Plus } from "@/components/ui/icons";
import { ResourceIcon } from "@/features/workspace/components/provider-icon";
import { extractErrorMessage } from "@/lib/extract-error-message";

interface ProjectLinkedResourcesProps {
  projectId: string;
  onManageClick: () => void;
}

export function ProjectLinkedResources({ projectId, onManageClick }: ProjectLinkedResourcesProps) {
  const { data: linkedResources = [] } = useListProjectResourcesQuery(projectId);
  const [removeResource] = useRemoveProjectResourceMutation();

  const handleRemove = async (resourceId: string) => {
    try {
      await removeResource({ projectId, resourceId }).unwrap();
      toast.success("Resource removed");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to remove resource"));
    }
  };

  return (
    <SettingsSection title="Linked Resources">
      {linkedResources.length === 0 ? (
        <div className="py-5">
          <Muted>No resources linked to this project.</Muted>
        </div>
      ) : (
        <div>
          {linkedResources.map((r, i) => (
            <div key={r.id}>
              {i > 0 && <SettingsDivider />}
              <div className="flex items-center gap-3 py-4">
                <Text as="span" size="inherit" tone="subtle" className="shrink-0">
                  <ResourceIcon kind={r.resource.kind} />
                </Text>
                <div className="flex-1 min-w-0">
                  <Text as="span" weight="medium" className="truncate block">
                    {r.resource.name || r.resource.externalId}
                  </Text>
                  {r.resource.externalId !== r.resource.name && (
                    <Caption className="truncate block">
                      {r.resource.externalId}
                    </Caption>
                  )}
                </div>
                <Button
                  type="button"
                  className="shrink-0  cursor-pointer hover:bg-primary-100/80 dark:hover:bg-primary/10 p-1.5 glass-button rounded-full text-primary-900 dark:text-primary-100 transition-all duration-300 ease-out"
                  onClick={() => handleRemove(r.resourceId)}
                >
                  <Close className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <SettingsDivider />
      <div className="py-4 flex justify-end">
        <Button
          type="button"
          variant="primary"
          className="flex items-center gap-1.5 "
          onClick={onManageClick}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Manage resources</span>
        </Button>
      </div>
    </SettingsSection>
  );
}
