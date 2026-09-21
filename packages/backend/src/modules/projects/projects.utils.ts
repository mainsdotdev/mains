// ─────────────────────────────────────────────────────────────
// Projects Utilities
// ─────────────────────────────────────────────────────────────

// Resource kinds that may be linked to a project via project_resources.
export const LINKABLE_KINDS = [
  "github_repo",
  "linear_team",
  "jira_project",
  "asana_project",
  "gitlab_project",
  "trello_board",
  "sentry_project",
];

/**
 * Normalize a git remote origin URL to `host/owner/repo` for dedup.
 *
 * Examples:
 * - `git@github.com:Foo/bar.git`    → `github.com/Foo/bar`
 * - `https://github.com/Foo/bar.git` → `github.com/Foo/bar`
 * - `ssh://git@github.com/Foo/bar`   → `github.com/Foo/bar`
 * - `https://github.com/Foo/bar`     → `github.com/Foo/bar`
 */
export function normalizeRemoteOrigin(url: string): string {
  let normalized = url.trim();

  // Remove trailing .git
  normalized = normalized.replace(/\.git$/, "");

  // Handle SSH format: git@host:owner/repo
  const sshMatch = normalized.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // Handle URL format: https://host/owner/repo or ssh://git@host/owner/repo
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname;
    // Remove leading slash from pathname
    const path = parsed.pathname.replace(/^\//, "");
    return `${host}/${path}`;
  } catch {
    // If URL parsing fails, return as-is
    return normalized;
  }
}
