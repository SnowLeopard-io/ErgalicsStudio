// ==========================================================================
// F8 Report Builder — spec → self-contained HTML, escaping, filters
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  buildReport,
  buildReportHtml,
  parseCsv,
  escapeHtml,
  safeJsonScript,
  type ReportSpec,
} from '@/core/report';
import { createEmptyProject, type Project } from '@/types/project';
import { createRunRecord } from '@/core/experiment/record';

function makeProject(): Project {
  const p = createEmptyProject('Report Project');
  p.data.files = [
    {
      id: 'csv1',
      name: 'samples.csv',
      size: 0,
      mimeType: 'text/csv',
      format: 'csv',
      content: 'group,score\n"alpha, inc",10\nbeta,20\nalpha,30\n',
    },
  ];
  return p;
}

function spec(partial: Partial<ReportSpec> = {}): ReportSpec {
  return {
    title: 'Q3 Results',
    sections: [],
    ...partial,
  };
}

describe('F8 buildReport basics', () => {
  it('returns UTF-8 HTML bytes with the title and project name', async () => {
    const project = makeProject();
    const bytes = await buildReport(project, spec({ sections: [{ type: 'heading', text: 'Intro' }] }));
    expect(bytes).toBeInstanceOf(Uint8Array);
    const html = new TextDecoder().decode(bytes);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Q3 Results</title>');
    expect(html).toContain('Report Project');
    expect(html).toContain('<h2>Intro</h2>');
  });

  it('renders subtitle and heading levels', async () => {
    const html = await buildReportHtml(makeProject(), spec({
      subtitle: 'A <bold> study',
      sections: [{ type: 'heading', text: 'Methods', level: 3 }],
    }));
    expect(html).toContain('<h3>Methods</h3>');
    expect(html).toContain('A &lt;bold&gt; study');
  });

  it('AC3: escapes XSS payloads in markdown (no executable markup survives)', async () => {
    const payload = '<img src=x onerror="alert(1)"> <script>alert(2)</script>';
    const html = await buildReportHtml(makeProject(), spec({
      sections: [{ type: 'markdown', text: payload }],
    }));
    expect(html).not.toContain('<img src=x onerror');
    expect(html).not.toContain('<script>alert(2)');
    expect(html).toContain('&lt;img');
    expect(html).toContain('onerror=&quot;alert(1)&quot;');
  });
});

describe('F8 tables', () => {
  it('renders inline tables with escaped cells and sortable headers', async () => {
    const html = await buildReportHtml(makeProject(), spec({
      sections: [
        {
          type: 'table',
          id: 't1',
          title: 'Raw',
          columns: ['name', 'value'],
          rows: [
            ['<img onerror="x">', 1],
            ['ok', 2],
          ],
        },
      ],
    }));
    expect(html).toContain('data-table="t1"');
    expect(html).toContain('<th data-sort="0">name</th>');
    expect(html).toContain('&lt;img onerror=&quot;x&quot;&gt;');
    expect(html).toContain('data-raw="1"');
    expect(html).toContain('id="data-t1"');
  });

  it('parses CSV files including quoted commas and alternate delimiters', () => {
    const parsed = parseCsv('a,b\n"alpha, inc",10\nbeta,20');
    expect(parsed.columns).toEqual(['a', 'b']);
    expect(parsed.rows[0]).toEqual(['alpha, inc', '10']);
    const semi = parseCsv('a;b\n1;2');
    expect(semi.rows).toEqual([['1', '2']]);
    expect(parseCsv('').columns).toEqual([]);
  });

  it('embeds a project data file into the report table', async () => {
    const html = await buildReportHtml(makeProject(), spec({
      sections: [{ type: 'table', id: 'file', fileId: 'csv1' }],
    }));
    expect(html).toContain('<th data-sort="0">group</th>');
    expect(html).toContain('alpha, inc');
    expect(html).toContain('"beta"');
  });

  it('previews only maxRows and states the truncation, then embeds all with includeFull', async () => {
    const project = makeProject();
    const rows = Array.from({ length: 500 }, (_, i) => [`g${i % 3}`, i]);
    const preview = await buildReportHtml(project, spec({
      sections: [{ type: 'table', id: 'big', columns: ['g', 'i'], rows, maxRows: 100 }],
    }));
    expect((preview.match(/<tr data-values/g) ?? []).length).toBe(100);
    expect(preview).toContain('100 / 500');

    const full = await buildReportHtml(project, spec({
      sections: [{ type: 'table', id: 'big', columns: ['g', 'i'], rows, includeFull: true, maxRows: 200 }],
    }));
    expect((full.match(/<tr data-values/g) ?? []).length).toBe(500);
  });

  it('warns when the referenced data file is missing', async () => {
    const html = await buildReportHtml(makeProject(), spec({
      sections: [{ type: 'table', id: 'x', fileId: 'nope' }],
    }));
    expect(html).toContain('not found');
  });
});

describe('F8 figures', () => {
  it('embeds inline SVG but strips scripts and event handlers', async () => {
    const html = await buildReportHtml(makeProject(), spec({
      sections: [
        { type: 'figure', svg: '<svg id="f" onclick="x()"><script>alert(1)</script><circle/></svg>', caption: 'Fig 1' },
      ],
    }));
    expect(html).toContain('<svg id="f"><circle/></svg>');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('onclick');
    expect(html).toContain('<figcaption>Fig 1</figcaption>');
  });

  it('shows a warning for an unknown figure sheet', async () => {
    const html = await buildReportHtml(makeProject(), spec({
      sections: [{ type: 'figure', sheetId: 'missing' }],
    }));
    expect(html).toContain('Figure not found');
  });
});

