export type GitHubCliStatus =
  | { status: "ready"; login: string }
  | { status: "missing" | "signed-out" | "unavailable" };
