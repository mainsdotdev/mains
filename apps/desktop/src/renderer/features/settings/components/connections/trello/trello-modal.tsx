import { useCallback } from "react";
import { Body, Caption } from "@/components/ui";
import { useLazyGetTrelloBoardsQuery } from "@/lib/redux/api";
import {
  ResourceWizardModal,
  type ResourceWizardConfig,
} from "../shared/resource-wizard-modal";

interface TrelloModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
}

const CONFIG: ResourceWizardConfig = {
  provider: "trello",
  appName: "Trello",
  modalTitle: "Trello",
  icon: "connections/trello.png",

  credentialDescription:
    "Enter your Trello API Key and Token to connect your boards.",
  credentialFields: [
    {
      id: "trello-api-key",
      label: "API Key",
      placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      dataKey: "apiKey",
      emptyError: "Please enter a valid API Key",
    },
    {
      id: "trello-token",
      label: "Token",
      placeholder:
        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      dataKey: "token",
      emptyError: "Please enter a valid token",
    },
  ],
  credentialInstructions: (
    <>
      <strong>How to get your credentials:</strong>
      <br />
      1. Go to{" "}
      <a
        href="https://trello.com/power-ups/admin"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 underline"
      >
        Trello Power-Ups Admin
      </a>
      <br />
      2. Click &quot;New&quot; to create a Power-Up, then copy your API Key
      <br />
      3. Next to your API Key, click the &quot;Token&quot; link to generate a token
      <br />
      4. Authorize the app and copy the token
    </>
  ),
  buildCredentials: (values) => ({
    token: values.token,
    apiKey: values.apiKey,
  }),

  loadingMessage: "Loading boards...",
  selectTitle: "Select the boards you want to sync cards from.",
  resourceLabel: "board",
  resourceLabelPlural: "boards",
  saveButtonLabel: (count) => `Save ${count} Boards`,
  addButtonLabel: "Add Board",
  revokeButtonLabel: "Revoke Trello Access",
  revokeDescription:
    "This will disconnect all boards and remove all Trello data. This action cannot be undone.",

  identityForItem: (board) => board.id,
  // The id is opaque here, so the search text is the label the row renders.
  searchTextForItem: (board) =>
    [board.name, board.organizationName].filter(Boolean).join(" "),
  identityForCurrent: (current) => current.boardId,

  renderItemForSelect: (board) => (
    <div className="flex items-center gap-2">
      <Body>{board.name}</Body>
      {board.organizationName && (
        <Caption>
          {board.organizationName}
        </Caption>
      )}
    </div>
  ),
  renderItemForManage: (resource) => (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <Body>{resource.name}</Body>
        {resource.metadata?.organizationName && (
          <Caption>
            {resource.metadata.organizationName}
          </Caption>
        )}
      </div>
    </div>
  ),

  autoSyncProviderLabel: "Trello",
};

export default function TrelloModal(props: TrelloModalProps) {
  const [getBoards] = useLazyGetTrelloBoardsQuery();
  const fetchAllResources = useCallback(
    async (connectionId: string) => {
      return getBoards(connectionId).unwrap();
    },
    [getBoards],
  );
  return (
    <ResourceWizardModal
      {...props}
      config={CONFIG}
      fetchAllResources={fetchAllResources}
    />
  );
}
