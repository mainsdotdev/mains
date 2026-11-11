// The desktop picker and its installed Tailwind theme own the icon colour vocabulary.
// Generate native light/dark assets; no extra runtime dependency is added to iOS.
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const desktop = createRequire(new URL('../../desktop/package.json', import.meta.url));
const { convert } = await import(pathToFileURL(desktop.resolve('@asamuzakjp/css-color')).href);
const source = await readFile(new URL('../../desktop/src/renderer/lib/icon-registry.tsx', import.meta.url), 'utf8');
const theme = await readFile(desktop.resolve('tailwindcss/theme.css'), 'utf8');
const palette = source.match(/export const ICON_COLORS:[^=]*=\s*\[([\s\S]*?)\];/)?.[1];
if (!palette) throw new Error('Could not read the desktop icon palette.');
const tokens = new Map([...theme.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
const root = new URL('../Resources/Assets.xcassets/', import.meta.url);
const check = process.argv.includes('--check');
const names = new Set();
const summary = [];

function color(token) {
  const css = tokens.get(token);
  if (!css) throw new Error(`Missing desktop theme token: ${token}`);
  const hex = convert.colorToHex(css);
  if (!/^#[\da-f]{6}$/i.test(hex ?? '')) throw new Error(`Invalid desktop icon colour: ${css}`);
  return { hex, asset: { 'color-space': 'srgb', components: {
    red: (parseInt(hex.slice(1, 3), 16) / 255).toFixed(8),
    green: (parseInt(hex.slice(3, 5), 16) / 255).toFixed(8),
    blue: (parseInt(hex.slice(5, 7), 16) / 255).toFixed(8), alpha: '1.00000000',
  } } };
}

for (const [, option] of palette.matchAll(/\{([^{}]*)\}/g)) {
  const name = option.match(/\bname:\s*"([^"]+)"/)?.[1];
  const classes = option.match(/\bclassName:\s*"([^"]*)"/)?.[1];
  if (!name || classes === undefined) throw new Error('Unrecognised desktop icon colour option.');
  if (!classes) continue; // Default inherits the caller's neutral/brand tint.
  const lightToken = classes.match(/(?:^|\s)text-([\w-]+)/)?.[1];
  const darkToken = classes.match(/(?:^|\s)dark:text-([\w-]+)/)?.[1];
  if (!lightToken || !darkToken) throw new Error(`Unrecognised desktop icon classes for ${name}: ${classes}`);
  const light = color(lightToken), dark = color(darkToken);
  const folderName = `registry-color-${name}.colorset`;
  names.add(folderName);
  const contents = JSON.stringify({ colors: [
    { idiom: 'universal', color: light.asset },
    { idiom: 'universal', appearances: [{ appearance: 'luminosity', value: 'dark' }], color: dark.asset },
  ], info: { author: 'xcode', version: 1 } }, null, 2) + '\n';
  const folder = new URL(`${folderName}/`, root);
  if (check) {
    const actual = await readFile(new URL('Contents.json', folder), 'utf8').catch(() => null);
    if (actual !== contents) throw new Error(`Native icon colour is out of sync: ${name}`);
  } else {
    await mkdir(folder, { recursive: true });
    await writeFile(new URL('Contents.json', folder), contents);
  }
  summary.push(`${name}: ${light.hex} / ${dark.hex}`);
}
if (!names.size) throw new Error('Desktop icon palette contained no tinted colours.');
for (const folder of await readdir(root)) {
  if (/^registry-color-[\w-]+\.colorset$/.test(folder) && !names.has(folder)) {
    if (check) throw new Error(`Stale generated icon colour: ${folder}`);
    await rm(new URL(`${folder}/`, root), { recursive: true });
  }
}
console.log(`${check ? 'Verified' : 'Synced'} ${names.size} desktop icon colours (light / dark)\n${summary.join('\n')}`);
