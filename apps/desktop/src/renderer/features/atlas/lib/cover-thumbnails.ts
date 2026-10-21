// Gallery thumbnails ship with the renderer (see `npm run atlas:cover-thumbnails`), so the
// picker never waits on the backend; the full-size image is saved to Atlas only when chosen.
const thumbnails = import.meta.glob<string>("../assets/cover-thumbs/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});

const byId = new Map(
  Object.entries(thumbnails).map(([file, url]) => [file.slice(file.lastIndexOf("/") + 1, -".jpg".length), url]),
);

export function coverThumbnail(id: string): string | undefined {
  return byId.get(id);
}

/** `aurora` -> `Aurora`, `deep-sea` -> `Deep sea`. */
export function coverTitle(id: string): string {
  const words = id.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
