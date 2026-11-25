import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { OUTPUT_FILE_MAX_BYTES } from "@mains/contracts/output-files";
import { startWsHost } from "../../ipc-kit/ws-server-host";
import { serveLocalDocument } from "./imageProxy.local-serve";
import { signLocalDocumentPath } from "./imageProxy.signing";

let folder: string;
let file: string;
beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "mains-media-"));
  file = path.join(folder, "preview.MP4");
  await writeFile(file, "0123456789");
});
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

it.each([
  [null, 200, null, "0123456789"],
  ["bytes=2-4", 206, "bytes 2-4/10", "234"],
  ["bytes=8-", 206, "bytes 8-9/10", "89"],
  ["bytes=-3", 206, "bytes 7-9/10", "789"],
  ["bytes=10-", 416, "bytes */10", ""],
] as const)("serves the signed media request %s", async (range, status, contentRange, bytes) => {
  const response = await serveLocalDocument(new URL(signLocalDocumentPath(file)), range);
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toBe("video/mp4");
  expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  expect(response.headers.get("Content-Range")).toBe(contentRange);
  expect(await response.text()).toBe(bytes);
});

it("requires authorization and enforces the size limit even for a small range", async () => {
  const url = new URL(signLocalDocumentPath(file));
  const tampered = new URL(url);
  tampered.searchParams.set("sig", "invalid");
  expect((await serveLocalDocument(tampered, "bytes=0-1")).status).toBe(403);
  await truncate(file, OUTPUT_FILE_MAX_BYTES + 1);
  expect((await serveLocalDocument(url, "bytes=0-1")).status).toBe(413);
});

it("preserves byte ranges through the browser host", async () => {
  const host = await startWsHost({ port: 0, host: "127.0.0.1", token: "test-token", serveLocalDocument });
  try {
    const signed = new URL(signLocalDocumentPath(file));
    const url = `http://127.0.0.1:${host.port}/__localdoc${signed.search}`;
    const response = await fetch(url, { headers: { Range: "bytes=4-5" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 4-5/10");
    expect(response.headers.get("Content-Length")).toBe("2");
    expect(await response.text()).toBe("45");
  } finally {
    await host.close();
  }
});
