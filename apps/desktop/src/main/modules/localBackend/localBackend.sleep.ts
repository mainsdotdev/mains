export interface RemoteAwakeState {
  enabled: boolean;
  remoteAccess: boolean;
  tailscale: boolean;
  onBatteryPower: boolean;
}

/** Keep the machine available only while remote access is usable and on AC. */
export function shouldKeepRemoteHostAwake({
  enabled,
  remoteAccess,
  tailscale,
  onBatteryPower,
}: RemoteAwakeState): boolean {
  return enabled && (remoteAccess || tailscale) && !onBatteryPower;
}
