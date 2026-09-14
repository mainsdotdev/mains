import { memo, ComponentType, SVGProps } from "react";
import {
  MarkdownFileIcon,
  EslintFileIcon,
  GitFileIcon,
  ClaudeFileIcon,
  ElectronFileIcon,
  JsFileIcon,
  TsFileIcon,
  NodeFileIcon,
  PostcssFileIcon,
  ReactFileIcon,
  TsconfigFileIcon,
  GoFileIcon,
  SumFileIcon,
  FolderIcon,
  FolderOpenIcon,
  HtmlFileIcon,
  CssFileIcon,
  JsonFileIcon,
  ImageFileIcon,
  EjsFileIcon,
  IcoFileIcon,
  SvgFileIcon,
  PythonFileIcon,
  RustFileIcon,
  RubyFileIcon,
  JavaFileIcon,
  CppFileIcon,
  PhpFileIcon,
  VueFileIcon,
  SvelteFileIcon,
  YamlFileIcon,
  XmlFileIcon,
  DatabaseFileIcon,
  CsvFileIcon,
  TextFileIcon,
  PdfFileIcon,
  ArchiveFileIcon,
  FontFileIcon,
  VideoFileIcon,
  AudioFileIcon,
  ShellFileIcon,
  EnvFileIcon,
  LockFileIcon,
  DockerFileIcon,
  TailwindFileIcon,
  ViteFileIcon,
  VitestFileIcon,
  DrizzleFileIcon,
  LicenseFileIcon,
  GraphqlFileIcon,
  NextFileIcon,
  PnpmFileIcon,
  TestFileIcon
} from "@/components/ui/icons/file-icons";

type FileIconType = ComponentType<SVGProps<SVGSVGElement>>;

const EXTENSION_ICONS: Record<string, FileIconType> = {
  js: JsFileIcon,
  mjs: JsFileIcon,
  cjs: JsFileIcon,
  html: HtmlFileIcon,
  htm: HtmlFileIcon,
  css: CssFileIcon,
  ts: TsFileIcon,
  mts: TsFileIcon,
  cts: TsFileIcon,
  jsx: ReactFileIcon,
  tsx: ReactFileIcon,
  md: MarkdownFileIcon,
  mdx: MarkdownFileIcon,
  postcss: PostcssFileIcon,
  go: GoFileIcon,
  sum: SumFileIcon,
  mod: SumFileIcon,
  json: JsonFileIcon,
  jsonc: JsonFileIcon,
  json5: JsonFileIcon,
  png: ImageFileIcon,
  jpg: ImageFileIcon,
  jpeg: ImageFileIcon,
  gif: ImageFileIcon,
  webp: ImageFileIcon,
  avif: ImageFileIcon,
  bmp: ImageFileIcon,
  svg: SvgFileIcon,
  icns: ImageFileIcon,
  ejs: EjsFileIcon,
  ico: IcoFileIcon,
  py: PythonFileIcon,
  pyi: PythonFileIcon,
  pyw: PythonFileIcon,
  rs: RustFileIcon,
  rb: RubyFileIcon,
  erb: RubyFileIcon,
  java: JavaFileIcon,
  c: CppFileIcon,
  h: CppFileIcon,
  cc: CppFileIcon,
  cpp: CppFileIcon,
  cxx: CppFileIcon,
  hpp: CppFileIcon,
  hh: CppFileIcon,
  php: PhpFileIcon,
  vue: VueFileIcon,
  svelte: SvelteFileIcon,
  yml: YamlFileIcon,
  yaml: YamlFileIcon,
  xml: XmlFileIcon,
  plist: XmlFileIcon,
  xsd: XmlFileIcon,
  xsl: XmlFileIcon,
  sql: DatabaseFileIcon,
  db: DatabaseFileIcon,
  sqlite: DatabaseFileIcon,
  sqlite3: DatabaseFileIcon,
  csv: CsvFileIcon,
  tsv: CsvFileIcon,
  txt: TextFileIcon,
  text: TextFileIcon,
  log: TextFileIcon,
  rtf: TextFileIcon,
  pdf: PdfFileIcon,
  zip: ArchiveFileIcon,
  tar: ArchiveFileIcon,
  gz: ArchiveFileIcon,
  tgz: ArchiveFileIcon,
  bz2: ArchiveFileIcon,
  xz: ArchiveFileIcon,
  rar: ArchiveFileIcon,
  "7z": ArchiveFileIcon,
  woff: FontFileIcon,
  woff2: FontFileIcon,
  ttf: FontFileIcon,
  otf: FontFileIcon,
  eot: FontFileIcon,
  mp4: VideoFileIcon,
  mov: VideoFileIcon,
  webm: VideoFileIcon,
  mkv: VideoFileIcon,
  avi: VideoFileIcon,
  m4v: VideoFileIcon,
  mp3: AudioFileIcon,
  wav: AudioFileIcon,
  flac: AudioFileIcon,
  m4a: AudioFileIcon,
  ogg: AudioFileIcon,
  aac: AudioFileIcon,
  sh: ShellFileIcon,
  bash: ShellFileIcon,
  zsh: ShellFileIcon,
  fish: ShellFileIcon,
  env: EnvFileIcon,
  lock: LockFileIcon,
  lockb: LockFileIcon,
  graphql: GraphqlFileIcon,
  gql: GraphqlFileIcon,
};

