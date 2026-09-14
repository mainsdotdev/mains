import { WsTransport } from "../ws-transport";
import { DemoBackend } from "./demo-backend";
import { DemoSocket } from "./demo-socket";

/**
 * The demo Mac's address. It looks like an endpoint so the whole pairing
 * machinery — keychain record, supervisor, settings screen — treats the demo
 * exactly like a Mac; only `createTransport` looks at the scheme.
 */
export const DEMO_ENDPOINT = "demo://on-this-phone";
export const DEMO_BACKEND_ID = "demo-mac";

export function isDemoEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("demo:");
}

/** One demo Mac per app session, so its runs survive reconnects. */
let backend: DemoBackend | null = null;

export function createDemoTransport(): WsTransport {
  return new WsTransport(DEMO_ENDPOINT, {
    factory: () => new DemoSocket((backend ??= new DemoBackend())),
  });
}
