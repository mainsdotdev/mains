import { useCallback } from "react";
import { Body, Caption } from "@/components/ui";
import { useLazyGetJiraProjectsQuery } from "@/lib/redux/api";
import {
  ResourceWizardModal,
  type ResourceWizardConfig,
} from "../shared/resource-wizard-modal";

interface JiraModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
}

const CONFIG: ResourceWizardConfig = {
  provider: "jira",
  appName: "Jira",
  modalTitle: "Jira",
  icon: "connections/jira.png",

  credentialDescription:
    "Enter your Jira credentials to connect your projects and sync issues.",
  credentialFields: [
    {
      id: "jira-domain",
      label: "Jira Domain",
      placeholder: "your-company.atlassian.net",
      type: "text",
      dataKey: "domain",
      emptyError: "Please enter your Jira domain",
    },
    {
      id: "jira-email",
      label: "Email",
      placeholder: "you@example.com",
      type: "email",
      dataKey: "email",
      emptyError: "Please enter your email",
    },
    {
      id: "jira-api-token",
      label: "API Token",
      placeholder: "Your API token",
      dataKey: "apiToken",
      emptyError: "Please enter your API token",
    },
  ],
  credentialInstructions: (
    <>
      <strong>How to create an API token:</strong>
      <br />
      1. Go to{" "}
      <a
        href="https://id.atlassian.com/manage-profile/security/api-tokens"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 underline"
      >
        Atlassian API tokens
      </a>
      <br />
      2. Click &quot;Create API token&quot;
      <br />
      3. Give it a name and copy the token
    </>
  ),
  buildCredentials: (values) => ({
    apiToken: values.apiToken,
    domain: values.domain,
    email: values.email,
  }),

  loadingMessage: "Loading projects...",
  selectTitle: "Select the projects you want to sync issues from.",
  resourceLabel: "project",
  resourceLabelPlural: "projects",
  saveButtonLabel: (count) => `Save ${count} Projects`,
  addButtonLabel: "Add Project",
  revokeButtonLabel: "Revoke Jira Access",
  revokeDescription:
    "This will disconnect all projects and remove all Jira data. This action cannot be undone.",

  identityForItem: (project) => project.key,
  identityForCurrent: (current) => current.key,
  searchTextForItem: (project) =>
    [project.name, project.key].filter(Boolean).join(" "),

  renderItemForSelect: (project) => (
    <div className="flex items-center gap-2">
      <Body>{project.name}</Body>
      <Caption>{project.key}</Caption>
    </div>
  ),
  renderItemForManage: (resource) => (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <Body>{resource.name}</Body>
        <Caption>{resource.key}</Caption>
      </div>
    </div>
  ),

  autoSyncProviderLabel: "Jira",
};

export default function JiraModal(props: JiraModalProps) {
  const [getProjects] = useLazyGetJiraProjectsQuery();
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
