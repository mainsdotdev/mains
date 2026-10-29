/** Keep the filename intact and only the nearest two folders on a phone row. */
export function filePathLabel(path: string): { name: string; directory: string } {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const name = parts.pop() ?? path;
  const directory = `${parts.length > 2 ? "…/" : ""}${parts.slice(-2).join("/")}`;
  return { name, directory };
}
