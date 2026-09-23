import { useEffect, useState } from "react";
import {
  Alert,
  Body,
  Button,
  Caption,
  CopyButton as UiCopyButton,
  Input,
  Toggle,
  toast,
} from "@/components/ui";
import { Check, Clipboard, Eye, EyeClosed, Refresh } from "@/components/ui/icons";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import {
  SettingsSection,
  SettingsDivider,
  SettingsRow,
} from "@/features/settings/components/settings-layout";
import { DevicePairing } from "./device-pairing";

interface Address {
  label: string;
  url: string;
  wsUrl: string;
}

interface Status {
  remoteAccess: boolean;
  lanAccess: boolean;
  port: number;
  token: string | null;
  addresses: Address[];
  tailscale: boolean;
  tailscaleHttpsUrl: string | null;
  tailscaleWsUrl: string | null;
  webUiAvailable: boolean;
  keepAwakeForRemoteAccess: boolean;
}

type Busy = "remote" | "lan" | "tailscale" | "rotate" | null;

const valueInputCls = "flex-1 min-w-0 font-mono text-xs";

/** Read-only value field — copyable but never edited. */
function ValueField({ value }: { value: string }) {
  return <Input value={value} readOnly className={valueInputCls} />;
}

/**
 * Read-only secret — masked until the field is clicked or the eye toggled, so
 * a screen share or screenshot doesn't leak it. Copying works while masked.
 */
