import { describe, it, expect } from "vitest";
import {
  getRouteType,
  getRouteRunId,
  getBaseRoutePath,
  WORKSPACE_BASE_PATH,
} from "./route-utils";

describe("getRouteType", () => {
  it('returns "home" for /', () => {
    expect(getRouteType("/")).toBe("home");
  });

  it('returns "settings" for /settings', () => {
    expect(getRouteType("/settings")).toBe("settings");
  });

  it('returns "settings" for /settings/subroute', () => {
    expect(getRouteType("/settings/account")).toBe("settings");
  });

  it('returns "code" for /code', () => {
    expect(getRouteType("/code")).toBe("code");
  });

  it('returns "code" for /code/:id', () => {
    expect(getRouteType("/code/workspace-123")).toBe("code");
  });

  it('returns "code" for a workspace-less run route', () => {
    expect(getRouteType("/code/runs/run-123")).toBe("code");
  });

  it('returns "unknown" for unmatched path', () => {
    expect(getRouteType("/random/path")).toBe("unknown");
  });

  it('returns "unknown" for retired per-provider routes', () => {
    expect(getRouteType("/claude/workspace-123")).toBe("unknown");
  });
});

describe("getBaseRoutePath", () => {
  it('returns /code for "code"', () => {
    expect(getBaseRoutePath("code")).toBe("/code");
  });

  it("pins the public workspace URL", () => {
    expect(WORKSPACE_BASE_PATH).toBe("/code");
  });

  it('returns /settings for "settings"', () => {
    expect(getBaseRoutePath("settings")).toBe("/settings");
  });

  it('returns / for "home"', () => {
    expect(getBaseRoutePath("home")).toBe("/");
  });

  it('returns / for "unknown"', () => {
    expect(getBaseRoutePath("unknown")).toBe("/");
  });
});

describe("getRouteRunId", () => {
  it("reads the run id off the workspace-less run route", () => {
    expect(getRouteRunId("/code/runs/run-123")).toBe("run-123");
  });

  it("returns null for /code with no param", () => {
    expect(getRouteRunId("/code")).toBeNull();
  });

  it("does not mistake a workspace id for a run id", () => {
    expect(getRouteRunId("/code/workspace-123")).toBeNull();
  });

  it("returns null off the code route", () => {
    expect(getRouteRunId("/pulse")).toBeNull();
  });
});
