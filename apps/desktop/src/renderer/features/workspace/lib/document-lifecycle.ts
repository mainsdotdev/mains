import type { UploadedFile } from "@/components/ui";

export function documentIdentity(doc: { path: string; docType: string }, backendRevision: number) {
  return JSON.stringify([backendRevision, doc.path, doc.docType]);
}
export function documentOwnerMatchesBackend(owner: string, backendId: string | null) {
  try { const parts: unknown = JSON.parse(owner); return Array.isArray(parts) && parts[0] === (backendId ?? "local"); }
  catch { return false; }
}
const surfaceIds = new WeakMap<object, string>();
export function annotationViewIdentity(owner: string, source: string, surface: object) {
  if (!surfaceIds.has(surface)) surfaceIds.set(surface, crypto.randomUUID());
  return JSON.stringify([owner, source, surfaceIds.get(surface)]);
}

/** A render attempt admits native resources only while current. Retirement
 * aborts first, disposes each resource once and also disposes late acquisitions. */
export function createDocumentTask() {
  const controller = new AbortController();
  let phase: "loading" | "ready" | "error" | "disposed" = "loading";
  const cleanups = new Set<() => void>();
  const current = () => phase === "loading" || phase === "ready";
  const finish = (next: "error" | "disposed") => {
    if (!current()) return;
    phase = next; controller.abort();
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
  };
  return {
    signal: controller.signal, current,
    own(dispose: () => void | Promise<unknown>) {
      let released = false;
      const cleanup = () => {
        if (released) return;
        released = true;
        try { void Promise.resolve(dispose()).catch((error) => console.warn("[document-viewer] Cleanup failed", error)); }
        catch (error) { console.warn("[document-viewer] Cleanup failed", error); }
      };
      if (current()) cleanups.add(cleanup); else cleanup();
    },
    ready(publish: () => void) { if (!current()) return; phase = "ready"; publish(); },
    fail(publish: () => void) { if (!current()) return; finish("error"); publish(); },
    close() { finish("disposed"); },
  };
}

/** An admitted capture keeps its originating composer even after navigation.
 * Its retired view cannot clear selection, display errors or start more work. */
export function createAnnotationCapture() {
  let mounted: object | null = null, pending: object | null = null;
  return {
    attach() { const token = {}; mounted = token; return () => { if (mounted === token) mounted = null; }; },
    begin(ready: boolean, targetCount: number) {
      if (!mounted || pending || !ready || !targetCount) return null;
      const view = mounted, token = {}; pending = token;
      return { visible: () => mounted === view, finish: () => { if (pending === token) pending = null; } };
    },
  };
}

/** Files and blob URLs stay in memory. Drafts and queued inputs may share a
 * preview; replacing one owner releases only URLs with no remaining owner. */
const empty: UploadedFile[] = [];
const filesByOwner = new Map<string, UploadedFile[]>();
const listeners = new Map<string, Set<() => void>>();
const retainedFiles = new Map<object, UploadedFile[]>();
const documentUrls = new Map<File, string>();
const retainedUrls = new Map<object, string>();
const notify = (owner: string) => listeners.get(owner)?.forEach((listener) => listener());
function releaseUnused(files: UploadedFile[]) {
  const live = [...filesByOwner.values(), ...retainedFiles.values()].flat();
  const referenced = new Set([...live.flatMap((file) => file.preview ? [file.preview] : []), ...retainedUrls.values()]);
  for (const [file, url] of documentUrls) if (live.some((entry) => entry.file === file)) referenced.add(url);
  const candidates = new Set([...files.flatMap((file) => file.preview ? [file.preview] : []), ...documentUrls.values()]);
  for (const preview of candidates) {
    if (referenced.has(preview)) continue;
    URL.revokeObjectURL(preview);
    for (const [file, url] of documentUrls) if (url === preview) documentUrls.delete(file);
  }
}
export const transientDocumentFiles = {
  get(owner: string): UploadedFile[] { return filesByOwner.get(owner) ?? empty; },
  owners() { return filesByOwner.keys(); },
  hold(files: UploadedFile[]) {
    const token = {}, snapshot = files.map((file) => ({ ...file }));
    retainedFiles.set(token, snapshot);
    return () => { if (retainedFiles.delete(token)) releaseUnused(snapshot); };
  },
  documentUrl(file: File) {
    if (!documentUrls.has(file)) documentUrls.set(file, URL.createObjectURL(file));
    return documentUrls.get(file)!;
  },
  retainPreview(url: string) {
    if (![...documentUrls.values()].includes(url)) return () => {};
    const token = {}; retainedUrls.set(token, url);
    return () => { if (retainedUrls.delete(token)) releaseUnused([]); };
  },
  subscribe(owner: string, listener: () => void) {
    const group = listeners.get(owner) ?? new Set<() => void>();
    group.add(listener); listeners.set(owner, group);
    return () => { group.delete(listener); if (!group.size) listeners.delete(owner); };
  },
  replace(owner: string, next: UploadedFile[]) {
    const previous = this.get(owner);
    if (next.length) filesByOwner.set(owner, [...next]); else filesByOwner.delete(owner);
    releaseUnused(previous); notify(owner);
  },
  move(from: string, to: string, options: { merge?: boolean } = {}) {
    if (from === to) return;
    const previous = this.get(to), source = this.get(from);
    const files = options.merge ? [...source, ...previous.filter((file) => !source.includes(file))] : source;
    if (files.length) filesByOwner.set(to, files); else filesByOwner.delete(to);
    filesByOwner.delete(from);
    releaseUnused(previous); notify(from); notify(to);
  },
};

/** Native acceptance consumes only this immutable submission. Rejected or
 * uncertain delivery leaves its draft/queue owner intact; Close only drops
 * the temporary resource lease. Files added during an await remain unsent. */
export function createUploadSubmission(files: UploadedFile[]) {
  const snapshot = [...files], release = transientDocumentFiles.hold(snapshot);
  let phase: "pending" | "accepted" | "closed" = "pending";
  return {
    files: snapshot,
    accept(current: UploadedFile[]) {
      if (phase !== "pending") return current;
      phase = "accepted";
      return current.filter((file) => !snapshot.includes(file));
    },
    close() { if (phase === "closed") return; phase = "closed"; release(); },
  };
}