describe('F8 runs-summary', () => {
  it('renders one row per run with source, seed and metric columns', async () => {
    const project = makeProject();
    const runs = [
      createRunRecord({ projectId: project.id, source: 'flow', label: 'baseline', seed: 7, metrics: { r2: 0.9, rmse: 0.1 }, durationMs: 120 }),
      createRunRecord({ projectId: project.id, source: 'code', label: 'alt', seed: 8, metrics: { r2: 0.8 }, durationMs: 40 }),
    ];
    const html = await buildReportHtml(project, spec({
      sections: [{ type: 'runs-summary' }],
    }), { runs });
    expect(html).toContain('baseline');
    expect(html).toContain('<th data-sort="1">Source</th>');
    expect(html).toContain('r2');
    expect(html).toContain('rmse');
    expect(html).toContain('0.9');
  });

  it('restricts the summary to runIds', async () => {
    const project = makeProject();
    const runs = [
      createRunRecord({ projectId: project.id, source: 'flow', label: 'keep', metrics: {} }),
      createRunRecord({ projectId: project.id, source: 'flow', label: 'drop', metrics: {} }),
    ];
    const html = await buildReportHtml(project, spec({
      sections: [{ type: 'runs-summary', runIds: [runs[0]!.id] }],
    }), { runs });
    expect(html).toContain('keep');
    expect(html).not.toContain('drop');
  });
});

describe('F8 filters (FR8.3)', () => {
  const filterableSpec = (): ReportSpec => ({
    title: 'Filtered',
    sections: [
      {
        type: 'table',
        id: 'before',
        columns: ['score'],
        rows: [[1], [2]],
      },
      { type: 'filter', id: 'f-range', field: 'score', kind: 'range' },
      { type: 'filter', id: 'f-cat', field: 'group', kind: 'categorical' },
      {
        type: 'table',
        id: 'after',
        columns: ['group', 'score'],
        rows: [['a', 1], ['b', 5], ['a', 9]],
      },
    ],
  });

  it('binds a range filter to later tables with min/max bounds', async () => {
    const html = await buildReportHtml(makeProject(), filterableSpec());
    const start = html.indexOf('data-filter="f-range"');
    const card = html.slice(start, start + 600);
    expect(card).toContain('data-kind="range"');
    expect(card).toContain('data-tables="after"');
    expect(card).toContain('data-bound="min"');
    expect(card).toContain('value="1"');
    expect(card).toContain('value="9"');
  });

  it('builds categorical checkboxes from distinct values', async () => {
    const html = await buildReportHtml(makeProject(), filterableSpec());
    const start = html.indexOf('data-filter="f-cat"');
    const card = html.slice(start, start + 600);
    expect(card).toContain('value="a"');
    expect(card).toContain('value="b"');
    expect((card.match(/type="checkbox"/g) ?? []).length).toBe(2);
  });

  it('never targets earlier tables or tables lacking the column', async () => {
    const html = await buildReportHtml(makeProject(), filterableSpec());
    expect(html).not.toContain('data-tables="before');
    expect(html).toContain('data-filters="f-range,f-cat"');
  });

  it('honours explicit targetTableIds', async () => {
    const html = await buildReportHtml(makeProject(), {
      title: 'T',
      sections: [
        { type: 'filter', id: 'f', field: 'x', kind: 'range', targetTableIds: ['only'] },
        { type: 'table', id: 'only', columns: ['x'], rows: [[1]] },
        { type: 'table', id: 'ignored', columns: ['x'], rows: [[1]] },
      ],
    });
    expect(html).toContain('data-tables="only"');
    expect(html).not.toContain('only,ignored');
  });
});

describe('F8 security / packaging', () => {
  it('safeJsonScript escapes </script> breakouts', () => {
    const out = safeJsonScript({ evil: '</script><img src=x onerror=alert(1)>' }, 'x');
    expect(out).not.toContain('</script><img');
    expect(out).toContain('\\u003c/script\\u003e');
    expect(() => JSON.parse(out.replace(/^<script[^>]*>/, '').replace('</script>', ''))).not.toThrow();
  });

  it('escapeHtml covers & < > " \' ', () => {
    expect(escapeHtml(`<a href="x'y&z">`)).toBe('&lt;a href=&quot;x&#39;y&amp;z&quot;&gt;');
  });

  it('AC packaging: fully self-contained (no external links/scripts)', async () => {
    const html = await buildReportHtml(makeProject(), spec({
      sections: [
        { type: 'markdown', text: '**Bold** and `code`.' },
        { type: 'table', id: 't', columns: ['x'], rows: [[1]] },
      ],
    }));
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toMatch(/<style>[\s\S]*<\/style>/);
    // exactly one inline controller script + json data scripts
    expect((html.match(/<script>/g) ?? []).length).toBe(1);
  });

  it('supports dark theme and Chinese chrome labels', async () => {
    const html = await buildReportHtml(makeProject(), spec({
      theme: 'dark',
      lang: 'zh',
      sections: [{ type: 'runs-summary' }],
    }), { runs: [] });
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('lang="zh"');
    expect(html).toContain('运行摘要');
  });
});
