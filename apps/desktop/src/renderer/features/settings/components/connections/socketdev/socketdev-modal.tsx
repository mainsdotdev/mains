import { useCallback } from "react";
import { Body, Caption } from "@/components/ui";
import { useLazyGetSocketDevOrganizationsQuery } from "@/lib/redux/api";
import {
  ResourceWizardModal,
  type ResourceWizardConfig,
} from "../shared/resource-wizard-modal";

interface SocketDevModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
}

const CONFIG: ResourceWizardConfig = {
  provider: "socketdev",
  appName: "Socket",
  modalTitle: "Socket",
  icon: "connections/socketdev.png",

  credentialDescription:
    "Enter your Socket.dev API token to connect your organizations.",
  credentialFields: [
    {
      id: "socketdev-token",
      label: "API Token",
      placeholder: "sktsec_xxxxxxxxxxxxxxxxxxxx",
      dataKey: "apiToken",
      emptyError: "Please enter a valid API token",
    },
  ],
  credentialInstructions: (
    <>
      <strong>How to create a token:</strong>
      <br />
      1. Go to{" "}
      <a
        href="https://socket.dev/dashboard/org/settings/api-tokens"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 underline"
      >
        Socket.dev Settings → API Tokens
      </a>
      <br />
      2. Create a new API token
      <br />
      3. Copy the token and paste it here
    </>
  ),
  buildCredentials: (values) => ({ apiToken: values.apiToken }),

  loadingMessage: "Loading organizations...",
  selectTitle: "Select the organizations you want to monitor.",
  resourceLabel: "organization",
  resourceLabelPlural: "organizations",
  saveButtonLabel: (count) =>
    `Save ${count} Organization${count !== 1 ? "s" : ""}`,
  addButtonLabel: "Add Organization",
  revokeButtonLabel: "Revoke Socket Access",
  revokeDescription:
    "This will disconnect all organizations and remove Socket.dev data. This action cannot be undone.",

  identityForItem: (org) => org.slug,
  searchTextForItem: (org) => [org.name, org.slug].filter(Boolean).join(" "),
  identityForCurrent: (current) => current.slug,

  renderItemForSelect: (org) => (
    <div className="flex items-center gap-2">
      <Body>{org.name}</Body>
      {org.plan && (
        <Caption>
          {org.plan}
        </Caption>
      )}
    </div>
  ),
  renderItemForManage: (resource) => (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <Body>{resource.name}</Body>
        {resource.metadata?.plan && (
          <Caption>
            {resource.metadata.plan}
          </Caption>
        )}
      </div>
    </div>
  ),
};

export default function SocketDevModal(props: SocketDevModalProps) {
  const [getOrgs] = useLazyGetSocketDevOrganizationsQuery();
  const fetchAllResources = useCallback(
    async (connectionId: string) => {
      return getOrgs(connectionId).unwrap();
    },
    [getOrgs],
  );
  return (
    <ResourceWizardModal
      {...props}
      config={CONFIG}
      fetchAllResources={fetchAllResources}
    />
  );
}
