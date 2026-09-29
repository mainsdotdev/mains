import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Input,
  toast,
} from "@/components/ui";
import SpaceIconPicker from "@/components/layout/sidebar/space-icon-picker";
import { CollectionSettingsModal } from "@/components/layout/sidebar/collection-settings-modal";
import {
  useGetAccountQuery,
  useGetCollectionQuery,
  useRemoveCollectionMutation,
  useUpdateCollectionMutation,
  type Collection,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import {
  DEFAULT_ICON_COLOR,
  formatIcon,
  iconKindOf,
  splitStoredIcon,
} from "@/lib/icon-registry";
import {
  SettingsDivider,
  SettingsPageShell,
  SettingsRow,
  SettingsSection,
} from "../settings-layout";

function CollectionDetailForm({
  accountId,
  collection,
}: {
  accountId: string;
  collection: Collection;
}) {
  const [, setSearchParams] = useSearchParams();
  const parsedIcon = splitStoredIcon(collection.icon);
  const [name, setName] = useState(collection.name);
  const [icon, setIcon] = useState(parsedIcon.value);
  const [iconMode, setIconMode] = useState(parsedIcon.mode);
  const [iconColor, setIconColor] = useState(parsedIcon.color);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [updateCollection, { isLoading: isSaving }] =
    useUpdateCollectionMutation();
  const [removeCollection, { isLoading: isDeleting }] =
    useRemoveCollectionMutation();

  const trimmedName = name.trim();
  const storedIcon = formatIcon(iconKindOf(icon), icon, iconColor);
  const originalIcon = formatIcon(
    iconKindOf(parsedIcon.value),
    parsedIcon.value,
    parsedIcon.color,
  );
  const isDirty =
    trimmedName !== collection.name || storedIcon !== originalIcon;

  const handleSave = async () => {
    if (!trimmedName || !isDirty || isSaving) return;
    try {
      await updateCollection({
        id: collection.id,
        accountId,
        payload: { name: trimmedName, icon: storedIcon },
      }).unwrap();
      toast.success("Project settings saved");
    } catch (error) {
      toast.error(
        extractErrorMessage(error, "Failed to save project settings"),
      );
    }
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    try {
      await removeCollection({ id: collection.id, accountId }).unwrap();
      toast.success("Project deleted");
      setSearchParams({ section: "general" });
    } catch (error) {
      toast.error(extractErrorMessage(error, "Failed to delete project"));
    } finally {
      setShowDeleteAlert(false);
    }
  };

  return (
    <SettingsPageShell title={collection.name} className="pb-16">
      <SettingsSection title="Project details">
        <SettingsRow
          variant="detail"
          title="Name"
          description="The project name shown in the sidebar and command menu."
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Project name"
            className="w-full md:max-w-sm"
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          variant="detail"
          title="Icon"
          description="Choose an emoji or icon for this project."
        >
          <SpaceIconPicker
            icon={icon}
            iconMode={iconMode}
            isOpen={isIconPickerOpen}
            onToggle={() => setIsIconPickerOpen((value) => !value)}
            onSelectEmoji={setIcon}
            onSelectIcon={setIcon}
            onSwitchMode={setIconMode}
            onClose={() => setIsIconPickerOpen(false)}
            onClear={() => {
              setIcon("");
              setIconColor(DEFAULT_ICON_COLOR);
            }}
            iconColor={iconColor}
            onSelectColor={setIconColor}
          />
        </SettingsRow>
      </SettingsSection>

      <div className="mb-8 flex justify-end">
        <Button
          type="button"
          variant="submit"
          disabled={!trimmedName || !isDirty || isSaving}
          isLoading={isSaving}
          onClick={() => void handleSave()}
        >
          Save
        </Button>
      </div>

      <SettingsSection title="Sources">
        <SettingsRow
          variant="detail"
          title="Available sources"
          description="See shared project files and references used by its chats."
        >
          <Button
            type="button"
            variant="subtle"
            className="text-primary-900 dark:text-primary-100"
            onClick={() => setShowProjectSettings(true)}
          >
            Open project settings
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Danger Zone">
        <SettingsRow
          variant="detail"
          title="Delete project"
          description="Chats move back to Recents. Files and text added to this project are deleted."
        >
          <Button
            type="button"
            variant="danger"
            disabled={isDeleting}
            onClick={() => setShowDeleteAlert(true)}
          >
            Delete
          </Button>
        </SettingsRow>
      </SettingsSection>

      <Alert
        isOpen={showDeleteAlert}
        title={`Delete ${collection.name}?`}
        description="The chats inside move back to Recents and stay. Files added to this project are deleted."
        primaryButtonText="Delete"
        secondaryButtonText="Cancel"
        primaryButtonVariant="danger"
        onPrimary={() => void handleDelete()}
        onSecondary={() => setShowDeleteAlert(false)}
        isPrimaryLoading={isDeleting}
      />
      {showProjectSettings && (
        <CollectionSettingsModal
          accountId={accountId}
          collection={collection}
          onClose={() => setShowProjectSettings(false)}
        />
      )}
    </SettingsPageShell>
  );
}

export default function CollectionDetail({ id }: { id: string }) {
  const { data: account, isLoading: isLoadingAccount } = useGetAccountQuery();
  const { data: collection, isLoading: isLoadingCollection } =
    useGetCollectionQuery(
      { id, accountId: account?.id ?? "" },
      { skip: !account?.id },
    );

  if (isLoadingAccount || isLoadingCollection) {
    return <SettingsPageShell title="Project" isLoading />;
  }

  if (!account || !collection) {
    return (
      <SettingsPageShell
        title="Project"
        error
        errorMessage="Project not found."
      />
    );
  }

  return (
    <CollectionDetailForm
      key={`${collection.id}:${new Date(collection.updatedAt).getTime()}`}
      accountId={account.id}
      collection={collection}
    />
  );
}
