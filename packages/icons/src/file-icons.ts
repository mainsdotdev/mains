import { EXTENSION_ICONS, FILENAME_ICONS, FILENAME_PATTERNS } from "./file-icons.generated";

/** The desktop's exact filename → filename family → extension lookup, without DOM components. */
export function fileIconSvg(filePath: string): string | undefined {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  if (Object.hasOwn(FILENAME_ICONS, name)) return FILENAME_ICONS[name];
  const patterned = FILENAME_PATTERNS.find(([pattern]) => pattern.test(name));
  if (patterned) return patterned[1];
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return Object.hasOwn(EXTENSION_ICONS, extension) ? EXTENSION_ICONS[extension] : undefined;
}
