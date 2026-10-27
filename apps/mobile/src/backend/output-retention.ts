/**
 * Which of the runs that left the phone's list were deleted on the Mac, as
 * opposed to archived or aged out of the window. Only an explicit "not found"
 * counts; a run that still exists or a lookup that failed keeps its files.
 */
export async function confirmDeletedRuns(
  runIds: readonly string[],
  lookup: (runId: string) => Promise<unknown>,
): Promise<string[]> {
  const deleted = await Promise.all(runIds.map(async (runId) => {
    try {
      return (await lookup(runId)) === null ? runId : null;
    } catch {
      return null;
    }
  }));
  return deleted.filter((runId): runId is string => runId !== null);
}
