/**
 * The latest thinking the agent surfaced, if any — a streamed `thinking`
 * artifact, else a legacy `[thinking] ` log line. Same order of preference as
 * the desktop's loader.
 */
export function latestThinking(
  artifacts: { kind: string; content: string | null }[],
): string | undefined {
  for (let i = artifacts.length - 1; i >= 0; i--) {
    const artifact = artifacts[i];
    if (artifact.kind === "thinking" && artifact.content?.trim()) return artifact.content;
  }
  for (let i = artifacts.length - 1; i >= 0; i--) {
    const artifact = artifacts[i];
    if (artifact.kind === "log" && artifact.content?.startsWith("[thinking] ")) {
      return artifact.content.slice("[thinking] ".length);
    }
  }
  return undefined;
}
