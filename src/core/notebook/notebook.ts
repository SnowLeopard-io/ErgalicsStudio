// ==========================================================================
// Ergalics Studio — notebook model (pure TS, data layer)
//
// A notebook is a flat list of markdown/code cells persisted in
// `project.state.notebook`. Execution semantics live in notebookStore (the
// Pyodide runtime is stateful and page-scoped); this module holds the cell
// model, output model and a small, safe markdown renderer.
// ==========================================================================

export type NotebookCellType = 'md' | 'code';

export type NotebookCellOutput =
  | { kind: 'stdout'; text: string }
  | { kind: 'stderr'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'vars'; entries: Array<{ name: string; preview: string }> };

export interface NotebookCell {
  id: string;
  type: NotebookCellType;
  source: string;
  outputs: NotebookCellOutput[];
  /** True when the last execution succeeded (undefined = never run). */
  ok?: boolean;
  /** Last execution duration in ms. */
  durationMs?: number;
}

export interface NotebookState {
  cells: NotebookCell[];
}

export function emptyNotebook(): NotebookState {
  return { cells: [] };
}

export function createCell(type: NotebookCellType, source = ''): NotebookCell {
  return {
    id: crypto.randomUUID(),
    type,
    source,
    outputs: [],
  };
}

/** Create a notebook pre-seeded with a markdown + code starter pair. */
export function starterNotebook(): NotebookState {
  return {
    cells: [
      createCell('md', '# Notebook\n\nMixed **markdown** and runnable Python cells.'),
      createCell('code', 'x = [1, 2, 3]\nsum(x)'),
    ],
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Markdown cells render with dangerouslySetInnerHTML and notebooks can be
 * shared inside project files, so a link target must not carry an active
 * scheme (javascript:, data:, vbscript:…). Only http/https/mailto and
 * relative/anchor links pass; anything else renders as plain label text.
 */
function isSafeUrl(url: string): boolean {
  if (url.startsWith('#') || url.startsWith('/')) return true;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  if (!m) return true; // relative URL without a scheme
  return ['http', 'https', 'mailto'].includes(m[1]!.toLowerCase());
}

function inlineMarkdown(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
      isSafeUrl(url)
        ? `<a href="${url}" rel="noopener noreferrer">${label}</a>`
        : label,
    );
}

/**
 * Lightweight, dependency-free markdown → HTML for notebook markdown cells.
 * HTML in the source is always escaped first; supports fenced code blocks,
 * headings, unordered lists, blockquotes, inline code/bold/italic and links.
 */
export function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  let codeBuf: string[] = [];
  let listBuf: string[] = [];

  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(`<ul>${listBuf.map((li) => `<li>${inlineMarkdown(li)}</li>`).join('')}</ul>`);
    listBuf = [];
  };

  for (const raw of lines) {
    const fence = /^\s*```(\w*)\s*$/.exec(raw);
    if (fence) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        inCode = false;
        codeBuf = [];
        codeLang = '';
      } else {
        flushList();
        inCode = true;
        codeLang = fence[1] ?? '';
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(raw);
    if (heading) {
      flushList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (bullet) {
      listBuf.push(bullet[1]!);
      continue;
    }
    flushList();

    const quote = /^\s*>\s?(.*)$/.exec(raw);
    if (quote) {
      out.push(`<blockquote>${inlineMarkdown(quote[1]!)}</blockquote>`);
      continue;
    }

    if (raw.trim() === '') {
      continue;
    }
    out.push(`<p>${inlineMarkdown(raw)}</p>`);
  }
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  flushList();
  void codeLang;
  return out.join('\n');
}
