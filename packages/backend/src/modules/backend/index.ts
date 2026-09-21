// IPC
export { registerBackendIpc, unregisterBackendIpc } from "./backend.ipc";

// Service
export {
  backendService,
  buildPairingLink,
  clearPairingCodes,
  PAIRED_DEVICE_CHANNELS,
  PAIRED_DEVICE_COMMANDS,
} from "./backend.service";

// Repository (module-internal — not exported)

// Validation
export { parsePairDeviceInput } from "./backend.validation";

// DTOs
export type {
  BackendDescriptor,
  PairedDevice,
  PairedDeviceAccess,
  PairedDevicePlatform,
  CommandReceiptRecord,
  PairingCode,
  PairDeviceInput,
  PairDeviceResult,
} from "./backend.dto";
