// ==========================================================================
// Ergalics Studio — notebook tests (core)
//
// Cell model helpers, the mdToHtml renderer (escaping + supported syntax)
// and the project persistence round-trip.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  createCell,
  emptyNotebook,
  starterNotebook,
  mdToHtml,
} from '@/core/notebook/notebook';
import { createEmptyProject, deserializeProject, serializeProject } from '@/types/project';

describe('notebook cell model', () => {
  it('creates unique ids and empty outputs', () => {
    const a = createCell('code', '1 + 1');
    const b = createCell('md', '# hi');
    expect(a.id).not.toBe(b.id);
    expect(a.type).toBe('code');
    expect(a.source).toBe('1 + 1');
    expect(a.outputs).toEqual([]);
    expect(b.type).toBe('md');
  });

  it('empty + starter notebooks', () => {
    expect(emptyNotebook().cells).toEqual([]);
    const starter = starterNotebook();
    expect(starter.cells).toHaveLength(2);
    expect(starter.cells[0]!.type).toBe('md');
    expect(starter.cells[1]!.type).toBe('code');
  });
});

describe('mdToHtml — safety', () => {
  it('escapes raw HTML in markdown', () => {
    const html = mdToHtml('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });

  it('escapes HTML inside fenced code blocks', () => {
    const html = mdToHtml('```\n<script>alert(1)</script>\n```');
    expect(html).toContain('<pre><code>&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('mdToHtml — supported syntax', () => {
  it('renders headings, emphasis, inline code and links', () => {
    const html = mdToHtml('# Title\n\n**bold** and *em* and `code`\n\n[site](https://x.example)');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://x.example" rel="noopener noreferrer">site</a>');
  });

  it('renders fenced code, lists and blockquotes', () => {
    const html = mdToHtml('```python\nx = 1\n```\n\n- one\n- two\n\n> quoted');
    expect(html).toContain('<pre><code>x = 1</code></pre>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<blockquote>quoted</blockquote>');
  });

  it('auto-closes an unclosed fence and keeps plain paragraphs', () => {
    const html = mdToHtml('plain text\n```\nnever closed');
    expect(html).toContain('<p>plain text</p>');
    expect(html).toContain('<pre><code>never closed</code></pre>');
  });
});

describe('persistence round-trip', () => {
  it('notebook survives serialize → deserialize with normalize defaults', () => {
    const project = createEmptyProject('NB');
    project.state.notebook = starterNotebook();
    const restored = deserializeProject(serializeProject(project));
    expect(restored.state.notebook?.cells).toHaveLength(2);
    expect(restored.state.notebook?.cells[0]!.source).toContain('# Notebook');

    // Projects saved before the notebook existed normalize to null.
    const legacy = JSON.parse(serializeProject(project)) as { state: Record<string, unknown> };
    delete legacy.state.notebook;
    const legacyRestored = deserializeProject(JSON.stringify(legacy) as string);
    expect(legacyRestored.state.notebook).toBeNull();
  });
});
