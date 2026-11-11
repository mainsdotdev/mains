import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { discoverRuntimeDependencies } from "./runtime-dependencies.mjs";

function discover(source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-package-imports-"));
  try {
    fs.mkdirSync(path.join(directory, "chunks"));
    fs.writeFileSync(path.join(directory, "chunks", "bridge.cjs"), source);
    return discoverRuntimeDependencies(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("finds runtime imports and normalizes package subpaths", () => {
  assert.deepEqual(discover(`
    require("ws"); require("ws"); import("@scope/provider/runtime");
    require(\`@scope/provider/other\`); require("node:fs"); require("fs/promises");
    require("./chunk.js"); require("../chunk.js"); require("/absolute/file.js");
  `), ["@scope/provider", "ws"]);
});

test("does not treat Bridge lifecycle method calls as package imports", () => {
  assert.deepEqual(discover(`
    a.require(\`requestApproval\`); a.require(\`approve\`);
    lifecycle . require("verify"); lifecycle?.require("recover");
    lifecycle["require"]("recover"); require("ws");
  `), ["ws"]);
});

test("ignores import-looking text in comments and strings", () => {
  assert.deepEqual(discover(`
    // require("comment-package")
    /* import("another-comment-package") */
    const description = 'Example: require("example-package")';
    const template = \`Example: import("template-package")\`;
    require("ws");
  `), ["ws"]);
});

test("ignores computed module names while visiting actual calls in expressions", () => {
  assert.deepEqual(discover(`
    require(name); import(\`provider-\${name}\`);
    const handler = () => require("ws");
    const template = \`loaded: \${require("zod")}\`;
  `), ["ws", "zod"]);
});

test("includes static imports and re-exports in JavaScript chunks", () => {
  assert.deepEqual(discover(`
    import ws from "ws";
    export { z } from "zod";
    export * from "@scope/provider/runtime";
    import "node:fs";
  `), ["@scope/provider", "ws", "zod"]);
});
