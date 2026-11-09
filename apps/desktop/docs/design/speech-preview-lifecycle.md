# Browser dictation and voice preview (27 + 28)

`src/renderer/lib/speech-lifecycle.ts` owns attempt admission, retirement and
terminal rules. React hooks adapt native browser APIs and present state;
`voice-preview-audio.ts` retains the Web Audio graph and level calculations.
No mobile, backend, channel, wire contract, database or dependency changes are
introduced. These lifetimes are independent of native realtime calls.

## Dictation

One mounted hook owns an Idle state or a native attempt in Starting, Recording
or Stopping. Unmount permanently retires that owner. Each explicit new start
creates a distinct recognizer. Mount/Strict Mode setup does not open speech
input. The existing one-shot, interim-result and `en-US` configuration remains.

| Event | Transition / effect |
| --- | --- |
| Toggle from Idle | Claim Starting, create/configure one recognizer and call native start in the gesture. |
| Native start acknowledgement | Move only the current Starting attempt to Recording; publish `isRecording: true`. |
| Toggle while Starting | Claim Stopping and cancel through abort, falling back to stop if needed. Ignore late start/results. |
| Toggle while Recording | Claim Stopping before native stop; allow its final transcript until End. |
| Repeated toggle while stopping | Do not start or stop again unless the previous native stop failed. |
| Stop/abort failure | Keep the same attempt and permit stop retry; do not acquire a competing recognizer. |
| Current result | Deliver text through the latest mounted callback. Empty malformed results are ignored. |
| Current End or Error | Retire the attempt, detach handlers and return to Idle. |
| Failed constructor/start | Report through the existing error logger, release any acquired recognizer and permit explicit retry. |
| Hook cleanup | Retire before detaching callbacks and attempting native abort/stop. |
| Old queued callback | Ignore it after replacement or disposal, even if the callback was already captured before handler removal. |

The hook's existing `isRecording` value follows native acknowledgement.
Graceful stopping retains it until End; a canceled pending start stays false.
A cleanup request is best-effort through the browser's synchronous control
methods; the browser owns native microphone shutdown. No automatic restart,
language choice or new speech UI is introduced. Unsupported browsers remain
idle, and the legacy prefixed recognition API remains supported.

The distinction between graceful final-result stopping and aborting without
results follows the [Web Speech API methods](https://webaudio.github.io/web-speech-api/#speechreco-methods).

## Bundled preview playback

Each explicit play claims a separate attempt before acquisition. It retires the
previous sample, resolves the bundled URL and acquires one audio element plus
optional analysis. Native play is invoked synchronously in the selection/replay
gesture, before settings persistence. Mount and preference refresh do not play.

| Event | Transition / effect |
| --- | --- |
| Valid sample acquired | Publish its voice and invoke native play once. |
| Missing sample | Release the previous sample and present the existing unavailable-preview error. Saving a new server voice remains possible. |
| Acquisition or synchronous/asynchronous play failure | Release the matching attempt and present a retryable playback error. |
| Native ended/error | Settle only that attempt; duplicate terminal events have no further effect. |
| Replacement / explicit Stop | Retire the old attempt before cleanup. Its late rejection or events cannot stop the successor. |
| Preference save failure/rejection | Cancel through the receipt returned by that exact play. A newer sample or replay remains owned. |
| Unmount | Permanently retire the lifecycle, release media and make retained hook callbacks inert. |

Preview identity is an attempt, rather than its voice name. Playing Cove, then
Maple, then Cove cannot revive the first Cove receipt. The stable level getter
reads only the currently owned graph and returns silence after release without
per-frame React updates.

## Analysis and cleanup

The existing single speaker route and analysis branch are preserved. Analysis
attaches only after a suspended context resumes. Stop before resume fences its
late graph acquisition. Unsupported analysis, rejected resume and synchronous
resume failure leave native audio playback available.

Resource retirement detaches terminal listeners, pauses media, disposes the
analysis graph, removes the source and resets the element. Graph disposal
clears its readable state before disconnecting nodes and closing the context.
Every independent cleanup is attempted even if another throws; rejected native
close promises are consumed. The graph's existing disposal guard prevents
duplicate release. Cleanup does not claim a confirmed close when a browser
operation fails.

## Validation

Public hook tests control only recognition, Audio and AudioContext boundaries.
They exercise the real hooks, lifecycle module and analysis implementation:
pending start cancellation, late callback retirement, graceful final speech,
latest transcript callback, stop failure/retry, failed start cleanup, unsupported
and legacy recognition, preview replacement/replay, stale receipts, synchronous
play failure, cleanup failure, analysis fallback and retained callbacks after
unmount. Existing graph/envelope tests remain in the targeted suite.

The actual Codex voice-settings component additionally verifies immediate
preview before save, replacement while an earlier save is pending, replay after
manual stop, and rejected/thrown preference writes. Existing picker, style,
color, completion and unavailable-sample tests remain. Tests use no real
microphone, speech service, audio output, provider call or installed profile.
