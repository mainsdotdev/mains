import type { ComponentType, SVGProps } from "react";
import type { BridgeRegisteredBackend } from "@mains/contracts/bridge-auth";
import { Button, Text } from "@/components/ui";
import { DeviceDesktop, DeviceLaptop, DeviceMobile, DeviceTablet, Web } from "@/components/ui/icons";
import { bridgeDevicePresentation, type BridgeDeviceKind } from "../lib/bridge-device";

const DEVICE_ICONS: Record<BridgeDeviceKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  desktop: DeviceDesktop,
  laptop: DeviceLaptop,
  phone: DeviceMobile,
  tablet: DeviceTablet,
  browser: Web,
};

export function BridgeDeviceRow({
  device,
  isCurrent,
  isRemote,
  busy,
  onRevoke,
}: {
  device: BridgeRegisteredBackend;
  isCurrent: boolean;
  isRemote: boolean;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { kind, platform, access, lastSeen } = bridgeDevicePresentation(device);
  const Icon = DEVICE_ICONS[kind];
  const details = [platform, access, !isCurrent && device.status === "approved" ? lastSeen : null].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-200/60 text-primary-600 dark:bg-primary-800/40 dark:text-primary-400">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text className="min-w-0 break-words">{device.label}</Text>
          {isCurrent && (
            <Text as="span" size="xxs" tone="subtle" className="shrink-0 rounded-md bg-primary-200/60 px-1.5 py-0.5 dark:bg-primary-800/40">
              {isRemote ? "Connected device" : "This device"}
            </Text>
          )}
        </div>
        <Text size="xs" tone="subtle" className="mt-0.5">{details.join(" · ")}</Text>
      </div>
      {!isCurrent && device.status !== "revoked" && (
        <div className="ml-auto flex justify-end">
          <Button variant="secondary" disabled={busy} onClick={onRevoke}>
            Revoke access
          </Button>
        </div>
      )}
    </li>
  );
}
