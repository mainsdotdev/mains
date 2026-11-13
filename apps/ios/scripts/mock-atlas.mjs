import { CHANNELS } from '../../../packages/contracts/src/channels.ts';
import { createHash } from 'node:crypto';

const saved = new Map(), sources = new Map(), edits = new Map();
export function resetAtlasFixture() { saved.clear(); sources.clear(); edits.clear(); }

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
  for (const row of rows) {
    Object.assign(row, edits.get(row.key));
    row.savedItemId = row.key; row.savedCollectionId = row.collectionId;
  }
  switch (channel) {
    case CHANNELS.atlas.mobileTrash: {
      const trashed = rows.filter(row => row.trashedAt).sort((left, right) => right.trashedAt.localeCompare(left.trashedAt) || right.key.localeCompare(left.key));
      const page = input.page ?? 1;
      return { items: trashed.slice((page - 1) * 50, page * 50).map(row => ({ id: row.key, title: row.title, kind: row.kind, collectionId: row.collectionId, trashedAt: row.trashedAt })), page, hasNext: page * 50 < trashed.length };
    }
    case CHANNELS.atlas.setMobileTrash: {
      const item = rows.find(row => row.key === input.id);
      if (!item || typeof input.trashed !== 'boolean') throw new Error('Atlas item not found');
      if (!!item.trashedAt !== input.trashed) edits.set(input.id, { ...edits.get(input.id), trashedAt: input.trashed ? new Date().toISOString() : null });
      return { id: item.key, requestedId: input.id, title: item.title, kind: item.kind, trashed: input.trashed };
    }
    case CHANNELS.atlas.readMobileBookmark:
    case CHANNELS.atlas.editMobileBookmark: {
      const item = rows.find(row => row.key === input.id && row.kind === 'bookmark' && !row.trashedAt);
      if (!item) throw new Error('Bookmark not found or in Trash');
      const document = row => ({ id: row.key, requestedId: input.id, title: row.title, kind: 'bookmark', url: row.url,
        description: row.description ?? '', note: row.note ?? '',
        revision: createHash('sha256').update(JSON.stringify([input.accountId, row.key, row.url, row.title, row.description ?? '', row.note ?? ''])).digest('hex') });
      const current = document(item);
      if (channel === CHANNELS.atlas.readMobileBookmark) return current;
      if (input.expectedRevision !== current.revision) throw new Error('This bookmark changed elsewhere. Reload it before saving your edits.');
      const patch = { ...edits.get(input.id) };
      for (const field of ['title', 'description', 'note']) if (field in input) patch[field] = input[field].trim();
      edits.set(input.id, patch);
      const updated = document({ ...item, ...patch });
      return { id: updated.id, requestedId: input.id, kind: 'bookmark', title: updated.title, revision: updated.revision };
    }
    case CHANNELS.atlas.updateMobileItem: {
      const item = rows.find(row => row.key === input.id);
      if (!item || item.trashedAt) throw new Error('Atlas item not found');
      const patch = { ...edits.get(input.id) };
      if (typeof input.isFavorite === 'boolean') patch.isFavorite = input.isFavorite;
      if ('collectionId' in input) patch.collectionId = input.collectionId;
      edits.set(input.id, patch);
      const result = { ...item, ...patch };
      return { id: result.key, requestedId: input.id, title: result.title, kind: result.kind, isFavorite: result.isFavorite, collectionId: result.collectionId };
    }
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
      const filtered = rows.filter(row => !row.trashedAt && (!input.type || input.type === 'all' || input.type === row.kind)
        && (!input.scope || input.scope === 'all' || input.scope === 'saved' || input.scope === 'favorites' && row.isFavorite)
        && (!input.collectionId || row.collectionId === input.collectionId) && (!input.query || row.title.toLowerCase().includes(input.query.toLowerCase())));
      const page = Math.max(1, Math.min(input.page ?? 1, Math.ceil(filtered.length / 50)));
      return { items: filtered.slice((page - 1) * 50, page * 50), page, hasNext: page * 50 < filtered.length };
    }
    case CHANNELS.atlas.readMobilePage: {
      if (!rows.some(row => row.pageId === input.id && !row.trashedAt) || input.version !== undefined && input.version !== 1) throw new Error('Atlas page changed or not found');
      const chars = Array.from('x'.repeat(16383) + '😀' + 'İstanbul 🌍'), offset = input.offset ?? 0, end = Math.min(chars.length, offset + 16384);
      if (offset < 0 || offset > chars.length) throw new Error('Invalid page offset');
      return { id: input.id, title: 'Travel notes', icon: 'emoji:🗺️', version: 1, markdown: chars.slice(offset, end).join(''), offset, nextOffset: end < chars.length ? end : null, sourceRunId: 'fixture-run' };
    }
    case CHANNELS.atlas.describeMobileFile:
    case CHANNELS.atlas.readMobileFile: {
      const id = input.reference?.itemId;
      if (rows.find(row => row.key === id)?.trashedAt) throw new Error('Atlas file not found');
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
