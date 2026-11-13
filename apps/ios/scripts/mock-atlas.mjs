import { CHANNELS } from '../../../packages/contracts/src/channels.ts';

/** Prepared read-only Atlas responses; no host paths or user library access. */
export function atlasFixture(channel, input, { outputBytes, imageBase64, version }) {
  if (input?.accountId !== 'fixture-account') throw new Error('Atlas account not found');
  const rows = Array.from({ length: 55 }, (_, index) => ({
    key: index === 0 ? 'fixture-atlas-page' : index === 1 ? 'fixture-atlas-doc' : index === 2 ? 'fixture-atlas-image' : index === 3 ? 'fixture-atlas-bookmark' : `fixture-atlas-page-${index}`,
    kind: ['page', 'file', 'image', 'bookmark'][index] ?? 'page',
    title: ['Travel notes', 'Project report', 'Sample image', 'A useful link'][index] ?? `Library page ${index}`,
    date: '2026-11-12T10:00:00.000Z', collectionId: null, isFavorite: index < 2, origin: 'saved', sourceRunId: 'fixture-run',
    file: index === 1 ? { itemId: 'fixture-atlas-doc' } : index === 2 ? { itemId: 'fixture-atlas-image' } : null,
    pageId: index === 0 ? 'fixture-atlas-page' : index > 3 ? `fixture-atlas-page-${index}` : null,
    icon: index === 0 ? 'emoji:🗺️' : null, url: index === 3 ? 'https://example.com' : null,
    description: index === 3 ? 'A saved bookmark' : null, note: null,
  }));
  switch (channel) {
    case CHANNELS.atlas.mobileLibrary: {
      const filtered = rows.filter(row => (!input.type || input.type === 'all' || input.type === row.kind)
        && (!input.scope || input.scope === 'all' || input.scope === 'saved' || input.scope === 'favorites' && row.isFavorite)
        && (!input.collectionId) && (!input.query || row.title.toLowerCase().includes(input.query.toLowerCase())));
      const page = Math.max(1, Math.min(input.page ?? 1, Math.ceil(filtered.length / 50)));
      return { items: filtered.slice((page - 1) * 50, page * 50), page, hasNext: page * 50 < filtered.length };
    }
    case CHANNELS.atlas.readMobilePage: {
      if (!rows.some(row => row.pageId === input.id) || input.version !== undefined && input.version !== 1) throw new Error('Atlas page changed or not found');
      const chars = Array.from('x'.repeat(16383) + '😀' + 'İstanbul 🌍'), offset = input.offset ?? 0, end = Math.min(chars.length, offset + 16384);
      if (offset < 0 || offset > chars.length) throw new Error('Invalid page offset');
      return { id: input.id, title: 'Travel notes', icon: 'emoji:🗺️', version: 1, markdown: chars.slice(offset, end).join(''), offset, nextOffset: end < chars.length ? end : null, sourceRunId: 'fixture-run' };
    }
    case CHANNELS.atlas.describeMobileFile:
    case CHANNELS.atlas.readMobileFile: {
      const id = input.reference?.itemId;
      if (!['fixture-atlas-doc', 'fixture-atlas-image'].includes(id)) throw new Error('Atlas file not found');
      const image = id === 'fixture-atlas-image', bytes = image ? Buffer.from(imageBase64, 'base64') : outputBytes;
      if (channel === CHANNELS.atlas.describeMobileFile) return { reference: input.reference, name: image ? 'image.png' : 'notes.md', mimeType: image ? 'image/png' : 'text/markdown', previewType: image ? 'image' : 'markdown', byteSize: bytes.length, modifiedAt: 1, version };
      if (input.version !== version || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > bytes.length) throw new Error('Atlas file changed');
      const end = Math.min(bytes.length, input.offset + 128 * 1024);
      return { base64: bytes.subarray(input.offset, end).toString('base64'), offset: input.offset, nextOffset: end < bytes.length ? end : null, byteSize: bytes.length, version };
    }
    default: throw new Error('Unknown Atlas channel');
  }
}
