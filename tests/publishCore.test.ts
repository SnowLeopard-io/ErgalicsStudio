// ==========================================================================
// Ergalics Studio — research publishing core tests
//
// Covers BibTeX parsing/serialisation, the seven citation styles, CITATION.cff,
// the LaTeX renderer + preview, the collaborative CRDT/diff, and arXiv
// packaging / reproducibility badges.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  dedupeEntries,
  entryAuthors,
  findDuplicateGroups,
  makeCitationKey,
  normalizeDoi,
  parseAuthor,
  parseBibtex,
  splitAuthors,
  toBibtex,
  type BibEntry,
} from '@/core/publish/bibtex';
import {
  citationStats,
  buildReferenceGraph,
  cffToBibEntry,
  cslToBibEntry,
  formatBibliography,
  formatCitation,
  parseCitationCff,
  toCitationCff,
  topCited,
  type CitationStyle,
} from '@/core/publish/citation';
import {
  equationSnippet,
  figureSnippet,
  getLatexTemplate,
  latexPreviewBody,
  latexPreviewHtml,
  renderLatex,
  starterLatex,
} from '@/core/publish/latex';
import {
  TextCrdt,
  crdtText,
  createCollabCell,
  createCollabNote,
  diffText,
  mergeCollabNotes,
  mergeCrdtStates,
  notebookToMarkdown,
} from '@/core/publish/collab';
import {
  buildArxivMetadata,
  buildArxivPackage,
  buildReproduceLink,
  buildReproducibilityBadge,
  exportArxivZip,
  zipArxivPackage,
} from '@/core/publish/preprint';
import {
  notebookFileStem,
  notebookToDocx,
  notebookToHtml,
  notebookToIpynb,
} from '@/core/publish/export';
import {
  createPublishState,
  normalizePublishState,
} from '@/core/publish/state';
import {
  figureSlug,
  referencedFigures,
} from '@/core/publish/bridge';

const SAMPLE = String.raw`
@article{smith2020deep,
  author = {Smith, John and Doe, Jane},
  title = {A Deep {L}earning Study},
  journal = {Nature},
  year = {2020},
  volume = {580},
  number = {7801},
  pages = {1--10},
  doi = {https://doi.org/10.1038/S41586-020-1234-5}
}

@book{knuth1997art,
  author = "Knuth, Donald E.",
  title = "The Art of Computer Programming",
  publisher = {Addison-Wesley},
  year = 1997
}

@misc{website,
  title = {Ergalics Studio},
  url = {https://example.org/ergalics},
  year = {2024}
}
`;

