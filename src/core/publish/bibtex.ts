// ==========================================================================
// Ergalics Studio — BibTeX parsing, author names and duplicate detection
//
// Pure TS, no DOM. The parser accepts the conventions BibTeX itself accepts:
// `@type{key, field = {value}}`, parenthesised entries, quoted values,
// brace-protected capitalisation and `#` concatenation. It is deliberately
// tolerant of malformed input (a broken trailing entry is skipped rather than
// throwing) because users paste BibTeX from many sources.
// ==========================================================================

export interface BibEntry {
  /** Lower-cased entry type (article, book, inproceedings, software, …). */
  type: string;
  /** Citation key. */
  key: string;
  /** Field names are lower-cased; values keep their inner braces. */
  fields: Record<string, string>;
}

export interface BibAuthor {
  given: string;
  family: string;
}

const KNOWN_KEYS = ['author', 'title', 'year', 'journal', 'booktitle', 'publisher', 'doi', 'url'];

/** Fields whose values are emitted before the rest (stable, readable output). */
const FIELD_ORDER = [
  'author', 'editor', 'title', 'journal', 'booktitle', 'publisher',
  'school', 'institution', 'year', 'volume', 'number', 'pages',
  'doi', 'url', 'note',
];

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/** Index of the delimiter matching the opener at `open` (brace/paren aware). */
function findMatching(src: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  let inQuote = false;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '"' && opener === '{') inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripOuterBraces(value: string): string {
  let v = value.trim();
  // A value may be `{...} # {...}`; concatenation is handled by the caller.
  while (v.startsWith('{') && v.endsWith('}') && findMatching(v, 0, '{', '}') === v.length - 1) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function cleanValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Parse a single `name = value` field starting at `pos`. */
function parseField(src: string, pos: number): { name: string; value: string; next: number } | null {
  let i = pos;
  while (i < src.length && (isSpace(src[i]) || src[i] === ',')) i += 1;
  if (i >= src.length) return null;
  const eq = src.indexOf('=', i);
  if (eq < 0) return null;
  const name = src.slice(i, eq).trim().toLowerCase();
  if (!name) return null;
  i = eq + 1;
  let value = '';
  while (true) {
    while (i < src.length && isSpace(src[i])) i += 1;
    if (i >= src.length) break;
    const ch = src[i]!;
    if (ch === '{') {
      const end = findMatching(src, i, '{', '}');
      if (end < 0) return null;
      value += stripOuterBraces(src.slice(i, end + 1));
      i = end + 1;
    } else if (ch === '"') {
      let j = i + 1;
      let out = '';
      while (j < src.length) {
        if (src[j] === '\\') { out += src[j]! + (src[j + 1] ?? ''); j += 2; continue; }
        if (src[j] === '"') break;
        out += src[j]!;
        j += 1;
      }
      value += out;
      i = j + 1;
    } else {
      let j = i;
      while (j < src.length && src[j] !== ',' && src[j] !== '#') j += 1;
      value += src.slice(i, j).trim();
      i = j;
    }
    while (i < src.length && isSpace(src[i])) i += 1;
    if (src[i] === '#') { i += 1; continue; }
    break;
  }
  return { name, value: cleanValue(value), next: i };
}

function parseEntryBody(type: string, body: string): BibEntry {
  const comma = body.indexOf(',');
  const key = (comma < 0 ? body : body.slice(0, comma)).trim();
  const fields: Record<string, string> = {};
  if (comma < 0) return { type, key, fields };
  let pos = comma + 1;
  while (pos < body.length) {
    const field = parseField(body, pos);
    if (!field) break;
    if (field.name && field.value !== '') fields[field.name] = field.value;
    if (field.next <= pos) break;
    pos = field.next;
  }
  return { type, key, fields };
}

/**
 * Parse every entry in a BibTeX source string. Tolerant of junk between
 * entries. `@string` macros are collected first and expanded in later entries
 * (BibTeX itself allows forward references, so this is a two-pass parse).
 */
export function parseBibtex(src: string): BibEntry[] {
  const raw: BibEntry[] = [];
  const macros = new Map<string, string>();
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('@', i);
    if (at < 0) break;
    let j = at + 1;
    while (j < src.length && /[A-Za-z]/.test(src[j]!)) j += 1;
    const type = src.slice(at + 1, j).toLowerCase();
    while (j < src.length && isSpace(src[j])) j += 1;
    const open = src[j];
    if (open !== '{' && open !== '(') { i = at + 1; continue; }
    const end = findMatching(src, j, open, open === '{' ? '}' : ')');
    if (end < 0) break;
    i = end + 1;
    if (!type || type === 'comment' || type === 'preamble') continue;
    const body = src.slice(j + 1, end);
    if (type === 'string') {
      const macro = parseField(body, 0);
      if (macro && macro.name) macros.set(macro.name, macro.value);
      continue;
    }
    const entry = parseEntryBody(type, body);
    if (entry.key) raw.push(entry);
  }
  for (const entry of raw) {
    for (const [name, value] of Object.entries(entry.fields)) {
      const macro = macros.get(value.toLowerCase());
      if (macro !== undefined) entry.fields[name] = macro;
    }
  }
  return raw;
}

