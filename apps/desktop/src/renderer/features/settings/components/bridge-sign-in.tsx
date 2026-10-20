import { useRef, useState } from "react";
import type { BridgeAuthStatus } from "@mains/contracts/bridge-auth";
import { Button, Input, Modal, ModalHeader, Muted, Text, Toggle } from "@/components/ui";
import { appApi } from "@/lib/transport";
import { SettingsRow, SettingsSection } from "./settings-layout";

export function BridgeSignInSection({
  status,
  isRemote,
  onSignedIn,
}: {
  status: BridgeAuthStatus;
  isRemote: boolean;
  onSignedIn: () => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [hubUrl, setHubUrl] = useState("");
  const [includeExisting, setIncludeExisting] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  function open() {
    const defaultHub = status.hubUrl?.trim() || (
      typeof __MAINS_BRIDGE_HUB_URL__ === "string" ? __MAINS_BRIDGE_HUB_URL__.trim() : ""
    );
    setLabel(status.label);
    setHubUrl(defaultHub);
    setIncludeExisting(true);
    setAdvanced(!defaultHub);
    setError(null);
    setIsOpen(true);
  }

  function close() {
    if (!busy) setIsOpen(false);
  }

  async function signIn() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await appApi.bridge.signIn({
        hubUrl: hubUrl.trim(),
        label: label.trim() || undefined,
        includeExisting,
        flow: isRemote ? "device" : "loopback",
      });
      if (!response.success) throw new Error(response.error);
      setIsOpen(false);
      await onSignedIn();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start Bridge sign-in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection title="Account">
      <SettingsRow title="Not connected" description="Sign in to sync Atlas and chats across your devices.">
        <Button variant="submit" onClick={open}>Sign in</Button>
      </SettingsRow>
      <Modal
        isOpen={isOpen}
        onClose={close}
        initialFocusRef={nameRef}
        closeOnEscape={!busy}
        closeOnBackdrop={!busy}
        className="w-full max-w-lg"
      >
        <ModalHeader onClose={close}>
          <Text as="h2" size="base" weight="medium">Sign in to Bridge</Text>
        </ModalHeader>
        <form
          className="space-y-5 overflow-y-auto px-6 pb-5 pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          {error && <Text role="alert" tone="danger">{error}</Text>}
          <Muted size="xs">Continue in your browser with GitHub or your email and password.</Muted>
          <Text as="label" className="block space-y-2">
            <span className="block">Device name</span>
            <Input
              ref={nameRef}
              disabled={busy}
              placeholder={isRemote ? "Connected computer" : "This device"}
              maxLength={128}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Text>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <Text>Include existing history and Atlas</Text>
              <Muted size="xs">
                {status.existing.runs} chats · {status.existing.pages} pages. Turn off to keep these items local.
              </Muted>
            </div>
            <Toggle
              aria-label="Include existing history and Atlas"
              enabled={includeExisting}
              disabled={busy}
              className="shrink-0 py-0.5"
              onChange={setIncludeExisting}
            />
          </div>
          <div className="space-y-3">
            <Button
              variant="ghost"
              disabled={busy}
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
              className="-ml-3"
            >
              Advanced
            </Button>
            {advanced && (
              <Text as="label" className="block space-y-2">
                <span className="block">Bridge hub URL</span>
                <Input
                  type="url"
                  required
                  disabled={busy}
                  placeholder="https://bridge.example.com"
                  value={hubUrl}
                  onChange={(event) => setHubUrl(event.target.value)}
                />
              </Text>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="submit" disabled={busy || !hubUrl.trim()} isLoading={busy}>
              Sign in
            </Button>
          </div>
        </form>
      </Modal>
    </SettingsSection>
  );
}