const FILENAME_ICONS: Record<string, FileIconType> = {
  ".gitignore": GitFileIcon,
  ".gitattributes": GitFileIcon,
  ".gitmodules": GitFileIcon,
  "CLAUDE.md": ClaudeFileIcon,
  ".claude": ClaudeFileIcon,
  "package.json": NodeFileIcon,
  "package-lock.json": NodeFileIcon,
  ".nvmrc": NodeFileIcon,
  ".node-version": NodeFileIcon,
  ".npmrc": NodeFileIcon,
  "manifest.json": JsonFileIcon,
  "Dockerfile": DockerFileIcon,
  ".dockerignore": DockerFileIcon,
  // pnpm's files say `.yaml`, and its lockfile isn't a plain `.lock` — without
  // these they fall through to the YAML icon (and the lock/node ones are wrong
  // when the tool has a mark of its own).
  "pnpm-lock.yaml": PnpmFileIcon,
  "pnpm-workspace.yaml": PnpmFileIcon,
  ".pnpmfile.cjs": PnpmFileIcon,
  "Cargo.toml": RustFileIcon,
  "Gemfile": RubyFileIcon,
  "pyproject.toml": PythonFileIcon,
  "requirements.txt": PythonFileIcon,
};

/**
 * Config files that come in families (`tsconfig.main.json`, `vite.renderer
 * .config.mjs`, `drizzle.config.runtime.ts`, `.env.local`, `Dockerfile.dev`).
 * Matched only after an exact FILENAME_ICONS hit, so a specific name always
 * wins over its family.
 *
 * The variant segment appears on either side of `.config` depending on the
 * tool, hence the optional group before and after. Order matters where two
 * families share a prefix: vitest is tested before vite.
 */
const CONFIG = String.raw`(\..+)?\.config(\..+)?\.[cm]?[jt]s$`;

const FILENAME_PATTERNS: Array<[RegExp, FileIconType]> = [
  // `foo.test.ts` / `foo.spec.tsx` read as tests first and TS/React second —
  // without this they're indistinguishable from the file under test in a tree.
  [/\.(test|spec)\.[cm]?[jt]sx?$/, TestFileIcon],
  [/^\.eslintrc(\..+)?$/, EslintFileIcon],
  [new RegExp(`^eslint${CONFIG}`), EslintFileIcon],
  [/^tsconfig(\..+)?\.json$/, TsconfigFileIcon],
  [new RegExp(`^postcss${CONFIG}`), PostcssFileIcon],
  [new RegExp(`^tailwind${CONFIG}`), TailwindFileIcon],
  [new RegExp(`^(forge|electron\\.vite)${CONFIG}`), ElectronFileIcon],
  [new RegExp(`^vitest${CONFIG}`), VitestFileIcon],
  [new RegExp(`^vite${CONFIG}`), ViteFileIcon],
  [new RegExp(`^drizzle${CONFIG}`), DrizzleFileIcon],
  [new RegExp(`^next${CONFIG}`), NextFileIcon],
  [/^\.env(\..+)?$/, EnvFileIcon],
  [/^(docker-)?compose(\..+)?\.ya?ml$/, DockerFileIcon],
  [/^Dockerfile\..+$/, DockerFileIcon],
  [/^(LICENSE|LICENCE|COPYING)(\..+)?$/i, LicenseFileIcon],
];

