import { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Body, Button, Caption, CopyButton, toast } from "@/components/ui";

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
}

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

function formatLastSeen(value: string | Date | null): string {
  if (!value) return "never connected";
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 60_000) return "seen just now";
  if (ms < 3_600_000) return `seen ${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `seen ${Math.floor(ms / 3_600_000)}h ago`;
  return `seen ${new Date(value).toLocaleDateString()}`;
}

/**
 * Pair the Mains mobile app with this machine: show a one-time QR code, watch
 * for the phone to redeem it, and manage the phones that already did. Lives
 * under "This machine" because pairing rides on that exposure — a phone needs
 * a LAN or Tailscale address to reach.
 */
export function PhonePairing({ canPair }: { canPair: boolean }) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [busy, setBusy] = useState<"code" | string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Devices known when the current code was minted; anything beyond them is
  // the phone that just redeemed it.
  const knownIds = useRef<Set<string>>(new Set());

  // The list follows main: a pairing, a phone connecting (last seen), or a
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
    <div className="py-3">
      <div className="flex items-center justify-between">
        <div className="flex-1 pr-8">
          <Body className="mb-1">Pair a phone</Body>
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
          Turn on Network access (LAN) or Tailscale HTTPS first — a phone
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
              Waiting for a phone… keep this window open until it reports
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

      {devices.length > 0 && (
        <div className="mt-4 space-y-2">
          <Caption className="block">Paired phones</Caption>
          {devices.map((device) => (
            <div
              key={device.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <Body className="truncate">{device.name}</Body>
                <Caption>
                  {device.platform}
                  {device.appVersion ? ` · v${device.appVersion}` : ""}
                  {" · "}
                  {formatLastSeen(device.lastSeenAt)}
                </Caption>
              </div>
              <Button
                variant="secondary"
                onClick={() => void revoke(device)}
                isLoading={busy === device.id}
                disabled={busy !== null}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