describe('bibtex', () => {
  it('parses entries, nested braces, quotes and bare years', () => {
    const entries = parseBibtex(SAMPLE);
    expect(entries).toHaveLength(3);
    const [article, book, misc] = entries;
    expect(article?.type).toBe('article');
    expect(article?.key).toBe('smith2020deep');
    expect(article?.fields.title).toBe('A Deep {L}earning Study');
    expect(article?.fields.pages).toBe('1--10');
    expect(book?.fields.author).toBe('Knuth, Donald E.');
    expect(book?.fields.year).toBe('1997');
    expect(misc?.fields.url).toBe('https://example.org/ergalics');
  });

  it('handles concatenation, parentheses and @string', () => {
    const src = `
      @string{conf = "Proceedings"}
      @inproceedings(p1, author = {A. Author}, title = "Part " # "Two",
        booktitle = conf, year = 2021)
    `;
    const entries = parseBibtex(src);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.fields.title).toBe('Part Two');
    expect(entries[0]?.fields.booktitle).toBe('Proceedings');
  });

  it('round-trips through toBibtex', () => {
    const entries = parseBibtex(SAMPLE);
    const again = parseBibtex(toBibtex(entries));
    expect(again.map((e) => e.key)).toEqual(entries.map((e) => e.key));
    expect(again[0]?.fields.title).toBe(entries[0]?.fields.title);
  });

  it('splits authors and parses both name forms', () => {
    expect(splitAuthors('Smith, John and Doe, Jane')).toEqual(['Smith, John', 'Doe, Jane']);
    expect(splitAuthors('A. One and B. Two and others')).toEqual(['A. One', 'B. Two', 'others']);
    expect(parseAuthor('Smith, John')).toEqual({ family: 'Smith', given: 'John' });
    expect(parseAuthor('John von Neumann')).toEqual({ family: 'Neumann', given: 'John von' });
    const entries = parseBibtex(SAMPLE);
    expect(entryAuthors(entries[0]!).map((a) => a.family)).toEqual(['Smith', 'Doe']);
  });

  it('normalises DOIs and detects duplicates', () => {
    expect(normalizeDoi('https://dx.doi.org/10.1000/ABC')).toBe('10.1000/abc');
    expect(normalizeDoi('doi: 10.1000/xyz')).toBe('10.1000/xyz');
    const entries: BibEntry[] = [
      { type: 'article', key: 'a', fields: { doi: '10.1/x', title: 'Same', year: '2020' } },
      { type: 'article', key: 'b', fields: { doi: 'https://doi.org/10.1/X', title: 'Same!' } },
      { type: 'article', key: 'c', fields: { title: 'Other', year: '2021' } },
    ];
    const groups = findDuplicateGroups(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((e) => e.key)).toEqual(['a', 'b']);
    const deduped = dedupeEntries(entries);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]?.fields.doi).toBe('https://doi.org/10.1/X');
  });

  it('generates collision-free keys', () => {
    const entry: BibEntry = {
      type: 'article',
      key: 'x',
      fields: { author: 'Smith, John', year: '2020', title: 'Deep learning for science' },
    };
    const key = makeCitationKey(entry);
    expect(key).toBe('smith2020deep');
    expect(makeCitationKey(entry, [key])).toBe('smith2020deep2');
  });
});

