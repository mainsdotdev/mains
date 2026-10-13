export interface ConnectorOAuthStartResult {
  authorizationUrl: string;
  /** Older provider runtimes omit the login attempt identity. */
  loginId?: string;
}

export interface ConnectorOAuthLoginCompletion {
  serverName: string;
  loginId?: string;
  success: boolean;
  error?: string;
}

/** A catalog refresh, optionally carrying the completed OAuth attempt. */
export interface ProviderConnectorsUpdatedEvent {
  providerId: string;
  oauthLogin?: ConnectorOAuthLoginCompletion;
}
