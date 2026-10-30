import { useState } from "react";
import type { IssueStatus, ProviderIssueState } from "@mains/contracts/issue-status";
import { Button, Modal, ModalHeader, Muted, Select, Text, toast } from "@/components/ui";
import {
  useGetConnectionStatesQuery,
  useGetIssueStatesQuery,
  useGetIssueStatusesQuery,
  useGetSelectedResourcesQuery,
  useSetIssueStatusMappingMutation,
} from "@/lib/redux/api";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { ProviderIcon } from "@/features/workspace/components/provider-icon";
import { resourceLabel, supportsStatusMapping, type TasksScope } from "../lib/scope";
import { IssueStatusIcon } from "./issue-status";

/** The Select value for "no mapping — let sync decide". */
const AUTOMATIC = "__automatic__";

/**
 * Why a resource has nothing to map, in the provider's own terms. Asana and
 * Trello states are columns the user makes; without any, items stay open
 * until they're completed or archived.
 */
const NO_STATES_HINTS: Record<string, string> = {
  asana:
    "No sections in this project, so its tasks are open until they're completed. Add sections in Asana (like To do, Doing, Done) to map them here.",
  trello: "No lists on this board yet. Its cards are open until they're archived.",
};

/**
 * Providers whose issues are only open or closed: nothing to map, so the
 * modal shows the fixed rule sync applies (`statusFromOpenClosed`).
 */
const FIXED_STATUSES: Record<string, Array<{ state: string; statusId: string }>> = {
  github: [
    { state: "Open", statusId: "todo" },
    { state: "Closed as completed", statusId: "done" },
    { state: "Closed as not planned", statusId: "canceled" },
  ],
  gitlab: [
    { state: "Open", statusId: "todo" },
    { state: "Closed", statusId: "done" },
  ],
};

/** Provider colors are data (Linear state colors); only a plain hex is painted. */
function providerColor(value: string | null): string | null {
  return value && /^#[\da-f]{6}$/i.test(value) ? value : null;
}

/**
 * Opens the status mapping for the sidebar's scope: one connection, or every
 * connected one under All issues.
 */
