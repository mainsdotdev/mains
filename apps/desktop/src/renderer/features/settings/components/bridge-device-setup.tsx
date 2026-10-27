import { Fragment, useState } from "react";
import { normalizeBridgeVerificationCode, type BridgeApprovalRequest, type BridgeAuthStatus, type BridgeJoinCode } from "@mains/contracts/bridge-auth";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { Button, CopyButton, Input, Muted, Text } from "@/components/ui";
import { appApi } from "@/lib/transport";
import { SettingsSection } from "./settings-layout";

async function value<T>(promise: Promise<ServiceResponse<T>>): Promise<T> {
  const response = await promise;
  if (!response.success) throw new Error(response.error);
  return response.data;
}

type Act = (action: () => Promise<unknown>) => Promise<void>;

function Approval({ request, busy, act }: { request: BridgeApprovalRequest; busy: boolean; act: Act }) {
  const [input, setInput] = useState("");
  let code: string | null = null;
  try { code = normalizeBridgeVerificationCode(input); } catch { /* Wait for a complete code. */ }
  // The expected code is never displayed: the operator types it from the new device.
  const matches = code !== null && code === request.code;
  const approve = () => {
    if (code && matches && !busy) void act(() => value(appApi.bridge.approveBackend({ ...request, code })));
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Text>{request.label}</Text>
        <Muted size="xs">Step 1 of 2 · Approve device</Muted>
        <Muted size="xs">
          {request.platform} · Expires {new Date(request.expiresAt).toLocaleTimeString()}
        </Muted>
      </div>
      <form className="max-w-xl space-y-3" onSubmit={(event) => {
        event.preventDefault();
        approve();
      }}>
        <Muted className="max-w-2xl">
          Enter the code shown on the new device. Its join code will appear here next.
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
        <Button variant="primary" disabled={busy || !matches} onClick={approve}>Approve device</Button>
        <Button variant="secondary" disabled={busy} onClick={() =>
          void act(() => value(appApi.bridge.rejectBackend(request.requestId)))
        }>Decline</Button>
      </div>
    </div>
  );
}

function JoinCode({ join }: { join: BridgeJoinCode }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Text>{join.label}</Text>
        <Muted size="xs">Step 2 of 2 · Finish on the new device</Muted>
      </div>
      <Text role="status" className="max-w-2xl">
        Device approved. Enter this join code on {join.label} to verify it and start sync.
      </Text>
      <div className="flex w-fit max-w-full items-center gap-3 rounded-xl glass-input px-3 py-2">
        <Text as="code" size="xl" className="whitespace-nowrap font-mono tracking-wider select-all">
          {join.code}
        </Text>
        <CopyButton text={join.code} tooltip="Copy join code" copiedTooltip="Copied!" />
      </div>
      <Muted size="xs">Waiting for verification on the new device…</Muted>
    </div>
  );
}

type Setup = { request: BridgeApprovalRequest; join?: never } | { request?: never; join: BridgeJoinCode };

export function BridgeDeviceSetup({ status, busy, act }: {
  status: Pick<BridgeAuthStatus, "backendId" | "accountId" | "approvals" | "joinCodes">;
  busy: boolean;
  act: Act;
}) {
  const setups = new Map<string, Setup>();
  for (const request of status.approvals) setups.set(request.backendId, { request });
  for (const join of status.joinCodes) setups.set(join.backendId, { join });
  if (!setups.size) return null;
  return (
    <SettingsSection title="Device setup">
      {[...setups].sort(([a], [b]) => a.localeCompare(b)).map(([backendId, setup], index) => (
        <Fragment key={`${status.backendId}:${status.accountId}:${backendId}`}>
          {index > 0 && <div className="border-t border-primary-200/60 dark:border-primary-800/20" />}
          <section aria-label={`Set up ${setup.request ? setup.request.label : setup.join.label}`} className="py-4">
            {setup.request ? (
              <Approval
                key={`${setup.request.requestId}:${setup.request.publicKey}:${setup.request.signingPublicKey}:${setup.request.code}`}
                request={setup.request}
                busy={busy}
                act={act}
              />
            ) : <JoinCode join={setup.join} />}
          </section>
        </Fragment>
      ))}
    </SettingsSection>
  );
}
