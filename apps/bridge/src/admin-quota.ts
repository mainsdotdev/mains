import type { BridgeQuota } from "@mains/contracts/bridge";

export interface AdminQuotaQuery { search: string; after: string }
export interface AdminQuotaRow {
  email: string;
  quota: Omit<BridgeQuota, "plans"> | null;
}
export interface AdminQuotaPage { rows: AdminQuotaRow[]; next: string | null; checkedAt: string }

const pageSize = 10;

export function validAdminQuotaQuery(query: unknown): query is AdminQuotaQuery {
  if (typeof query !== "object" || !query) return false;
  const { search, after } = query as Partial<AdminQuotaQuery>;
  return typeof search === "string" && search.length <= 254 &&
    typeof after === "string" && /^[A-Za-z0-9_-]{0,128}$/.test(after);
}

type AccountQuery = { prepare(sql: string): { bind(...values: (string | number)[]): {
  all<T>(): Promise<{ results: T[] }>;
} } };

export async function listAdminQuotas(db: AccountQuery, query: AdminQuotaQuery,
  read: (accountId: string) => Promise<BridgeQuota>): Promise<AdminQuotaPage> {
  if (!validAdminQuotaQuery(query)) throw new Error("Invalid quota query");
  const search = query.search.trim().toLowerCase();
  const { results } = await db.prepare(`SELECT a.account_id, u.email FROM bridge_accounts a JOIN user u ON u.id=a.account_id
    WHERE a.account_id>? AND (?='' OR instr(lower(u.email), ?)>0)
    ORDER BY a.account_id LIMIT ?`).bind(query.after, search, search, pageSize + 1).all<{ account_id: string; email: string }>();
  const accounts = results.slice(0, pageSize);
  const quotas = await Promise.allSettled(accounts.map(account => read(account.account_id)));
  const rows = quotas.map((result, index) => {
    const email = accounts[index].email;
    if (result.status === "rejected") return { email, quota: null };
    const { plans: _plans, ...quota } = result.value;
    return { email, quota };
  });
  return { rows, next: results.length > pageSize ? accounts[pageSize - 1].account_id : null, checkedAt: new Date().toISOString() };
}
