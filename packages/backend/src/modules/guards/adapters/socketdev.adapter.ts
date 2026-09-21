// ─────────────────────────────────────────────────────────────
// Socket.dev Guard Adapter
// Uses Socket.dev REST API for package security checks
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import type {
  GuardAdapter,
  GuardConfig,
  PackageIdentifier,
  PackageCheckResult,
  PackageScore,
  PackageAlert,
  PackageScoreCategories,
  ManifestScanResult,
  RiskLevel,
  ScanSummary,
} from "./adapter.types";

const API_BASE = "https://api.socket.dev/v0";

/** Manifest file names → ecosystem mapping */
const MANIFEST_MAP: Record<string, string> = {
  "package.json": "npm",
  "package-lock.json": "npm",
  "yarn.lock": "npm",
  "pnpm-lock.yaml": "npm",
  "requirements.txt": "pypi",
  "Pipfile": "pypi",
  "Pipfile.lock": "pypi",
  "Cargo.toml": "cargo",
  "Cargo.lock": "cargo",
  "go.mod": "go",
  "go.sum": "go",
  "Gemfile": "rubygems",
  "Gemfile.lock": "rubygems",
};

interface SocketDevAdapterOptions {
  apiToken: string;
  orgSlug?: string;
  config?: GuardConfig;
}

/**
 * Convert a 0–1 score to a risk level
 */
function scoreToRiskLevel(score: number): RiskLevel {
  if (score < 0.2) return "critical";
  if (score < 0.4) return "high";
  if (score < 0.6) return "medium";
  if (score < 0.8) return "low";
  return "none";
}

/**
 * Build a PURL string for a package
 * @see https://github.com/package-url/purl-spec
 */
function toPurl(pkg: PackageIdentifier): string {
  // PURL spec: encode @ as %40 but keep / for scoped packages
  const encodedName = pkg.name.replace("@", "%40");
  const base = `pkg:${pkg.ecosystem}/${encodedName}`;
  return pkg.version ? `${base}@${pkg.version}` : base;
}

/**
 * Decide whether to allow a package based on config thresholds
 */
function shouldAllow(score: PackageScore, config: GuardConfig): { allowed: boolean; reason?: string } {
  // Always allow allowlisted packages
  if (config.allowlist?.includes(score.package.name)) {
    return { allowed: true, reason: "Package is in allowlist" };
  }

  // Block if any alert matches blockOnSeverity
  if (config.blockOnSeverity?.length) {
    const blocked = score.alerts.find((a) => config.blockOnSeverity!.includes(a.severity as RiskLevel));
    if (blocked) {
      return {
        allowed: false,
        reason: `Blocked: ${blocked.severity} alert — ${blocked.title}`,
      };
    }
  }

  // Block if below minimum score
  if (config.minScore != null && score.overallScore < config.minScore) {
    return {
      allowed: false,
      reason: `Score ${(score.overallScore * 100).toFixed(0)} is below minimum ${(config.minScore * 100).toFixed(0)}`,
    };
  }

  return { allowed: true };
}

