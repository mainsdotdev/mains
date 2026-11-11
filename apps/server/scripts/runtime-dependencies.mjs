import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";

function walkJavaScript(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkJavaScript(file);
    return /\.(?:c?js|mjs)$/.test(entry.name) ? [file] : [];
  });
}

export function discoverRuntimeDependencies(directory) {
  const builtins = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ]);
  const dependencies = new Set();
  function add(specifier) {
    if (specifier.startsWith(".") || path.isAbsolute(specifier) || builtins.has(specifier)) return;
    dependencies.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);
  }
  for (const file of walkJavaScript(directory)) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    function visit(node) {
      if (ts.isCallExpression(node) && node.arguments.length === 1 &&
          (ts.isIdentifier(node.expression) && node.expression.text === "require" || node.expression.kind === ts.SyntaxKind.ImportKeyword) &&
          ts.isStringLiteralLike(node.arguments[0])) {
        add(node.arguments[0].text);
      } else if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
                 node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        add(node.moduleSpecifier.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return [...dependencies].sort();
}
