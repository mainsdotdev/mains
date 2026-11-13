import { CHANNELS } from '../../../packages/contracts/src/channels.ts';

const saved = new Map(), sources = new Map();
export function resetAtlasFixture() { saved.clear(); sources.clear(); }

/** Prepared Atlas responses and memory-only saves; no user library access. */
export function atlasFixture(channel, input, { outputBytes, pdfBytes, imageBase64, version }) {
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
  rows.push(...saved.values());
  switch (channel) {
    case CHANNELS.atlas.saveMobileBookmark:
    case CHANNELS.atlas.saveMobileFile: {
      let source, title, kind, url = null;
      if (channel === CHANNELS.atlas.saveMobileBookmark) {
        const value = new URL(input.url);
        if (!['http:', 'https:'].includes(value.protocol)) throw new Error('Invalid bookmark URL');
        for (const key of [...value.searchParams.keys()]) if (key.startsWith('utm_') || ['fbclid', 'gclid'].includes(key)) value.searchParams.delete(key);
        source = value.href; title = value.hostname; url = input.url; kind = 'bookmark';
      } else {
        if (input.runId !== 'fixture-run' || input.version !== version || ![503, 505].includes(input.artifactId)) throw new Error('Invalid Atlas save source');
        source = `file:${input.runId}:${input.artifactId}`; title = input.artifactId === 505 ? 'report.pdf' : 'notes.md'; kind = 'file';
      }
      let key = sources.get(source);
      if (!key) {
        key = `fixture-saved-${saved.size}`;
        saved.set(key, { ...rows[1], key, title, kind, isFavorite: false, sourceRunId: kind === 'file' ? input.runId : null,
          collectionId: input.collectionId ?? null, file: kind === 'file' ? { itemId: key } : null, url });
        sources.set(source, key);
      }
      const item = saved.get(key); return { id: key, title: item.title, kind: item.kind };
    }
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
      if (!['fixture-atlas-doc', 'fixture-atlas-image'].includes(id) && saved.get(id)?.kind !== 'file') throw new Error('Atlas file not found');
      const image = id === 'fixture-atlas-image', bytes = image ? Buffer.from(imageBase64, 'base64') : saved.get(id)?.title === 'report.pdf' ? pdfBytes : outputBytes;
      if (channel === CHANNELS.atlas.describeMobileFile) return { reference: input.reference, name: image ? 'image.png' : 'notes.md', mimeType: image ? 'image/png' : 'text/markdown', previewType: image ? 'image' : 'markdown', byteSize: bytes.length, modifiedAt: 1, version };
      if (input.version !== version || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > bytes.length) throw new Error('Atlas file changed');
      const end = Math.min(bytes.length, input.offset + 128 * 1024);
      return { base64: bytes.subarray(input.offset, end).toString('base64'), offset: input.offset, nextOffset: end < bytes.length ? end : null, byteSize: bytes.length, version };
    }
    default: throw new Error('Unknown Atlas channel');
  }
}
