import { describe, expect, it } from "vitest";
import { pullRequestKey, pullRequestRefFromUrl } from "./pull-request-link";

describe("pull request links", () => {
  it.each(["", "/files", "/commits", "/checks?check_run_id=123#summary", "?tab=readme#discussion"])(
    "recognizes a PR URL with suffix %s", (suffix) => {
      expect(pullRequestRefFromUrl("https://github.com/Acme/Widget/pull/176" + suffix))
        .toEqual({ provider: "github", owner: "acme", repo: "widget", number: 176 });
    },
  );
  it.each([
    "https://github.com/acme/widget/issues/176",
    "https://github.com/acme/widget/pull/new",
    "https://github.com/acme/widget/pull/0",
    "https://github.com/acme/widget/pull/9007199254740992",
    "https://github.com/acme/widget/pull/176/unknown",
    "https://github.com.evil.test/acme/widget/pull/176",
    "https://github.com:8443/acme/widget/pull/176",
    "https://user@github.com/acme/widget/pull/176",
    "https://gitlab.com/acme/widget/-/merge_requests/176",
    "file:///acme/widget/pull/176",
    "not a URL",
  ])("leaves unsupported URL %s to normal link handling", (url) => {
    expect(pullRequestRefFromUrl(url)).toBeNull();
  });
  it("gives case variants and provider defaults the same identity", () => {
    expect(pullRequestKey({ owner: "Acme", repo: "Widget", number: 176 }))
      .toBe(pullRequestKey({ provider: "github", owner: "acme", repo: "widget", number: 176 }));
    expect(pullRequestKey({ provider: "other", owner: "acme", repo: "widget", number: 176 }))
      .not.toBe(pullRequestKey({ owner: "acme", repo: "widget", number: 176 }));
  });
});
