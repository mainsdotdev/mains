import type { ResourceFetcher } from "../sync.dto";

import { githubIssuesFetcher, githubPullRequestsFetcher } from "./github";
import { gitlabIssuesFetcher, gitlabMergeRequestsFetcher } from "./gitlab";
import { linearIssuesFetcher } from "./linear";
import { jiraIssuesFetcher } from "./jira";
import { asanaTasksFetcher } from "./asana";
import { trelloCardsFetcher } from "./trello";
import { sentryIssuesFetcher } from "./sentry";

// ─────────────────────────────────────────────────────────────
// Active ResourceFetcher registry. Adding a new provider:
// 1. Implement a ResourceFetcher in connections/{provider}.ts
// 2. Add it to this list. That's it — sync.fetchers.ts iterates
//    over RESOURCE_FETCHERS, no other wiring needed.
// ─────────────────────────────────────────────────────────────
export const RESOURCE_FETCHERS: ResourceFetcher[] = [
  githubIssuesFetcher,
  githubPullRequestsFetcher,
  gitlabIssuesFetcher,
  gitlabMergeRequestsFetcher,
  linearIssuesFetcher,
  jiraIssuesFetcher,
  asanaTasksFetcher,
  trelloCardsFetcher,
  sentryIssuesFetcher,
];

// Per-provider helpers used elsewhere in the app (list available
// repos/projects/boards in connection setup flows).
export { fetchJiraProjects } from "./jira";
export { fetchAsanaWorkspaces, fetchAsanaProjects } from "./asana";
export { fetchTrelloBoards } from "./trello";
export type { AsanaProjectInfo } from "./asana";
export type { TrelloBoardInfo } from "./trello";
export type { JiraProject } from "./jira";

// Re-export individual fetchers so tests / introspection tools can
// reach them by name.
export {
  githubIssuesFetcher,
  githubPullRequestsFetcher,
  gitlabIssuesFetcher,
  gitlabMergeRequestsFetcher,
  linearIssuesFetcher,
  jiraIssuesFetcher,
  asanaTasksFetcher,
  trelloCardsFetcher,
  sentryIssuesFetcher,
};
