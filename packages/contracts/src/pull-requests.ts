export interface PrRefInput {
  provider?: string;
  owner: string;
  repo: string;
  number: number;
}

export interface PrPageInput extends PrRefInput {
  cursor?: string | null;
  pageSize?: number;
}

export interface PrAuthor {
  login: string;
  avatarUrl: string | null;
}

export interface PrCommit {
  oid: string;
  message: string;
  committedAt: string;
  author: PrAuthor | null;
  authorName: string | null;
  url: string;
}

/** Pages run newest to oldest; items within each page are chronological. */
export interface PrPage<T> {
  items: T[];
  startCursor: string | null;
  hasPreviousPage: boolean;
  totalCount: number;
}

export type PrCommitPage = PrPage<PrCommit>;
export type PrActivityFilter = "all" | "comments" | "reviews" | "events";
export interface PrActivityInput extends PrPageInput {
  filter?: PrActivityFilter;
}

export type PrActivityKind = "comment" | "review" | "closed" | "reopened" | "merged"
  | "review_requested" | "review_request_removed" | "ready" | "draft" | "force_pushed";

export interface PrActivity {
  id: string;
  kind: PrActivityKind;
  author: PrAuthor | null;
  createdAt: string;
  body: string | null;
  url: string | null;
  reviewState: string | null;
  reviewer: string | null;
  commitOid: string | null;
}

export type PrActivityPage = PrPage<PrActivity>;

/** GitHub repository names are case-insensitive; both entry points share a cache key. */
export function canonicalPrRef(ref: PrRefInput): PrRefInput {
  return {
    provider: ref.provider ?? "github",
    owner: ref.owner.toLowerCase(),
    repo: ref.repo.toLowerCase(),
    number: ref.number,
  };
}

export function pullRequestRefFromUrl(raw: string): PrRefInput | null {
  try {
    const url = new URL(raw);
    if (!(["https:", "http:"].includes(url.protocol)) || url.hostname !== "github.com" ||
        url.port || url.username || url.password) return null;
    const match = /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)(?:\/(?:files|commits|checks))?\/?$/.exec(url.pathname);
    if (!match) return null;
    const number = Number(match[3]);
    if (!Number.isSafeInteger(number)) return null;
    return canonicalPrRef({ provider: "github", owner: match[1], repo: match[2], number });
  } catch {
    return null;
  }
}

export function pullRequestKey(ref: PrRefInput): string {
  const pr = canonicalPrRef(ref);
  return pr.provider + ":" + pr.owner + "/" + pr.repo + "#" + pr.number;
}

export function githubPullRequestUrl(ref: PrRefInput): string {
  return "https://github.com/" + ref.owner + "/" + ref.repo + "/pull/" + ref.number;
}
