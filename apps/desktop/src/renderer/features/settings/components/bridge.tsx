import { useState } from "react";
import type { BridgeApprovalRequest } from "@mains/contracts/bridge-auth";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { Button, Checkbox, Input, Muted, Text, Modal, ModalHeader } from "@/components/ui";
import { appApi, getTransport } from "@/lib/transport";
import { useGetBridgeAuthStatusQuery, useGetBridgeStatusQuery, useGetBridgeProjectScopesQuery } from "@/lib/redux/api/bridgeApi";
import { SettingsPageShell, SettingsSection, SettingsRow } from "./settings-layout";

async function value<T>(promise: Promise<ServiceResponse<T>>): Promise<T> {
  const response = await promise;
  if (!response.success) throw new Error(response.error);
  return response.data;
}

function Approval({ request, busy, act }: {
  request: BridgeApprovalRequest; busy: boolean; act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [matches, setMatches] = useState(false);
  return <div className="space-y-3 py-4">
    <div><Text>{request.label}</Text><Muted>{request.platform} · Expires {new Date(request.expiresAt).toLocaleTimeString()}</Muted></div>
    <Text className="font-mono text-xl tracking-[0.25em]">{request.code}</Text>
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={matches} onChange={setMatches} />This code matches the new backend’s screen</label>
    <div className="flex gap-2">
      <Button variant="primary" disabled={busy || !matches} onClick={() => void act(() => value(appApi.bridge.approveBackend(request)))}>Approve backend</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void act(() => value(appApi.bridge.rejectBackend(request.requestId)))}>Decline</Button>
    </div>
  </div>;
}

