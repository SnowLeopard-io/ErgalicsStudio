// ==========================================================================
// Ergalics Studio — citation styles, CITATION.cff, DOI metadata and graphs
//
// Pure TS. Styles are rendered from the same normalised BibEntry model used by
// the LaTeX editor, so the manuscript bibliography and the Citation Manager
// can never disagree. DOI resolution uses the CSL-JSON content negotiation
// endpoint (`doi.org` → Crossref/DataCite); `fetch` is injectable for tests
// and for environments that route through a CORS proxy.
// ==========================================================================

import {
  entryAuthors,
  normalizeDoi,
  parseAuthor,
  type BibAuthor,
  type BibEntry,
} from './bibtex';

export type CitationStyle =
  | 'apa'
  | 'mla'
  | 'chicago'
  | 'ieee'
  | 'vancouver'
  | 'nature'
  | 'science';

export interface CitationStyleDef {
  id: CitationStyle;
  label: string;
  /** Alphabetical bibliographies sort by author; numeric ones keep order. */
  alphabetical: boolean;
}

export const CITATION_STYLES: CitationStyleDef[] = [
  { id: 'apa', label: 'APA 7th', alphabetical: true },
  { id: 'mla', label: 'MLA 9th', alphabetical: true },
  { id: 'chicago', label: 'Chicago 17th', alphabetical: true },
  { id: 'ieee', label: 'IEEE', alphabetical: false },
  { id: 'vancouver', label: 'Vancouver', alphabetical: false },
  { id: 'nature', label: 'Nature', alphabetical: true },
  { id: 'science', label: 'Science', alphabetical: true },
];

function ascii(s: string): string {
  return s.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function initials(given: string): string {
  return given
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}.`)
    .join(' ');
}

function compactInitials(given: string): string {
  return given
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((part) => (part[0] ?? '').toUpperCase())
    .join('');
}

function givenName(author: BibAuthor): string {
  return ascii(author.given);
}

function family(author: BibAuthor): string {
  return ascii(author.family);
}

function apaAuthors(authors: BibAuthor[]): string {
  if (authors.length === 0) return '';
  const names = authors.map((a) => {
    const ini = initials(givenName(a));
    return ini ? `${family(a)}, ${ini}` : family(a);
  });
  if (names.length === 1) return names[0] ?? '';
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(', ')}, & ${last}`;
}

function mlaAuthors(authors: BibAuthor[]): string {
  if (authors.length === 0) return '';
  const first = authors[0]!;
  const head = givenName(first) ? `${family(first)}, ${givenName(first)}` : family(first);
  if (authors.length === 1) return head;
  if (authors.length === 2) return `${head}, and ${givenName(authors[1]!)} ${family(authors[1]!)}`.trim();
  return `${head}, et al.`;
}

function chicagoAuthors(authors: BibAuthor[]): string {
  return mlaAuthors(authors);
}

function ieeeAuthors(authors: BibAuthor[]): string {
  if (authors.length === 0) return '';
  const names = authors.map((a) => {
    const ini = initials(givenName(a));
    return ini ? `${ini} ${family(a)}` : family(a);
  });
  if (names.length === 1) return names[0] ?? '';
  if (names.length <= 6) return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  return `${names[0]} et al.`;
}

function vancouverAuthors(authors: BibAuthor[]): string {
  if (authors.length === 0) return '';
  return authors
    .slice(0, 6)
    .map((a) => `${family(a)} ${compactInitials(givenName(a))}`.trim())
    .join(', ') + (authors.length > 6 ? ', et al' : '');
}

function natureAuthors(authors: BibAuthor[]): string {
  if (authors.length === 0) return '';
  const names = authors.map((a) => {
    const ini = initials(givenName(a));
    return ini ? `${family(a)}, ${ini}` : family(a);
  });
  if (names.length === 1) return names[0] ?? '';
  if (names.length <= 5) return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  return `${names[0]} et al.`;
}

function scienceAuthors(authors: BibAuthor[]): string {
  if (authors.length === 0) return '';
  const names = authors.map((a) => {
    const ini = initials(givenName(a));
    return ini ? `${family(a)}, ${ini}` : family(a);
  });
  if (names.length === 1) return names[0] ?? '';
  if (names.length <= 5) return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  return `${names[0]}, et al.`;
}

function tidyPages(pages: string | undefined): string {
  return (pages ?? '').replace(/--/g, '–').replace(/\s+/g, '');
}

