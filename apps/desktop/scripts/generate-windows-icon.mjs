import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ICO supports PNG frames. Reuse the checked-in iconset without a platform
// image tool or a second source of icon artwork.
const frames = [16, 32, 64, 128, 256].map(size => {
  const filename = size === 64 ? 'icon_32x32@2x.png' : `icon_${size}x${size}.png`;
  return { size, data: readFileSync(new URL(`../src/renderer/public/icon.iconset/${filename}`, import.meta.url)) };
});
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
const destination = new URL('../src/renderer/public/icon.ico', import.meta.url);
writeFileSync(destination, Buffer.concat([header, ...frames.map(frame => frame.data)]));
console.log(`Generated ${fileURLToPath(destination)}`);
