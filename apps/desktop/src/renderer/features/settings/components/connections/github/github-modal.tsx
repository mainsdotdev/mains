import { useCallback } from "react";
import { Body } from "@/components/ui";
import { Lock } from "@/components/ui/icons";
import { useLazyGetGitHubReposQuery } from "@/lib/redux/api";
import {
  ResourceWizardModal,
  type ResourceWizardConfig,
} from "../shared/resource-wizard-modal";
import { GitHubDeviceFlowPanel } from "./github-device-flow-panel";

interface GitHubModalProps {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess?: () => void;
}

const CONFIG: ResourceWizardConfig = {
  provider: "github",
  appName: "GitHub",
  modalTitle: "Github",
  icon: "connections/github.png",

  credentialDescription:
    "Enter your GitHub Personal Access Token to connect your repositories.",
  credentialFields: [
    {
      id: "github-token",
      label: "",
      placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
      dataKey: "token",
      emptyError: "Please enter a valid token",
    },
  ],
  credentialInstructions: (
    <>
      Create a{" "}
      <a
        href="https://github.com/settings/tokens"
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 underline"
      >
        classic token
      </a>{" "}
      with the <code>repo</code> and <code>read:user</code> scopes.
    </>
  ),
  buildCredentials: (values) => ({ token: values.token }),

  // OAuth device flow as the default sign-in; the PAT form stays as the
  // second tab. Both paths save a plain token via saveCredentials.
  credentialAlternative: {
    label: "Sign in with GitHub",
    tokenLabel: "Access token",
    render: ({ submitValues, submitting }) => (
      <GitHubDeviceFlowPanel
        submitting={submitting}
        onToken={(token) => submitValues({ token })}
      />
    ),
  },

  loadingMessage: "Loading repositories...",
  selectTitle: "Select the repositories you want to connect.",
  resourceLabel: "repository",
  resourceLabelPlural: "repositories",
  saveButtonLabel: (count) => `Save ${count} Repositories`,
  addButtonLabel: "Add Repository",
  revokeButtonLabel: "Revoke GitHub Access",
  revokeDescription:
    "This will disconnect all repositories and remove all GitHub data. This action cannot be undone.",

  identityForItem: (item) => item.fullName,
  identityForCurrent: (current) => current.fullName,
  searchTextForItem: (repo) => repo.fullName ?? "",

  renderItemForSelect: (repo) => (
    <div className="flex items-center gap-2">
      <Body>{repo.fullName}</Body>
      {repo.private && (
        <Lock className="w-3 h-3 text-primary-600 dark:text-primary-400" />
      )}
    </div>
  ),
  renderItemForManage: (resource) => (
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <Body>{resource.fullName}</Body>
        {resource.metadata?.private && (
          <Lock className="w-3 h-3 text-primary-600 dark:text-primary-400" />
        )}
      </div>
    </div>
  ),

  autoSyncProviderLabel: "GitHub",
};

export default function GitHubModal(props: GitHubModalProps) {
  const [getRepos] = useLazyGetGitHubReposQuery();
  const fetchAllResources = useCallback(
    async (connectionId: string) => {
      return getRepos(connectionId).unwrap();
    },
    [getRepos],
  );
  return (
    <ResourceWizardModal
      {...props}
      config={CONFIG}
      fetchAllResources={fetchAllResources}
    />
  );
}
