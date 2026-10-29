/** SF names are the existing UI vocabulary; Android draws the corresponding Material icon. */
export const ANDROID_SYMBOLS = {
  "arrow.clockwise": "refresh", "arrow.down": "arrow-down", "arrow.right": "arrow-right",
  "arrow.up": "arrow-up", "arrow.up.left": "arrow-top-left", "arrow.up.right.square": "open-in-new",
  "arrow.triangle.2.circlepath": "sync", "camera": "camera-outline", "checkmark": "check",
  "checkmark.circle": "check-circle-outline", "checkmark.circle.fill": "check-circle",
  "checkmark.seal": "check-decagram-outline", "chevron.down": "chevron-down", "chevron.left": "chevron-left",
  "chevron.right": "chevron-right", "chevron.up": "chevron-up", "circle": "circle-outline",
  "circle.lefthalf.filled": "circle-half-full", "desktopcomputer": "monitor", "doc": "file-outline",
  "doc.badge.plus": "file-plus-outline", "doc.on.doc": "file-multiple-outline", "doc.text": "file-document-outline",
  "ellipsis": "dots-horizontal", "envelope": "email-outline", "eye": "eye-outline", "folder": "folder-outline",
  "gearshape": "cog-outline", "globe": "web", "hourglass": "timer-sand", "laptopcomputer": "laptop",
  "list.bullet": "format-list-bulleted", "list.bullet.rectangle": "clipboard-list-outline", "lock.fill": "lock",
  "magnifyingglass": "magnify", "mic": "microphone-outline", "paperclip": "paperclip", "paperplane": "send-outline",
  "paperplane.fill": "send", "pencil": "pencil-outline", "person.crop.square": "account-box-outline",
  "person.fill": "account", "photo": "image-outline", "photo.on.rectangle": "image-multiple-outline",
  "plus": "plus", "point.3.connected.trianglepath.dotted": "source-branch", "puzzlepiece.extension": "puzzle-outline",
  "questionmark.circle": "help-circle-outline", "shippingbox": "package-variant-closed", "sparkles": "creation",
  "square.and.arrow.up": "share-variant-outline", "square.and.pencil": "square-edit-outline", "stop.fill": "stop",
  "tablecells": "table", "terminal": "console", "text.magnifyingglass": "text-search", "trash": "trash-can-outline",
  "tray": "tray", "waveform": "waveform", "wrench.and.screwdriver": "tools", "xmark": "close",
  "xmark.circle": "close-circle-outline", "xmark.circle.fill": "close-circle", "exclamationmark.triangle": "alert-outline",
  "exclamationmark.triangle.fill": "alert", "bolt.fill": "lightning-bolt", "pause.fill": "pause",
  "bolt.slash.fill": "flash-off", "checkmark.square.fill": "checkbox-marked",
  "chevron.left.forwardslash.chevron.right": "code-tags", "doc.richtext": "file-document-outline",
  "stop.circle.fill": "stop-circle", "play.fill": "play", "checklist": "format-list-checks",
} as const;

export function androidSymbol(name: string) {
  return Object.hasOwn(ANDROID_SYMBOLS, name) ? ANDROID_SYMBOLS[name as keyof typeof ANDROID_SYMBOLS] : "help-circle-outline";
}
