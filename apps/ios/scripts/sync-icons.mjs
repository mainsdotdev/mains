// Render the actual desktop registry, including nested SVGs, strokes and masks.
// The older shared path snapshot can lag behind newly registered desktop icons.
import './sync-icon-colors.mjs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = fileURLToPath(new URL('../../desktop/', import.meta.url));
const desktop = createRequire(new URL('../../desktop/package.json', import.meta.url));
const { build } = desktop('esbuild');
const { JSDOM } = desktop('jsdom');
const root = new URL('../Resources/Assets.xcassets/', import.meta.url);
const check = process.argv.includes('--check');
const temporary = await mkdtemp(join(tmpdir(), 'mains-native-icons-'));
let icons;
try {
  const bundle = join(temporary, 'registry.cjs');
  await build({
    stdin: { contents: `
      const React = require('react');
      const { renderToStaticMarkup } = require('react-dom/server');
      const { iconRegistry } = require('./src/renderer/lib/icon-registry.tsx');
      // The desktop settings use this static mark instead of the animated sprite.
      const { default: CopilotStatic } = require('./src/renderer/components/ui/icons/copilot.tsx');
      // Bridge is a status mark, rather than an option in the desktop icon picker.
      const { default: Bridge } = require('./src/renderer/components/ui/icons/bridge.tsx');
      const { default: MainsFill } = require('./src/renderer/components/ui/icons/mains.tsx');
      const { default: Queue } = require('./src/renderer/components/ui/icons/queue.tsx');
      // Atlas navigation uses its own outlined icons outside the space registry.
      const atlasIcons = {
        'atlas-all': require('./src/renderer/components/ui/icons/library.tsx').default,
        'atlas-page': require('./src/renderer/components/ui/icons/page.tsx').default,
        'atlas-file': require('./src/renderer/components/ui/icons/passport.tsx').default,
        'atlas-image': require('./src/renderer/components/ui/icons/picture.tsx').default,
        'atlas-bookmark': require('./src/renderer/components/ui/icons/space/bookmark.tsx').default,
      };
      const modelIcons = {
        'model-muse': require('./src/renderer/components/ui/icons/muse.tsx').default,
        'model-deepseek': require('./src/renderer/components/ui/icons/deep-seek.tsx').default,
        'model-gpt': require('./src/renderer/components/ui/icons/gpt.tsx').default,
        'model-meta': require('./src/renderer/components/ui/icons/meta.tsx').default,
        'model-gemini': require('./src/renderer/components/ui/icons/gemini.tsx').default,
        'model-grok': require('./src/renderer/components/ui/icons/grok.tsx').default,
        'model-kimi': require('./src/renderer/components/ui/icons/kimi.tsx').default,
        'model-zai': require('./src/renderer/components/ui/icons/zai.tsx').default,
        'model-bot': require('./src/renderer/components/ui/icons/bot.tsx').default,
      };
      module.exports = Object.fromEntries(Object.entries({ ...iconRegistry, copilot: CopilotStatic, bridge: Bridge, queue: Queue, 'mains-fill': MainsFill, ...atlasIcons, ...modelIcons })
        .map(([name, Icon]) => [name, renderToStaticMarkup(React.createElement(Icon))]));
    `, resolveDir: desktopRoot, loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    tsconfig: join(desktopRoot, 'tsconfig.renderer.json'), outfile: bundle, logLevel: 'silent',
  });
  icons = desktop(bundle);
} finally {
  await rm(temporary, { recursive: true });
}
if (!Object.keys(icons).length) throw new Error('Desktop icon registry is empty.');

for (const [name, markup] of Object.entries(icons)) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unsupported native icon name: ${name}`);
  const dom = new JSDOM(markup.replace(/\bcurrentColor\b/g, '#000000'), { contentType: 'image/svg+xml' });
  let svg;
  try {
    const element = dom.window.document.documentElement;
    if (element.localName !== 'svg' || !element.hasAttribute('viewBox')) {
      throw new Error(`Desktop icon is not a standalone vector: ${name}`);
    }
    // Native templates supply their own size and tint. Keep all SVG geometry,
    // opacity, inherited strokes and masking rather than flattening to paths.
    for (const attr of ['width', 'height', 'class', 'style']) element.removeAttribute(attr);
    for (const title of element.querySelectorAll('title')) title.remove();
    // Desktop's GPT icon has an off-canvas accessible name; native supplies its own.
    for (const text of element.querySelectorAll('text[x="-9999"]')) text.remove();
    for (const child of element.querySelectorAll('[class]')) child.removeAttribute('class');
    // Desktop's Mains mark uses currentColor inside an alpha mask. Native SVG
    // template rendering reads the black paint as zero luminance instead.
    // Opaque white has the same alpha and keeps the mask visible in both modes.
    for (const mask of element.querySelectorAll('mask')) {
      if (!/mask-type\s*:\s*alpha/.test(mask.getAttribute('style') ?? '')) continue;
      for (const shape of [mask, ...mask.querySelectorAll('*')]) {
        for (const paint of ['fill', 'stroke']) {
          if (shape.getAttribute(paint) === '#000000') shape.setAttribute(paint, '#ffffff');
        }
      }
    }
    // Claude wraps a 100×100 mark in a 24×24 SVG. CoreSVG clips that nested
    // viewport in native templates. Hoist a full-viewport SVG's coordinates
    // and attributes to the root, retaining the desktop's exact path data.
    while (element.children.length === 1 && element.firstElementChild.localName === 'svg') {
      const nested = element.firstElementChild;
      if (['x', 'y', 'width', 'height', 'transform'].some(attr => nested.hasAttribute(attr))) break;
      for (const attr of nested.attributes) element.setAttribute(attr.name, attr.value);
      nested.replaceWith(...nested.childNodes);
    }
    svg = new dom.window.XMLSerializer().serializeToString(element) + '\n';
  } finally {
    dom.window.close();
  }
  const folder = new URL(`registry-${name}.imageset/`, root);
  const contents = JSON.stringify({ images: [{ filename: 'icon.svg', idiom: 'universal' }], info: { author: 'xcode', version: 1 }, properties: { 'preserves-vector-representation': true, 'template-rendering-intent': 'template' } }, null, 2) + '\n';
  if (check) {
    for (const [file, expected] of [['icon.svg', svg], ['Contents.json', contents]]) {
      if (await readFile(new URL(file, folder), 'utf8').catch(() => null) !== expected) {
        throw new Error(`Native vector icon is out of sync: ${name} (${file})`);
      }
    }
  } else {
    await mkdir(folder, { recursive: true });
    await writeFile(new URL('icon.svg', folder), svg);
    await writeFile(new URL('Contents.json', folder), contents);
  }
}
// Retain existing legacy assets so previously saved icon tokens still resolve.
console.log(`${check ? 'Verified' : 'Synced'} ${Object.keys(icons).length} current desktop vector icons`);
