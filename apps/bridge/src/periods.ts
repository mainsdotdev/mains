/** UTC calendar-month arithmetic shared by entitlement grants and write budgets.
 * The anchor's day and time are kept, clamped to the target month's last day. */
export function addUtcMonths(at: number, months: number): number {
  const start = new Date(at), end = new Date(at);
  end.setUTCDate(1); end.setUTCMonth(start.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return end.getTime();
}
