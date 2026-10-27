import { MOBILE_OUTPUT_MAX_BYTES, OUTPUT_CHUNK_BYTES, type RunOutput, type RunOutputChunk, type ReadRunOutputPayload } from "@mains/contracts/run-outputs";
import { isDesktopOnlyOutput } from "./output-presentation";

export function checkDownloadSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Download canceled");
}

export function outputCacheSegments(backendId: string, output: RunOutput): string[] {
  const segment = (value: string) => {
    const encoded = encodeURIComponent(value);
    if (!encoded || encoded.length > 200) throw new Error("Invalid output cache identity");
    return `id-${encoded}`;
  };
  if (!/^[a-f0-9]{64}$/.test(output.version) || !Number.isSafeInteger(output.artifactId) || !output.artifactId) throw new Error("Invalid output revision");
  const name = output.name.replace(/[\u0000-\u001f/\\:]/g, "_");
  const dot = name.lastIndexOf(".");
  const safeName = name.length <= 80 ? name : `${name.slice(0, 64)}${dot >= 0 ? name.slice(dot).slice(0, 16) : ""}`;
  return [segment(backendId), segment(output.runId), `${output.artifactId}-${output.version}`, !safeName || /^\.{1,2}$/.test(safeName) ? "file" : safeName];
}

/** Only one bounded chunk is held in memory; interrupted transfers never become cached files. */
export async function downloadOutput({ output, read, write, signal, onProgress }: {
  output: RunOutput;
  read: (payload: ReadRunOutputPayload) => Promise<RunOutputChunk>;
  write: (bytes: Uint8Array) => void;
  signal: AbortSignal;
  onProgress?: (received: number) => void;
}): Promise<void> {
  if (isDesktopOnlyOutput(output)) throw new Error("See on desktop");
  if (!Number.isSafeInteger(output.byteSize) || output.byteSize < 0 || output.byteSize > MOBILE_OUTPUT_MAX_BYTES) throw new Error("This file is too large to download");
  let offset = 0;
  do {
    checkDownloadSignal(signal);
    const chunk = await read({ runId: output.runId, artifactId: output.artifactId, version: output.version, offset });
    checkDownloadSignal(signal);
    if (chunk.version !== output.version || chunk.byteSize !== output.byteSize || chunk.offset !== offset ||
      typeof chunk.base64 !== "string" || chunk.base64.length > Math.ceil(OUTPUT_CHUNK_BYTES / 3) * 4) throw new Error("The file changed while downloading. Refresh and try again.");
    const raw = atob(chunk.base64);
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    const next = offset + bytes.length;
    if (next > output.byteSize || next < output.byteSize && (!bytes.length || chunk.nextOffset !== next) || next === output.byteSize && chunk.nextOffset !== null) throw new Error("Incomplete file download. Try again.");
    write(bytes);
    offset = next;
    onProgress?.(offset);
  } while (offset < output.byteSize);
}
