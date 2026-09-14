export { registerGuardsIpc, unregisterGuardsIpc } from "./guards.ipc";
export { guardsService } from "./guards.service";
export { shutdownAllGuardAdapters, invalidateGuardAdapter } from "./adapters";
export type {
  GuardAdapter,
  GuardConfig,
  PackageIdentifier,
  PackageCheckResult,
  PackageScore,
  ManifestScanResult,
} from "./adapters";
