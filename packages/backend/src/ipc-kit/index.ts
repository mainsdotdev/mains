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

// `browser-window-sink.ts` lives in the desktop host because it imports Electron.
// The transport-neutral IPC adapter remains available as an explicit subpath.
