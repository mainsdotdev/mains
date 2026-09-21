import { describe, it, expect } from "vitest";
import {
  validateCreateProject,
  validateUpdateProject,
} from "./projects.validation";

describe("validateCreateProject", () => {
  const validPayload = {
    accountId: "acc-1",
    name: "My Project",
    rootPath: "/home/user/project",
    remoteOrigin: "git@github.com:user/repo.git",
  };

  it("accepts valid payload with all required fields", () => {
    const result = validateCreateProject(validPayload);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.name).toBe("My Project");
    }
  });

  it("rejects null payload", () => {
    const result = validateCreateProject(null);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("Payload must be an object");
  });

  it("rejects missing accountId", () => {
    const result = validateCreateProject({ ...validPayload, accountId: undefined });
    expect(result.valid).toBe(false);
  });

  it("rejects missing name", () => {
    const result = validateCreateProject({ ...validPayload, name: undefined });
    expect(result.valid).toBe(false);
  });

  it("rejects missing rootPath", () => {
    const result = validateCreateProject({ ...validPayload, rootPath: undefined });
    expect(result.valid).toBe(false);
  });

  it("accepts payload without remoteOrigin (local-only project)", () => {
    const result = validateCreateProject({ ...validPayload, remoteOrigin: undefined });
    expect(result.valid).toBe(true);
  });

  it("accepts null remoteOrigin", () => {
    const result = validateCreateProject({ ...validPayload, remoteOrigin: null });
    expect(result.valid).toBe(true);
  });

  it("rejects non-string remoteOrigin", () => {
    const result = validateCreateProject({ ...validPayload, remoteOrigin: 123 });
    expect(result.valid).toBe(false);
  });

  it("strips unknown fields", () => {
    const result = validateCreateProject({ ...validPayload, hackerField: "drop table" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect((result.data as any).hackerField).toBeUndefined();
    }
  });

  it("allows optional fields like icon and scripts", () => {
    const result = validateCreateProject({
      ...validPayload,
      icon: "rocket",
      setupScript: "npm install",
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.icon).toBe("rocket");
      expect(result.data.setupScript).toBe("npm install");
    }
  });
});

describe("validateUpdateProject", () => {
  it("accepts valid update fields", () => {
    const result = validateUpdateProject({ name: "New Name" });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.data.name).toBe("New Name");
  });

  it("rejects null payload", () => {
    const result = validateUpdateProject(null);
    expect(result.valid).toBe(false);
  });

  it("rejects empty object (no valid fields)", () => {
    const result = validateUpdateProject({});
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe("No valid fields to update");
  });

  it("rejects payload with only unknown fields", () => {
    const result = validateUpdateProject({ foo: "bar", baz: 123 });
    expect(result.valid).toBe(false);
  });

  it("strips unknown fields from update", () => {
    const result = validateUpdateProject({ name: "OK", malicious: "data" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect((result.data as any).malicious).toBeUndefined();
    }
  });
});
