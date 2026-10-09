import { useRef } from "react";
import { Button } from "./button";
import { Danger, ProjectFolder, Terminal, Web } from "./icons";
import { Modal } from "./modal";
import Text from "./text";

interface FullAccessConfirmationModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function FullAccessConfirmationModal({
  isOpen,
  onConfirm,
  onCancel,
}: FullAccessConfirmationModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      initialFocusRef={cancelRef}
      className="w-full max-w-xl"
      aria-labelledby="full-access-confirmation-title"
      aria-describedby="full-access-confirmation-description"
    >
      <div className="overflow-y-auto p-6 sm:p-7">
        <div className="flex items-center gap-3">
          <Danger className="size-6 shrink-0 text-danger" aria-hidden="true" />
          <Text as="h2" id="full-access-confirmation-title" size="xl" weight="semibold">
            Turn on Full Access?
          </Text>
        </div>

        <Text
          as="p"
          id="full-access-confirmation-description"
          size="sm"
          tone="muted"
          className="mt-4"
        >
          Codex will be able to run commands, use the internet, and read or change
          files anywhere on this computer.
        </Text>

        <div className="mt-5 divide-y divide-primary-200/60 rounded-2xl bg-primary-100/60 px-4 dark:divide-primary/10 dark:bg-primary/5">
          <div className="flex items-start gap-3 py-3">
            <ProjectFolder className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <Text as="p" size="sm" weight="medium">Files and folders</Text>
              <Text as="p" size="s" tone="muted">
                Read, create, modify, or delete files anywhere on this computer
              </Text>
            </div>
          </div>
          <div className="flex items-start gap-3 py-3">
            <Terminal className="mt-0.5 size-5 shrink-0 text-primary-700 dark:text-primary-300" aria-hidden="true" />
            <div>
              <Text as="p" size="sm" weight="medium">Terminal commands</Text>
              <Text as="p" size="s" tone="muted">
                Run commands, install software, and change system settings
              </Text>
            </div>
          </div>
          <div className="flex items-start gap-3 py-3">
            <Web className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <Text as="p" size="sm" weight="medium">Internet and connected apps</Text>
              <Text as="p" size="s" tone="muted">
                Access websites, send data, and use enabled integrations
              </Text>
            </div>
          </div>
        </div>

        <Text as="p" size="s" tone="muted" className="mt-5">
          Full Access increases the risk of data loss, exposure of sensitive
          information, and prompt injection. You can switch back to a restricted
          mode at any time.
        </Text>

        <div className="mt-6 flex justify-end gap-3">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
