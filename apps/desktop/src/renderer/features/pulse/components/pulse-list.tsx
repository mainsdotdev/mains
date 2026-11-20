import { useEffect, useState } from "react";
import { Clock, Close, Edit, Minus, Play, Trash } from "@/components/ui/icons";
import {
  useDeletePulseMutation,
  useRunPulseNowMutation,
  useTogglePulseMutation,
  type Pulse,
} from "@/lib/redux/api/pulseApi";
import { useListWorkspacesQuery } from "@/lib/redux/api/workspaceApi";
import { useGetAccountQuery } from "@/lib/redux/api/accountApi";
import { useListCollectionsQuery } from "@/lib/redux/api/collectionsApi";
import { extractErrorMessage } from "@/lib/extract-error-message";
import { cn } from "@/lib/cn";
import {
  Alert,
  AsciiSpinner,
  Body,
  Button,
  Caption,
  StatusBadge,
  Text,
  Toggle,
  type StatusTone,
  toast,
} from "@/components/ui";
import { formatSchedule } from "../lib/format-schedule";
import { describePulseStatus, type PulseState } from "../lib/pulse-status";

interface PulseListProps {
  /** Already search-filtered by the page. */
  pulses: Pulse[];
  isLoading: boolean;
  /** A search is narrowing `pulses` — hide the section rather than claim nothing is scheduled. */
  searching: boolean;
  onEdit: (pulse: Pulse) => void;
}

const PULSE_STATUS = {
  active: { tone: "info", icon: Clock },
  paused: { tone: "neutral", icon: Minus },
  failed: { tone: "danger", icon: Close },
} satisfies Record<PulseState, { tone: StatusTone; icon: typeof Clock }>;

/** Re-render once a minute so "Next in 3h" doesn't go stale on an open page. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function PulseList({
  pulses,
  isLoading,
  searching,
  onEdit,
}: PulseListProps) {
  const { data: workspaces = [] } = useListWorkspacesQuery();
  const { data: account } = useGetAccountQuery();
  const { data: collections = [] } = useListCollectionsQuery(
    { accountId: account?.id ?? "" },
    { skip: !account },
  );
  const [deletePulse, { isLoading: isDeleting }] = useDeletePulseMutation();
  const [pendingDelete, setPendingDelete] = useState<Pulse | null>(null);
  const now = useMinuteClock();

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deletePulse(pendingDelete.id).unwrap();
      setPendingDelete(null);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to delete pulse"));
    }
  };

  const targetName = (pulse: Pulse): string | null => {
    if (pulse.assistantId) return "Mate routine";
    if (pulse.workspaceId) {
      return workspaces.find((w) => w.id === pulse.workspaceId)?.name ?? null;
    }
    if (pulse.collectionId) {
      return collections.find((c) => c.id === pulse.collectionId)?.name ?? null;
    }
    return null;
  };

  const activeCount = pulses.filter((p) => p.isActive).length;

  if (searching && pulses.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <Body weight="medium">Your pulses</Body>
        {!searching && pulses.length > 0 && (
          <Caption tone="faint">
            {activeCount} of {pulses.length} running
          </Caption>
        )}
      </div>

      {isLoading ? (
        <Text as="div" size="xs" tone="faint" className="px-1 py-3">
          Loading…
        </Text>
      ) : pulses.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-primary-300/70 dark:border-primary-800 px-5 py-5">
          <Body>Nothing scheduled yet</Body>
          <Caption as="p" tone="subtle" className="mt-1">
            Pick a template below, or start a pulse from scratch.
          </Caption>
        </div>
      ) : (
        <div className="rounded-3xl glass-surface px-4 py-1">
          {pulses.map((pulse, index) => (
            <div
              key={pulse.id}
              className={
                index > 0
                  ? "border-t border-primary-200/60 dark:border-primary-800/20"
                  : undefined
              }
            >
              <PulseRow
                pulse={pulse}
                target={targetName(pulse)}
                now={now}
                onEdit={() => onEdit(pulse)}
                onDelete={() => setPendingDelete(pulse)}
              />
            </div>
          ))}
        </div>
      )}

      <Alert
        isOpen={!!pendingDelete}
        title="Delete pulse?"
        description="The pulse stops running and is removed. Runs it already started stay in your history."
        primaryButtonText="Delete"
        secondaryButtonText="Cancel"
        primaryButtonVariant="danger"
        isPrimaryLoading={isDeleting}
        onPrimary={handleDelete}
        onSecondary={() => setPendingDelete(null)}
      />
    </section>
  );
}

function PulseRow({
  pulse,
  target,
  now,
  onEdit,
  onDelete,
}: {
  pulse: Pulse;
  target: string | null;
  now: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [togglePulse, { isLoading: isToggling }] = useTogglePulseMutation();
  const [runPulseNow, { isLoading: isRunning }] = useRunPulseNowMutation();
  const status = describePulseStatus(pulse, now);
  const statusStyle = PULSE_STATUS[status.state];
  const schedule = formatSchedule({
    frequency: pulse.frequency,
    hour: pulse.hour,
    minute: pulse.minute,
    dayOfWeek: pulse.dayOfWeek,
  });

  const handleToggle = async (isActive: boolean) => {
    try {
      await togglePulse({ id: pulse.id, isActive }).unwrap();
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to update pulse"));
    }
  };

  const handleRunNow = async () => {
    try {
      await runPulseNow(pulse.id).unwrap();
      toast.success(pulse.assistantId ? `Task queued for “${pulse.title}”` : `Started “${pulse.title}”`);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to start pulse"));
    }
  };

  return (
    <div className="group flex items-center gap-4 py-3">
      <Button
        onClick={onEdit}
        className="flex-1 min-w-0 text-left rounded-lg focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Body
          as="div"
          tone={pulse.isActive ? "default" : "subtle"}
          className="truncate"
        >
          {pulse.title}
        </Body>
        <Caption
          as="div"
          tone="subtle"
          className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5"
        >
          {/* The target name is the only part long enough to need cutting. */}
          {target && (
            <>
              <span className="truncate">{target}</span>
              <MetaDot />
            </>
          )}
          <span className="shrink-0 whitespace-nowrap">{schedule}</span>
          <StatusBadge tone={statusStyle.tone} icon={statusStyle.icon} title={pulse.lastError ?? undefined}>
            {status.label ?? "Active"}
          </StatusBadge>
        </Caption>
      </Button>

      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 transition-opacity",
          // A run in flight keeps its spinner visible after the pointer leaves.
          isRunning
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <Button
          tooltip="Run now"
          aria-label="Run now"
          onClick={handleRunNow}
          disabled={isRunning}
          variant="icon"
        >
          {isRunning ? (
            <AsciiSpinner variant="inherit" kind="circle" />
          ) : (
            <Play className="size-3.5" />
          )}
        </Button>
        <Button
          tooltip="Edit"
          aria-label="Edit"
          onClick={onEdit}
          variant="icon"
        >
          <Edit className="size-4" />
        </Button>
        <Button
          tooltip="Delete"
          aria-label="Delete"
          onClick={onDelete}
          variant="icon"
        >
          <Trash className="size-4" />
        </Button>
      </div>

      <Toggle
        aria-label={pulse.isActive ? "Pause pulse" : "Resume pulse"}
        enabled={pulse.isActive}
        onChange={handleToggle}
        disabled={isToggling}
        className="shrink-0 py-0"
      />
    </div>
  );
}

function MetaDot() {
  return (
    <span
      aria-hidden
      className="size-0.75 shrink-0 rounded-full bg-primary-400 dark:bg-primary-600"
    />
  );
}
