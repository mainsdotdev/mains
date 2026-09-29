/**
 * Content search under one directory — `fileExplorer:searchText`. The backend
 * runs ripgrep, so `.gitignore` rules apply and binary files are skipped.
 */
export interface TextSearchQuery {
  rootPath: string;
  query: string;
  /** Match letter case exactly. Off: case-insensitive. */
  caseSensitive?: boolean;
  /** Only match whole words. */
  wholeWord?: boolean;
  /** Read `query` as a regular expression (Rust regex syntax). Off: literal text. */
  regex?: boolean;
  /** Search dotfiles and dot-directories too. Default true. */
  includeHidden?: boolean;
  /** Matching lines to collect before stopping. Clamped by the backend. */
  maxResults?: number;
  /**
   * A later search carrying the same key cancels this one while it is still
   * running, so a caller that searches as the user types never stacks
   * searches behind each other. The cancelled call resolves with what it had.
   */
  cancelKey?: string;
}

/** A span of one line: zero-based UTF-16 offsets, end exclusive. */
export interface TextSearchRange {
  start: number;
  end: number;
}

/** One line with at least one match. */
export interface TextSearchLineMatch {
  /** One-based line number. */
  line: number;
  /**
   * The line's text without its indentation, cut to a window around its
   * first match when the match sits far to the right or the line is long.
   */
  preview: string;
  /** Where `preview` begins in the full line. */
  previewStart: number;
  /** True when text before `previewStart` was cut — more than indentation. */
  previewClipped: boolean;
  /** Every match on the line, in full-line offsets. */
  ranges: TextSearchRange[];
}

export interface TextSearchFileMatch {
  fullPath: string;
  /** Path below the searched root, `/`-separated. */
  relativePath: string;
  lines: TextSearchLineMatch[];
}

export interface TextSearchResult {
  /** Files sorted by `relativePath`. */
  files: TextSearchFileMatch[];
  /** Matches across every line — a line can hold several. */
  matchCount: number;
  /** True when the line cap, the time limit, or a newer search cut this one short. */
  truncated: boolean;
}
