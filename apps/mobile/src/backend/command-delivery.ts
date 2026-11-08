import type { ServiceResponse } from "@mains/contracts/service-response";
import { isConnectionLoss, type WsTransport } from "./ws-transport";

interface CommandTarget {
  waitForConnected(deadline: number): Promise<Pick<WsTransport, "invoke">>;
  isCurrent(): boolean;
}

/** One command identity survives transport replacement; refusals are final. */
export async function deliverCommand<T>(
  target: CommandTarget,
  channel: string,
  args: unknown[],
  commandId: string,
  timeoutMs = 60_000,
): Promise<ServiceResponse<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!target.isCurrent()) throw new Error("The connected computer changed");
    const transport = await target.waitForConnected(deadline);
    if (!target.isCurrent()) throw new Error("The connected computer changed");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Command timed out waiting for the connection");
    try {
      const result = await transport.invoke(channel, args, { commandId, timeoutMs: Math.min(30_000, remaining) });
      if (!target.isCurrent()) throw new Error("The connected computer changed");
      return result as ServiceResponse<T>;
    } catch (error) {
      if (!isConnectionLoss(error) || Date.now() >= deadline) throw error;
    }
  }
}
