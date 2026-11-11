/** Opaque backend-generation revision. Optional for older clients/servers. */
export interface ConnectionRevision { revision?: string }
export interface ExpectedConnectionRevision { expectedRevision?: string }
export interface SavedConnectionCredentials extends ConnectionRevision { message: string }
export interface SavedConnectionResources extends ConnectionRevision { message: string; count: number }
