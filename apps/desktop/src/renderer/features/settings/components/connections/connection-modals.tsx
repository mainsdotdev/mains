import AsanaModal from "./asana/asana-modal";
import GitHubModal from "./github/github-modal";
import GitLabModal from "./gitlab/gitlab-modal";
import JiraModal from "./jira/jira-modal";
import LinearModal from "./linear/linear-modal";
import TrelloModal from "./trello/trello-modal";
import SentryModal from "./sentry/sentry-modal";
import SocketDevModal from "./socketdev/socketdev-modal";

export type ConnectionModalProps = {
  open: boolean;
  onClose: () => void;
  isConnected: boolean;
  onSuccess: () => void;
};

const CONNECTION_MODALS: Array<{
  id: string;
  Component: React.ComponentType<ConnectionModalProps>;
}> = [
  { id: "github", Component: GitHubModal },
  { id: "gitlab", Component: GitLabModal },
  { id: "jira", Component: JiraModal },
  { id: "asana", Component: AsanaModal },
  { id: "linear", Component: LinearModal },
  { id: "trello", Component: TrelloModal },
  { id: "sentry", Component: SentryModal },
  { id: "socketdev", Component: SocketDevModal },
];

/**
 * Mounts every provider's connect/manage modal and opens the one named by
 * `activeModal` (a connection state id). Shared by Settings › Connections and
 * the /tasks sidebar, so both open the exact same flow.
 */
export function ConnectionModalHost({
  activeModal,
  isConnected,
  onClose,
  onSuccess,
}: {
  activeModal: string | null;
  isConnected: (appId: string) => boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  return (
    <>
      {CONNECTION_MODALS.map(({ id, Component }) => (
        <Component
          key={id}
          open={activeModal === id}
          onClose={onClose}
          isConnected={isConnected(id)}
          onSuccess={onSuccess}
        />
      ))}
    </>
  );
}
