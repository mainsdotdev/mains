import { useState } from "react";
import { Edit, Trash } from "@/components/ui/icons";
import {
  useDeletePulseMutation,
  useGetPulsesQuery,
  useTogglePulseMutation,
  type Pulse,
} from "@/lib/redux/api/pulseApi";
import { useListWorkspacesQuery } from "@/lib/redux/api/workspaceApi";
import { formatSchedule } from "../lib/format-schedule";
import { Body, Button, Text } from "@/components/ui";

interface PulseListProps {
  onEdit: (pulse: Pulse) => void;
}

export function PulseList({ onEdit }: PulseListProps) {
  const { data: pulses = [], isLoading } = useGetPulsesQuery();
  const { data: workspaces = [] } = useListWorkspacesQuery();
  const [togglePulse] = useTogglePulseMutation();
  const [deletePulse] = useDeletePulseMutation();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Text as="div" tone="faint" className="px-1 py-3">
        Loading…
      </Text>
    );
  }

  if (pulses.length === 0) {
    return null;
  }

  return (
    <section>
      <Body
        weight="medium"
        className="mb-3 pb-2 border-b border-primary-200/40 dark:border-primary-800/60"
      >
        Current
      </Body>
      <ul className="">
        {pulses.map((pulse) => {
          const workspace = workspaces.find((w) => w.id === pulse.workspaceId);
          const isConfirming = confirmDeleteId === pulse.id;
          return (
            <li
              key={pulse.id}
              className="group flex items-center gap-3 py-3"
            >
              <Button
                type="button"
                tooltip={pulse.isActive ? "Disable" : "Enable"}
                onClick={() =>
                  togglePulse({ id: pulse.id, isActive: !pulse.isActive })
                }
                className="cursor-pointer p-0"
              >
                <span
                  className={`block size-4 rounded-full border-2 ${
                    pulse.isActive
                      ? "border-primary-700 dark:border-primary-200 bg-primary-700/20 dark:bg-primary-200/30"
                      : "border-primary-400 dark:border-primary-600"
                  }`}
                />
              </Button>

              <div className="flex-1 min-w-0 flex items-baseline gap-2">
                <Text as="span" className="truncate">
                  {pulse.title}
                </Text>
                {workspace && (
                  <Text as="span" size="xs" tone="faint" className="truncate">
                    {workspace.name}
                  </Text>
                )}
              </div>

              <div
                className={`flex items-center gap-1 transition-opacity ${
                  // Confirming keeps them up: the buttons are live, and a live
                  // control must not vanish because the pointer moved away.
                  isConfirming ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <Button
                  type="button"
                  tooltip="Edit"
                  onClick={() => onEdit(pulse)}
                  className="p-1.5 rounded-lg hover:bg-primary-200/30 dark:hover:bg-primary-800 cursor-pointer text-primary-500"
                >
                  <Edit className="size-4" />
                </Button>
                {isConfirming ? (
                  <>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={async () => {
                        await deletePulse(pulse.id).unwrap();
                        setConfirmDeleteId(null);
                      }}
                      className="px-2 py-1 rounded-lg text-xs cursor-pointer"
                    >
                      Confirm
                    </Button>
                    <Button
                    variant="primary"
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 rounded-lg text-xs cursor-pointer "
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    tooltip="Delete"
                    onClick={() => setConfirmDeleteId(pulse.id)}
                    className="p-1.5 rounded-lg hover:bg-primary-200/30 dark:hover:bg-primary-800 cursor-pointer text-primary-500"
                  >
                    <Trash className="size-4" />
                  </Button>
                )}
              </div>
              <Text
                as="span"
                size="xs"
                tone="faint"
                className="whitespace-nowrap"
              >
                {formatSchedule({
                  frequency: pulse.frequency,
                  hour: pulse.hour,
                  minute: pulse.minute,
                  dayOfWeek: pulse.dayOfWeek,
                })}
              </Text>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
