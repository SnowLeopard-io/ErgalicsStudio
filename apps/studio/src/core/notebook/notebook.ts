// ==========================================================================
// Ergalics Studio — notebook model (pure TS, data layer)
//
// A notebook is a flat list of markdown/code cells persisted in
// `project.state.notebook`. Execution semantics live in notebookStore (the
// Pyodide runtime is stateful and page-scoped); this module holds the cell
// model, output model and the shared markdown renderer (marked + DOMPurify,
// with mermaid diagrams / TeX math emitted as placeholder nodes that
// `enhanceMarkdownDom` upgrades asynchronously).
// ==========================================================================

import { marked } from 'marked';
import DOMPurify from 'dompurify';

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

/** A mermaid diagram placeholder (upgraded asynchronously by enhanceMarkdownDom). */
function mermaidPlaceholder(code: string): string {
  return `\n<div class="md-mermaid" data-mermaid="${encodeURIComponent(code.trim())}"></div>\n`;
}

/** A TeX math placeholder (`display` = block-level math). */
function texPlaceholder(tex: string, display: boolean): string {
  return `<span class="md-tex" data-tex="${encodeURIComponent(tex.trim())}"${
    display ? ' data-display="1"' : ''
  }></span>`;
}

/**
 * Replace rich content (mermaid diagrams, TeX math, code) with raw HTML that
 * marked passes through untouched, so it can never be mangled by the markdown
 * parser and math payloads survive URI-encoded in data attributes.
 */
function extractRichTokens(src: string): string {
  // 1) Fenced code blocks — mermaid becomes a diagram placeholder, every other
  //    language re-emits as an escaped <pre><code> (bypassing marked, which is
  //    fine: the content is already HTML-escaped here).
  src = src.replace(
    /```([\w+#-]*)[^\S\n]*\n?([\s\S]*?)```/g,
    (_m, lang: string, code: string) => {
      if (lang.toLowerCase() === 'mermaid') return mermaidPlaceholder(code);
      const cls = lang ? ` class="language-${lang.toLowerCase()}"` : '';
      return `\n<pre><code${cls}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>\n`;
    },
  );
  // 2) Inline code spans — escaped now so math extraction can't touch them.
  src = src.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${escapeHtml(code)}</code>`);
  // 3) Display math: $$…$$ and \[…\]
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => ` ${texPlaceholder(tex, true)} `);
  src = src.replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => ` ${texPlaceholder(tex, true)} `);
  // 4) Inline math: \(…\) and $…$ (single-line; the opening $ must not be
  //    followed by whitespace and the closing $ must not sit inside a word,
  //    which keeps currency amounts like "$5 and $10" out of TeX).
  src = src.replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => texPlaceholder(tex, false));
  src = src.replace(/(^|[^\w$\\])\$([^$\n]+?)\$(?![\w$])/g, (_m, pre: string, tex: string) => {
    if (/^\s|\s$/.test(tex)) return _m;
    return `${pre}${texPlaceholder(tex, false)}`;
  });
  return src;
}

/**
 * Shared markdown → HTML renderer. Offline-friendly: marked (GFM tables,
 * task lists, strikethrough…) + DOMPurify sanitization run synchronously;
 * mermaid diagrams and TeX math are emitted as placeholder nodes that
 * `enhanceMarkdownDom()` upgrades in place (async render, lazy-loaded libs).
 * Raw HTML in the source is sanitized by DOMPurify (executable markup never
 * survives). Needs a DOM — only call from browser/jsdom contexts.
 */
let relHookInstalled = false;

export function mdToHtml(md: string): string {
  // One-time hook: every surviving <a> gets a rel so target=_blank-style
  // navigation never leaks the opener. Installed lazily so importing this
  // module in a DOM-less environment (plain node) stays harmless.
  if (!relHookInstalled && typeof document !== 'undefined') {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') node.setAttribute('rel', 'noopener noreferrer');
    });
    relHookInstalled = true;
  }
  const preprocessed = extractRichTokens(md);
  const parsed = marked.parse(preprocessed, { gfm: true, breaks: false }) as string;
  return DOMPurify.sanitize(parsed, { ADD_ATTR: ['data-mermaid', 'data-tex', 'data-display'] });
}
