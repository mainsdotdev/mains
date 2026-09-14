import { useCallback } from "react";
import { Body, Caption } from "@/components/ui";
import { useLazyGetSentryProjectsQuery } from "@/lib/redux/api";
import {
  ResourceWizardModal,
  type ResourceWizardConfig,
} from "../shared/resource-wizard-modal";

interface SentryModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
}

const CONFIG: ResourceWizardConfig = {
  provider: "sentry",
  appName: "Sentry",
  modalTitle: "Sentry",
  icon: "connections/sentry.png",

  credentialDescription:
    "Enter your Sentry Auth Token and organization slug to connect your projects.",
  credentialFields: [
    {
      id: "sentry-token",
      label: "Auth Token",
      placeholder: "sntrys_xxxxxxxxxxxxxxxxxxxx",
      dataKey: "token",
      emptyError: "Please enter a valid Auth Token",
    },
    {
      id: "sentry-org",
      label: "Organization Slug",
      placeholder: "my-org",
      dataKey: "organization",
      emptyError: "Please enter your organization slug",
    },
  ],
  credentialInstructions: (
    <>
      <strong>How to create a token:</strong>
      <br />
      1. Go to Sentry Settings →{" "}
      <a
        href="https://sentry.io/settings/auth-tokens/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 underline"
      >
        Auth Tokens
      </a>
      <br />
      2. Create a new token
      <br />
      3. Select scopes: <code>project:read</code>, <code>event:read</code>,{" "}
      <code>org:read</code>
      <br />
      <br />
      <strong>Organization slug:</strong> found in your Sentry URL:{" "}
      <code>sentry.io/organizations/[slug]/</code>
    </>
  ),
  buildCredentials: (values) => ({
    token: values.token,
    organization: values.organization,
  }),

  loadingMessage: "Loading projects...",
  selectTitle: "Select the Sentry projects you want to monitor.",
  resourceLabel: "project",
  resourceLabelPlural: "projects",
  saveButtonLabel: (count) => `Save ${count} Projects`,
  addButtonLabel: "Add Project",
  revokeButtonLabel: "Revoke Sentry Access",
  revokeDescription:
    "This will disconnect all projects and remove all Sentry data. This action cannot be undone.",

  identityForItem: (project) => project.slug,
  searchTextForItem: (project) =>
    [project.name, project.slug, project.platform].filter(Boolean).join(" "),
  identityForCurrent: (current) => current.slug,

  renderItemForSelect: (project) => (
    <div className="flex items-center gap-2">
      <Body>{project.name}</Body>
      {project.platform && (
        <Caption>
          {project.platform}
        </Caption>
      )}
    </div>
  ),
  renderItemForManage: (resource) => (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <Body>{resource.name}</Body>
        {resource.metadata?.platform && (
          <Caption>
            {resource.metadata.platform}
          </Caption>
        )}
      </div>
    </div>
  ),

  autoSyncProviderLabel: "Sentry",
};

export default function SentryModal(props: SentryModalProps) {
  const [getProjects] = useLazyGetSentryProjectsQuery();
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
