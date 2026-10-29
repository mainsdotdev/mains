import assert from "node:assert/strict";
import test from "node:test";
import { fileIconSvg } from "@mains/icons/file-icons";
import { filePathLabel } from "../src/features/runs/lib/file-path-label.ts";

test("long paths retain the filename and nearest folders without wrapping the full project path", () => {
  assert.deepEqual(filePathLabel("apps/desktop/src/renderer/features/settings/components/bridge-account.tsx"), {
    name: "bridge-account.tsx", directory: "…/settings/components",
  });
  assert.deepEqual(filePathLabel("apps/mobile/src/theme/colors.ts"), { name: "colors.ts", directory: "…/src/theme" });
});

test("short, root-level, Windows and Unicode paths keep meaningful labels", () => {
  assert.deepEqual(filePathLabel("src/ui/button.tsx"), { name: "button.tsx", directory: "src/ui" });
  assert.deepEqual(filePathLabel("README.md"), { name: "README.md", directory: "" });
  assert.deepEqual(filePathLabel("C:\\work\\src\\ui\\button.tsx"), { name: "button.tsx", directory: "…/src/ui" });
  assert.deepEqual(filePathLabel("belgeler/Özgeçmiş.txt"), { name: "Özgeçmiş.txt", directory: "belgeler" });
});

test("React, TypeScript and other file extensions use the desktop artwork across path styles", () => {
  assert.equal(fileIconSvg("src/view.tsx"), fileIconSvg("C:\\src\\View.JSX"));
  assert.match(fileIconSvg("view.tsx"), /#00d8ff/);
  assert.match(fileIconSvg("util.TS"), /#007acc/);
  assert.notEqual(fileIconSvg("view.tsx"), fileIconSvg("util.ts"));
  for (const name of ["readme.md", "main.py", "main.rs", "data.json", "photo.png", "report.pdf", "report.docx", "table.xlsx", "slides.pptx"]) {
    assert.match(fileIconSvg(name), /^<svg\b.*<\/svg>$/);
    assert.doesNotMatch(fileIconSvg(name), /\{\.\.\.|className=|style=\{\{/);
  }
});

test("exact filenames and config families take precedence over generic extensions", () => {
  assert.notEqual(fileIconSvg("package.json"), fileIconSvg("data.json"));
  assert.equal(fileIconSvg("src/tsconfig.main.json"), fileIconSvg("tsconfig.json"));
  assert.notEqual(fileIconSvg("tsconfig.json"), fileIconSvg("data.json"));
  assert.equal(fileIconSvg("vitest.workspace.config.mts"), fileIconSvg("vitest.config.ts"));
  assert.notEqual(fileIconSvg("vitest.config.ts"), fileIconSvg("vite.config.ts"));
  assert.equal(fileIconSvg(".env.local"), fileIconSvg(".env"));
  assert.notEqual(fileIconSvg("view.test.tsx"), fileIconSvg("view.tsx"));
  assert.notEqual(fileIconSvg("pnpm-lock.yaml"), fileIconSvg("settings.yaml"));
});

test("unknown and extensionless names use the generic fallback, including object property names", () => {
  for (const name of ["", "Makefile", "file.unknown", ".unknown", "constructor", "__proto__", "a.constructor", "a.__proto__"]) {
    assert.equal(fileIconSvg(name), undefined);
  }
});
