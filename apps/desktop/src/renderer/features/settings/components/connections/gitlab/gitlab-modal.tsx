import { useCallback } from "react";
import { Body, Caption } from "@/components/ui";
import { Lock as LockIcon } from "@/components/ui/icons";
import { useLazyGetGitLabProjectsQuery } from "@/lib/redux/api";
import {
  ResourceWizardModal,
  type ResourceWizardConfig,
} from "../shared/resource-wizard-modal";

interface GitLabModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
}

function readVisibility(metadata: unknown): string | null {
  if (!metadata) return null;
  try {
    const parsed =
      typeof metadata === "string" ? JSON.parse(metadata) : metadata;
    return (parsed as { visibility?: string })?.visibility ?? null;
  } catch {
    return null;
  }
}

const CONFIG: ResourceWizardConfig = {
  provider: "gitlab",
  appName: "GitLab",
  modalTitle: "GitLab",
  icon: "connections/gitlab.png",

  credentialDescription:
    "Enter your GitLab credentials to connect your projects and sync issues.",
  credentialFields: [
    {
      id: "gitlab-domain",
      label: "GitLab Domain",
      placeholder: "gitlab.com",
      type: "text",
      required: false,
      dataKey: "domain",
      helperText:
        "Leave empty for gitlab.com, or enter your self-hosted domain (e.g. gitlab.yourcompany.com)",
    },
    {
      id: "gitlab-token",
      label: "Personal Access Token",
      placeholder: "glpat-xxxxxxxxxxxxxxxxxxxx",
      dataKey: "token",
      emptyError: "Please enter a valid token",
    },
  ],
  credentialInstructions: (
    <>
      <strong>How to create a token:</strong>
      <br />
      1. Go to GitLab Settings → Access Tokens →{" "}
      <a
        href="https://gitlab.com/-/user_settings/personal_access_tokens"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 underline"
      >
        Personal access tokens
      </a>
      <br />
      2. Create a new token
      <br />
      3. Select scopes: <code>read_api</code>
    </>
  ),
  buildCredentials: (values) => ({
    token: values.token,
    domain: values.domain || "gitlab.com",
  }),

  loadingMessage: "Loading projects...",
  selectTitle:
    "Select the projects you want to sync issues and merge requests from.",
  resourceLabel: "project",
  resourceLabelPlural: "projects",
  saveButtonLabel: (count) => `Save ${count} Projects`,
  addButtonLabel: "Add Project",
  revokeButtonLabel: "Revoke GitLab Access",
  revokeDescription:
    "This will disconnect all projects and remove all GitLab data. This action cannot be undone.",

  identityForItem: (project) => String(project.id),
  identityForCurrent: (current) => current.externalId,
  // The id is opaque here, so the search text is the label the row renders.
  searchTextForItem: (project) =>
    [project.pathWithNamespace, project.name].filter(Boolean).join(" "),

  renderItemForSelect: (project) => (
    <div className="flex items-center gap-2">
      <Body>{project.pathWithNamespace || project.name}</Body>
      {project.visibility &&
        (project.visibility === "private" ? (
          <LockIcon className="w-3 h-3 text-primary-500" />
        ) : (
          <Caption>{project.visibility}</Caption>
        ))}
    </div>
  ),
  renderItemForManage: (resource) => {
    const visibility = readVisibility(resource.metadata);
    return (
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Body>{resource.name}</Body>
          {visibility &&
            (visibility === "private" ? (
              <LockIcon className="w-3 h-3 text-primary-500" />
            ) : (
              <Caption>{visibility}</Caption>
            ))}
        </div>
      </div>
    );
  },

  autoSyncProviderLabel: "GitLab",
};

export default function GitLabModal(props: GitLabModalProps) {
  const [getProjects] = useLazyGetGitLabProjectsQuery();
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
