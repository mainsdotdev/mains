import { useCallback } from "react";
import { Body, Caption } from "@/components/ui";
import { useLazyGetLinearTeamsQuery } from "@/lib/redux/api";
import {
  ResourceWizardModal,
  type ResourceWizardConfig,
} from "../shared/resource-wizard-modal";

interface LinearModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
}

const CONFIG: ResourceWizardConfig = {
  provider: "linear",
  appName: "Linear",
  modalTitle: "Linear",
  icon: "connections/linear.png",

  credentialDescription:
    "Enter your Linear API key to connect your teams and sync issues.",
  credentialFields: [
    {
      id: "linear-api-key",
      label: "API Key",
      placeholder: "lin_api_xxxxxxxxxxxxxxxxxxxx",
      dataKey: "apiKey",
      emptyError: "Please enter a valid API key",
    },
  ],
  credentialInstructions: (
    <>
      <strong>How to create an API key:</strong>
      <br />
      1. Go to Linear Settings → API →{" "}
      <a
        href="https://linear.app/settings/api"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 underline"
      >
        Personal API keys
      </a>
      <br />
      2. Click &quot;Create key&quot;
      <br />
      3. Give it a name and copy the key
    </>
  ),
  buildCredentials: (values) => ({ apiKey: values.apiKey }),

  loadingMessage: "Loading teams...",
  selectTitle: "Select the teams you want to sync issues from.",
  resourceLabel: "team",
  resourceLabelPlural: "teams",
  saveButtonLabel: (count) => `Save ${count} Teams`,
  addButtonLabel: "Add Team",
  revokeButtonLabel: "Revoke Linear Access",
  revokeDescription:
    "This will disconnect all teams and remove all Linear data. This action cannot be undone.",

  identityForItem: (team) => team.key,
  identityForCurrent: (current) => current.key,
  searchTextForItem: (team) =>
    [team.name, team.key, team.description].filter(Boolean).join(" "),

  renderItemForSelect: (team) => (
    <div className="flex items-center gap-2">
      <Body>{team.name}</Body>
      {team.description && (
        <Caption className="truncate">
          {team.description}
        </Caption>
      )}
    </div>
  ),
  renderItemForManage: (resource) => (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <Body>{resource.name}</Body>
      </div>
    </div>
  ),

  autoSyncProviderLabel: "Linear",
};

export default function LinearModal(props: LinearModalProps) {
  const [getTeams] = useLazyGetLinearTeamsQuery();
  const fetchAllResources = useCallback(
    async (connectionId: string) => {
      return getTeams(connectionId).unwrap();
    },
    [getTeams],
  );
  return (
    <ResourceWizardModal
      {...props}
      config={CONFIG}
      fetchAllResources={fetchAllResources}
    />
  );
}
