/**
 * Read the JSON array stored in `models.effort_levels`.
 *
 * Older demo exports split that JSON on commas. When a generated snapshot was
 * synced back into the simulator and exported again, every pass wrapped the
 * same values in another JSON layer. Joining and parsing reverses one such
 * pass, so keep peeling until the canonical effort ids are reached.
 */
export function parseStoredEffortLevels(json, label = "models.effort_levels") {
  if (!json) return undefined;

  let encoded = json;
  for (let pass = 0; pass < 32; pass += 1) {
    let parsed;
    try {
      parsed = JSON.parse(encoded);
    } catch {
      break;
    }

    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) break;
    if (parsed.length === 0) return undefined;
    if (parsed.every((value) => /^[a-z][a-z0-9_-]*$/i.test(value))) return parsed;

    encoded = parsed.join(",");
  }

  throw new Error(`Invalid effort-level list in ${label}`);
}
