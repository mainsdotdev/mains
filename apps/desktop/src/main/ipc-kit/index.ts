export {
  emit,
  registerEventSink,
  clearEventSinks,
  type EventSink,
  type EventScope,
} from "./event-bus";
export {
  registerHandler,
  unregisterHandler,
  hasHandler,
  invokeHandler,
  registeredChannels,
  clearHandlers,
  type IpcHandler,
  type IpcInvokeContext,
} from "./handler-registry";
export { handle } from "./handle";
export { WebSocketSink, type WsClientConnection } from "./websocket-sink";
export { serveConnection, type WsConnection } from "./ws-server";

// Note: `browser-window-sink.ts` and `ipc-main.ts` import `electron` and are
// intentionally NOT re-exported here, so importing this barrel for the event bus
// or handler registry never pulls Electron into a module (or a headless process).
