import assert from "node:assert/strict";
import test from "node:test";
import { readTurnFileDiff } from "../src/lib/turn-file-diff.ts";
import { wordEmphasis } from "../src/lib/word-diff.ts";

function source(text, size = 8192) {
  const characters = Array.from(text), requests = [];
  return {
    requests,
    read: async (offset) => {
      requests.push(offset);
      return { text: characters.slice(offset, offset + size).join(""), offset,
        totalChars: characters.length, nextOffset: offset + size < characters.length ? offset + size : null };
    },
  };
}
const patch = (name, body, oldName = name) => `diff --git a/${oldName} b/${name}\n--- a/${oldName}\n+++ b/${name}\n${body}`;
const lines = (page) => page.diff.hunks.flatMap((hunk) => hunk.lines);

test("a selected file excludes adjacent files and retains line numbers and word emphasis", async () => {
  const text = patch("first.ts", "@@ -1 +1 @@\n-first\n+other\n") +
    patch("src/app.ts", "@@ -10,2 +10,2 @@\n context\n-const count = 1;\n+const count = 2;\n") +
    patch("last.ts", "@@ -1 +1 @@\n-last\n+unrelated\n");
  const page = await readTurnFileDiff({ path: "src/app.ts", ...source(text, 7) });
  assert.equal(page.found, true);
  assert.equal(page.next, null);
  assert.deepEqual(lines(page), [
    { type: "context", text: "context", oldNo: 10, newNo: 10 },
    { type: "remove", text: "const count = 1;", oldNo: 11, newNo: null },
    { type: "add", text: "const count = 2;", oldNo: null, newNo: 11 },
  ]);
  assert.deepEqual(wordEmphasis(lines(page))[2].filter((part) => part.changed), [{ text: "2", changed: true }]);
});

test("file pages resume inside a hunk with no missing or duplicate lines, including SQLite Unicode offsets", async () => {
  const body = Array.from({ length: 370 }, (_, index) => `+satır ${index} 😀`).join("\n");
  const input = source(patch("Örnek.ts", `@@ -0,0 +1,370 @@\n${body}\n`), 41);
  let cursor, output = [], pages = [];
  do {
    const page = await readTurnFileDiff({ path: "Örnek.ts", cursor, ...input });
    pages.push(page);
    output.push(...lines(page));
    assert.ok(lines(page).length <= 160);
    cursor = page.next ?? undefined;
  } while (cursor);
  assert.deepEqual(pages.map((page) => lines(page).length), [160, 160, 50]);
  assert.deepEqual(output.map((line) => line.text), body.split("\n").map((line) => line.slice(1)));
  assert.deepEqual(output.map((line) => line.newNo), Array.from({ length: 370 }, (_, index) => index + 1));
  const reread = await readTurnFileDiff({ path: "Örnek.ts", ...input });
  assert.deepEqual(reread, pages[0]);
});

test("quoted UTF-8, quotes, tabs and backslashes in Git names match the exact selected file", async () => {
  const quoted = '"a/\\303\\226rnek\\t\\"x\\"\\\\name.ts" "b/\\303\\226rnek\\t\\"x\\"\\\\name.ts"';
  const text = `diff --git ${quoted}\n@@ -1 +1 @@\n-old\n+new\n`;
  const page = await readTurnFileDiff({ path: 'Örnek\t"x"\\name.ts', ...source(text, 1) });
  assert.equal(page.found, true);
  assert.equal(page.diff.added, 1);
});

test("renames and unquoted spaces cannot select a similarly suffixed file", async () => {
  const text = patch("folder b/target.ts", "@@ -1 +1 @@\n-wrong\n+wrong\n") +
    patch("new folder/target.ts", "similarity index 80%\nrename from old folder/target.ts\nrename to new folder/target.ts\n@@ -1 +1 @@\n-old\n+selected\n", "old folder/target.ts");
  const page = await readTurnFileDiff({ path: "new folder/target.ts", oldPath: "old folder/target.ts", ...source(text, 11) });
  assert.equal(lines(page).at(-1).text, "selected");
  const missing = await readTurnFileDiff({ path: "target.ts", ...source(text) });
  assert.equal(missing.found, false);
  assert.equal(lines(missing).length, 0);
});

test("binary and metadata-only changes do not turn headers or payloads into code", async () => {
  const binary = await readTurnFileDiff({ path: "icon.png", ...source(patch("icon.png", "GIT binary patch\nliteral 12345\nabc\n")) });
  assert.equal(binary.binary, true);
  assert.deepEqual(lines(binary), []);
  const metadata = await readTurnFileDiff({ path: "script.sh", ...source(patch("script.sh", "old mode 100644\nnew mode 100755\n")) });
  assert.equal(metadata.found, true);
  assert.deepEqual(lines(metadata), []);
});

test("file headers inside hunks remain content; hunk gaps and missing final newlines retain positions", async () => {
  const text = patch("app.ts", "@@ -3 +3 @@\n--- old\n+++ new\n@@ -20 +30 @@\n-before\n+after\n\\ No newline at end of file");
  const page = await readTurnFileDiff({ path: "app.ts", ...source(text, 8) });
  assert.equal(page.diff.hunks.length, 2);
  assert.deepEqual(lines(page).map((line) => [line.text, line.oldNo, line.newNo]), [
    ["-- old", 3, null], ["++ new", null, 3], ["before", 20, null], ["after", null, 30],
  ]);
});

test("exact page boundaries do not create an empty next page", async () => {
  const text = patch("app.ts", `@@ -0,0 +1,160 @@\n${"+line\n".repeat(160)}`) + patch("next.ts", "@@ -1 +1 @@\n-no\n+no\n");
  const page = await readTurnFileDiff({ path: "app.ts", ...source(text) });
  assert.equal(lines(page).length, 160);
  assert.equal(page.next, null);
});

test("large lines and character-heavy pages stay bounded and continue at the right next line", async () => {
  const text = patch("data.txt", `@@ -0,0 +1,4 @@\n+${"a".repeat(100_000)}\n+${"b".repeat(20_000)}\n+${"c".repeat(20_000)}\n+last\n`);
  const input = source(text);
  const first = await readTurnFileDiff({ path: "data.txt", ...input });
  assert.equal(first.shortened, true);
  assert.ok(lines(first).every((line) => line.text.length <= 16_384));
  assert.ok(first.next);
  const second = await readTurnFileDiff({ path: "data.txt", cursor: first.next, ...input });
  assert.equal(lines(second).at(-1).text, "last");
  assert.equal(lines(second).at(-1).newNo, 4);
  assert.equal(second.next, null);
});

test("leaving the screen or switching computers stops after the pending chunk", async () => {
  let active = true, reads = 0;
  await assert.rejects(readTurnFileDiff({ path: "app.ts", active: () => active, read: async (offset) => {
    reads++; active = false;
    return { text: "diff ", offset, nextOffset: 5, totalChars: 1000 };
  } }), /cancelled/);
  assert.equal(reads, 1);
});

test("read failures and non-advancing offsets fail explicitly without modifying bookmarks", async () => {
  await assert.rejects(readTurnFileDiff({ path: "app.ts", read: async () => { throw new Error("Disconnected"); } }), /Disconnected/);
  const cursor = { offset: 20, selected: true, oldNo: 4, newNo: 5, oldLeft: 2, newLeft: 2 };
  const original = { ...cursor };
  await assert.rejects(readTurnFileDiff({ path: "app.ts", cursor, read: async (offset) => ({ text: "+wrong", offset, nextOffset: offset, totalChars: 100 }) }), /Could not read/);
  assert.deepEqual(cursor, original);
});
