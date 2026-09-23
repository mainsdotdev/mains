import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import qrcode from "qrcode-generator";
import { Body, Button, Caption, CopyButton, Input, toast } from "@/components/ui";
import { DeviceMobile, DeviceTablet, Edit, Web } from "@/components/ui/icons";
import {
  SettingsDivider,
  SettingsSection,
} from "@/features/settings/components/settings-layout";

interface PairingCode {
  code: string;
  link: string;
  expiresAt: string | Date;
}

interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  appVersion: string | null;
  createdAt: string | Date;
  lastSeenAt: string | Date | null;
  /** Holds an open connection to this machine right now. */
  connected: boolean;
}

/** Matches the backend's cap on device names. */
const MAX_DEVICE_NAME_LENGTH = 80;

async function fetchDevices(): Promise<PairedDevice[]> {
  const res = await window.api.localBackend.listPairedDevices();
  return res?.success ? (res.data as PairedDevice[]) : [];
}

function QrCode({ value, size = 184 }: { value: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value, "Byte");
    qr.make();
    const count = qr.getModuleCount();
    const dark: Array<[number, number]> = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) dark.push([row, col]);
      }
    }
    return { count, dark };
  }, [value]);

  const cell = size / cells.count;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Pairing QR code"
      className="rounded-lg bg-white p-2 fill-black"
    >
      {cells.dark.map(([row, col]) => (
        <rect
          key={`${row}-${col}`}
          x={col * cell}
          y={row * cell}
          width={cell}
          height={cell}
        />
      ))}
    </svg>
  );
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * When the device last connected. `lastSeenAt` is stamped as a device opens
 * its connection, not while it stays on one — so "connected", not "active".
 */
function formatLastConnected(value: string | Date | null): string {
  if (!value) return "Never connected";
  const date = new Date(value);
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return "Connected just now";
  if (ms < 3_600_000) return `Connected ${Math.floor(ms / 60_000)}m ago`;
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === new Date().toDateString()) {
    return `Last connected today at ${time}`;
  }
  if (ms < 6 * 86_400_000) {
    const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
    return `Last connected ${weekday} at ${time}`;
  }
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return `Last connected ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })}`;
}

type DeviceKind = "phone" | "tablet" | "browser";

/**
 * What the device is, from what pairing records. There is no form factor on
 * the wire, but iOS reports the model family ("iPad") as the device name
 * unless the app holds Apple's user-assigned-name entitlement, and names
 * users give their iPads usually keep the word. Android tablets read as
 * phones until the app sends one.
 */
function deviceKind({ name, platform }: PairedDevice): DeviceKind {
  if (platform === "web") return "browser";
  if (/\bipad\b/i.test(name)) return "tablet";
  return "phone";
}

const DEVICE_ICONS: Record<DeviceKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  phone: DeviceMobile,
  tablet: DeviceTablet,
  browser: Web,
};

function platformLabel(device: PairedDevice, kind: DeviceKind): string | null {
  switch (device.platform) {
    case "ios":
      return kind === "tablet" ? "iPadOS" : "iOS";
    case "android":
      return "Android";
    case "web":
      return "Browser";
    default:
      return null;
  }
}

/**
 * One paired device: what it is, whether it's connected, and its name —
 * renamed in place, since pairing only learns "iPad" or a model code.
 */
