/** Public account rights. Device credentials and encryption keys are separate. */
export type BridgeBillingInterval = "monthly" | "yearly";
export interface BridgePlan {
  id: string;
  name: string;
  storageLimitBytes: number;
  fileLimitBytes: number;
  writesPerMinute: number;
  billingIntervals: BridgeBillingInterval[];
}
export interface BridgeSubscription {
  status: "none" | "scheduled" | "active" | "expired" | "revoked" | "unavailable" | "development";
  planId: string | null;
  billingInterval: BridgeBillingInterval | null;
  startsAt: string | null;
  expiresAt: string | null;
  canUpload: boolean;
}
export interface BridgeSubscriptionStatus {
  subscription: BridgeSubscription;
  plans: BridgePlan[];
}