function doiLine(fields: Record<string, string>): string {
  const doi = fields.doi ? normalizeDoi(fields.doi) : '';
  return doi ? `https://doi.org/${doi}` : fields.url ?? '';
}

function sentence(text: string | undefined): string {
  const value = ascii(text ?? '');
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function yearOf(entry: BibEntry): string {
  return ascii(entry.fields.year ?? entry.fields.date ?? '').slice(0, 4);
}

function journalOf(entry: BibEntry): string {
  return ascii(entry.fields.journal ?? entry.fields.booktitle ?? entry.fields.publisher ?? '');
}

export interface CitationFormatOptions {
  /** 1-based citation number, used by IEEE/Vancouver. */
  index?: number;
}

/** Format one entry in the requested style (plain text, no markup). */
export function formatCitation(
  entry: BibEntry,
  style: CitationStyle,
  options: CitationFormatOptions = {},
): string {
  const fields = entry.fields;
  const authors = entryAuthors(entry);
  const title = ascii(fields.title ?? '');
  const year = yearOf(entry);
  const journal = journalOf(entry);
  const volume = ascii(fields.volume ?? '');
  const issue = ascii(fields.number ?? fields.issue ?? '');
  const pages = tidyPages(fields.pages);
  const doi = doiLine(fields);
  const isBook = ['book', 'monograph', 'thesis', 'phdthesis', 'mastersthesis'].includes(entry.type);
  const isProceedings = ['inproceedings', 'conference', 'proceedings'].includes(entry.type);

  switch (style) {
    case 'apa': {
      const author = apaAuthors(authors);
      const head = [author, year ? `(${year}).` : ''].filter(Boolean).join(' ');
      const container = isBook
        ? [ascii(fields.publisher ?? ''), doi].filter(Boolean).join('. ')
        : isProceedings
          ? [`In ${journal}${pages ? ` (pp. ${pages})` : ''}`, ascii(fields.publisher ?? ''), doi]
              .filter(Boolean)
              .join('. ')
          : [
              [journal, volume && `${volume}${issue ? `(${issue})` : ''}`, pages].filter(Boolean).join(', '),
              doi,
            ]
              .filter(Boolean)
              .join('. ');
      return [head, sentence(title), container ? (container.endsWith('.') ? container : `${container}.`) : '']
        .filter(Boolean)
        .join(' ')
        .trim();
    }
    case 'mla': {
      const author = mlaAuthors(authors);
      const source = isBook
        ? [ascii(fields.publisher ?? ''), year].filter(Boolean).join(', ')
        : [
            journal,
            volume ? `vol. ${volume}` : '',
            issue ? `no. ${issue}` : '',
            year,
            pages ? `pp. ${pages}` : '',
          ]
            .filter(Boolean)
            .join(', ');
      return [author ? `${author}.` : '', `"${sentence(title).replace(/\.$/, '')}."`, `${source}.`, doi]
        .filter(Boolean)
        .join(' ')
        .trim();
    }
    case 'chicago': {
      const author = chicagoAuthors(authors);
      if (isBook) {
        return [author ? `${author}.` : '', `${sentence(title)}`, `${ascii(fields.publisher ?? '')}, ${year}.`, doi]
          .filter(Boolean)
          .join(' ')
          .trim();
      }
      const source = [journal, volume ? `${volume}` : '', issue ? `no. ${issue}` : '', year ? `(${year})` : '', pages ? `: ${pages}` : '']
        .filter(Boolean)
        .join(' ')
        .replace(/\s+:/g, ':');
      return [author ? `${author}.` : '', `"${sentence(title).replace(/\.$/, '')}."`, `${source}.`, doi]
        .filter(Boolean)
        .join(' ')
        .trim();
    }
    case 'ieee': {
      const n = options.index ?? 1;
      const author = ieeeAuthors(authors);
      if (isBook) {
        return `[${n}] ${author}${author ? ', ' : ''}${sentence(title)} ${ascii(fields.publisher ?? '')}, ${year}.`;
      }
      if (isProceedings) {
        return `[${n}] ${author}${author ? ', ' : ''}"${sentence(title).replace(/\.$/, '')}," in ${journal}, ${year}${pages ? `, pp. ${pages}` : ''}.`;
      }
      return `[${n}] ${author}${author ? ', ' : ''}"${sentence(title).replace(/\.$/, '')}," ${journal}${volume ? `, vol. ${volume}` : ''}${issue ? `, no. ${issue}` : ''}${pages ? `, pp. ${pages}` : ''}, ${year}.`;
    }
    case 'vancouver': {
      const n = options.index ?? 1;
      const author = vancouverAuthors(authors);
      if (isBook) {
        return `${n}. ${author}${author ? '. ' : ''}${sentence(title)} ${ascii(fields.publisher ?? '')}; ${year}.`;
      }
      return `${n}. ${author}${author ? '. ' : ''}${sentence(title)} ${journal}. ${year};${volume}${issue ? `(${issue})` : ''}${pages ? `:${pages}` : ''}.`;
    }
    case 'nature': {
      const author = natureAuthors(authors);
      if (isBook) {
        return `${author}${author ? '. ' : ''}${sentence(title)} ${ascii(fields.publisher ?? '')} (${year}).`;
      }
      return `${author}${author ? '. ' : ''}${sentence(title)} ${journal}${volume ? ` ${volume}` : ''}${pages ? `, ${pages}` : ''} (${year}).${doi ? ` ${doi}` : ''}`;
    }
    case 'science': {
      const author = scienceAuthors(authors);
      if (isBook) {
        return `${author}${author ? '. ' : ''}${sentence(title)} ${ascii(fields.publisher ?? '')} (${year}).`;
      }
      return `${author}${author ? '. ' : ''}${sentence(title)} ${journal}${volume ? ` ${volume}` : ''}${pages ? `, ${pages}` : ''} (${year}).${doi ? ` ${doi}` : ''}`;
    }
  }
}

function sortKey(entry: BibEntry): string {
  const first = entryAuthors(entry)[0];
  return `${(first?.family ?? 'zzz').toLowerCase()} ${entry.fields.year ?? ''} ${(entry.fields.title ?? '').toLowerCase()}`;
}

/** Order entries for a bibliography in the given style. */
export function sortForStyle(entries: BibEntry[], style: CitationStyle): BibEntry[] {
  const def = CITATION_STYLES.find((s) => s.id === style);
  return def?.alphabetical ? [...entries].sort((a, b) => sortKey(a).localeCompare(sortKey(b))) : [...entries];
}

/** Render a full bibliography. */
export function formatBibliography(entries: BibEntry[], style: CitationStyle): string[] {
  return sortForStyle(entries, style).map((entry, i) =>
    formatCitation(entry, style, { index: i + 1 }),
  );
}

// --------------------------------------------------------------------------
// CITATION.cff (subset of CFF 1.2 used by software archives)
// --------------------------------------------------------------------------

export interface CitationCff {
  cffVersion: string;
  message: string;
  title: string;
  authors: BibAuthor[];
  year?: string;
  version?: string;
  doi?: string;
  url?: string;
  repositoryCode?: string;
  license?: string;
  abstract?: string;
}

function yamlScalar(raw: string): string {
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

/** Parse the small YAML subset emitted by GitHub's CITATION.cff generator. */
export function parseCitationCff(src: string): CitationCff {
  const result: CitationCff = {
    cffVersion: '1.2.0',
    message: 'If you use this software, please cite it as below.',
    title: '',
    authors: [],
  };
  const lines = src.split(/\r?\n/);
  let inAuthors = false;
  let current: Partial<BibAuthor> | null = null;
  const flush = () => {
    if (current && (current.family || current.given)) {
      result.authors.push({
        family: current.family ?? '',
        given: current.given ?? '',
      });
    }
    current = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^authors\s*:/.test(trimmed)) { inAuthors = true; flush(); continue; }
    if (inAuthors) {
      const item = /^-\s*(.*)$/.exec(trimmed);
      if (item) {
        flush();
        current = {};
        const rest = item[1] ?? '';
        const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(rest);
        if (kv) assignCffAuthor(current, kv[1]!, kv[2]!);
        continue;
      }
      if (/^\s+/.test(line)) {
        if (!current) current = {};
        const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(trimmed);
        if (kv) assignCffAuthor(current, kv[1]!, kv[2]!);
        continue;
      }
      inAuthors = false;
      flush();
    }
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1]!;
    const value = yamlScalar(kv[2]!);
    switch (key) {
      case 'cff-version': result.cffVersion = value || result.cffVersion; break;
      case 'message': result.message = value; break;
      case 'title': result.title = value; break;
      case 'year': result.year = value; break;
      case 'version': result.version = value; break;
      case 'doi': result.doi = value; break;
      case 'url': result.url = value; break;
      case 'repository-code': result.repositoryCode = value; break;
      case 'license': result.license = value; break;
      case 'abstract': result.abstract = value; break;
      default: break;
    }
  }
  flush();
  return result;
}