export default function BridgeSettings() {
  const { data: status, isLoading, error: loadError, refetch } = useGetBridgeAuthStatusQuery(undefined, { pollingInterval: 5000 });
  const { data: sync, refetch: refetchSync } = useGetBridgeStatusQuery(undefined, { skip: status?.state !== "ready", pollingInterval: 5000 });
  const { data: projects, refetch: refetchProjects } = useGetBridgeProjectScopesQuery();
  const [hubUrl, setHubUrl] = useState(""), [label, setLabel] = useState("");
  const [includeExisting, setIncludeExisting] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  // Recovery codes never enter Redux, localStorage, query strings or command receipts.
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryCode, setRecoveryCode] = useState<{ backendId: string; accountId: string; value: string } | null>(null);
  const visibleRecoveryCode = recoveryCode?.backendId === status?.backendId && recoveryCode?.accountId === status?.accountId ? recoveryCode?.value : null;
  const showRecoveryCode = (code: string | null) => setRecoveryCode(code && status?.accountId ? { backendId: status.backendId, accountId: status.accountId, value: code } : null);
  const [confirm, setConfirm] = useState<{ kind: "logout" | "recovery" | "revoke"; backendId?: string; label?: string } | null>(null);
  const [removeSynced, setRemoveSynced] = useState(false);
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); await refetch(); await refetchProjects(); if (status?.state === "ready") await refetchSync(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Bridge request failed"); }
    finally { setBusy(false); }
  }
  const signedOut = status?.state === "signed-out" || (status?.state === "error" && !status.accountId);
  return <SettingsPageShell title="Bridge" isLoading={isLoading} error={loadError}>
    <Muted className="mb-6">Keep Atlas and chat history available across your backends. Each backend stores its own encrypted account key.</Muted>
    {(error || status?.error) && <Text role="alert" className="mb-4 text-danger">{error ?? status?.error}</Text>}
    {signedOut && !status?.logoutPending && <SettingsSection title="Connect this backend">
      <form className="space-y-4 py-4 max-w-xl" onSubmit={(event) => { event.preventDefault(); void act(() => value(appApi.bridge.signIn({ hubUrl, label: label || undefined, includeExisting, flow: getTransport().kind === "ipc" ? "loopback" : "device" }))); }}>
        <label className="block space-y-2"><Text>Bridge hub URL</Text><Input type="url" required placeholder="https://bridge.example.com" value={hubUrl} onChange={(event) => setHubUrl(event.target.value)} /></label>
        <label className="block space-y-2"><Text>Backend name</Text><Input placeholder={status?.label ?? "This computer"} maxLength={128} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <label className="flex items-start gap-2 text-sm"><Checkbox className="mt-1" checked={includeExisting} onChange={setIncludeExisting} /><span>Include existing history and Atlas ({status?.existing.runs ?? 0} chats, {status?.existing.pages ?? 0} pages). When unchecked, these existing items stay local.</span></label>
        <Button type="submit" variant="primary" disabled={busy || !hubUrl.trim()} isLoading={busy}>Sign in</Button>
      </form>
    </SettingsSection>}
    {status?.state === "signing-in" && <SettingsSection title="Finish sign-in in your browser">
      <div className="space-y-3 py-4">
        {status.login ? <><a className="text-accent underline break-all" href={status.login.url} target="_blank" rel="noreferrer">Open secure sign-in</a>
          {status.login.code && <Text className="font-mono text-xl tracking-widest">{status.login.code}</Text>}
          <Muted>Expires {new Date(status.login.expiresAt).toLocaleTimeString()}. Sign in with GitHub or an email link.</Muted></> : <Muted>Creating your account keys…</Muted>}
      </div>
    </SettingsSection>}
    {status?.state === "needs-approval" && <SettingsSection title="Approve this backend">
      <div className="space-y-4 py-4 max-w-xl">
        <Text>On an approved backend, open Settings › Bridge and compare this code before approving {status.label}.</Text>
        <Text className="font-mono text-2xl tracking-[0.25em]">{status.verificationCode}</Text>
        <Muted>Sync starts after approval. You can also unlock your account with its recovery code.</Muted>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); const code = recoveryInput; setRecoveryInput(""); void act(() => value(appApi.bridge.enterRecoveryCode(code))); }}>
          <Input aria-label="Recovery code" type="password" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={recoveryInput} onChange={(event) => setRecoveryInput(event.target.value)} />
          <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" disabled={busy || !recoveryInput.trim()}>Use recovery code</Button><Button variant="secondary" disabled={busy} onClick={() => void act(() => value(appApi.bridge.requestApproval()))}>Request approval again</Button></div>
        </form>
      </div>
    </SettingsSection>}
    {status?.state === "ready" && <>
      <SettingsSection title="Account"><SettingsRow title={status.email ?? "Signed in"} description={`${status.label} · ${status.hubUrl}`}><Text tone="muted">Connected</Text></SettingsRow></SettingsSection>
      <SettingsSection title="Storage">
        {sync?.quota ? <div className="space-y-3 py-4">
          <SettingsRow title={`${(sync.quota.usedBytes / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB of ${(sync.quota.limitBytes / 1024 ** 2).toLocaleString()} MiB`} description={`${sync.quota.plan} · Up to ${sync.quota.fileLimitBytes / 1024 ** 2} MiB per file`}>
            <Text tone="muted">{sync.pendingRecords} queued</Text>
          </SettingsRow>
          <div role="meter" aria-label="Bridge storage used" aria-valuenow={Math.min(sync.quota.usedBytes, sync.quota.limitBytes)} aria-valuemin={0} aria-valuemax={Math.max(1, sync.quota.limitBytes)} className="h-1.5 overflow-hidden rounded-full bg-primary-200">
            <div className="h-full bg-accent" style={{ width: `${sync.quota.limitBytes ? Math.min(100, sync.quota.usedBytes / sync.quota.limitBytes * 100) : 100}%` }} />
          </div>
          <Muted>Includes encrypted records, files and pending uploads. When full, changes stay on this backend until space is available.</Muted>
        </div> : <Muted className="py-4">Storage usage is available when the hub is connected.</Muted>}
        {sync?.error && <Text role="alert" className="py-3 text-danger">{sync.error}</Text>}
      </SettingsSection>
      {!!status.localHistory && <SettingsSection title="Local history"><SettingsRow title={`${status.localHistory} existing items kept local`} description="Add the history you previously left out. Projects marked Local only will stay local.">
        <Button variant="secondary" disabled={busy} onClick={() => void act(() => value(appApi.bridge.includeLocalHistory()))}>Sync existing history</Button>
      </SettingsRow></SettingsSection>}
      {status.approvals.length > 0 && <SettingsSection title="Backend approval requests">{status.approvals.map((request) => <Approval key={request.requestId} request={request} busy={busy} act={act} />)}</SettingsSection>}
      <SettingsSection title="Recovery code">
        <div className="space-y-3 py-4">
          <Muted>Keep this code somewhere safe. It can unlock a new backend when every other backend is offline.</Muted>
          {visibleRecoveryCode ? <><Text className="break-all font-mono select-all tracking-wider">{visibleRecoveryCode}</Text><Button variant="secondary" onClick={() => setRecoveryCode(null)}>I saved it — hide code</Button></> : <div className="flex flex-wrap gap-2">
            {status.recoveryCodeAvailable && <Button variant="primary" disabled={busy} onClick={() => void act(async () => showRecoveryCode(await value<string | null>(appApi.bridge.takeRecoveryCode())))}>Show setup recovery code once</Button>}
            <Button variant="secondary" disabled={busy} onClick={() => setConfirm({ kind: "recovery" })}>Generate new recovery code</Button>
          </div>}
        </div>
      </SettingsSection>
      <SettingsSection title="Backends">{status.backends.map((backend) => <SettingsRow key={backend.backendId} title={`${backend.label}${backend.backendId === status.backendId ? " (this backend)" : ""}`} description={`${backend.platform} · ${backend.status}`}>
        {backend.status !== "revoked" && backend.backendId !== status.backendId && <Button variant="secondary" disabled={busy} onClick={() => setConfirm({ kind: "revoke", backendId: backend.backendId, label: backend.label })}>Revoke access</Button>}
      </SettingsRow>)}</SettingsSection>

    </>}
    {!!projects?.length && <SettingsSection title="Project sync">
      <Muted className="py-3">Local only keeps a project’s workspaces and chats on this backend. Previously synced copies remain on other backends. Turn it off to send pending changes.</Muted>
      {projects.map((project) => <SettingsRow key={project.id} title={project.name} description={`${project.workspaces} workspaces · ${project.runs} chats`}>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!project.localOnly} disabled={busy || status?.logoutPending} onChange={(checked) => void act(() => value(appApi.bridge.setProjectLocalOnly(project.id, checked)))} />Local only</label>
      </SettingsRow>)}
    </SettingsSection>}
    {status?.logoutPending && <Button variant="secondary" disabled={busy} onClick={() => void act(() => value(appApi.bridge.signOut(removeSynced)))}>Finish signing out</Button>}
    {status && !signedOut && <div className="flex justify-start"><Button variant="secondary" disabled={busy} onClick={() => { setRemoveSynced(false); setConfirm({ kind: "logout" }); }}>{status.state === "signing-in" ? "Cancel sign-in" : "Sign out of Bridge"}</Button></div>}
    <Modal isOpen={confirm !== null} onClose={() => { if (!busy) setConfirm(null); }} className="w-full max-w-md">
      <ModalHeader onClose={() => { if (!busy) setConfirm(null); }}>{confirm?.kind === "logout" ? "Sign out of Bridge?" : confirm?.kind === "recovery" ? "Replace recovery code?" : "Revoke backend access?"}</ModalHeader>
      <div className="space-y-4 p-4">
        {error && <Text role="alert" className="text-danger">{error}</Text>}
        <Text>{confirm?.kind === "logout" ? "Your own chats, shared Atlas items and opened shared files stay on this computer. Access keys, other backends’ chat replicas and the download cache are removed. Unsent edits are always kept." : confirm?.kind === "recovery" ? "The previous recovery code will stop working. Save the new code when it appears." : `${confirm?.label} will lose sync access immediately. Data already stored on that backend remains there.`}</Text>
        {confirm?.kind === "logout" && <label className="flex items-start gap-2 text-sm"><Checkbox checked={removeSynced} onChange={setRemoveSynced} />Also remove synced Spaces, Collections and Atlas items from this backend</label>}
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" disabled={busy} isLoading={busy} onClick={() => { void act(async () => {
          if (confirm?.kind === "logout") { await value(appApi.bridge.signOut(removeSynced)); setRecoveryCode(null); setRecoveryInput(""); }
          else if (confirm?.kind === "recovery") showRecoveryCode(await value<string>(appApi.bridge.regenerateRecoveryCode()));
          else if (confirm?.backendId) await value(appApi.bridge.revokeBackend(confirm.backendId));
          setConfirm(null);
        }); }}>{confirm?.kind === "logout" ? "Sign out" : confirm?.kind === "recovery" ? "Replace code" : "Revoke access"}</Button></div>
      </div>
    </Modal>
  </SettingsPageShell>;
}
