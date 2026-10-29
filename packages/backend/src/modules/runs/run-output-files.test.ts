import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OUTPUT_CHUNK_BYTES } from "@mains/contracts/run-outputs";
import type { RunArtifactResponse } from "./runs.dto";
import { describeRunOutput, readRunOutputChunk, validateOutputReference } from "./run-output-files";

let directory: string;
const artifact = (file: string, id = -101): RunArtifactResponse => ({ id, runId: "r", kind: "document", path: file, content: null, blobData: null, entityId: null, contentHash: null, metadata: { outputSelected: true }, createdAt: new Date() });
beforeEach(async () => { directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mains-outputs-"))); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe("selected file downloads", () => {
  it("describes PDF and Office files without exposing host paths", async () => {
    for (const extension of ["pdf", "docx", "xlsx", "pptx"]) {
      const file = path.join(directory, `report.${extension}`);
      await fs.writeFile(file, "document");
      const output = await describeRunOutput("r", artifact(file), false);
      expect(output).toMatchObject({ artifactId: -101, name: `report.${extension}`, byteSize: 8, previewType: "native" });
      expect(JSON.stringify(output)).not.toContain(directory);
      expect(output.version).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("reassembles bounded binary chunks exactly, including the final partial chunk", async () => {
    const file = path.join(directory, "large.pdf");
    const bytes = Buffer.alloc(OUTPUT_CHUNK_BYTES * 2 + 33);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    await fs.writeFile(file, bytes);
    const output = await describeRunOutput("r", artifact(file), false);
    const chunks: Buffer[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk = await readRunOutputChunk(output, file, { runId: "r", artifactId: output.artifactId, version: output.version, offset }, false);
      const data = Buffer.from(chunk.base64, "base64");
      expect(data.length).toBeLessThanOrEqual(OUTPUT_CHUNK_BYTES);
      chunks.push(data); offset = chunk.nextOffset;
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
  });

  it("rejects stale revisions, changed files and invalid offsets", async () => {
    const file = path.join(directory, "report.pdf");
    await fs.writeFile(file, "old");
    const output = await describeRunOutput("r", artifact(file), false);
    const request = { runId: "r", artifactId: output.artifactId, version: output.version, offset: 0 };
    for (const offset of [-1, 0.5, 4, Infinity]) await expect(readRunOutputChunk(output, file, { ...request, offset }, false)).rejects.toThrow();
    await expect(readRunOutputChunk(output, file, { ...request, version: "stale" }, false)).rejects.toThrow("changed");
    await fs.writeFile(file, "changed");
    await expect(readRunOutputChunk(output, file, request, false)).rejects.toThrow("changed");
    expect((await describeRunOutput("r", artifact(file), false)).version).not.toBe(output.version);
  });

  it("refuses a symlink swapped in after selection and missing files", async () => {
    const file = path.join(directory, "selected.pdf");
    const other = path.join(directory, "private.pdf");
    await fs.writeFile(file, "selected"); await fs.writeFile(other, "private");
    const output = await describeRunOutput("r", artifact(file), false);
    await fs.unlink(file); await fs.symlink(other, file);
    await expect(describeRunOutput("r", artifact(file), false)).rejects.toThrow("unavailable");
    await expect(readRunOutputChunk(output, file, { runId: "r", artifactId: -101, version: output.version, offset: 0 }, false)).rejects.toThrow("unavailable");
    await expect(describeRunOutput("r", artifact(path.join(directory, "missing.pdf")), false)).rejects.toThrow();
  });

  it("lists a Bridge output from its manifest before its bytes are hydrated", async () => {
    const remote = { ...artifact("/other-computer/report.pdf"), metadata: { outputSelected: true, byteSize: 20, modifiedAt: 123 } };
    const output = await describeRunOutput("r", remote, true);
    expect(output).toMatchObject({ name: "report.pdf", byteSize: 20, modifiedAt: 123 });
    expect(JSON.stringify(output)).not.toContain("other-computer");
  });

  it("accepts derived artifact IDs while rejecting malformed identities", () => {
    expect(() => validateOutputReference("run", -42)).not.toThrow();
    for (const id of [0, 0.5, "42", NaN, Infinity]) expect(() => validateOutputReference("run", id)).toThrow();
    expect(() => validateOutputReference("", 42)).toThrow();
  });
});
