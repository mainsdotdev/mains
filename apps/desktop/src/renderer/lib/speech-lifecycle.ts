export interface DictationRecognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}

/** Each explicit dictation attempt owns a native recognizer and its callbacks. */
export function createDictationLifecycle(create: () => DictationRecognizer, effects: {
  transcript(text: string): void;
  recording(value: boolean): void;
  error(error: unknown): void;
}) {
  type Attempt = { native: DictationRecognizer | null; phase: "starting" | "recording" | "stopping"; canceled: boolean; retry: boolean };
  let closed = false;
  let owned: Attempt | null = null;
  const current = (attempt: Attempt) => !closed && owned === attempt;
  const detach = (native: DictationRecognizer) => { native.onstart = native.onresult = native.onend = native.onerror = null; };
  const abort = (native: DictationRecognizer) => {
    if (native.abort) {
      try { native.abort(); return; }
      catch { /* retry through graceful native stop */ }
    }
    native.stop();
  };
  const finish = (attempt: Attempt) => {
    if (!current(attempt)) return;
    owned = null;
    if (attempt.native) detach(attempt.native);
    effects.recording(false);
  };
  const stop = (attempt: Attempt) => {
    if (!attempt.native || !current(attempt)) return;
    const cancel = attempt.canceled || attempt.phase === "starting";
    attempt.canceled = cancel; attempt.phase = "stopping"; attempt.retry = false;
    if (cancel) effects.recording(false);
    try {
      if (cancel) abort(attempt.native);
      else attempt.native.stop();
    } catch (error) {
      if (!current(attempt)) return;
      attempt.retry = true;
      effects.error(error);
    }
  };
  return {
    toggle() {
      if (closed) return;
      if (owned) {
        if (owned.phase !== "stopping" || owned.retry) stop(owned);
        return;
      }
      const attempt: Attempt = { native: null, phase: "starting", canceled: false, retry: false };
      owned = attempt;
      try {
        const native = create(); attempt.native = native;
        native.continuous = false; native.interimResults = true; native.lang = "en-US";
        native.onstart = () => {
          if (current(attempt) && attempt.phase === "starting" && !attempt.canceled) {
            attempt.phase = "recording"; effects.recording(true);
          }
        };
        native.onresult = (event) => {
          if (!current(attempt) || attempt.canceled) return;
          const text = event.results[0]?.[0]?.transcript;
          if (typeof text === "string") effects.transcript(text);
        };
        native.onend = native.onerror = () => finish(attempt);
        native.start();
      } catch (error) {
        finish(attempt);
        if (attempt.native) releaseSpeechResources(() => abort(attempt.native!));
        effects.error(error);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      const attempt = owned; owned = null;
      if (!attempt?.native) return;
      const native = attempt.native; detach(native);
      releaseSpeechResources(() => abort(native));
    },
  };
}

export interface VoicePreviewState { playingVoice: string | null; error: string | null }
export const idleVoicePreview: VoicePreviewState = { playingVoice: null, error: null };
const playbackError = "Unable to play this voice preview. Try again.";

/** One failed native release must not prevent the remaining cleanup attempts. */
export function releaseSpeechResources(...effects: Array<() => void | Promise<unknown>>): void {
  for (const effect of effects) {
    try { void Promise.resolve(effect()).catch(() => {}); }
    catch { /* continue releasing independent resources */ }
  }
}

/** The playback attempt owns acquisition, terminal receipts and scoped cancellation. */
export function createVoicePreviewLifecycle<Resource extends { play(): Promise<void>; release(): void }>(effects: {
  acquire(voice: string, finish: (error: string | null) => void): Resource | null;
  change(state: VoicePreviewState): void;
}) {
  type Attempt = { resource: Resource | null };
  let active = true, revision = 0;
  let owned: Attempt | null = null;
  const release = (resource: Resource | null) => { try { resource?.release(); } catch { /* adapter cleanup is best-effort */ } };
  const retire = () => { const previous = owned; owned = null; release(previous?.resource ?? null); };
  const finish = (attempt: Attempt, error: string | null) => {
    if (!active || owned !== attempt) return;
    retire(); effects.change({ playingVoice: null, error });
  };
  const stop = () => { revision++; retire(); if (active) effects.change(idleVoicePreview); };
  return {
    resource: () => owned?.resource ?? null,
    stop,
    close() { if (!active) return; active = false; revision++; retire(); },
    play(voice: string): () => void {
      if (!active) return () => {};
      const ticket = ++revision;
      retire();
      const cancel = () => { if (active && revision === ticket) stop(); };
      if (!active || revision !== ticket) return cancel;
      const attempt: Attempt = { resource: null }; owned = attempt;
      try {
        const resource = effects.acquire(voice, (error) => finish(attempt, error));
        if (!resource) { finish(attempt, "No preview is available for this voice."); return cancel; }
        if (!active || owned !== attempt || revision !== ticket) { release(resource); return cancel; }
        attempt.resource = resource;
        effects.change({ playingVoice: voice, error: null });
        // Stay in the selecting/replay gesture; never defer native play to an effect.
        void resource.play().catch(() => finish(attempt, playbackError));
      } catch { finish(attempt, playbackError); }
      return cancel;
    },
  };
}
