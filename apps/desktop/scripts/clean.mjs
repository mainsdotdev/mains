import { readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mode = process.argv[2] ?? 'build';
if (mode === 'build' || mode === 'dependencies') {
  for (const directory of ['.vite', 'dist', 'out', '.webpack', 'node_modules/.vite', 'node_modules/.cache'])
    rmSync(directory, { recursive: true, force: true });
  if (mode === 'dependencies') rmSync('node_modules', { recursive: true, force: true });
} else if (mode === 'dev-db' || mode === 'runtime-db') {
  const runtimeDirectory = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'mains')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'mains')
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'mains');
  const directory = mode === 'dev-db' ? '.data' : runtimeDirectory;
  let files = [];
  try { files = readdirSync(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of files) {
    if (['mains.db', 'mains.db-shm', 'mains.db-wal'].includes(file) ||
      (mode === 'dev-db' && file.startsWith('mains.db.pre-migration-backup')))
      rmSync(path.join(directory, file), { force: true });
  }
  console.log('Database cleaned. Restart the app to recreate it.');
} else throw new Error('Unknown cleanup mode');
