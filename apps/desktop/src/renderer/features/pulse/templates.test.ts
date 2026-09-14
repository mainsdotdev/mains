// ─────────────────────────────────────────────────────────────
// Table invariants for the pulse template corpus — the mode split
// must not drift (developer templates are git-centric; work/chat
// templates run workspace-less and must never assume a repo).
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { MODE_IDS } from "../../../shared/modes";
import { PULSE_CATEGORIES, PULSE_TEMPLATES } from "./templates";

describe("PULSE_TEMPLATES invariants", () => {
  it("every template names a known category and known modes", () => {
    const categoryIds = new Set(PULSE_CATEGORIES.map((cat) => cat.id));
    for (const template of PULSE_TEMPLATES) {
      expect(categoryIds.has(template.category)).toBe(true);
      for (const mode of template.modes ?? []) {
        expect(MODE_IDS).toContain(mode);
      }
    }
  });

  it("ids are unique", () => {
    const ids = PULSE_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers templates for every mode", () => {
    for (const mode of MODE_IDS) {
      const forMode = PULSE_TEMPLATES.filter(
        (template) => !template.modes || template.modes.includes(mode),
      );
      expect(forMode.length).toBeGreaterThan(0);
    }
  });

  it("work/chat templates never lean on git", () => {
    const nonDeveloper = PULSE_TEMPLATES.filter(
      (template) => template.modes && !template.modes.includes("developer"),
    );
    expect(nonDeveloper.length).toBeGreaterThan(0);
    for (const template of nonDeveloper) {
      const text = `${template.prompt} ${template.description}`.toLowerCase();
      for (const term of [
        /\bgit\b/,
        /\bcommits?\b/,
        /\bbranch(es)?\b/,
        /\brepo(s|sitor(y|ies))?\b/,
        /\bpull requests?\b/,
      ]) {
        expect(text).not.toMatch(term);
      }
    }
  });

  it("chat templates stay read-only by contract", () => {
    const chatTemplates = PULSE_TEMPLATES.filter((template) =>
      template.modes?.includes("chat"),
    );
    expect(chatTemplates.length).toBeGreaterThan(0);
    for (const template of chatTemplates) {
      expect(template.prompt).toContain("do not create or modify any files");
    }
  });
});
