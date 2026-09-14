import { useCallback } from "react";
import { Body, Caption } from "@/components/ui";
import { useLazyGetAsanaProjectsQuery } from "@/lib/redux/api";
import {
  ResourceWizardModal,
  type ResourceWizardConfig,
} from "../shared/resource-wizard-modal";

interface AsanaModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
}

const CONFIG: ResourceWizardConfig = {
  provider: "asana",
  appName: "Asana",
  modalTitle: "Asana",
  icon: "connections/asana.png",

  credentialDescription:
    "Enter your Asana Personal Access Token to connect your projects.",
  credentialFields: [
    {
      id: "asana-token",
      label: "Personal Access Token",
      placeholder: "0/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      dataKey: "token",
      emptyError: "Please enter a valid token",
    },
  ],
  credentialInstructions: (
    <>
      <strong>How to create a token:</strong>
      <br />
      1. Go to{" "}
      <a
        href="https://app.asana.com/0/my-apps"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 underline"
      >
        Asana Developer Console
      </a>
      <br />
      2. Click &quot;Create new token&quot;
      <br />
      3. Give it a name and copy the token
    </>
  ),
  buildCredentials: (values) => ({ accessToken: values.token }),

  loadingMessage: "Loading projects...",
  selectTitle: "Select the projects you want to sync tasks from.",
  resourceLabel: "project",
  resourceLabelPlural: "projects",
  saveButtonLabel: (count) => `Save ${count} Projects`,
  addButtonLabel: "Add Project",
  revokeButtonLabel: "Revoke Asana Access",
  revokeDescription:
    "This will disconnect all projects and remove all Asana data. This action cannot be undone.",

  identityForItem: (project) => project.gid,
  identityForCurrent: (current) => current.gid,
  // The gid is opaque here, so the search text is the label the row renders.
  searchTextForItem: (project) =>
    [project.name, project.workspaceName].filter(Boolean).join(" "),

  renderItemForSelect: (project) => (
    <div className="flex items-center gap-2">
      <Body>{project.name}</Body>
      {project.workspaceName && (
        <Caption>{project.workspaceName}</Caption>
      )}
    </div>
  ),
  renderItemForManage: (resource) => (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <Body>{resource.name}</Body>
        {resource.metadata?.workspaceName && (
          <Caption>
            {resource.metadata.workspaceName}
          </Caption>
        )}
      </div>
    </div>
  ),

  autoSyncProviderLabel: "Asana",
};

export default function AsanaModal(props: AsanaModalProps) {
  const [getProjects] = useLazyGetAsanaProjectsQuery();
  const fetchAllResources = useCallback(
    async (connectionId: string) => {
      return getProjects(connectionId).unwrap();
    },
    [getProjects],
  );
  return (
    <ResourceWizardModal
      {...props}
      config={CONFIG}
      fetchAllResources={fetchAllResources}
    />
  );
}