describe('citation styles', () => {
  const article = parseBibtex(SAMPLE)[0]!;
  const book = parseBibtex(SAMPLE)[1]!;
  const styles: CitationStyle[] = ['apa', 'mla', 'chicago', 'ieee', 'vancouver', 'nature', 'science'];

  it('renders every style without throwing and includes the author', () => {
    for (const style of styles) {
      const text = formatCitation(article, style, { index: 3 });
      expect(text.length).toBeGreaterThan(20);
      expect(text).toContain('Smith');
    }
  });

  it('uses numeric prefixes for IEEE and Vancouver', () => {
    expect(formatCitation(article, 'ieee', { index: 3 }).startsWith('[3]')).toBe(true);
    expect(formatCitation(article, 'vancouver', { index: 3 }).startsWith('3.')).toBe(true);
    expect(formatCitation(article, 'apa')).not.toMatch(/^\[/);
  });

  it('builds an ordered bibliography (alphabetical vs numeric)', () => {
    const apa = formatBibliography([article, book], 'apa');
    expect(apa).toHaveLength(2);
    expect(apa[0]).toContain('Knuth');
    const ieee = formatBibliography([article, book], 'ieee');
    expect(ieee[0]).toContain('Smith');
    expect(ieee[1]?.startsWith('[2]')).toBe(true);
  });

  it('reports statistics and reference graph', () => {
    const citing: BibEntry = {
      type: 'article',
      key: 'citing',
      fields: { title: 'Citing', year: '2022', references: 'smith2020deep knuth1997art' },
    };
    const stats = citationStats([article, book, citing]);
    expect(stats.total).toBe(3);
    expect(stats.byType.article).toBe(2);
    expect(stats.byYear[0]?.year).toBe('1997');
    const graph = buildReferenceGraph([article, book, citing]);
    expect(graph.edges).toHaveLength(2);
    expect(topCited(graph, 1)[0]?.key).toMatch(/smith2020deep|knuth1997art/);
  });

  it('parses and serialises CITATION.cff', () => {
    const cff = parseCitationCff(`cff-version: 1.2.0
message: "Cite this"
title: Ergalics Studio
authors:
  - family-names: Doe
    given-names: Jane
  - family-names: Smith
year: 2026
doi: 10.5281/zenodo.1
license: MIT
`);
    expect(cff.title).toBe('Ergalics Studio');
    expect(cff.authors).toHaveLength(2);
    expect(cff.authors[0]).toEqual({ family: 'Doe', given: 'Jane' });
    expect(cff.doi).toBe('10.5281/zenodo.1');
    const yaml = toCitationCff(cff);
    expect(yaml).toContain('cff-version: 1.2.0');
    expect(yaml).toContain('family-names: Doe');
    const bib = cffToBibEntry(cff, 'ergalics');
    expect(bib.type).toBe('software');
    expect(bib.fields.author).toBe('Doe, Jane and Smith');
  });

  it('maps CSL-JSON metadata', () => {
    const entry = cslToBibEntry({
      DOI: '10.1000/ABC',
      title: 'A study',
      author: [{ given: 'Jane', family: 'Doe' }],
      issued: { 'date-parts': [[2021]] },
      'container-title': 'Journal',
      volume: '3',
      page: '10-20',
      type: 'article-journal',
    });
    expect(entry.type).toBe('article');
    expect(entry.fields.doi).toBe('10.1000/abc');
    expect(entry.fields.author).toBe('Doe, Jane');
    expect(entry.fields.pages).toBe('10-20');
    expect(entry.key.startsWith('Doe2021')).toBe(true);
  });
});

describe('latex', () => {
  it('exposes all six templates', () => {
    const ids = ['ieee', 'acm', 'nature', 'science', 'apa', 'chicago'];
    for (const id of ids) expect(getLatexTemplate(id).id).toBe(id);
    expect(getLatexTemplate('missing').id).toBe('ieee');
  });

  it('renders a compilable document with bibliography and figures', () => {
    const tex = starterLatex('acm', 'My Paper');
    expect(tex).toContain('\\documentclass');
    expect(tex).toContain('acmart');
    expect(tex).toContain('\\bibliography{references}');
    expect(tex).toContain('\\end{document}');
    const snippet = figureSnippet('figures/fig-1.svg', 'Results', 'fig:res', 0.8);
    expect(snippet).toContain('\\includesvg');
    expect(snippet).toContain('fig-1.svg');
    expect(equationSnippet('E = mc^2', 'eq:energy')).toContain('\\begin{equation}');
  });

  it('renders structured documents', () => {
    const tex = renderLatex({
      templateId: 'nature',
      title: 'Structured',
      authors: [{ name: 'Jane Doe', affiliation: 'Lab' }],
      abstract: 'Short abstract.',
      sections: [
        { id: 's1', heading: 'Intro', blocks: [{ type: 'text', text: 'Hello world.' }] },
        { id: 's2', heading: 'Math', level: 2, blocks: [{ type: 'equation', tex: 'a^2+b^2=c^2' }] },
      ],
    });
    expect(tex).toContain('\\section{Intro}');
    expect(tex).toContain('\\subsection{Math}');
    expect(tex).toContain('\\begin{equation}');
  });

  it('renders a preview with sections, citations and figures', () => {
    const entries = parseBibtex(SAMPLE);
    const body = latexPreviewBody(starterLatex('ieee'), {
      entries,
      resolveFigure: () => '<svg><rect width="10" height="10"/></svg>',
    });
    expect(body).toContain('lp-head');
    expect(body).toContain('Introduction');
    expect(body).not.toContain('\\documentclass');
    expect(body).toContain('References');
    const html = latexPreviewHtml('\\title{T}\\begin{document}Hi $x^2$\\end{document}');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('katex');
    expect(html).toContain('<h1>T</h1>');
  });

  it('renders \\includesvg figures through the sheet resolver', () => {
    const src = [
      '\\title{T}',
      '\\begin{document}',
      '\\begin{figure}[htbp]',
      '\\centering',
      '\\includesvg[width=0.9\\linewidth]{figures/fig-1.svg}',
      '\\caption{Main result}',
      '\\label{fig:one}',
      '\\end{figure}',
      '\\end{document}',
    ].join('\n');
    const withFigure = latexPreviewBody(src, {
      resolveFigure: (file) => (file.includes('fig-1') ? '<svg id="resolved"></svg>' : null),
    });
    expect(withFigure).toContain('<div class="lp-figure-art"><svg id="resolved"></svg></div>');
    expect(withFigure).toContain('Main result');
    const unresolved = latexPreviewBody(src);
    expect(unresolved).toContain('figures/fig-1.svg');
  });
});

describe('collaborative notes', () => {
  it('converges after concurrent inserts', () => {
    const a = new TextCrdt('aaa');
    a.insert(0, 'hello');
    const b = new TextCrdt('bbb', a.snapshot());
    a.insert(5, ' world');
    b.insert(0, '>> ');
    a.apply(b.snapshot());
    b.apply(a.snapshot());
    expect(a.getText()).toBe(b.getText());
    expect(a.getText()).toContain('>> ');
    expect(a.getText()).toContain('world');
  });

  it('merges snapshots idempotently and honours deletes', () => {
    const a = new TextCrdt('a');
    a.insert(0, 'abcd');
    const b = new TextCrdt('b', a.snapshot());
    b.delete(1, 2);
    const merged = mergeCrdtStates(a.snapshot(), b.snapshot());
    expect(crdtText(merged)).toBe('ad');
    expect(crdtText(mergeCrdtStates(merged, merged))).toBe('ad');
  });

  it('replaces text with a minimal diff', () => {
    const crdt = new TextCrdt('s');
    crdt.insert(0, 'the quick brown fox');
    crdt.replaceAll('the quick red fox');
    expect(crdt.getText()).toBe('the quick red fox');
  });

  it('diffs lines and exports markdown', () => {
    const ops = diffText('a\nb\nc', 'a\nx\nc');
    expect(ops.some((op) => op.type === 'del' && op.text.includes('b'))).toBe(true);
    expect(ops.some((op) => op.type === 'add' && op.text.includes('x'))).toBe(true);
    const note = createCollabNote('Demo');
    note.cells[0]!.type = 'code';
    expect(notebookToMarkdown(note)).toContain('```');
  });

  it('merges remote notebooks by cell id', () => {
    const local = createCollabNote('Local');
    const remote = createCollabNote('Remote');
    remote.updatedAt = local.updatedAt + 1;
    remote.cells[0]!.id = local.cells[0]!.id;
    remote.cells[0]!.crdt = createCollabCell('md', 'remote text').crdt;
    const merged = mergeCollabNotes(local, remote);
    expect(merged.cells.length).toBeGreaterThanOrEqual(local.cells.length);
    expect(merged.title).toBe('Remote');
  });
});

describe('preprint packaging', () => {
  it('renders a badge with escape-safe labels', () => {
    const svg = buildReproducibilityBadge({
      projectName: 'A <B> & C',
    });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('&lt;B&gt;');
    expect(svg).not.toContain('<B>');
    expect(svg).toContain('&amp;');
  });

  it('builds a reproduce link', () => {
    const link = buildReproduceLink('https://example.org/studio/#/x', 'proj-1', 'abc');
    expect(link).toBe('https://example.org/studio/#/studio/reprolock?project=proj-1&lock=abc');
  });

  it('assembles and zips an arXiv package', () => {
    const pkg = buildArxivPackage({
      source: '\\documentclass{article}\\begin{document}Hi\\end{document}',
      metadata: buildArxivMetadata({
        title: 'Paper',
        authors: [{ name: 'Jane Doe' }],
        abstract: 'Abstract',
        keywords: ['x'],
      }),
      entries: parseBibtex(SAMPLE),
      figures: [{ name: 'fig-1.svg', svg: '<svg/>' }],
      project: { id: 'p1', name: 'My Project', version: '1.0.0' },
      lock: '{"schema":"x"}',
      citationCff: 'cff-version: 1.2.0\n',
    });
    expect(pkg.fileName).toBe('my-project-preprint.zip');
    expect(Object.keys(pkg.files)).toEqual(
      expect.arrayContaining([
        'main.tex',
        'references.bib',
        'figures/fig-1.svg',
        'reproducibility-badge.svg',
        'CITATION.cff',
        'repro.lock.json',
        'metadata.json',
        'manifest.json',
      ]),
    );
    expect(pkg.manifest.hasLock).toBe(true);
    const zip = zipArxivPackage(pkg);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    const exported = exportArxivZip({
      source: 'x',
      metadata: buildArxivMetadata({ title: 'T', authors: [], abstract: '' }),
      project: { id: 'p', name: 'P' },
    });
    expect(exported.data.length).toBeGreaterThan(0);
  });
});

describe('notebook exporters', () => {
  const note = createCollabNote('My <Note>');
  note.cells[0]!.crdt = createCollabCell('md', '# Heading\n\n- one\n- two').crdt;
  note.cells[1]!.crdt = createCollabCell('code', 'print("hi")').crdt;
  note.cells[1]!.type = 'code';

  it('exports self-contained HTML with escaping', () => {
    const html = notebookToHtml(note);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('My &lt;Note&gt;');
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('print(&quot;hi&quot;)');
    expect(html).not.toContain('http://');
  });

  it('exports nbformat v4 Jupyter JSON', () => {
    const parsed = JSON.parse(notebookToIpynb(note)) as {
      nbformat: number;
      cells: Array<{ cell_type: string; source: string[] }>;
    };
    expect(parsed.nbformat).toBe(4);
    expect(parsed.cells.map((c) => c.cell_type)).toEqual(['markdown', 'code']);
    expect(parsed.cells[0]?.source.join('')).toContain('# Heading');
  });

  it('exports a zip-based DOCX package', () => {
    const docx = notebookToDocx(note);
    expect(docx[0]).toBe(0x50);
    expect(docx[1]).toBe(0x4b);
    expect(notebookFileStem(note)).toBe('my-note');
  });
});

describe('publishing state + figure bridge', () => {
  it('normalises untrusted publish state', () => {
    const empty = normalizePublishState(null);
    expect(empty).toEqual(createPublishState());
    const state = normalizePublishState({
      manuscripts: [{ id: 'm1', name: 'Paper', templateId: 'nope', source: 5 }],
      library: [{ type: 'article', key: 'k', fields: { title: 'T', bad: 1 } }],
      notes: [{ id: 'n1', cells: [{ id: 'c1', crdt: { atoms: [{ id: '1@s', after: null, value: 'a' }] } }] }],
    });
    expect(state.manuscripts[0]?.templateId).toBe('ieee');
    expect(state.manuscripts[0]?.source).toBe('');
    expect(state.library[0]?.fields).toEqual({ title: 'T' });
    expect(state.notes[0]?.cells[0]?.crdt.atoms[0]?.value).toBe('a');
    expect(state.activeManuscriptId).toBe('m1');
  });

  it('slugs figures and finds includes', () => {
    expect(figureSlug('Figure 1: Main Results!')).toBe('figure-1-main-results');
    expect(figureSlug('', 'fallback')).toBe('fallback');
    expect(
      referencedFigures('\\includesvg[width=0.8\\linewidth]{figures/fig-1.svg} \\includegraphics{./fig-2.png}'),
    ).toEqual(['fig-1.svg', './fig-2.png']);
  });
});