const EXTENSION_COLORS: Record<string, string> = {
  js: "text-warning",
  jsx: "text-warning",
  ts: "text-accent",
  tsx: "text-accent",
  mjs: "text-warning",
  cjs: "text-warning",
  html: "text-warning",
  htm: "text-warning",
  css: "text-accent",
  scss: "text-pink-400",
  sass: "text-pink-400",
  less: "text-accent",
  json: "text-warning",
  yaml: "text-danger",
  yml: "text-danger",
  xml: "text-warning",
  toml: "text-primary-600 dark:text-primary-400",
  md: "text-accent",
  mdx: "text-accent",
  txt: "text-primary-600 dark:text-primary-400",
  rst: "text-primary-600 dark:text-primary-400",
  py: "text-success",
  rb: "text-danger",
  go: "text-accent",
  rs: "text-warning",
  java: "text-danger",
  kt: "text-purple-400",
  swift: "text-warning",
  c: "text-accent",
  cpp: "text-accent",
  h: "text-purple-400",
  hpp: "text-purple-400",
  cs: "text-success",
  php: "text-indigo-400",
  sh: "text-success",
  bash: "text-success",
  zsh: "text-success",
  fish: "text-success",
  png: "text-purple-400",
  jpg: "text-purple-400",
  jpeg: "text-purple-400",
  gif: "text-purple-400",
  svg: "text-warning",
  ico: "text-purple-400",
  webp: "text-purple-400",
  pdf: "text-danger",
  zip: "text-warning",
  tar: "text-warning",
  gz: "text-warning",
  env: "text-warning",
  lock: "text-primary-500 dark:text-primary-500",
  gitignore: "text-primary-500 dark:text-primary-500",
};

/**
 * Pick the dedicated icon for a file, or null when only the generic page glyph
 * (tinted by EXTENSION_COLORS) applies. Resolution order is exact filename →
 * filename family → extension: `tsconfig.json` must not lose to `.json`.
 */
export function resolveFileIcon(
  fileName?: string,
  extension?: string,
): FileIconType | null {
  if (fileName) {
    const exact = FILENAME_ICONS[fileName];
    if (exact) return exact;
    const patterned = FILENAME_PATTERNS.find(([re]) => re.test(fileName));
    if (patterned) return patterned[1];
  }
  if (extension) {
    const byExtension = EXTENSION_ICONS[extension.toLowerCase()];
    if (byExtension) return byExtension;
  }
  return null;
}

interface IconProps {
  className?: string;
}

export const FileIcon = memo(function FileIcon({ className = "" }: IconProps) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3.5 1.5A1.5 1.5 0 015 0h4.379a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 01.439 1.061V14.5a1.5 1.5 0 01-1.5 1.5H5a1.5 1.5 0 01-1.5-1.5v-13z"
        fill="currentColor"
      />
    </svg>
  );
});

interface FileIconComponentProps {
  extension?: string;
  fileName?: string;
  isDirectory?: boolean;
  isExpanded?: boolean;
  className?: string;
}

export const FileIconComponent = memo(function FileIconComponent({
  extension,
  fileName,
  isDirectory,
  isExpanded,
  className = "",
}: FileIconComponentProps) {
  if (isDirectory) {
    const colorClass = "text-warning";
    if (isExpanded) {
      return <FolderOpenIcon className={`${colorClass} ${className}`} />;
    }
    return <FolderIcon className={`${colorClass} ${className}`} />;
  }

  const Resolved = resolveFileIcon(fileName, extension);
  if (Resolved) {
    return <Resolved className={className} />;
  }

    const colorClass = extension
    ? EXTENSION_COLORS[extension.toLowerCase()] || "text-primary-600 dark:text-primary-400"
    : "text-primary-600 dark:text-primary-400";

  return <FileIcon className={`${colorClass} ${className}`} />;
});
