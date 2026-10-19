import { Fragment, useId, useRef, useState } from "react";
import { normalizeBridgeVerificationCode, type BridgeApprovalRequest } from "@mains/contracts/bridge-auth";
import type { ServiceResponse } from "@mains/contracts/service-response";
import {
  Button,
  Checkbox,
  CopyButton,
  Input,
  Muted,
  Text,
  Modal,
  ModalHeader,
  Toggle,
  UsageTicks,
} from "@/components/ui";
import { appApi, getTransport } from "@/lib/transport";
import {
  useGetBridgeAuthStatusQuery,
  useGetBridgeStatusQuery,
  useGetBridgeProjectScopesQuery,
  useSyncBridgeNowMutation,
} from "@/lib/redux/api/bridgeApi";
import {
  SettingsDivider,
  SettingsPageShell,
  SettingsSection,
  SettingsRow,
} from "./settings-layout";
import { BridgeSubscriptionSection } from "./bridge-subscription";
import { BridgeDeviceRow } from "./bridge-device-row";
import { BridgeSignInSection } from "./bridge-sign-in";
import { BridgeKeyVerification } from "./bridge-key-verification";
import { bridgeConnectionDescription } from "../lib/bridge-connection";

async function value<T>(promise: Promise<ServiceResponse<T>>): Promise<T> {
  const response = await promise;
  if (!response.success) throw new Error(response.error);
  return response.data;
}

