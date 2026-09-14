import { baseApi } from "./baseApi";
import { CHANNELS } from "../../../../shared/ipc-kit/channels";

export interface PackageIdentifier {
  name: string;
  version?: string;
  ecosystem: string;
}

export interface PackageAlert {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description?: string;
  url?: string;
}

export interface PackageScore {
  package: PackageIdentifier;
  overallScore: number;
  riskLevel: "critical" | "high" | "medium" | "low" | "none";
  categories: {
    quality?: number;
    maintenance?: number;
    vulnerability?: number;
    license?: number;
    supplyChain?: number;
  };
  alerts: PackageAlert[];
}

export interface PackageCheckResult {
  allowed: boolean;
  package: PackageIdentifier;
  score?: PackageScore;
  reason?: string;
  alerts: PackageAlert[];
}

export interface ScanSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  safe: number;
}

export interface ManifestScanResult {
  ecosystem: string;
  manifestPath: string;
  packages: PackageScore[];
  summary: ScanSummary;
  scannedAt: number;
}

export interface ActiveGuardInfo {
  id: string;
  displayName: string;
}

export const guardsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getActiveGuard: builder.query<ActiveGuardInfo | null, void>({
      query: () => ({
        handler: CHANNELS.guards.getActiveGuard,
      }),
    }),

    checkPackage: builder.mutation<PackageCheckResult, PackageIdentifier>({
      query: (pkg) => ({
        handler: CHANNELS.guards.checkPackage,
        args: [pkg],
      }),
    }),

    checkPackages: builder.mutation<PackageCheckResult[], PackageIdentifier[]>({
      query: (pkgs) => ({
        handler: CHANNELS.guards.checkPackages,
        args: [pkgs],
      }),
    }),

    getPackageScore: builder.query<PackageScore, PackageIdentifier>({
      query: (pkg) => ({
        handler: CHANNELS.guards.getPackageScore,
        args: [pkg],
      }),
    }),

    scanWorkspace: builder.mutation<
      ManifestScanResult[],
      { workspaceId: string; rootPath: string }
    >({
      query: ({ workspaceId, rootPath }) => ({
        handler: CHANNELS.guards.scanWorkspace,
        args: [workspaceId, rootPath],
      }),
    }),
  }),
});

export const {
  useGetActiveGuardQuery,
  useCheckPackageMutation,
  useCheckPackagesMutation,
  useGetPackageScoreQuery,
  useLazyGetPackageScoreQuery,
  useScanWorkspaceMutation,
} = guardsApi;