export function createSocketDevAdapter(options: SocketDevAdapterOptions): GuardAdapter {
  const { apiToken, orgSlug, config = {} } = options;

  // Default config: block critical and high severity, min score 0.3
  const guardConfig: GuardConfig = {
    minScore: config.minScore ?? 0.3,
    blockOnSeverity: config.blockOnSeverity ?? ["critical", "high"],
    allowlist: config.allowlist ?? [],
  };

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  /**
   * Fetch package data from the PURL endpoint
   */
  async function fetchPurl(pkgs: PackageIdentifier[]): Promise<Map<string, PackageScore>> {
    const components = pkgs.map((p) => ({ purl: toPurl(p) }));
    const body = { components };

    // PURL endpoint works without org scope — simpler and always available
    const endpoint = `${API_BASE}/purl`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Socket.dev API error (${response.status}): ${errorText}`);
    }

    const text = await response.text();
    const results = new Map<string, PackageScore>();

    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const obj = JSON.parse(line);

        // API uses "inputPurl" to identify which request PURL this result is for
        const purl = obj.inputPurl || obj.purl;

        // Skip error entries
        if (obj.error) {
          console.warn(`[SocketDev] Error for ${purl}:`, obj.error);
          continue;
        }

        if (!purl && !obj.name) continue;

        // Match by inputPurl or by name+ecosystem
        const matchedPkg = purl
          ? pkgs.find((p) => toPurl(p) === purl)
          : pkgs.find((p) => p.name === obj.name);
        if (!matchedPkg) continue;

        const scoreData = obj.score || {};
        const overallScore = scoreData.overall ?? 0.5;
        const categories: PackageScoreCategories = {
          quality: scoreData.quality,
          maintenance: scoreData.maintenance,
          vulnerability: scoreData.vulnerability,
          license: scoreData.license,
          supplyChain: scoreData.supplyChain,
        };

        const alerts: PackageAlert[] = (obj.alerts || []).map((a: any) => ({
          type: a.type || "unknown",
          severity: a.severity || "medium",
          title: a.key || a.type || "Unknown alert",
          description: a.description,
          url: a.url,
        }));

        const key = purl || `pkg:${obj.type}/${obj.name}`;

        results.set(key, {
          package: matchedPkg,
          overallScore,
          riskLevel: scoreToRiskLevel(overallScore),
          categories,
          alerts,
          metadata: { id: obj.id, license: obj.license, size: obj.size, author: obj.author },
        });
      } catch {
        // Skip malformed lines
      }
    }

    return results;
  }

  /**
   * Create a full scan by uploading manifest files
   */
  async function createFullScan(manifestPaths: string[]): Promise<ManifestScanResult[]> {
    if (!orgSlug) {
      throw new Error("Socket.dev organization slug is required for full scans");
    }

    // Build multipart form with manifest files
    const formData = new FormData();
    for (const manifestPath of manifestPaths) {
      const content = fs.readFileSync(manifestPath, "utf-8");
      const fileName = path.basename(manifestPath);
      formData.append(fileName, new Blob([content]), fileName);
    }

    const scanResponse = await fetch(`${API_BASE}/orgs/${encodeURIComponent(orgSlug)}/full-scans`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
      body: formData,
    });

    if (!scanResponse.ok) {
      const errorText = await scanResponse.text();
      throw new Error(`Socket.dev full scan error (${scanResponse.status}): ${errorText}`);
    }

    const scanData: any = await scanResponse.json();
    const scanId = scanData.id;

    if (!scanId) {
      throw new Error("Socket.dev full scan response missing scan ID");
    }

    // Stream scan results
    const resultsResponse = await fetch(
      `${API_BASE}/orgs/${encodeURIComponent(orgSlug)}/full-scans/${scanId}`,
      { headers },
    );

    if (!resultsResponse.ok) {
      throw new Error(`Socket.dev scan results error (${resultsResponse.status})`);
    }

    const resultsText = await resultsResponse.text();
    const packages: PackageScore[] = [];

    for (const line of resultsText.split("\n").filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        if (!obj.name) continue;

        const scoreData = obj.score || {};
        const overallScore = scoreData.overall ?? 0.5;
        const categories: PackageScoreCategories = {
          quality: scoreData.quality,
          maintenance: scoreData.maintenance,
          vulnerability: scoreData.vulnerability,
          license: scoreData.license,
          supplyChain: scoreData.supplyChain,
        };

        const alerts: PackageAlert[] = (obj.alerts || []).map((a: any) => ({
          type: a.type || "unknown",
          severity: a.severity || "medium",
          title: a.key || a.type || "Unknown alert",
          description: a.description,
          url: a.url,
        }));

        packages.push({
          package: {
            name: obj.name,
            version: obj.version,
            ecosystem: obj.ecosystem || "npm",
          },
          overallScore,
          riskLevel: scoreToRiskLevel(overallScore),
          categories,
          alerts,
        });
      } catch {
        // Skip malformed lines
      }
    }

    // Group results by manifest ecosystem
    const summary: ScanSummary = {
      total: packages.length,
      critical: packages.filter((p) => p.riskLevel === "critical").length,
      high: packages.filter((p) => p.riskLevel === "high").length,
      medium: packages.filter((p) => p.riskLevel === "medium").length,
      low: packages.filter((p) => p.riskLevel === "low").length,
      safe: packages.filter((p) => p.riskLevel === "none").length,
    };

    // Return as single scan result (the API merges all manifest files)
    return [
      {
        ecosystem: "mixed",
        manifestPath: manifestPaths.join(", "),
        packages,
        summary,
        scannedAt: Date.now(),
      },
    ];
  }

  return {
    id: "socketdev",
    displayName: "Socket.dev",

    async checkPackage(pkg: PackageIdentifier): Promise<PackageCheckResult> {
      const results = await this.checkPackages([pkg]);
      return results[0];
    },

    async checkPackages(pkgs: PackageIdentifier[]): Promise<PackageCheckResult[]> {
      const scoreMap = await fetchPurl(pkgs);

      return pkgs.map((pkg) => {
        const purl = toPurl(pkg);
        const score = scoreMap.get(purl);

        if (!score) {
          // Unknown package — allow but flag
          return {
            allowed: true,
            package: pkg,
            reason: "Package not found in Socket.dev database",
            alerts: [],
          };
        }

        const { allowed, reason } = shouldAllow(score, guardConfig);

        return {
          allowed,
          package: pkg,
          score,
          reason,
          alerts: score.alerts,
        };
      });
    },

    async getPackageScore(pkg: PackageIdentifier): Promise<PackageScore> {
      const scoreMap = await fetchPurl([pkg]);
      const purl = toPurl(pkg);
      const score = scoreMap.get(purl);

      if (!score) {
        return {
          package: pkg,
          overallScore: 0.5,
          riskLevel: "medium",
          categories: {},
          alerts: [],
          metadata: { notFound: true },
        };
      }

      return score;
    },

    async scanProject(rootPath: string): Promise<ManifestScanResult[]> {
      // Discover manifest files in root
      const manifestPaths: string[] = [];
      const entries = fs.readdirSync(rootPath);

      for (const entry of entries) {
        if (MANIFEST_MAP[entry]) {
          const fullPath = path.join(rootPath, entry);
          if (fs.statSync(fullPath).isFile()) {
            manifestPaths.push(fullPath);
          }
        }
      }

      if (manifestPaths.length === 0) {
        return [];
      }

      // If org slug is set, use full scan API
      if (orgSlug) {
        return createFullScan(manifestPaths);
      }

      // Fallback: parse package.json and check packages via PURL
      const pkgJsonPath = manifestPaths.find((p) => p.endsWith("package.json"));
      if (!pkgJsonPath) {
        return [];
      }

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      const deps: PackageIdentifier[] = [];

      for (const [name, version] of Object.entries(pkgJson.dependencies || {})) {
        deps.push({ name, version: String(version).replace(/^[\^~>=<]/, ""), ecosystem: "npm" });
      }
      for (const [name, version] of Object.entries(pkgJson.devDependencies || {})) {
        deps.push({ name, version: String(version).replace(/^[\^~>=<]/, ""), ecosystem: "npm" });
      }

      if (deps.length === 0) return [];

      const scoreMap = await fetchPurl(deps);
      const packages: PackageScore[] = [];

      for (const dep of deps) {
        const score = scoreMap.get(toPurl(dep));
        if (score) {
          packages.push(score);
        }
      }

      const summary: ScanSummary = {
        total: packages.length,
        critical: packages.filter((p) => p.riskLevel === "critical").length,
        high: packages.filter((p) => p.riskLevel === "high").length,
        medium: packages.filter((p) => p.riskLevel === "medium").length,
        low: packages.filter((p) => p.riskLevel === "low").length,
        safe: packages.filter((p) => p.riskLevel === "none").length,
      };

      return [
        {
          ecosystem: "npm",
          manifestPath: pkgJsonPath,
          packages,
          summary,
          scannedAt: Date.now(),
        },
      ];
    },
  };
}
