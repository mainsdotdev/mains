import { ACCOUNT_ID, SETTINGS_ID } from "./appSettings.constants";
import { appSettingsRepo } from "./appSettings.repo";
import { sanitizeAppSettingsPatch } from "./appSettings.validation";
import type { AppSettingsRecord } from "./appSettings.dto";

// ─────────────────────────────────────────────────────────────
// Service - Business Logic
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// See CONTEXT.md "handle".
// ─────────────────────────────────────────────────────────────
export const appSettingsService = {
  async ensureSettings(): Promise<AppSettingsRecord> {
    const existing = await appSettingsRepo.findById(SETTINGS_ID);
    if (existing) return existing;

    await appSettingsRepo.createDefaultAccount();
    await appSettingsRepo.create({ id: SETTINGS_ID, accountId: ACCOUNT_ID });

    const created = await appSettingsRepo.findById(SETTINGS_ID);
    if (!created) {
      throw new Error("Failed to create app settings");
    }
    return created;
  },

  async getSettings(): Promise<AppSettingsRecord> {
    return this.ensureSettings();
  },

  /**
   * Internal write for the backend-access toggles. These fields are
   * deliberately absent from the renderer patch allowlist
   * (sanitizeAppSettingsPatch) — only main-process code flips them.
   */
  async updateBackendAccess(patch: {
    backendRemoteAccess?: boolean;
    backendLanAccess?: boolean;
    backendTailscaleHttps?: boolean;
  }): Promise<void> {
    await this.ensureSettings();
    await appSettingsRepo.update(SETTINGS_ID, patch);
  },

  /**
   * Internal write for the backend identity — minted once by the backend
   * module, never settable from the renderer (absent from the patch allowlist).
   */
  async setBackendId(backendId: string): Promise<void> {
    await this.ensureSettings();
    await appSettingsRepo.update(SETTINGS_ID, { backendId });
  },

  async updateSettings(patch: unknown): Promise<AppSettingsRecord> {
    const sanitized = sanitizeAppSettingsPatch(patch);
    if (!sanitized) {
      throw new Error("patch must be an object");
    }

    await this.ensureSettings();
    const updated = await appSettingsRepo.update(SETTINGS_ID, sanitized);
    if (!updated) {
      throw new Error("Failed to update settings");
    }
    return updated;
  },
};