function assignCffAuthor(target: Partial<BibAuthor>, key: string, raw: string): void {
  const value = yamlScalar(raw);
  if (key === 'family-names') target.family = value;
  else if (key === 'given-names') target.given = value;
}

function yamlQuote(value: string): string {
  if (!value) return '""';
  return /[:#'"[\]{}]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
}

/** Serialise a CitationCff to YAML. */
export function toCitationCff(cff: CitationCff): string {
  const lines = [
    `cff-version: ${cff.cffVersion || '1.2.0'}`,
    `message: ${yamlQuote(cff.message)}`,
    `title: ${yamlQuote(cff.title)}`,
  ];
  if (cff.authors.length > 0) {
    lines.push('authors:');
    for (const author of cff.authors) {
      lines.push(`  - family-names: ${yamlQuote(author.family)}`);
      if (author.given) lines.push(`    given-names: ${yamlQuote(author.given)}`);
    }
  }
  if (cff.year) lines.push(`year: ${cff.year}`);
  if (cff.version) lines.push(`version: ${yamlQuote(cff.version)}`);
  if (cff.doi) lines.push(`doi: ${yamlQuote(cff.doi)}`);
  if (cff.url) lines.push(`url: ${yamlQuote(cff.url)}`);
  if (cff.repositoryCode) lines.push(`repository-code: ${yamlQuote(cff.repositoryCode)}`);
  if (cff.license) lines.push(`license: ${yamlQuote(cff.license)}`);
  if (cff.abstract) lines.push(`abstract: ${yamlQuote(cff.abstract)}`);
  return `${lines.join('\n')}\n`;
}

/** Convert a software CITATION.cff into a BibTeX `@software` entry. */
export function cffToBibEntry(cff: CitationCff, key = 'software'): BibEntry {
  const fields: Record<string, string> = {
    title: cff.title,
    author: cff.authors
      .map((a) => `${a.family}${a.given ? `, ${a.given}` : ''}`)
      .join(' and '),
  };
  if (cff.year) fields.year = cff.year;
  if (cff.version) fields.version = cff.version;
  if (cff.doi) fields.doi = cff.doi;
  if (cff.url ?? cff.repositoryCode) fields.url = cff.url ?? cff.repositoryCode ?? '';
  if (cff.license) fields.note = `License: ${cff.license}`;
  return { type: 'software', key, fields };
}

// --------------------------------------------------------------------------
// DOI → CSL-JSON → BibEntry
// --------------------------------------------------------------------------

export interface CslAuthor { given?: string; family?: string; literal?: string }

export interface CslItem {
  DOI?: string;
  title?: string | string[];
  author?: CslAuthor[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string | string[];
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  type?: string;
  URL?: string;
  ISBN?: string;
}

function firstString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

const CSL_TYPE_MAP: Record<string, string> = {
  'article-journal': 'article',
  'article-magazine': 'article',
  'article-newspaper': 'article',
  book: 'book',
  monograph: 'book',
  'paper-conference': 'inproceedings',
  'chapter': 'incollection',
  thesis: 'phdthesis',
  software: 'software',
  dataset: 'misc',
  report: 'techreport',
};

/** Map Crossref/DataCite CSL-JSON to the internal BibEntry model. */
export function cslToBibEntry(item: CslItem, fallbackKey?: string): BibEntry {
  const fields: Record<string, string> = {};
  const title = firstString(item.title);
  if (title) fields.title = title;
  const authors = (item.author ?? [])
    .map((a) => {
      if (a.literal) return a.literal;
      if (a.family && a.given) return `${a.family}, ${a.given}`;
      return a.family ?? a.given ?? '';
    })
    .filter(Boolean);
  if (authors.length > 0) fields.author = authors.join(' and ');
  const year = item.issued?.['date-parts']?.[0]?.[0];
  if (year) fields.year = String(year);
  const container = firstString(item['container-title']);
  if (container) fields.journal = container;
  if (item.volume) fields.volume = item.volume;
  if (item.issue) fields.issue = item.issue;
  if (item.page) fields.pages = item.page;
  if (item.publisher) fields.publisher = item.publisher;
  if (item.DOI) fields.doi = normalizeDoi(item.DOI);
  if (item.URL) fields.url = item.URL;
  if (item.ISBN) fields.isbn = item.ISBN;
  const type = CSL_TYPE_MAP[item.type ?? ''] ?? 'misc';
  return {
    type,
    key: fallbackKey ?? makeKeyFromFields(fields),
    fields,
  };
}

function makeKeyFromFields(fields: Record<string, string>): string {
  const first = (fields.author ?? '').split(' and ')[0] ?? '';
  const family = parseAuthor(first).family.replace(/[^A-Za-z]/g, '') || 'ref';
  const year = (fields.year ?? '').slice(0, 4) || 'nd';
  const word = (fields.title ?? '').split(/\s+/).find((w) => w.length > 3) ?? 'work';
  return `${family}${year}${word.replace(/[^A-Za-z]/g, '').toLowerCase()}`;
}

/** Fetch CSL-JSON for a DOI via doi.org content negotiation. */
export async function fetchDoiMetadata(
  doi: string,
  fetcher: typeof fetch = fetch,
): Promise<BibEntry> {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new Error('Empty DOI');
  const res = await fetcher(`https://doi.org/${encodeURIComponent(normalized)}`, {
    headers: { Accept: 'application/vnd.citationstyles.csl+json' },
  });
  if (!res.ok) throw new Error(`DOI lookup failed (${res.status})`);
  const item = (await res.json()) as CslItem;
  return cslToBibEntry(item);
}

// --------------------------------------------------------------------------
// Statistics and reference graph
// --------------------------------------------------------------------------

export interface CitationStats {
  total: number;
  byType: Record<string, number>;
  byYear: Array<{ year: string; count: number }>;
  earliestYear?: string;
  latestYear?: string;
}

/** Aggregate counts used by the Citation Manager dashboard. */
export function citationStats(entries: BibEntry[]): CitationStats {
  const byType: Record<string, number> = {};
  const years = new Map<string, number>();
  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    const year = yearOf(entry);
    if (year) years.set(year, (years.get(year) ?? 0) + 1);
  }
  const byYear = [...years.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, count]) => ({ year, count }));
  return {
    total: entries.length,
    byType,
    byYear,
    earliestYear: byYear[0]?.year,
    latestYear: byYear[byYear.length - 1]?.year,
  };
}