/** Serialise entries back to canonical BibTeX. */
export function toBibtex(entries: BibEntry[]): string {
  return entries
    .map((entry) => {
      const names = Object.keys(entry.fields);
      const ordered = [
        ...FIELD_ORDER.filter((k) => names.includes(k)),
        ...names.filter((k) => !FIELD_ORDER.includes(k)).sort(),
      ];
      const fields = ordered
        .map((name) => `  ${name} = {${entry.fields[name] ?? ''}},`)
        .join('\n');
      return `@${entry.type}{${entry.key},\n${fields}\n}`;
    })
    .join('\n\n');
}

function bracesBalanced(value: string): boolean {
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Split an author field on top-level `and` separators. */
export function splitAuthors(field: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  const lower = field.toLowerCase();
  for (let i = 0; i < field.length; i += 1) {
    const ch = field[i]!;
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && lower.startsWith(' and ', i)) {
      parts.push(field.slice(start, i));
      i += 4;
      start = i + 1;
    }
  }
  parts.push(field.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parse one BibTeX name (`Last, First` or `First Last`). */
export function parseAuthor(raw: string): BibAuthor {
  const name = raw.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  if (name.includes(',')) {
    const [family = '', ...rest] = name.split(',');
    return { family: family.trim(), given: rest.join(',').trim() };
  }
  const tokens = name.split(' ');
  if (tokens.length <= 1) return { family: name, given: '' };
  const family = tokens.pop() ?? '';
  return { given: tokens.join(' '), family };
}

/** All authors of an entry, parsed. `and others` is ignored. */
export function entryAuthors(entry: BibEntry): BibAuthor[] {
  const raw = entry.fields.author ?? entry.fields.editor ?? '';
  return splitAuthors(raw)
    .filter((a) => a.toLowerCase() !== 'others')
    .map(parseAuthor)
    .filter((a) => a.family !== '');
}

/** Normalised DOI (`10.xxxx/...`, no URL prefix, lower-cased). */
export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeTitle(title: string): string {
  return title
    .replace(/[{}]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Stable comparison key used for duplicate detection. */
export function duplicateKey(entry: BibEntry): string {
  const doi = entry.fields.doi ? normalizeDoi(entry.fields.doi) : '';
  if (doi) return `doi:${doi}`;
  const title = normalizeTitle(entry.fields.title ?? '');
  if (title) return `title:${title}|${(entry.fields.year ?? '').trim()}`;
  return `key:${entry.key.trim().toLowerCase()}`;
}

/** Groups of entries that look like the same work (size ≥ 2). */
export function findDuplicateGroups(entries: BibEntry[]): BibEntry[][] {
  const groups = new Map<string, BibEntry[]>();
  for (const entry of entries) {
    const key = duplicateKey(entry);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function richerValue(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const av = a.trim();
  const bv = b.trim();
  // Prefer the value that carries more information, but never a malformed one.
  if (bracesBalanced(bv) && (!bracesBalanced(av) || bv.length > av.length)) return bv;
  return av;
}

/** Merge one duplicate group into a single entry (first key wins). */
export function mergeEntries(group: BibEntry[]): BibEntry {
  const [first] = group;
  if (!first) return { type: 'misc', key: 'unknown', fields: {} };
  const fields: Record<string, string> = {};
  for (const entry of group) {
    for (const [name, value] of Object.entries(entry.fields)) {
      fields[name] = richerValue(fields[name], value) ?? value;
    }
  }
  return { type: first.type, key: first.key, fields };
}

/** Deduplicate a library, preserving first-occurrence order. */
export function dedupeEntries(entries: BibEntry[]): BibEntry[] {
  const seen = new Map<string, BibEntry>();
  for (const entry of entries) {
    const key = duplicateKey(entry);
    const existing = seen.get(key);
    seen.set(key, existing ? mergeEntries([existing, entry]) : entry);
  }
  return [...seen.values()];
}

function slugKeyPart(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  return ascii || 'anon';
}

/** Generate a collision-free citation key (`familyYEARword`). */
export function makeCitationKey(entry: BibEntry, existing: Iterable<string> = []): string {
  const used = new Set([...existing].map((k) => k.toLowerCase()));
  const first = entryAuthors(entry)[0];
  const family = slugKeyPart(first?.family ?? entry.fields.publisher ?? entry.type);
  const year = (entry.fields.year ?? '').replace(/[^0-9]/g, '').slice(0, 4) || 'nd';
  const word = slugKeyPart((entry.fields.title ?? '').split(/\s+/).find((w) => w.length > 3) ?? entry.type);
  const base = `${family}${year}${word}`;
  let key = base;
  let n = 1;
  while (used.has(key.toLowerCase())) {
    n += 1;
    key = `${base}${n}`;
  }
  return key;
}

/** Human-facing one-line summary (used in lists and duplicate dialogs). */
export function entrySummary(entry: BibEntry): string {
  const authors = entryAuthors(entry);
  const names = authors.slice(0, 3).map((a) => a.family);
  if (authors.length > 3) names.push('et al.');
  const authorText = names.length > 0 ? `${names.join(', ')}. ` : '';
  const year = entry.fields.year ? ` (${entry.fields.year})` : '';
  const title = entry.fields.title ? `${entry.fields.title}.` : '';
  return `${authorText}${title}${year}`.trim();
}

/** Field names that participate in known-field ordering (exported for tests). */
export const BIB_KNOWN_KEYS = KNOWN_KEYS;
