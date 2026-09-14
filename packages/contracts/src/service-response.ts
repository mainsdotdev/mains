export type ServiceResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export const ok = <T>(data: T): ServiceResponse<T> => ({ success: true, data });

export const fail = <T = never>(error: string): ServiceResponse<T> => ({ success: false, error });

export function assertOk<T>(r: ServiceResponse<T>): asserts r is { success: true; data: T } {
  if (!r.success) throw new Error(`Expected ok, got error: ${r.error}`);
}

export function assertFail<T>(r: ServiceResponse<T>): asserts r is { success: false; error: string } {
  if (r.success) throw new Error("Expected failure, got ok");
}
