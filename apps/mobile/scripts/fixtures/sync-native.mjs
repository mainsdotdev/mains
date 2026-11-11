import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";

// Only native adapters are replaced. Production schema, migrations, Drizzle,
// projection transactions and sync code run against disposable real SQLite.
export const sqlite = new DatabaseSync(":memory:");
const database = {
  execSync: (sql) => sqlite.exec(sql),
  getFirstSync: (sql) => sqlite.prepare(sql).get(),
  getAllSync: (sql) => sqlite.prepare(sql).all(),
  withTransactionSync(write) {
    sqlite.exec("BEGIN");
    try { write(); sqlite.exec("COMMIT"); } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
  prepareSync(sql) {
    return {
      executeSync(params) {
        const stmt = sqlite.prepare(sql);
        let result;
        const run = () => result ??= stmt.run(...params);
        return {
          get changes() { return run().changes; },
          get lastInsertRowId() { return run().lastInsertRowid; },
          getAllSync: () => stmt.all(...params),
          getFirstSync: () => stmt.get(...params),
        };
      },
      executeForRawResultSync(params) {
        const stmt = sqlite.prepare(sql); stmt.setReturnArrays(true);
        return { getAllSync: () => stmt.all(...params) };
      },
    };
  },
};
globalThis.__historyTestDatabase = database;
const inline = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "expo-sqlite") return inline("export const openDatabaseSync = () => globalThis.__historyTestDatabase; export const addDatabaseChangeListener = () => ({ remove() {} });");
    if (specifier === "expo-file-system") return inline(`
      export class Directory { exists = false; constructor(...parts) { this.uri = parts.join('/'); } list() { return []; } }
      export class File extends Directory {}
      export const Paths = { cache: 'file:///unused-test-cache' }, FileMode = {};
    `);
    if (specifier.startsWith("@/")) return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    return next(specifier, context);
  },
});
