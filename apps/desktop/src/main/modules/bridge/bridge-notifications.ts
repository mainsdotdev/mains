import { Notification } from "electron";
import { registerEventSink } from "@mains/backend/ipc-kit/event-bus";
import { CHANNELS } from "@mains/contracts/channels";
import type { BridgeApprovalRequest } from "@mains/contracts/bridge-auth";
import { requestWindow } from "../../windows";

export function startBridgeNotifications(): () => void {
  const retained = new Set<Notification>();
  const unregister = registerEventSink({ kind: "bridge-notifications", send(channel, payload) {
    if (channel !== CHANNELS.bridge.deviceApprovalRequested || !Notification.isSupported()) return;
    const request = payload as BridgeApprovalRequest;
    // Never show the expected code here: approval means typing it from the new device's screen.
    const notification = new Notification({ title: "Approve a Mains backend", body: `${request.label} wants to sync. Enter the code shown on that device in Bridge › Device setup.`, silent: false });
    retained.add(notification);
    notification.on("click", () => { requestWindow({ kind: "navigate", path: "/bridge" }); retained.delete(notification); });
    notification.on("close", () => retained.delete(notification));
    notification.show();
  } });
  return () => { unregister(); for (const notification of retained) notification.close(); retained.clear(); };
}
