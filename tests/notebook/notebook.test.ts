// ==========================================================================
// Ergalics Studio — notebook tests (core)
//
// Cell model helpers, the mdToHtml renderer (marked + DOMPurify: GFM syntax,
// sanitized raw HTML, mermaid/math placeholders) and the project persistence
// round-trip.
// ==========================================================================

// @vitest-environment jsdom

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
  it('sanitizes raw HTML in markdown (no executable markup survives)', () => {
    const html = mdToHtml('<img src=x onerror=alert(1)>');
    // DOMPurify keeps the inert img but strips the event handler entirely.
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
  });

  it('escapes HTML inside fenced code blocks', () => {
    const html = mdToHtml('```\n<script>alert(1)</script>\n```');
    expect(html).toContain('<pre><code>&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('neutralizes active-scheme markdown links (shared-notebook XSS)', () => {
    const evil = mdToHtml('[click](javascript:alert(1))');
    expect(evil).not.toContain('href="javascript:');
    expect(evil).not.toContain('href=');
    expect(evil).toContain('click');

    // Obfuscated casing and other active schemes are blocked too.
    expect(mdToHtml('[x](JaVaScRiPt:alert(1))')).not.toContain('href=');
    expect(mdToHtml('[x](data:text/html,<script>)')).not.toContain('href=');
    expect(mdToHtml('[x](vbscript:msgbox)')).not.toContain('href=');
  });

  it('still allows http/https/mailto and relative links', () => {
    expect(mdToHtml('[s](https://x.example)')).toContain('href="https://x.example"');
    expect(mdToHtml('[s](http://x.example)')).toContain('href="http://x.example"');
    expect(mdToHtml('[m](mailto:a@b.example)')).toContain('href="mailto:a@b.example"');
    expect(mdToHtml('[r](/files/a.csv)')).toContain('href="/files/a.csv"');
    expect(mdToHtml('[r](#section)')).toContain('href="#section"');
    // Every surviving link gets a rel (opener-leak protection).
    expect(mdToHtml('[s](https://x.example)')).toContain('rel="noopener noreferrer"');
  });
});

describe('mdToHtml — supported syntax', () => {
  it('renders headings, emphasis, inline code and links', () => {
    const html = mdToHtml('# Title\n\n**bold** and *em* and `code`\n\n[site](https://x.example)');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://x.example"');
  });

  it('renders fenced code, lists and blockquotes', () => {
    const html = mdToHtml('```python\nx = 1\n```\n\n- one\n- two\n\n> quoted');
    expect(html).toContain('<pre><code class="language-python">x = 1</code></pre>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<p>quoted</p>');
  });

  it('auto-closes an unclosed fence and keeps plain paragraphs', () => {
    const html = mdToHtml('plain text\n```\nnever closed');
    expect(html).toContain('<p>plain text</p>');
    expect(html).toContain('<pre><code>never closed');
  });

  it('renders GFM tables and task lists', () => {
    const html = mdToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo');
    expect(html).toContain('<table>');
    expect(html).toContain('<th');
    expect(html).toContain('<input');
    expect(html).toContain('checked');
  });

  it('emits mermaid + math placeholders (upgraded by enhanceMarkdownDom)', () => {
    const html = mdToHtml(
      '```mermaid\ngraph TD; A-->B;\n```\n\nInline $E=mc^2$ and $$\\int_0^1 x\\,dx$$',
    );
    expect(html).toContain('class="md-mermaid"');
    expect(html).toContain('data-mermaid="' + encodeURIComponent('graph TD; A-->B;') + '"');
    expect(html).toContain('class="md-tex"');
    expect(html).toContain('data-tex="' + encodeURIComponent('E=mc^2') + '"');
    expect(html).toContain('data-display="1"');
    // The raw TeX must not leak as unencoded markup.
    expect(html).not.toContain('E=mc^2');
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
