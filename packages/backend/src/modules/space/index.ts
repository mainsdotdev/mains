// IPC Handlers
export { registerSpaceIpc, unregisterSpaceIpc } from "./space.ipc";

// Service
export { spaceService } from "./space.service";

// Repository

// Validation
export { sanitizeSpacePayload, sanitizeString, generateSlug } from "./space.validation";

// Constants
export { ACCOUNT_ID } from "./space.constants";

// DTOs
export type {
  SpacePayload,
  SanitizedSpaceResult,
  SpaceRecord,
} from "./space.dto";