export interface ReferenceGraphNode {
  key: string;
  label: string;
  /** Number of incoming citations inside the library. */
  citedBy: number;
  /** Number of outgoing references inside the library. */
  references: number;
}

export interface ReferenceGraphEdge {
  from: string;
  to: string;
}

export interface ReferenceGraph {
  nodes: ReferenceGraphNode[];
  edges: ReferenceGraphEdge[];
}

function referenceKeys(entry: BibEntry): string[] {
  const raw = entry.fields.references ?? entry.fields.cites ?? '';
  return raw
    .split(/[;,\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Build the in-library citation graph. Edge direction is "citing → cited".
 * `extra` lets the UI merge relationships fetched elsewhere (e.g. a cited-by
 * export) without mutating the entries.
 */
export function buildReferenceGraph(
  entries: BibEntry[],
  extra: ReferenceGraphEdge[] = [],
): ReferenceGraph {
  const known = new Set(entries.map((e) => e.key));
  const edges: ReferenceGraphEdge[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string) => {
    if (!known.has(from) || !known.has(to) || from === to) return;
    const id = `${from}\u0000${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ from, to });
  };
  for (const entry of entries) {
    for (const target of referenceKeys(entry)) add(entry.key, target);
  }
  for (const edge of extra) add(edge.from, edge.to);

  const nodes = entries.map((entry) => {
    const author = entryAuthors(entry)[0]?.family ?? entry.key;
    const year = yearOf(entry);
    return {
      key: entry.key,
      label: `${author}${year ? ` ${year}` : ''}`,
      citedBy: edges.filter((e) => e.to === entry.key).length,
      references: edges.filter((e) => e.from === entry.key).length,
    };
  });
  return { nodes, edges };
}

/** Most-cited entries first (ties broken by key). */
export function topCited(graph: ReferenceGraph, limit = 5): ReferenceGraphNode[] {
  return [...graph.nodes]
    .sort((a, b) => b.citedBy - a.citedBy || a.key.localeCompare(b.key))
    .slice(0, limit);
}
