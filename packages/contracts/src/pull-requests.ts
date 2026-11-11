export interface PrRefInput {
  provider?: string;
  owner: string;
  repo: string;
  number: number;
}

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
