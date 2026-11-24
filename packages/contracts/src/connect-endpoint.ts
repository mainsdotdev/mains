// Local HTTP is used by the CLI and the local end of an SSH tunnel.
export function isConnectLoopback(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host.toLowerCase());
}

export function isSecureConnectEndpoint(value: string, socket = false): boolean {
  // Native clients use the original URL after this check. Require an explicit
  // authority so their parsers agree about the destination and transport.
  if (!/^(?:https?|wss?):\/\//i.test(value) || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (!url.hostname || url.username || url.password || url.hash || url.search) return false;
    return url.protocol === (socket ? "wss:" : "https:") ||
      (url.protocol === (socket ? "ws:" : "http:") && isConnectLoopback(url.hostname));
  } catch {
    return false;
  }
}
