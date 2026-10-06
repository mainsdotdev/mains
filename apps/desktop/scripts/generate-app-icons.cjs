const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const publicDir = path.resolve(__dirname, '../src/renderer/public');
const iconsDir = path.join(publicDir, 'icons');
// Keep these dimensions in sync with main/windows/dock-icon.ts.
const canvasSize = 1024;
const contentSize = 832;
const inset = (canvasSize - contentSize) / 2;

if (process.versions.electron) {
  const { app, nativeImage } = require('electron');
  app.whenReady().then(() => {
    app.dock.hide();
    const image = nativeImage.createFromPath(path.join(iconsDir, 'mains-default.png'));
    if (image.isEmpty()) throw new Error('The default app icon could not be loaded');
    const source = image.resize({ width: contentSize, height: contentSize, quality: 'best' })
      .toBitmap({ scaleFactor: 1 });
    const bitmap = Buffer.alloc(canvasSize * canvasSize * 4);
    for (let y = 0; y < contentSize; y++) {
      source.copy(bitmap, ((y + inset) * canvasSize + inset) * 4,
        y * contentSize * 4, (y + 1) * contentSize * 4);
    }
    const padded = nativeImage.createFromBitmap(bitmap, { width: canvasSize, height: canvasSize });
    fs.writeFileSync(path.join(publicDir, 'icon.png'), padded.toPNG());

    const iconset = path.join(publicDir, 'icon.iconset');
    fs.mkdirSync(iconset, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const pixels = size * scale;
        const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        fs.writeFileSync(path.join(iconset, filename),
          padded.resize({ width: pixels, height: pixels, quality: 'best' }).toPNG());
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(publicDir, 'icon.icns')]);
    console.log('Generated the padded PNG, ICNS and 10 legacy iconset sizes.');
    app.quit();
  }).catch((error) => {
    console.error(error);
    app.exit(1);
  });
} else {
  if (process.platform !== 'darwin') throw new Error('App icon generation requires macOS');
  const developerDir = process.env.DEVELOPER_DIR || execFileSync('xcode-select', ['-p'], { encoding: 'utf8' }).trim();
  const candidates = [
    '/Applications/Icon Composer.app/Contents/Executables/ictool',
    path.resolve(developerDir, '../Applications/Icon Composer.app/Contents/Executables/ictool'),
  ];
  const ictool = candidates.find((candidate) => fs.existsSync(candidate));
  if (!ictool) throw new Error('Install Icon Composer before generating app icons');

  const sources = fs.readdirSync(iconsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.icon'));
  // Icon Composer can silently omit a missing image layer. Validate every
  // source before overwriting previews so a bad reference cannot erase logos.
  for (const { name } of sources) {
    const document = JSON.parse(fs.readFileSync(path.join(iconsDir, name, 'icon.json'), 'utf8'));
    for (const group of document.groups ?? []) {
      for (const layer of group.layers ?? []) {
        const asset = layer['image-name'];
        if (asset && !fs.existsSync(path.join(iconsDir, name, 'Assets', asset))) {
          throw new Error(`${name}: missing image layer ${asset}`);
        }
      }
    }
  }
  for (const { name } of sources) {
    execFileSync(ictool, [path.join(iconsDir, name), '--export-image',
      '--output-file', path.join(iconsDir, `${name.slice(0, -5)}.png`),
      '--platform', 'macOS', '--rendition', 'Default',
      '--width', '1024', '--height', '1024', '--scale', '1']);
  }
  console.log(`Rendered ${sources.length} app icons from Icon Composer sources.`);
  execFileSync(require('electron'), [__filename], { stdio: 'inherit' });
}