function CheckboxField({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <Text
      as="label"
      className={`flex items-start gap-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      <Checkbox
        className="mt-0.5"
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="min-w-0 space-y-1">
        <span className="block">{label}</span>
        {description && (
          <Muted as="span" id={descriptionId} size="xs" className="block">
            {description}
          </Muted>
        )}
      </span>
    </Text>
  );
}

function storageSize(bytes: number) {
  const unit = bytes >= 1024 ** 3 ? "GiB" : "MiB";
  return `${(bytes / (unit === "GiB" ? 1024 ** 3 : 1024 ** 2)).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

function Approval({
  request,
  busy,
  act,
}: {
  request: BridgeApprovalRequest;
  busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  let code: string | null = null;
  try { code = normalizeBridgeVerificationCode(input); } catch { /* Wait for a complete code. */ }
  // The expected code is never displayed: typing it from the new device's
  // screen is the comparison. The backend checks the typed code again.
  const matches = code !== null && code === request.code;
  const approve = () => {
    if (code && matches && !busy) void act(() => value(appApi.bridge.approveBackend({ ...request, code })));
  };
  return (
    <div className="space-y-3 py-4">
      <div className="space-y-1">
        <Text>{request.label}</Text>
        <Muted size="xs">
          {request.platform} · Expires{" "}
          {new Date(request.expiresAt).toLocaleTimeString()}
        </Muted>
      </div>
      <form
        className="max-w-xl space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          approve();
        }}
      >
        <Muted className="max-w-2xl">
          Enter the code shown on the new device to approve it.
        </Muted>
        <Input
          aria-label="Code shown on the new device"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Enter the code from the new device"
          value={input}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
        />
        {code && !matches && (
          <Text role="alert" tone="danger">
            This code does not match. Check it again, and decline the request
            if the new device shows a different code.
          </Text>
        )}
      </form>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !matches} onClick={approve}>
          Approve device
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void act(() =>
              value(appApi.bridge.rejectBackend(request.requestId)),
            )
          }
        >
          Decline
        </Button>
      </div>
    </div>
  );
}

export default function BridgeSettings() {
  const {
    data: status,
    isLoading,
    error: loadError,
    refetch,
  } = useGetBridgeAuthStatusQuery(undefined, { pollingInterval: 5000 });
  const { data: sync, refetch: refetchSync } = useGetBridgeStatusQuery(
    undefined,
    { skip: status?.state !== "ready", pollingInterval: 5000 },
  );
  const { data: projects, refetch: refetchProjects } =
    useGetBridgeProjectScopesQuery();
  const [syncNow] = useSyncBridgeNowMutation();
  const isRemote = getTransport().kind !== "ipc";
  const deviceLabel = isRemote
    ? status?.label.trim() || "the connected computer"
    : "this device";
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  // Recovery codes never enter Redux, localStorage, query strings or command receipts.
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<{
    backendId: string;
    accountId: string;
    value: string;
  } | null>(null);
  const visibleRecoveryCode =
    recoveryCode?.backendId === status?.backendId &&
    recoveryCode?.accountId === status?.accountId
      ? recoveryCode?.value
      : null;
  const showRecoveryCode = (code: string | null) =>
    setRecoveryCode(
      code && status?.accountId
        ? {
            backendId: status.backendId,
            accountId: status.accountId,
            value: code,
          }
        : null,
    );
  const [confirm, setConfirm] = useState<{
    kind: "logout" | "recovery" | "revoke";
    backendId?: string;
    label?: string;
  } | null>(null);
  const [removeSynced, setRemoveSynced] = useState(false);
  const confirmDescriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refetch();
      await refetchProjects();
      if (status?.state === "ready") await refetchSync();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Bridge request failed",
      );
    } finally {
      setBusy(false);
    }
  }
  function confirmDisconnect() {
    setRemoveSynced(false);
    setConfirm({ kind: "logout" });
  }
  const signedOut =
    status?.state === "signed-out" ||
    (status?.state === "error" && !status.accountId);
  return (
    <SettingsPageShell title="Bridge" isLoading={isLoading} error={loadError}>
      {(error || status?.error) && (
        <Text role="alert" tone="danger" className="mb-4">
          {error ?? status?.error}
        </Text>
      )}
      {signedOut && status && !status.logoutPending && (
        <BridgeSignInSection
          key={status.backendId}
          status={status}
          isRemote={isRemote}
          onSignedIn={async () => {
            await refetch();
            await refetchProjects();
          }}
        />
      )}
      {status?.state === "signing-in" && (
        <SettingsSection title="Finish sign-in in your browser">
          <div className="space-y-3 py-4">
            {status.login ? (
              <>
                <a
                  className="text-accent underline break-all"
                  href={status.login.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open secure sign-in
                </a>
                {status.login.code && (
                  <Text size="xl" className="font-mono tracking-widest">
                    {status.login.code}
                  </Text>
                )}
                <Muted>
                  Expires{" "}
                  {new Date(status.login.expiresAt).toLocaleTimeString()}. Sign
                  in with GitHub or your email and password.
                </Muted>
              </>
            ) : (
              <Muted>Creating your account keys…</Muted>
            )}
          </div>
        </SettingsSection>
      )}
      {status?.state === "needs-approval" && (
        <SettingsSection title={`Approve ${deviceLabel}`}>
          <div className="space-y-4 py-4">
            <Text className="max-w-2xl">
              On an approved device, open Settings › Bridge and compare this
              code before approving {status.label}.
            </Text>
            {status.verificationCode && (
              <div className="flex w-fit items-center gap-3 rounded-xl glass-input px-3 py-2">
                <Text as="code" size="xl" className="whitespace-nowrap font-mono select-all tracking-wider">
                  {status.verificationCode}
                </Text>
                <CopyButton
                  text={status.verificationCode}
                  tooltip="Copy verification code"
                  copiedTooltip="Copied!"
                />
              </div>
            )}
            <Muted className="max-w-2xl">
              After approval, enter the join code shown on the approving device
              to start sync. You can also unlock your account with its recovery code.
            </Muted>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const code = recoveryInput;
                setRecoveryInput("");
                void act(() => value(appApi.bridge.enterRecoveryCode(code)));
              }}
            >
              <Input
                aria-label="Recovery code"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Enter your recovery code"
                className="max-w-xl"
                value={recoveryInput}
                onChange={(event) => setRecoveryInput(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || !recoveryInput.trim()}
                >
                  Use recovery code
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(() => value(appApi.bridge.requestApproval()))
                  }
                >
                  Request approval again
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  className="ml-auto"
                  onClick={status.logoutPending
                    ? () => void act(() => value(appApi.bridge.signOut(removeSynced)))
                    : confirmDisconnect}
                >
                  {status.logoutPending ? "Finish disconnecting" : "Disconnect from Bridge"}
                </Button>
              </div>
            </form>
          </div>
        </SettingsSection>
      )}
      {status?.state === "needs-verification" && (
        <BridgeKeyVerification
          key={`${status.backendId}:${status.accountId}`}
          busy={busy}
          onConfirm={(joinCode) => act(() => value(appApi.bridge.confirmAccountKey(joinCode)))}
        />
      )}
      {status?.state === "ready" && (
        <>
          <SettingsSection title="Account">
            <SettingsRow
              title={status.email ?? "Signed in"}
              description={bridgeConnectionDescription(sync)}
            >
              <Button
                variant="danger"
                disabled={busy}
                onClick={status.logoutPending
                  ? () => void act(() => value(appApi.bridge.signOut(removeSynced)))
                  : confirmDisconnect}
              >
                {status.logoutPending ? "Finish disconnecting" : "Disconnect"}
              </Button>
            </SettingsRow>
            {status.joinCodes.map((join) => (
              <SettingsRow
                key={`${status.accountId}:${join.backendId}`}
                title={`Join code for ${join.label}`}
                description="Enter this on that device to verify it before its sync starts."
              >
                <div className="flex items-center gap-3">
                  <Text as="code" className="whitespace-nowrap font-mono tracking-wider select-all">
                    {join.code}
                  </Text>
                  <CopyButton text={join.code} tooltip="Copy join code" copiedTooltip="Copied!" />
                </div>
              </SettingsRow>
            ))}
            {sync?.error && (
              <Text role="alert" tone="danger" className="pb-3">
                {sync.error}
              </Text>
            )}
          </SettingsSection>
          {sync?.quota?.subscription && (
            <BridgeSubscriptionSection
              subscription={sync.quota.subscription}
              plans={sync.quota.plans ?? []}
              deviceLabel={deviceLabel}
              busy={busy}
              onRefresh={() => void act(() => syncNow().unwrap())}
            />
          )}
          <SettingsSection title="Storage">
            {sync?.quota ? (
              <div className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Text as="span" weight="medium">Storage used</Text>
                  <Text as="span" size="xs" tone="subtle">
                    {sync.quota.usedBytes >= sync.quota.limitBytes
                      ? `Storage is full. Changes stay on ${deviceLabel} until space is available.`
                      : `Up to ${storageSize(sync.quota.fileLimitBytes)} per file`}
                  </Text>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <UsageTicks
                    usedPercent={sync.quota.limitBytes > 0 ? (sync.quota.usedBytes / sync.quota.limitBytes) * 100 : 100}
                    display="used"
                    role="meter"
                    label="Bridge storage used"
                    valueText={`${storageSize(sync.quota.usedBytes)} of ${storageSize(sync.quota.limitBytes)} used`}
                    className="shrink-0"
                  />
                  <Text as="span" tone="subtle" align="right" className="whitespace-nowrap tabular-nums">
                    {storageSize(sync.quota.usedBytes)} / {storageSize(sync.quota.limitBytes)}
                  </Text>
                </div>
              </div>
            ) : (
              <Muted className="py-4">
                Storage usage is available when the hub is connected.
              </Muted>
            )}
          </SettingsSection>
          {!!status.localHistory && (
            <SettingsSection title="Local history">
              <SettingsRow
                title={`${status.localHistory} existing items kept local`}
                description="Add the history you previously left out. Projects with sync turned off stay local."
              >
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(() => value(appApi.bridge.includeLocalHistory()))
                  }
                >
                  Sync existing history
                </Button>
              </SettingsRow>
            </SettingsSection>
          )}
          {status.approvals.length > 0 && (
            <SettingsSection title="Device approval requests">
              {status.approvals.map((request) => (
                <Approval
                  key={`${status.backendId}:${status.accountId}:${request.requestId}:${request.publicKey}:${request.signingPublicKey}:${request.code}`}
                  request={request}
                  busy={busy}
                  act={act}
                />
              ))}
            </SettingsSection>
          )}
          <SettingsSection title="Recovery code">
            <div className="space-y-4 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
                <div className="min-w-0 flex-1 space-y-3">
                  <Muted>
                    Save this code in your password manager. You’ll need it if you
                    lose access to every approved device.
                  </Muted>
                  {!visibleRecoveryCode && status.recoveryCodeAvailable && (
                    <Button
                      variant="primary"
                      disabled={busy}
                      className="whitespace-nowrap"
                      onClick={() =>
                        void act(async () =>
                          showRecoveryCode(
                            await value<string | null>(
                              appApi.bridge.takeRecoveryCode(),
                            ),
                          ),
                        )
                      }
                    >
                      Show setup code
                    </Button>
                  )}
                </div>
                <Button
                  variant="secondary"
                  disabled={busy}
                  className="self-end whitespace-nowrap md:w-48 md:shrink-0 md:self-auto"
                  onClick={visibleRecoveryCode
                    ? () => setRecoveryCode(null)
                    : () => setConfirm({ kind: "recovery" })}
                >
                  {visibleRecoveryCode ? "I saved it — hide code" : "New recovery code"}
                </Button>
              </div>
              {visibleRecoveryCode && (
                <div className="relative max-w-2xl">
                  <Input
                    aria-label="Recovery code"
                    readOnly
                    autoComplete="off"
                    spellCheck={false}
                    value={visibleRecoveryCode}
                    onFocus={(event) => event.currentTarget.select()}
                    className="pr-11 font-mono tracking-wider"
                  />
                  <CopyButton
                    text={visibleRecoveryCode}
                    tooltip="Copy recovery code"
                    copiedTooltip="Copied!"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  />
                </div>
              )}
            </div>
          </SettingsSection>
          <SettingsSection title="Devices">
            <ul aria-label="Bridge devices" className="divide-y divide-primary-200/60 dark:divide-primary-800/20">
              {status.backends.map((backend) => (
                <BridgeDeviceRow
                  key={backend.backendId}
                  device={backend}
                  isCurrent={backend.backendId === status.backendId}
                  isRemote={isRemote}
                  busy={busy}
                  onRevoke={() =>
                    setConfirm({
                      kind: "revoke",
                      backendId: backend.backendId,
                      label: backend.label,
                    })
                  }
                />
              ))}
            </ul>
          </SettingsSection>
        </>
      )}
      {status?.state === "ready" && !status.logoutPending && !!projects?.length && (
        <SettingsSection title="Project sync">
          <Muted size="xs" className="max-w-2xl pb-4 pt-3">
            Sync workspaces and chats from {deviceLabel}. When off, new changes
            stay local; existing copies on other devices are kept.
          </Muted>
          <SettingsDivider />
          {projects.map((project, index) => (
            <Fragment key={project.id}>
              {index > 0 && <SettingsDivider />}
              <SettingsRow
                title={project.name}
                description={`${project.workspaces} workspace${project.workspaces === 1 ? "" : "s"} · ${project.runs} chat${project.runs === 1 ? "" : "s"}`}
              >
                <Toggle
                  aria-label={`Sync ${project.name}`}
                  className="justify-end py-0"
                  enabled={!project.localOnly}
                  disabled={busy || status?.logoutPending}
                  onChange={(enabled) =>
                    void act(() =>
                      value(
                        appApi.bridge.setProjectLocalOnly(project.id, !enabled),
                      ),
                    )
                  }
                />
              </SettingsRow>
            </Fragment>
          ))}
        </SettingsSection>
      )}
      {status?.logoutPending && status.state !== "ready" && status.state !== "needs-approval" && (
        <Button
          variant="danger"
          disabled={busy}
          onClick={() =>
            void act(() => value(appApi.bridge.signOut(removeSynced)))
          }
        >
          Finish disconnecting
        </Button>
      )}
      {status && !signedOut && status.state !== "ready" && status.state !== "needs-approval" && !status.logoutPending && (
        <div className="flex justify-start">
          <Button
            variant={status.state === "signing-in" ? "secondary" : "danger"}
            disabled={busy}
            onClick={confirmDisconnect}
          >
            {status.state === "signing-in"
              ? "Cancel sign-in"
              : "Disconnect from Bridge"}
          </Button>
        </div>
      )}
      <Modal
        isOpen={confirm !== null}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        initialFocusRef={cancelRef}
        aria-describedby={confirmDescriptionId}
        closeOnEscape={!busy}
        closeOnBackdrop={!busy}
        className="w-full max-w-lg"
      >
        <ModalHeader
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <Text as="h2" size="base" weight="medium">
            {confirm?.kind === "logout"
              ? "Disconnect from Bridge?"
              : confirm?.kind === "recovery"
                ? "Replace recovery code?"
                : "Revoke device access?"}
          </Text>
        </ModalHeader>
        <div className="space-y-5 overflow-y-auto px-6 pb-4 pt-2">
          {error && (
            <Text role="alert" tone="danger">
              {error}
            </Text>
          )}
          <Text id={confirmDescriptionId} tone="secondary">
            {confirm?.kind === "logout"
              ? `Your chats, Atlas items and opened files stay on ${deviceLabel}. Bridge keys and other devices’ chat copies are removed. Unsent changes are always kept.`
              : confirm?.kind === "recovery"
                ? "The previous recovery code will stop working. Save the new code when it appears."
                : `${confirm?.label} will lose sync access immediately. Data saved on that device stays there.`}
          </Text>
          {confirm?.kind === "logout" && (
            <CheckboxField
              label={`Remove synced Spaces, Collections and Atlas from ${deviceLabel}`}
              checked={removeSynced}
              disabled={busy}
              onChange={setRemoveSynced}
            />
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button
              ref={cancelRef}
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              isLoading={busy}
              onClick={() => {
                void act(async () => {
                  if (confirm?.kind === "logout") {
                    await value(appApi.bridge.signOut(removeSynced));
                    setRecoveryCode(null);
                    setRecoveryInput("");
                  } else if (confirm?.kind === "recovery")
                    showRecoveryCode(
                      await value<string>(
                        appApi.bridge.regenerateRecoveryCode(),
                      ),
                    );
                  else if (confirm?.backendId)
                    await value(appApi.bridge.revokeBackend(confirm.backendId));
                  setConfirm(null);
                });
              }}
            >
              {confirm?.kind === "logout"
                ? "Disconnect"
                : confirm?.kind === "recovery"
                  ? "Replace code"
                  : "Revoke access"}
            </Button>
          </div>
        </div>
      </Modal>
    </SettingsPageShell>
  );
}
