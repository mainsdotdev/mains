import { describe, it, expect, vi } from "vitest";
import { assertOk, assertFail } from "../../../shared/ipc-kit/service-response";

const { safeStorageMock } = vi.hoisted(() => ({
  safeStorageMock: {
    // Default to available (matches a healthy macOS / Keychain install).
    // Individual tests flip this to false to exercise the fail-closed path (B3).
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

vi.mock("electron", () => ({
  safeStorage: safeStorageMock,
  app: {
    getPath: () => "/tmp",
    getName: () => "mains",
    getVersion: () => "0.0.0",
  },
}));

import {
  formatSourceName,
  parseConnectionMetadata,
  parseResourceMetadata,
  encryptSecrets,
  decryptSecrets,
  createTokenHash,
  parseProviderCredentials,
} from "./connections.utils";

describe("formatSourceName", () => {
  it("maps known source names", () => {
    expect(formatSourceName("playlists")).toBe("Library Playlists");
    expect(formatSourceName("recently-played")).toBe("Recently Played");
    expect(formatSourceName("heavy-rotation")).toBe("Heavy Rotation");
    expect(formatSourceName("top-tracks")).toBe("Top Tracks");
    expect(formatSourceName("top-artists")).toBe("Top Artists");
    expect(formatSourceName("saved-albums")).toBe("Saved Albums");
  });

  it("returns the original string for unknown names", () => {
    expect(formatSourceName("custom-source")).toBe("custom-source");
  });
});

describe("parseConnectionMetadata", () => {
  it("returns empty object for null", () => {
    expect(parseConnectionMetadata(null)).toEqual({});
  });

  it("parses valid JSON string", () => {
    expect(parseConnectionMetadata('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("returns empty object for invalid JSON string", () => {
    expect(parseConnectionMetadata("not json")).toEqual({});
  });

  it("returns empty object for non-object JSON", () => {
    expect(parseConnectionMetadata('"just a string"')).toEqual({});
  });

  it("passes through object directly", () => {
    const obj = { domain: "github.com" };
    expect(parseConnectionMetadata(obj)).toBe(obj);
  });
});

describe("parseResourceMetadata", () => {
  it("returns empty object for null", () => {
    expect(parseResourceMetadata(null)).toEqual({});
  });

  it("parses valid JSON string", () => {
    expect(parseResourceMetadata('{"repo":"test"}')).toEqual({ repo: "test" });
  });

  it("returns empty object for invalid JSON", () => {
    expect(parseResourceMetadata("bad json")).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────
// Crypto / provider-secret helpers (moved from connectionCredentials.utils)
// ─────────────────────────────────────────────────────────────
describe("encryptSecrets / decryptSecrets", () => {
  it("round-trips a secrets map", () => {
    const secrets = { token: "gh_abc123", apiKey: "key-xyz" };
    const encrypted = encryptSecrets(secrets);
    expect(encrypted).toBeInstanceOf(Buffer);

    const decrypted = decryptSecrets(encrypted);
    expect(decrypted).toEqual(secrets);
  });

  it("handles single-field secrets", () => {
    const secrets = { token: "test-token" };
    const result = decryptSecrets(encryptSecrets(secrets));
    expect(result).toEqual(secrets);
  });

  it("handles empty secrets", () => {
    const secrets = {};
    const result = decryptSecrets(encryptSecrets(secrets));
    expect(result).toEqual(secrets);
  });

  it("fails closed when secure storage is unavailable (B3)", () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValueOnce(false);
    expect(() => encryptSecrets({ token: "x" })).toThrow(/unavailable/i);
  });
});

describe("createTokenHash", () => {
  it("returns a 32-byte SHA-256 Buffer", () => {
    const hash = createTokenHash(["token1"]);
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32);
  });

  it("produces deterministic output", () => {
    const hash1 = createTokenHash(["token1", "token2"]);
    const hash2 = createTokenHash(["token1", "token2"]);
    expect(hash1.equals(hash2)).toBe(true);
  });

  it("different tokens produce different hashes", () => {
    const hash1 = createTokenHash(["token1"]);
    const hash2 = createTokenHash(["token2"]);
    expect(hash1.equals(hash2)).toBe(false);
  });

  it("joins tokens with colon separator", () => {
    const combined = createTokenHash(["a", "b"]);
    const separate1 = createTokenHash(["a:b"]);
    expect(combined.equals(separate1)).toBe(true);
  });
});

describe("parseProviderCredentials", () => {
  it("parses github credentials", () => {
    const result = parseProviderCredentials("github", { token: "gh_abc" });
    assertOk(result);
    if (result.success) {
      expect(result.data.secrets).toEqual({ token: "gh_abc" });
      expect(result.data.tokensForHash).toEqual(["gh_abc"]);
    }
  });

  it("parses linear credentials", () => {
    const result = parseProviderCredentials("linear", { apiKey: "lin_123" });
    assertOk(result);
    if (result.success) {
      expect(result.data.secrets).toEqual({ apiKey: "lin_123" });
    }
  });

  it("parses jira credentials", () => {
    const result = parseProviderCredentials("jira", { apiToken: "jira-tok" });
    assertOk(result);
    if (result.success) {
      expect(result.data.secrets).toEqual({ apiToken: "jira-tok" });
    }
  });

  it("parses gitlab credentials", () => {
    const result = parseProviderCredentials("gitlab", { token: "glpat-xxx" });
    assertOk(result);
    if (result.success) {
      expect(result.data.secrets).toEqual({ token: "glpat-xxx" });
    }
  });

  it("parses asana credentials", () => {
    const result = parseProviderCredentials("asana", { accessToken: "asana-tok" });
    assertOk(result);
    if (result.success) {
      expect(result.data.secrets).toEqual({ accessToken: "asana-tok" });
    }
  });

  it("parses trello credentials (two required fields)", () => {
    const result = parseProviderCredentials("trello", {
      token: "trello-tok",
      apiKey: "trello-key",
    });
    assertOk(result);
    if (result.success) {
      expect(result.data.secrets).toEqual({ token: "trello-tok", apiKey: "trello-key" });
      expect(result.data.tokensForHash).toEqual(["trello-tok", "trello-key"]);
    }
  });

  it("fails for unsupported provider", () => {
    const result = parseProviderCredentials("unknown", { token: "x" });
    assertFail(result);
    if (!result.success) {
      expect(result.error).toContain("Unsupported provider");
    }
  });

  it("fails when required field is missing", () => {
    const result = parseProviderCredentials("github", {});
    assertFail(result);
    if (!result.success) {
      expect(result.error).toContain("token is required");
    }
  });

  it("fails when required field is not a string", () => {
    const result = parseProviderCredentials("github", { token: 123 });
    assertFail(result);
  });

  it("fails for trello when one of two required fields missing", () => {
    const result = parseProviderCredentials("trello", { token: "tok" });
    assertFail(result);
    if (!result.success) {
      expect(result.error).toContain("apiKey is required");
    }
  });
});
