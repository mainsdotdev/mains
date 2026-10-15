export const utf8 = (value: string) => new TextEncoder().encode(value);
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(value: string, length?: number): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid Bridge encoding");
  let decoded: string;
  try { decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/")); }
  catch { throw new Error("Invalid Bridge encoding"); }
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  if (toBase64Url(bytes) !== value || length !== undefined && bytes.length !== length) throw new Error("Invalid Bridge encoding");
  return bytes;
}
