import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

/** Socket inactivity bounds chunk I/O. The separate connection deadline also covers DNS/TLS. */
export function requestBridgeChunk(url: string, options: { body?: Buffer; signal: AbortSignal; idleTimeoutMs?: number }): Promise<Response> {
  const target = new URL(url), idleMs = options.idleTimeoutMs ?? 30_000;
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return Promise.reject(new Error("Invalid Bridge chunk URL"));
  return new Promise((resolve, reject) => {
    const timeout = () => request.destroy(new Error("Bridge chunk transfer timed out without progress"));
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
      method: options.body ? "PUT" : "GET", signal: options.signal, agent: false,
      headers: options.body ? { "Content-Length": options.body.length } : undefined,
    });
    const connecting = setTimeout(timeout, idleMs); connecting.unref();
    request.once("socket", (socket) => {
      if (!socket.connecting) clearTimeout(connecting);
      else socket.once(target.protocol === "https:" ? "secureConnect" : "connect", () => clearTimeout(connecting));
    });
    request.setTimeout(idleMs, timeout);
    // 'finish' means bytes reached the OS, not the peer. Allow the queued tail to drain at
    // 128 Kibit/s before requiring its receipt, so OS buffering cannot turn a slow upload into
    // a false inactivity timeout. Pending writes still use Node's write-queue progress check.
    if (options.body) request.once("finish", () => request.setTimeout(Math.max(idleMs, 30_000 + Math.ceil(options.body!.length / 16_384) * 1000)));
    request.once("close", () => clearTimeout(connecting));
    request.once("error", reject);
    request.once("response", (response) => {
      clearTimeout(connecting);
      request.setTimeout(idleMs);
      const status = response.statusCode!;
      if (status >= 300 && status < 400) { response.destroy(); reject(new Error("Bridge chunk redirect refused")); return; }
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) if (value !== undefined)
        for (const entry of Array.isArray(value) ? value : [value]) headers.append(name, entry);
      if ([204, 205, 304].includes(status)) { response.resume(); resolve(new Response(null, { status, headers })); }
      else resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { status, headers }));
    });
    request.end(options.body);
  });
}
