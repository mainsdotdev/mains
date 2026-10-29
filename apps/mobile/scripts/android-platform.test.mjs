import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ANDROID_SYMBOLS, androidSymbol } from "../src/lib/android-symbols.ts";
import { isCachedDocumentUri } from "../modules/mains-document-preview/cached-document.ts";

test("Android symbols resolve to actual bundled font glyphs, including a visible fallback", () => {
  const glyphs = JSON.parse(readFileSync(new URL("../node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json", import.meta.url), "utf8"));
  for (const [name, icon] of Object.entries(ANDROID_SYMBOLS)) {
    assert.ok(Object.hasOwn(glyphs, icon), `${name} maps to missing glyph ${icon}`);
  }
  assert.ok(Object.hasOwn(glyphs, androidSymbol("unknown.future.symbol")));
  for (const name of ["constructor", "__proto__", "toString"]) {
    assert.equal(androidSymbol(name), androidSymbol("unknown.future.symbol"));
  }
  assert.notEqual(androidSymbol("checkmark.circle.fill"), androidSymbol("xmark.circle.fill"));
});

test("external document opening accepts only a file within the downloaded-output cache", () => {
  const root = "file:///data/user/0/dev.mains.mobile.dev/cache/mains-outputs";
  assert.equal(isCachedDocumentUri(`${root}/backend/run/version/CV.pdf`, root), true);
  assert.equal(isCachedDocumentUri(`${root}/backend/run/version/%C3%96zge%C3%A7mi%C5%9F%20CV.pdf`, root + "/"), true);
  for (const uri of [root, root + "/", `${root}-other/private.pdf`, "https://example.com/CV.pdf",
    "content://some-provider/private.pdf", "file:///data/user/0/dev.mains.mobile.dev/files/mains.db"]) {
    assert.equal(isCachedDocumentUri(uri, root), false, uri);
  }
});

test("Android document grants reject literal, encoded and malformed path escapes", () => {
  const root = "file:///cache/mains-outputs";
  for (const path of ["../private.pdf", "%2e%2e/private.pdf", "a/%2E%2E/private.pdf", "a%2f..%2fprivate.pdf",
    "a/./private.pdf", "bad%name.pdf", "bad%00name.pdf"]) {
    assert.equal(isCachedDocumentUri(`${root}/${path}`, root), false, path);
  }
});
