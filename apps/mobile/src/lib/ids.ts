/**
 * Command ids only need to be unique per device (they key the Mac's receipt
 * table together with the device id), so a timestamp plus random suffix is
 * enough and needs no native crypto module.
 */
export function newCommandId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
  return `${Date.now().toString(36)}-${random}`;
}
