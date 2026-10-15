import type { AuthEnv } from "./identity";
export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function jsonInput(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > 32 * 1024) throw new HttpError(413, "Request too large");
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
  if (reader) try { for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.length; if (size > 32 * 1024) { await reader.cancel(); throw new HttpError(413, "Request too large"); }
    chunks.push(part.value);
  } } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, "Invalid request"); }
}
export function textField(value: unknown, name: string, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new HttpError(400, `Invalid ${name}`);
  return value.trim();
}
export function identifier(value: unknown): string {
  const result = textField(value, "backend id");
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new HttpError(400, "Invalid backend id");
  return result;
}
export async function rateLimit(env: AuthEnv, key: string, max = 60): Promise<void> {
  const now = Date.now();
  const row = await env.AUTH_DB!.prepare(`INSERT INTO bridge_limits(id,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(key, now + 60_000, now, now).first<{ count: number }>();
  if ((row?.count ?? max + 1) > max) throw new HttpError(429, "Too many requests; try again shortly");
}
export const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