function SecretField({ value, label }: { value: string; label: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <>
      <Input
        type={revealed ? "text" : "password"}
        value={value}
        readOnly
        autoComplete="off"
        aria-label={label}
        onClick={() => setRevealed(true)}
        className={`${valueInputCls} ${revealed ? "" : "cursor-pointer"}`}
      />
      <Button
        type="button"
        variant="bare"
        tooltip={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        aria-pressed={revealed}
        onClick={() => setRevealed((v) => !v)}
        className="text-primary-900 dark:text-primary-100"
      >
        {revealed ? <EyeClosed className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
    </>
  );
}

/** Icon-only copy button with a brief check on success. */
function CopyButton({ value, tooltip }: { value: string; tooltip: string }) {
  return (
    <UiCopyButton
      text={value}
      tooltip={tooltip}
      variant="bare"
      className="text-primary-900 dark:text-primary-100"
    />
  );
}

/** Mint the one-use login only when the user asks to copy it. */
function BrowserLoginCopyButton({ baseUrl }: { baseUrl: string }) {
  const { copy, isCopied } = useCopyToClipboard();
  const [loading, setLoading] = useState(false);

  const handleCopy = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await window.api.localBackend.createWebLogin(baseUrl);
      if (!result?.success) {
        toast.error(result?.error ?? "Failed to create browser login");
        return;
      }
      const login = result.data as { link?: unknown };
      if (typeof login?.link !== "string") {
        toast.error("Backend returned an invalid browser login");
        return;
      }
      if (!(await copy(login.link))) {
        toast.error("Could not copy browser login");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create browser login",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="bare"
      tooltip={isCopied ? "Login link copied" : "Copy one-use browser login"}
      aria-label="Copy one-use browser login"
      onClick={() => void handleCopy()}
      disabled={loading}
      className="text-primary-900 dark:text-primary-100"
    >
      {isCopied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
    </Button>
  );
}

/**
 * "This machine" — expose the RUNNING desktop app as a backend so a phone or
 * tablet, a LAN device, or another mains over an SSH tunnel can drive it. No
 * separate `serve` process or repo. Desktop-only (rendered only outside web
 * mode in BackendsSettings). Device pairing follows as its own section.
 *
 * Two privacy levels: loopback-only ("Allow remote access" — SSH attaches to it,
 * nothing on the network) and LAN ("Network access" — binds 0.0.0.0).
 */
export function LocalBackendShare() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  useEffect(() => {
    let active = true;
    window.api.localBackend
      .getStatus()
      .then((res) => {
        if (active && res?.success) setStatus(res.data as Status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const run = async (
    which: Busy,
    call: Promise<{ success: boolean; data?: unknown; error?: string }>,
    okMsg?: string,
  ) => {
    setBusy(which);
    try {
      const res = await call;
      if (res?.success) {
        setStatus(res.data as Status);
        if (okMsg) toast.success(okMsg);
      } else {
        toast.error(res?.error ?? "Failed");
      }
    } finally {
      setBusy(null);
    }
  };

  const remoteOn = !!status?.remoteAccess;
  const lanOn = !!status?.lanAccess;
  const tailscaleOn = !!status?.tailscale;

  return (
    <>
      <SettingsSection title="This machine">
        {/* Allow remote access (loopback / SSH) */}
        <div className="flex items-center justify-between py-3">
          <div className="flex-1 pr-8">
            <Body className="mb-1">Allow remote access</Body>
            <Caption>
              SSH-tunnel in from another machine. Loopback only — not on your
              network.
            </Caption>
          </div>
          <Toggle
            enabled={remoteOn}
            aria-label="Allow remote access"
            onChange={(v) =>
              run("remote", window.api.localBackend.setRemoteAccess(v))
            }
            disabled={busy !== null}
          />
        </div>

        {remoteOn && status && (
          <div className="space-y-2 pb-2">
            {status.addresses.map((a) => (
              <div key={a.label} className="flex items-center gap-2">
                <Caption className="w-28 shrink-0">{a.label}</Caption>
                <ValueField value={a.url} />
                <BrowserLoginCopyButton baseUrl={a.url} />
                {/* <CopyButton value={a.wsUrl} tooltip="Copy ws:// URL" /> */}
              </div>
            ))}
            {status.token && (
              <div className="flex items-center gap-2">
                <Caption className="w-28 shrink-0">Owner token</Caption>
                {/* Keyed by the token so a rotated token starts masked again. */}
                <SecretField key={status.token} value={status.token} label="Owner token" />
                <CopyButton value={status.token} tooltip="Copy token" />
                <Button
                  type="button"
                  variant="bare"
                  tooltip="Rotate token"
                  aria-label="Rotate owner token"
                  onClick={() => setConfirmRotate(true)}
                  disabled={busy !== null}
                  className="text-primary-900 dark:text-primary-100"
                >
                  <Refresh className="size-3.5" />
                </Button>
              </div>
            )}

            <Alert
              isOpen={confirmRotate}
              title="Rotate owner token?"
              description="Active browser sessions and clients using the current owner token are disconnected. Paired devices use their own tokens and reconnect on their own."
              primaryButtonText="Rotate"
              secondaryButtonText="Cancel"
              primaryButtonVariant="danger"
              isPrimaryLoading={busy === "rotate"}
              onPrimary={() =>
                void run(
                  "rotate",
                  window.api.localBackend.rotateToken(),
                  "Owner token rotated",
                ).finally(() => setConfirmRotate(false))
              }
              onSecondary={() => setConfirmRotate(false)}
            />
            {!status.webUiAvailable && (
              <Caption tone="warning" className="block">
                Web UI not built — run <code>npm run build:web</code> once so
                browsers can load the interface.
              </Caption>
            )}

            {/* Network access (LAN) — requires remote access */}
            <div className="flex items-center justify-between pt-3">
              <div className="flex-1 pr-8">
                <Body className="mb-1">Network access (LAN)</Body>
                <Caption>
                  Also bind your LAN / Tailscale IPs for direct access. 
                </Caption>
              </div>
              <Toggle
                enabled={lanOn}
                aria-label="Allow network access on LAN"
                onChange={(v) => run("lan", window.api.localBackend.setLanAccess(v))}
                disabled={busy !== null}
              />
            </div>
          </div>
        )}

        <SettingsDivider />

        {/* Tailscale HTTPS */}
        <div className="flex items-center justify-between py-3">
          <div className="flex-1 pr-8">
            <Body className="mb-1">Tailscale HTTPS</Body>
            <Caption>
              A MagicDNS HTTPS URL via Tailscale Serve. Requires the Tailscale app
              with HTTPS enabled.
            </Caption>
          </div>
          <Toggle
            enabled={tailscaleOn}
            aria-label="Enable Tailscale HTTPS"
            onChange={(v) =>
              run(
                "tailscale",
                window.api.localBackend.setTailscaleHttps(v),
                v ? "Exposed over Tailscale HTTPS" : undefined,
              )
            }
            disabled={busy !== null}
          />
        </div>

        {tailscaleOn && status?.tailscaleHttpsUrl && (
          <div className="flex items-center gap-2 pb-3">
            <ValueField value={status.tailscaleHttpsUrl} />
            <BrowserLoginCopyButton baseUrl={status.tailscaleHttpsUrl} />
            {/* {status.tailscaleWsUrl && (
              <CopyButton value={status.tailscaleWsUrl} tooltip="Copy ws:// URL" />
            )} */}
          </div>
        )}
      </SettingsSection>

      <DevicePairing canPair={lanOn || tailscaleOn} />
    </>
  );
}

export function RemoteKeepAwakeSetting() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    window.api.localBackend
      .getStatus()
      .then((res) => {
        if (active && res?.success) {
          setEnabled(!!(res.data as Status).keepAwakeForRemoteAccess);
        }
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleChange = async (next: boolean) => {
    setBusy(true);
    try {
      const res = await window.api.localBackend.setKeepAwakeForRemoteAccess(next);
      if (res?.success) {
        setEnabled(!!(res.data as Status).keepAwakeForRemoteAccess);
      } else {
        toast.error(res?.error ?? "Failed to update keep awake");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update keep awake",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Other settings">
      <SettingsRow
        title="Keep this computer awake"
        description="Prevent sleep while plugged in and remote access is enabled."
      >
        <Toggle
          enabled={enabled ?? false}
          aria-label="Keep this computer awake for remote access"
          onChange={handleChange}
          disabled={enabled === null || busy}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