export function StatusMappingButton({ scope }: { scope: TasksScope }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="shrink-0">
        <Text size="s" variant="button">
          Statuses
        </Text>
      </Button>
      {open && (
        <StatusMappingModal
          provider={scope.provider}
          resourceId={scope.resourceId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Which Mains status each provider state counts as. Scoped to one connection
 * (and one team / project / board when the sidebar has one selected), or —
 * with no provider — a section per connected issue connection. Open/closed
 * providers show their fixed rule instead of selects.
 */
export function StatusMappingModal({
  provider,
  resourceId,
  onClose,
}: {
  provider: string | null;
  resourceId: string | null;
  onClose: () => void;
}) {
  const { data: connections = [] } = useGetConnectionStatesQuery();
  const { data: statuses = [] } = useGetIssueStatusesQuery();
  const shown = provider
    ? [{ id: provider, displayName: connections.find((c) => c.id === provider)?.displayName ?? provider }]
    : connections
        .filter((connection) => connection.category === "issues" && connection.isConnected)
        .sort((a, b) => a.sortOrder - b.sortOrder);
  const title = provider ? `${shown[0].displayName} statuses` : "Statuses";

  return (
    <Modal isOpen onClose={onClose} className="w-full max-w-xl rounded-3xl">
      <ModalHeader onClose={onClose}>
        <Text as="h2" size="base" weight="medium">
          {title}
        </Text>
      </ModalHeader>
      <div className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto px-6 pb-6">
        <Muted size="xs">
          Pick the status each state counts as. Done and Canceled count as closed; everything
          else shows under Open. Changes apply right away, to issues already synced too.
        </Muted>
        {shown.map((connection) => (
          <ConnectionStatuses
            key={connection.id}
            provider={connection.id}
            name={connection.displayName}
            resourceId={provider ? resourceId : null}
            withHeading={!provider}
            statuses={statuses}
          />
        ))}
      </div>
    </Modal>
  );
}

function ConnectionStatuses({
  provider,
  name,
  resourceId,
  withHeading,
  statuses,
}: {
  provider: string;
  name: string;
  resourceId: string | null;
  /** Under All issues, where several connections share the modal. */
  withHeading: boolean;
  statuses: IssueStatus[];
}) {
  return (
    <section aria-label={withHeading ? name : undefined} className="flex flex-col gap-3">
      {withHeading && (
        <div className="flex items-center gap-2">
          <span aria-hidden className="flex shrink-0">
            <ProviderIcon provider={provider} className="size-4 shrink-0 text-primary-800 dark:text-primary-200" />
          </span>
          <Text size="s" weight="medium">
            {name}
          </Text>
        </div>
      )}
      {supportsStatusMapping(provider) ? (
        <MappedResources provider={provider} resourceId={resourceId} statuses={statuses} />
      ) : (
        <FixedStatuses provider={provider} name={name} statuses={statuses} />
      )}
    </section>
  );
}

function MappedResources({
  provider,
  resourceId,
  statuses,
}: {
  provider: string;
  resourceId: string | null;
  statuses: IssueStatus[];
}) {
  const { data, isLoading } = useGetSelectedResourcesQuery(provider);
  const resources = ((data?.items ?? []) as Array<Record<string, unknown> & { id: string }>).filter(
    (resource) => !resourceId || resource.id === resourceId,
  );
  if (!isLoading && resources.length === 0) {
    return (
      <Text size="s" tone="subtle">
        No teams or projects are linked to this connection yet.
      </Text>
    );
  }
  return (
    <>
      {resources.map((resource) => (
        <ResourceStates
          key={resource.id}
          provider={provider}
          resourceId={resource.id}
          label={resources.length > 1 ? resourceLabel(resource) : null}
          statuses={statuses}
        />
      ))}
    </>
  );
}

function FixedStatuses({ provider, name, statuses }: { provider: string; name: string; statuses: IssueStatus[] }) {
  const rules = FIXED_STATUSES[provider];
  if (!rules) {
    return (
      <Text size="s" tone="subtle">
        No states to map.
      </Text>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Text size="s" tone="subtle" className="pb-1">
        {name} issues are only open or closed, so their status follows that.
      </Text>
      {rules.map((rule) => {
        const status = statuses.find((candidate) => candidate.id === rule.statusId);
        return (
          <div key={rule.state} className="flex items-center justify-between gap-3 py-1">
            <Text size="s" className="truncate">
              {rule.state}
            </Text>
            <span className="flex shrink-0 items-center gap-2">
              {status && <IssueStatusIcon status={status} />}
              <Text size="s" tone="secondary">
                {status?.name ?? rule.statusId}
              </Text>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ResourceStates({
  provider,
  resourceId,
  label,
  statuses,
}: {
  provider: string;
  resourceId: string;
  label: string | null;
  statuses: IssueStatus[];
}) {
  const { data, isLoading, error } = useGetIssueStatesQuery(resourceId);
  const [setMapping] = useSetIssueStatusMappingMutation();

  const statusName = (id: string) => statuses.find((status) => status.id === id)?.name ?? id;

  const change = (state: ProviderIssueState, value: string) => {
    const statusId = value === AUTOMATIC ? null : value;
    setMapping({ resourceId, stateId: state.id, statusId })
      .unwrap()
      .catch((err: unknown) => toast.error(extractErrorMessage(err, "Couldn't save the mapping")));
  };

  return (
    <section aria-label={label ?? "States"} className="flex flex-col gap-1">
      {label && (
        <Text size="xs" weight="medium" tone="subtle" className="pb-1">
          {label}
        </Text>
      )}
      {isLoading ? (
        <Text size="s" tone="inherit" className="shine-text">
          Loading states...
        </Text>
      ) : error ? (
        <Text size="s" tone="danger">
          {extractErrorMessage(error, "Couldn't load this connection's states")}
        </Text>
      ) : !data?.supported || data.states.length === 0 ? (
        <Text size="s" tone="subtle">
          {NO_STATES_HINTS[provider] ?? "No states to map."}
        </Text>
      ) : (
        data.states.map((state) => {
          const color = providerColor(state.color);
          return (
            <div key={state.id} className="flex items-center justify-between gap-3 py-1">
              <div className="flex min-w-0 items-center gap-2">
                {color && (
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                )}
                <Text size="s" className="truncate">
                  {state.name}
                </Text>
              </div>
              <Select
                size="s"
                aria-label={`Status for ${state.name}`}
                value={state.mapped ? state.statusId : AUTOMATIC}
                options={[
                  {
                    value: AUTOMATIC,
                    label: `Automatic · ${statusName(state.defaultStatusId)}`,
                    selectedLabel: statusName(state.defaultStatusId),
                  },
                  ...statuses.map((status) => ({ value: status.id, label: status.name })),
                ]}
                onChange={(value) => change(state, value)}
              />
            </div>
          );
        })
      )}
    </section>
  );
}
