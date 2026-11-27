// ==========================================================================
// Ergalics Studio — workspace file search (pure, injectable filesystem)
//
// The search panel walks the project workspace through the same Vfs the
// explorer uses, so results always match what the user sees (including
// unsaved-to-disk nothing — the tree is the source of truth). Text files are
// scanned line by line; binary formats are skipped by extension and a byte
// cap keeps a huge dataset from freezing the UI.
//
// Kept free of React/store imports so it can be unit-tested with a fake Vfs.
// ==========================================================================

import type { Vfs } from '@/core/vfs';
import type { VfsEntry } from '@/core/vfs';
import { isTextFile } from '@/core/workspace/file-classify';

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface SearchMatch {
  /** 1-based line number. */
  line: number;
  /** 1-based column of the first match character. */
  column: number;
  /** Single-line snippet (with ellipses when trimmed). */
  text: string;
  /** Offset of the match inside `text` (for highlighting). */
  highlightStart: number;
  /** Match length inside `text` (clamped to the snippet). */
  highlightLength: number;
}

export interface SearchFileResult {
  path: string;
  name: string;
  size: number;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: SearchFileResult[];
  /** Matches across all files. */
  total: number;
  /** True when the walk stopped at the result cap. */
  truncated: boolean;
  /** True when the query is not a valid regular expression. */
  invalidRegex: boolean;
}

/** Total matches shown across all files (the panel is not a database). */
export const SEARCH_MAX_MATCHES = 500;
/** Matches shown per file (one noisy log must not crowd out other files). */
export const SEARCH_MAX_MATCHES_PER_FILE = 50;
/** Files listed (each header costs vertical space). */
export const SEARCH_MAX_FILES = 120;
/** Files larger than this are skipped: likely data dumps, slow to scan. */
export const SEARCH_MAX_FILE_BYTES = 512 * 1024;

const EMPTY: SearchResult = {
  files: [],
  total: 0,
  truncated: false,
  invalidRegex: false,
};

/** Escape a literal query so it can be embedded in a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the scanning regex. Returns null for an invalid regex query (the
 * panel reports it instead of silently showing no results).
 */
export function buildSearchRegex(query: string, options: SearchOptions = {}): RegExp | null {
  let source = options.regex ? query : escapeRegExp(query);
  if (options.wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

/** Build a short snippet around one match on a line. */
function makeSnippet(
  line: string,
  index: number,
  length: number,
): { text: string; highlightStart: number; highlightLength: number } {
  const clean = line.replace(/\t/g, ' ').replace(/\s+$/, '');
  const clipped = Math.min(index, clean.length);
  let start = Math.max(0, clipped - 40);
  const end = Math.min(clean.length, clipped + length + 120);
  if (end - start > 200) start = Math.max(0, end - 200);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  const text = `${prefix}${clean.slice(start, end)}${suffix}`;
  const highlightStart = prefix.length + Math.max(0, clipped - start);
  const highlightLength = Math.min(length, Math.max(0, text.length - highlightStart - suffix.length));
  return { text, highlightStart, highlightLength };
}

/** Find every match in one file's text, capped per file. */
function matchText(text: string, re: RegExp): SearchMatch[] {
  const out: SearchMatch[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      const snippet = makeSnippet(line, match.index, match[0].length);
      out.push({
        line: i + 1,
        column: match.index + 1,
        ...snippet,
      });
      if (out.length >= SEARCH_MAX_MATCHES_PER_FILE) return out;
      // A zero-length match (e.g. regex `x*`) must advance or exec loops.
      if (match[0].length === 0) {
        re.lastIndex += 1;
        if (re.lastIndex > line.length) break;
      }
    }
  }
  return out;
}

/**
 * Walk the workspace and collect content matches. `root` is the project repo
 * path; paths in the result are workspace-relative with '/' separators.
 */
export async function searchWorkspace(
  fs: Pick<Vfs, 'readDir' | 'readFile'>,
  root: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  if (!query) return EMPTY;
  const re = buildSearchRegex(query, options);
  if (!re) return { ...EMPTY, invalidRegex: true };

  const files: SearchFileResult[] = [];
  let total = 0;
  let truncated = false;

  const walk = async (dir: string): Promise<void> => {
    if (total >= SEARCH_MAX_MATCHES || files.length >= SEARCH_MAX_FILES) {
      truncated = true;
      return;
    }
    let entries: VfsEntry[];
    try {
      entries = await fs.readDir(root, dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (total >= SEARCH_MAX_MATCHES || files.length >= SEARCH_MAX_FILES) {
        truncated = true;
        return;
      }
      if (entry.isDir) {
        // Version-control internals are noise and can be huge.
        if (entry.name === '.git') continue;
        await walk(entry.path);
        continue;
      }
      if (!isTextFile(entry.name) || entry.size > SEARCH_MAX_FILE_BYTES) continue;
      let text: string;
      try {
        text = await fs.readFile(root, entry.path);
      } catch {
        continue;
      }
      if (text.length > SEARCH_MAX_FILE_BYTES) continue;
      const matches = matchText(text, re);
      if (matches.length === 0) continue;
      files.push({ path: entry.path, name: entry.name, size: entry.size, matches });
      total += matches.length;
    }
  };

  await walk('');
  return { files, total, truncated, invalidRegex: false };
}
