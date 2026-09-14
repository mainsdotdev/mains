import { ACCOUNT_ID } from "./account.constants";
import { accountRepo } from "./account.repo";
import { validateUpdatePayload } from "./account.validation";
import {
  formatAccountResponse,
  type AccountRecord,
  type AccountResponse,
} from "./account.dto";

// ─────────────────────────────────────────────────────────────
// Service - Business Logic
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// See CONTEXT.md "handle".
// ─────────────────────────────────────────────────────────────
export const accountService = {
  /**
   * Ensures the default account row exists
   */
  async ensureAccount(): Promise<AccountRecord> {
    const existing = await accountRepo.findById(ACCOUNT_ID);
    if (existing) return existing;

    await accountRepo.create({
      id: ACCOUNT_ID,
      timezone: "UTC",
      locale: "en-US",
    });

    const created = await accountRepo.findById(ACCOUNT_ID);
    if (!created) {
      throw new Error("Failed to initialize account row");
    }

    return created;
  },

  /**
   * Gets the current account
   */
  async getAccount(): Promise<AccountResponse> {
    return formatAccountResponse(await this.ensureAccount());
  },

  /**
   * Updates the current account
   */
  async updateAccount(payload: unknown): Promise<AccountResponse> {
    const { data, errors } = validateUpdatePayload(payload);

    if (Object.keys(errors).length > 0) {
      throw new Error(
        Object.entries(errors)
          .map(([field, msg]) => `${field}: ${msg}`)
          .join("; "),
      );
    }

    if (Object.keys(data).length === 0) {
      throw new Error("No fields to update");
    }

    await this.ensureAccount();

    const updated = await accountRepo.update(ACCOUNT_ID, data);

    return formatAccountResponse(updated);
  },
};
