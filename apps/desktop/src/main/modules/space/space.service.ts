import { nanoid } from "nanoid";
import { spaceRepo } from "./space.repo";
import { ACCOUNT_ID } from "./space.constants";
import { sanitizeSpacePayload, generateSlug } from "./space.validation";
import type { SpaceRecord } from "./space.dto";
import { PROVIDER_IDS } from "../../../shared/provider-ids";
import {
  DEFAULT_MODE_ID,
  clampModeForProvider,
  providerModes,
  providerSupportsMode,
} from "../../../shared/modes";

function flattenFieldErrors(errors: Record<string, string>): string {
  return Object.entries(errors)
    .map(([field, msg]) => `${field}: ${msg}`)
    .join("; ");
}

/**
 * A space read back through its provider's mode list. The stored value is left
 * alone — a provider that regains work/chat picks its spaces back up — but a
 * mode the provider no longer drives must not reach the UI or the harness.
 */
function withSupportedMode(space: SpaceRecord): SpaceRecord {
  const mode = clampModeForProvider(space.providerId, space.mode);
  return mode === space.mode ? space : { ...space, mode };
}

// ─────────────────────────────────────────────────────────────
// Space Service
//
// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
// Reads return null for absence; mutations on a missing target throw
// (see CONTEXT.md "absence rule").
// ─────────────────────────────────────────────────────────────
export const spaceService = {
  async getAll(): Promise<SpaceRecord[]> {
    return (await spaceRepo.findAll()).map(withSupportedMode);
  },

  async getById(spaceId: string): Promise<SpaceRecord | null> {
    const space = await spaceRepo.findById(spaceId);
    return space ? withSupportedMode(space) : null;
  },

  async create(payload: unknown): Promise<SpaceRecord> {
    const { data, errors } = sanitizeSpacePayload(payload);

    if (Object.keys(errors).length > 0) {
      throw new Error(flattenFieldErrors(errors));
    }

    if (!data.name) {
      throw new Error("name: Name is required");
    }

    // Generate slug if not provided
    const slug = data.slug || generateSlug(data.name);

    // Check if slug already exists
    const existing = await spaceRepo.findBySlug(slug);
    if (existing) {
      throw new Error("slug: A space with this slug already exists");
    }

    // Get next sort order
    const nextOrder = await spaceRepo.getMaxSortOrder();

    const providerId = data.providerId ?? PROVIDER_IDS.claude;
    const mode = data.mode ?? DEFAULT_MODE_ID;
    if (!providerSupportsMode(providerId, mode)) {
      throw new Error(
        `mode: "${providerId}" spaces support ${providerModes(providerId).join(", ")}`,
      );
    }

    const newSpace = {
      id: nanoid(),
      accountId: ACCOUNT_ID,
      name: data.name,
      slug,
      description: data.description || null,
      systemPrompt: data.systemPrompt || null,
      model: data.model || null,
      icon: data.icon || null,
      themeConfig: data.themeConfig || null,
      providerId,
      mode,
      sortOrder: data.sortOrder ?? nextOrder,
    };

    await spaceRepo.create(newSpace);

    const created = await spaceRepo.findById(newSpace.id);
    if (!created) throw new Error("Failed to create space");
    return created;
  },

  async update(spaceId: string, payload: unknown): Promise<SpaceRecord> {
    const { data, errors } = sanitizeSpacePayload(payload);

    if (Object.keys(errors).length > 0) {
      throw new Error(flattenFieldErrors(errors));
    }

    const existing = await spaceRepo.findById(spaceId);
    if (!existing) throw new Error("Space not found");

    // The pair, not the halves: an update sends `mode` or `providerId` alone,
    // so the missing half comes from the row. Checked here rather than in
    // `sanitizeSpacePayload`, which never sees the existing space.
    const nextProviderId = data.providerId ?? existing.providerId;
    const nextMode = data.mode ?? existing.mode;
    if (
      (data.mode !== undefined || data.providerId !== undefined) &&
      !providerSupportsMode(nextProviderId, nextMode)
    ) {
      throw new Error(
        `mode: "${nextProviderId}" spaces support ${providerModes(nextProviderId).join(", ")}`,
      );
    }

    // If slug is being changed, check if new slug already exists
    if (data.slug && data.slug !== existing.slug) {
      const slugExists = await spaceRepo.findBySlug(data.slug);
      if (slugExists) {
        throw new Error("slug: A space with this slug already exists");
      }
    }

    // Update space (only set slug when provided or implied by a new name)
    const updatePayload: typeof data = { ...data };
    if (data.slug) {
      updatePayload.slug = data.slug;
    } else if (data.name) {
      updatePayload.slug = generateSlug(data.name);
    }
    await spaceRepo.update(spaceId, updatePayload);

    const updated = await spaceRepo.findById(spaceId);
    if (!updated) throw new Error("Failed to update space");
    return updated;
  },

  async delete(spaceId: string): Promise<void> {
    const existing = await spaceRepo.findById(spaceId);
    if (!existing) throw new Error("Space not found");

    await spaceRepo.delete(spaceId);
  },

  async archive(spaceId: string): Promise<void> {
    const existing = await spaceRepo.findById(spaceId);
    if (!existing) throw new Error("Space not found");

    await spaceRepo.archive(spaceId);
  },

  async unarchive(spaceId: string): Promise<void> {
    const existing = await spaceRepo.findById(spaceId);
    if (!existing) throw new Error("Space not found");

    await spaceRepo.unarchive(spaceId);
  },
};