function DeviceRow({
  device,
  revoking,
  locked,
  onRename,
  onRevoke,
}: {
  device: PairedDevice;
  revoking: boolean;
  /** Another action is running; one at a time. */
  locked: boolean;
  onRename: (device: PairedDevice, name: string) => void;
  onRevoke: (device: PairedDevice) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Enter, Escape and the blur that follows either would each finish the
  // edit; only the first one counts.
  const finished = useRef(false);

  const kind = deviceKind(device);
  const Icon = DEVICE_ICONS[kind];
  const details = [
    platformLabel(device, kind),
    device.appVersion ? `v${device.appVersion}` : null,
    device.connected ? "Connected now" : formatLastConnected(device.lastSeenAt),
  ].filter(Boolean);

  const startEditing = () => {
    finished.current = false;
    setDraft(device.name);
  };
  const finishEditing = (save: boolean) => {
    if (finished.current || draft === null) return;
    finished.current = true;
    const name = draft.trim();
    setDraft(null);
    if (save && name && name !== device.name) onRename(device, name);
  };

  return (
    <div className="flex items-center gap-3 py-3">
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-200/60 text-primary-600 dark:bg-primary-800/40 dark:text-primary-400">
        <Icon aria-hidden className="size-5" />
        {device.connected && (
          <span
            aria-hidden
            className="absolute right-0 bottom-0 size-2.5 rounded-full bg-success ring-2 ring-primary dark:ring-primary-950"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        {draft === null ? (
          <div className="group/name flex min-w-0 items-center gap-1">
            <Body className="truncate">{device.name}</Body>
            <Button
              variant="icon"
              tooltip="Rename"
              aria-label={`Rename ${device.name}`}
              onClick={startEditing}
              disabled={locked}
              className="opacity-0 group-hover/name:opacity-100 focus-visible:opacity-100"
            >
              <Edit className="size-3.5" />
            </Button>
          </div>
        ) : (
          <Input
            autoFocus
            value={draft}
            maxLength={MAX_DEVICE_NAME_LENGTH}
            aria-label={`New name for ${device.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.target.select()}
            onBlur={() => finishEditing(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishEditing(true);
              if (event.key === "Escape") finishEditing(false);
            }}
            className="mb-0.5 max-w-72 py-1 mr-2"
          />
        )}
        <Caption>{details.join(" · ")}</Caption>
      </div>
      <Button
        variant="danger"
        onClick={() => onRevoke(device)}
        isLoading={revoking}
        disabled={locked}
      >
        Revoke
      </Button>
    </div>
  );
}

/**
 * Pair the Mains mobile app with this machine: show a one-time QR code, watch
 * for the device to redeem it, and manage the devices that already did. Its
 * own section, below "This machine": pairing rides on that exposure — a
 * device needs a LAN or Tailscale address to reach.
 */
export function DevicePairing({ canPair }: { canPair: boolean }) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [busy, setBusy] = useState<"code" | string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Devices known when the current code was minted; anything beyond them is
  // the device that just redeemed it.
  const knownIds = useRef<Set<string>>(new Set());

  // The list follows main: a pairing, a device connecting (last seen), or a
  // revoke all push `pairedDevicesChanged`, so there is nothing to poll.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      fetchDevices()
        .then((list) => {
          if (active) setDevices(list);
        })
        .catch(() => {});
    };
    refresh();
    const unsubscribe = window.api.localBackend.onPairedDevicesChanged(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // While a code is on screen: tick the countdown (and drop the code when it
  // runs out), and hand the QR over to the new device the moment it pairs.
  useEffect(() => {
    if (!code) return;
    const expiresAt = new Date(code.expiresAt).getTime();
    const tick = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) setCode(null);
    }, 1000);
    const unsubscribe = window.api.localBackend.onPairedDevicesChanged(() => {
      fetchDevices()
        .then((list) => {
          const fresh = list.find((d) => !knownIds.current.has(d.id));
          if (fresh) {
            setCode(null);
            toast.success(`Paired ${fresh.name}`);
          }
        })
        .catch(() => {});
    });
    return () => {
      clearInterval(tick);
      unsubscribe();
    };
  }, [code]);

  const remainingMs = code ? new Date(code.expiresAt).getTime() - now : 0;

  const createCode = async () => {
    setBusy("code");
    try {
      const res = await window.api.localBackend.createPairingCode();
      if (res?.success) {
        knownIds.current = new Set(devices.map((d) => d.id));
        setNow(Date.now());
        setCode(res.data as PairingCode);
      } else {
        toast.error(res?.error ?? "Failed to create pairing code");
      }
    } finally {
      setBusy(null);
    }
  };

  const rename = async (device: PairedDevice, name: string) => {
    // Show the new name straight away; the change event brings the list back
    // in line either way.
    setDevices((list) =>
      list.map((d) => (d.id === device.id ? { ...d, name } : d)),
    );
    const res = await window.api.localBackend.renamePairedDevice(device.id, name);
    if (!res?.success) {
      toast.error(res?.error ?? "Failed to rename device");
      setDevices(await fetchDevices());
    }
  };

  const revoke = async (device: PairedDevice) => {
    setBusy(device.id);
    try {
      const res = await window.api.localBackend.revokePairedDevice(device.id);
      if (res?.success) {
        toast.success(`Revoked ${device.name}`);
        setDevices(await fetchDevices());
      } else {
        toast.error(res?.error ?? "Failed to revoke device");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsSection title="Devices">
      <div className="py-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 pr-8">
            <Body className="mb-1">Pair a device</Body>
            <Caption>
              Scan the code with the Mains mobile app. A code works once and
              expires after five minutes.
            </Caption>
          </div>
          {!code && (
            <Button
              variant="secondary"
              onClick={() => void createCode()}
              isLoading={busy === "code"}
              disabled={!canPair || busy !== null}
            >
              Show pairing code
            </Button>
          )}
        </div>

        {!canPair && (
          <Caption tone="warning" className="mt-2 block">
            Turn on Network access (LAN) or Tailscale HTTPS first — a device
            cannot reach a loopback-only host.
          </Caption>
        )}

        {code && (
          <div className="mt-4 flex items-start gap-5">
            <QrCode value={code.link} />
            <div className="flex flex-1 flex-col gap-2 pt-1">
              <Caption>
                Expires in{" "}
                <span className="font-mono">{formatCountdown(remainingMs)}</span>
              </Caption>
              <Caption>
                Waiting for a device… keep this window open until it reports
                paired.
              </Caption>
              <div className="flex items-center gap-1">
                <Caption>No camera (simulator)? Copy the link and paste it in the app.</Caption>
                <CopyButton
                  text={code.link}
                  tooltip="Copy pairing link"
                  variant="bare"
                  className="text-primary-900 dark:text-primary-100"
                />
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void createCode()}
                  isLoading={busy === "code"}
                  disabled={busy !== null}
                >
                  New code
                </Button>
                <Button variant="secondary" onClick={() => setCode(null)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {devices.map((device) => (
        <Fragment key={device.id}>
          <SettingsDivider />
          <DeviceRow
            device={device}
            revoking={busy === device.id}
            locked={busy !== null}
            onRename={(d, name) => void rename(d, name)}
            onRevoke={(d) => void revoke(d)}
          />
        </Fragment>
      ))}
    </SettingsSection>
  );
}
