import { Buffer } from "node:buffer";

export const utf8 = (value: string) => new TextEncoder().encode(value);
export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");
}
export function fromBase64Url(value: string, length?: number): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid Bridge encoding");
  const bytes = new Uint8Array(Buffer.from(value, "base64url"));
  if (toBase64Url(bytes) !== value || length !== undefined && bytes.length !== length) throw new Error("Invalid Bridge encoding");
  return bytes;
}
