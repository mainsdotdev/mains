import { githubPullRequestUrl, pullRequestKey, pullRequestRefFromUrl } from "@mains/contracts/pull-requests";
import type { PreviewTab } from "@/lib/redux/slices/previewSlice";

export function pullRequestPreviewTab(url: string): Extract<PreviewTab, { kind: "pull-request" }> | null {
  const prRef = pullRequestRefFromUrl(url);
  return prRef ? {
    kind: "pull-request", id: "pull-request:" + pullRequestKey(prRef),
    title: "PR #" + prRef.number, prRef, url: githubPullRequestUrl(prRef),
  } : null;
}
