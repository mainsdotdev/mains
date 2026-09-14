// ─────────────────────────────────────────────────────────────
// Guard Adapter Types
// Dependency security interfaces for package checking flows
// ─────────────────────────────────────────────────────────────

/**
 * Identifies a package across ecosystems
 */
export interface PackageIdentifier {
  name: string;
  version?: string;
  ecosystem: PackageEcosystem;
}

export type PackageEcosystem = "npm" | "pypi" | "cargo" | "go" | "maven" | "rubygems";

/**
 * Alert raised for a package
 */
export interface PackageAlert {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description?: string;
  url?: string;
}

/**
 * Security scores for a package (0–1 scale)
 */
export interface PackageScoreCategories {
  quality?: number;
  maintenance?: number;
  vulnerability?: number;
  license?: number;
  supplyChain?: number;
}

/**
 * Full score report for a single package
 */
export interface PackageScore {
  package: PackageIdentifier;
  overallScore: number;
  riskLevel: RiskLevel;
  categories: PackageScoreCategories;
  alerts: PackageAlert[];
  metadata?: Record<string, unknown>;
}

export type RiskLevel = "critical" | "high" | "medium" | "low" | "none";

/**
 * Result of checking a package before install
 */
export interface PackageCheckResult {
  allowed: boolean;
  package: PackageIdentifier;
  score?: PackageScore;
  reason?: string;
  alerts: PackageAlert[];
}

/**
 * Result of scanning a manifest file
 */
export interface ManifestScanResult {
  ecosystem: string;
  manifestPath: string;
  packages: PackageScore[];
  summary: ScanSummary;
  scannedAt: number;
}

export interface ScanSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  safe: number;
}

/**
 * Guard adapter configuration stored alongside the connection
 */
export interface GuardConfig {
  /** Minimum overall score (0–1) to allow a package. Below this → block. */
  minScore?: number;
  /** Severity levels that trigger a block */
  blockOnSeverity?: RiskLevel[];
  /** Package names that always pass regardless of score */
  allowlist?: string[];
}

/**
 * Interface that all guard adapters must implement
 */
export interface GuardAdapter {
  /** Unique identifier for this guard service */
  readonly id: string;
  /** Human-readable name */
  readonly displayName: string;

  /** Check a single package before installation */
  checkPackage(pkg: PackageIdentifier): Promise<PackageCheckResult>;

  /** Batch check multiple packages */
  checkPackages(pkgs: PackageIdentifier[]): Promise<PackageCheckResult[]>;

  /** Get detailed score for a single package */
  getPackageScore(pkg: PackageIdentifier): Promise<PackageScore>;

  /** Full scan of all manifest files in a directory */
  scanProject(rootPath: string): Promise<ManifestScanResult[]>;

  /** Cleanup */
  shutdown?(): Promise<void>;
}
