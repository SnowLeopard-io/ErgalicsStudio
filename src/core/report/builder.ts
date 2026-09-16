// ==========================================================================
// Ergalics Studio — interactive report builder (F8, pure TS core)
//
// buildReport turns a ReportSpec (ordered sections: headings, markdown,
// Figure Studio figures, data tables, run summaries, filters) into ONE
// self-contained HTML document: inline CSS, inline SVG, inline JSON data and
// a dependency-free vanilla-JS controller (filter chaining, sortable tables).
//
// Security (FR8.5): every user string goes through escapeHtml / mdToHtml
// (which escapes first); embedded JSON is emitted in
// <script type="application/json"> with all `<` unicode-escaped, so a
// `</script>` payload in the data can never break out.
// ==========================================================================

import { mdToHtml } from '@/core/notebook/notebook';
import { renderSVG } from '@/core/plot';
import type { Project } from '@/types/project';
import type { RunRecord } from '@/core/experiment/record';

// --------------------------------------------------------------------------
// Spec types
// --------------------------------------------------------------------------

export type ReportTheme = 'light' | 'dark';
export type ReportLang = 'en' | 'zh';

export interface HeadingSection {
  type: 'heading';
  text: string;
  level?: 1 | 2 | 3;
}

export interface MarkdownSection {
  type: 'markdown';
  text: string;
}

export interface FigureSection {
  type: 'figure';
  /** Figure Studio sheet id (panels rendered through the core plot engine). */
  sheetId?: string;
  /** Pre-rendered inline SVG; wins over sheet lookup. */
  svg?: string;
  caption?: string;
}

export interface TableSection {
  type: 'table';
  /** Stable id used as the filter target. */
  id: string;
  title?: string;
  /** Project data file to embed. */
  fileId?: string;
  /** Explicit columns (default: file header / rows[0] length). */
  columns?: string[];
  /** Inline rows (used instead of the file when fileId is absent). */
  rows?: Array<Array<string | number | boolean | null | undefined>>;
  /** Visible / embedded row cap for the preview (default 200). */
  maxRows?: number;
  /** Embed the complete CSV, not only the preview rows. */
  includeFull?: boolean;
  caption?: string;
}

export interface RunsSummarySection {
  type: 'runs-summary';
  id?: string;
  title?: string;
  /** Restrict to these run ids (default: every run supplied in context). */
  runIds?: string[];
}

export interface FilterSection {
  type: 'filter';
  id: string;
  /** Column name in the targeted table(s). */
  field: string;
  label?: string;
  kind: 'range' | 'categorical';
  /** Target table ids; default = every later table that has the column. */
  targetTableIds?: string[];
}

export type ReportSection =
  | HeadingSection
  | MarkdownSection
  | FigureSection
  | TableSection
  | RunsSummarySection
  | FilterSection;

export interface ReportSpec {
  id?: string;
  name?: string;
  title: string;
  subtitle?: string;
  theme?: ReportTheme;
  lang?: ReportLang;
  sections: ReportSection[];
  createdAt?: string;
  updatedAt?: number;
}

export interface ReportBuildContext {
  /** Runs for `runs-summary` sections (runs live outside the project file). */
  runs?: RunRecord[];
  /** Custom figure renderer (e.g. cached SVG); falls back to the plot core. */
  resolveFigure?: (sheetId: string) => string | null | Promise<string | null>;
  now?: Date;
}

// --------------------------------------------------------------------------
// Escaping
// --------------------------------------------------------------------------

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe transport for JSON inside <script> tags (FR8.5). */
export function safeJsonScript(data: unknown, elementId: string): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return `<script type="application/json" id="${escapeHtml(elementId)}">${json}</script>`;
}

/** Strip executable content from an SVG produced by an external renderer. */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
}

// --------------------------------------------------------------------------
// Minimal CSV (handles quoted fields, comma/semicolon/tab delimiters)
// --------------------------------------------------------------------------

export function parseCsv(text: string): { columns: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      if (record.some((f) => f !== '')) records.push(record);
      record = [];
      field = '';
    } else if (ch === ',' || ch === ';' || ch === '\t') {
      record.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  record.push(field);
  if (record.some((f) => f !== '')) records.push(record);

  if (records.length === 0) return { columns: [], rows: [] };
  const [columns, ...rest] = records;
  return { columns: columns ?? [], rows: rest };
}

// --------------------------------------------------------------------------
// Chrome labels
// --------------------------------------------------------------------------

const LABELS = {
  en: {
    generated: 'Generated',
    runsTitle: 'Run summary',
    run: 'Run',
    source: 'Source',
    duration: 'Duration (ms)',
    seed: 'Seed',
    createdAt: 'Created',
    metrics: 'Metrics',
    all: 'All',
    min: 'Min',
    max: 'Max',
    missingFile: 'Data file not found in the project.',
    missingFigure: 'Figure not found:',
    rows: 'rows',
  },
  zh: {
    generated: '生成于',
    runsTitle: '运行摘要',
    run: '运行',
    source: '来源',
    duration: '耗时（毫秒）',
    seed: '种子',
    createdAt: '创建时间',
    metrics: '指标',
    all: '全部',
    min: '最小',
    max: '最大',
    missingFile: '项目中找不到该数据文件。',
    missingFigure: '找不到图：',
    rows: '行',
  },
} as const;

// --------------------------------------------------------------------------
// CSS / controller
// --------------------------------------------------------------------------

function reportCss(theme: ReportTheme): string {
  const dark = theme === 'dark';
  const vars = dark
    ? `--bg:#14161a;--fg:#e8eaed;--muted:#9aa0a6;--card:#1d2026;--border:#353941;--accent:#7eb6ff;--hover:#262b33;--danger:#f28b82;`
    : `--bg:#ffffff;--fg:#1a1c1e;--muted:#5f6368;--card:#f7f8fa;--border:#dfe1e5;--accent:#1a56c4;--hover:#eef3fd;--danger:#c5221f;`;
  return `:root{${vars}--radius:8px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:880px;margin:0 auto;padding:48px 28px 96px}
header.report-head{border-bottom:1px solid var(--border);margin-bottom:28px;padding-bottom:20px}
h1{font-size:28px;margin:0 0 6px}
.subtitle{color:var(--muted);margin:0}
.meta{color:var(--muted);font-size:13px;margin-top:10px}
h2{font-size:21px;margin:32px 0 12px}h3{font-size:17px;margin:24px 0 10px}
p{margin:8px 0}a{color:var(--accent)}code{background:var(--card);border:1px solid var(--border);border-radius:4px;padding:1px 5px}
pre{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;overflow:auto}
figure{margin:20px 0;padding:14px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius)}
figure svg{max-width:100%;height:auto;display:block;margin:0 auto}
figcaption{color:var(--muted);font-size:13px;margin-top:10px;text-align:center}
.table-wrap{overflow-x:auto;margin:16px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{border:1px solid var(--border);padding:6px 10px;text-align:left;white-space:nowrap}
th{background:var(--card);cursor:pointer;user-select:none;position:sticky;top:0}
th:hover{background:var(--hover)}
tbody tr:nth-child(even){background:var(--card)}
.caption{color:var(--muted);font-size:13px;margin:6px 0}
.filter-card{border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin:18px 0;background:var(--card)}
.filter-card .filter-label{font-weight:600;margin-bottom:8px}
.filter-card input[type=number]{width:110px;margin-right:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:4px 8px}
.filter-chips label{display:inline-flex;gap:4px;align-items:center;margin:2px 14px 2px 0;font-size:13px}
.warn{color:var(--danger);font-size:13px}
.badge{display:inline-block;font-size:12px;color:var(--muted);margin-left:8px}`;
}

function reportJs(): string {
  // Vanilla controller: filters hide rows; headers sort numeric/text.
  return `(function(){
  function readData(id){try{return JSON.parse(document.getElementById('data-'+id).textContent||'[]')}catch(e){return []}}
  function readCols(id){var el=document.getElementById('cols-'+id);return el?JSON.parse(el.textContent||'[]'):[]}
  function rowsOf(tableId){return Array.prototype.slice.call(document.querySelectorAll('table[data-table="'+tableId+'"] tbody tr'))}
  function num(v){var n=parseFloat(v);return isNaN(n)?NaN:n}
  function applyFilters(tableId){
    var rows=rowsOf(tableId), cols=readCols(tableId);
    var filters=Array.prototype.slice.call(document.querySelectorAll('[data-filter]')).filter(function(f){
      return (f.getAttribute('data-tables')||'').split(',').indexOf(tableId)>=0;
    });
    rows.forEach(function(tr){
      var values=JSON.parse(tr.getAttribute('data-values')||'[]');
      var visible=true;
      filters.forEach(function(f){
        var field=f.getAttribute('data-field'), idx=cols.indexOf(field);
        if(idx<0)return;
        var raw=values[idx];
        if(f.getAttribute('data-kind')==='range'){
          var lo=f.querySelector('[data-bound="min"]').value, hi=f.querySelector('[data-bound="max"]').value;
          var x=num(raw);
          if(lo!==''&&(isNaN(x)||x<parseFloat(lo)))visible=false;
          if(hi!==''&&(isNaN(x)||x>parseFloat(hi)))visible=false;
        }else{
          var checked=Array.prototype.slice.call(f.querySelectorAll('input[type=checkbox]:checked')).map(function(c){return c.value});
          if(checked.length>0&&checked.indexOf(String(raw))<0)visible=false;
        }
      });
      tr.style.display=visible?'':'none';
    });
  }
  document.querySelectorAll('[data-filter]').forEach(function(f){
    var tableIds=(f.getAttribute('data-tables')||'').split(',');
    f.addEventListener('input',function(){tableIds.forEach(applyFilters)});
    f.addEventListener('change',function(){tableIds.forEach(applyFilters)});
  });
  document.querySelectorAll('th[data-sort]').forEach(function(th){
    th.addEventListener('click',function(){
      var table=th.closest('table'), tbody=table.tBodies[0], idx=parseInt(th.getAttribute('data-sort'),10);
      var dir=th.getAttribute('data-dir')==='asc'?'desc':'asc';
      Array.prototype.slice.call(tbody.rows).forEach(function(r){r.removeAttribute('data-sortkey')});
      var rowsArr=Array.prototype.slice.call(tbody.rows);
      rowsArr.sort(function(a,b){
        var va=a.cells[idx].getAttribute('data-raw')!=null?a.cells[idx].getAttribute('data-raw'):a.cells[idx].textContent;
        var vb=b.cells[idx].getAttribute('data-raw')!=null?b.cells[idx].getAttribute('data-raw'):b.cells[idx].textContent;
        var na=parseFloat(va), nb=parseFloat(vb);
        var cmp=(!isNaN(na)&&!isNaN(nb))?na-nb:String(va).localeCompare(String(vb));
        return dir==='asc'?cmp:-cmp;
      });
      rowsArr.forEach(function(r){tbody.appendChild(r)});
      th.setAttribute('data-dir',dir);
    });
  });
})();`;
}

// --------------------------------------------------------------------------
// Section rendering
// --------------------------------------------------------------------------

type CellValue = string | number | boolean | null | undefined;

function renderTableHtml(
  section: TableSection,
  columns: string[],
  rows: CellValue[][],
  totalRows: number,
  labels: (typeof LABELS)[ReportLang],
  applicableFilterIds: string[],
): string {
  const cap = section.maxRows ?? 200;
  const embedded = section.includeFull ? rows : rows.slice(0, cap);
  const shown = section.includeFull ? embedded : embedded.slice(0, cap);
  const preview = shown;
  const head = columns
    .map((c, i) => `<th data-sort="${i}">${escapeHtml(c)}</th>`)
    .join('');
  const body = preview
    .map((row) => {
      const tds = columns
        .map((_, ci) => {
          const v = row[ci];
          return `<td data-raw="${escapeHtml(typeof v === 'number' ? v : v ?? '')}">${escapeHtml(v ?? '')}</td>`;
        })
        .join('');
      const values = columns.map((_, ci) => (row[ci] ?? null) as CellValue);
      return `<tr data-values="${escapeHtml(JSON.stringify(values))}">${tds}</tr>`;
    })
    .join('');
  const title = section.title ? `<h3>${escapeHtml(section.title)}</h3>` : '';
  const caption = section.caption ? `<p class="caption">${escapeHtml(section.caption)}</p>` : '';
  const truncated = totalRows > shown.length;
  const note = truncated
    ? `<p class="caption">${shown.length} / ${totalRows} ${labels.rows}${section.includeFull ? '' : ''}</p>`
    : '';
  const filterAttr = applicableFilterIds.length > 0 ? ` data-filters="${escapeHtml(applicableFilterIds.join(','))}"` : '';
  return `${title}<div class="table-wrap"${filterAttr}><table data-table="${escapeHtml(section.id)}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${note}${caption}${safeJsonScript(columns, `cols-${section.id}`)}${safeJsonScript(embedded, `data-${section.id}`)}`;
}

function renderRunsSummary(
  section: RunsSummarySection,
  runs: RunRecord[],
  labels: (typeof LABELS)[ReportLang],
): string {
  const selected = section.runIds
    ? section.runIds.map((id) => runs.find((r) => r.id === id)).filter((r): r is RunRecord => !!r)
    : runs;
  const metricKeys = [...new Set(selected.flatMap((r) => Object.keys(r.metrics)))].sort();
  const columns = [labels.run, labels.source, labels.duration, labels.seed, ...metricKeys];
  const rows: CellValue[][] = selected.map((r) => [
    r.label ?? r.id,
    r.source,
    Math.round(r.durationMs),
    r.seed ?? '',
    ...metricKeys.map((k) => r.metrics[k] ?? ''),
  ]);
  const tableSection: TableSection = {
    type: 'table',
    id: section.id ?? 'runs-summary',
    title: section.title ?? labels.runsTitle,
    columns,
    rows,
    maxRows: Number.MAX_SAFE_INTEGER,
  };
  return renderTableHtml(tableSection, columns, rows, rows.length, labels, []);
}

function renderFilter(
  section: FilterSection,
  labels: (typeof LABELS)[ReportLang],
  tables: Array<{ id: string; columns: string[]; rows: CellValue[][] }>,
): string {
  const targets = section.targetTableIds ?? tables.map((t) => t.id);
  const targetTables = tables.filter((t) => targets.includes(t.id) && t.columns.includes(section.field));
  const targetIds = targetTables.map((t) => t.id);
  const label = escapeHtml(section.label ?? section.field);
  let control = '';
  if (section.kind === 'range') {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const t of targetTables) {
      const idx = t.columns.indexOf(section.field);
      for (const row of t.rows) {
        const v = typeof row[idx] === 'number' ? (row[idx] as number) : parseFloat(String(row[idx]));
        if (Number.isFinite(v)) {
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 0;
    }
    control = `<label>${labels.min} <input type="number" data-bound="min" step="any" value="${escapeHtml(min)}"></label>`
      + `<label>${labels.max} <input type="number" data-bound="max" step="any" value="${escapeHtml(max)}"></label>`;
  } else {
    const values = new Set<string>();
    for (const t of targetTables) {
      const idx = t.columns.indexOf(section.field);
      for (const row of t.rows) values.add(String(row[idx] ?? ''));
    }
    control = [...values].sort().map(
      (v) => `<label><input type="checkbox" value="${escapeHtml(v)}" checked>${escapeHtml(v)}</label>`,
    ).join('');
  }
  return `<div class="filter-card" data-filter="${escapeHtml(section.id)}" data-field="${escapeHtml(section.field)}" data-kind="${section.kind}" data-tables="${escapeHtml(targetIds.join(','))}"><div class="filter-label">${label}</div>${control}</div>`;
}

// --------------------------------------------------------------------------
// buildReport
// --------------------------------------------------------------------------

export async function buildReport(
  project: Project,
  spec: ReportSpec,
  context: ReportBuildContext = {},
): Promise<Uint8Array> {
  const lang: ReportLang = spec.lang === 'zh' ? 'zh' : 'en';
  const theme: ReportTheme = spec.theme === 'dark' ? 'dark' : 'light';
  const labels = LABELS[lang];

  // Pre-resolve table data so filters can read every later table's columns.
  const tableData: Array<{ id: string; columns: string[]; rows: CellValue[][]; total: number }> = [];
  for (const section of spec.sections) {
    if (section.type !== 'table') continue;
    let columns: string[] = section.columns ?? [];
    let rows: CellValue[][] = [];
    let total = 0;
    if (section.rows) {
      rows = section.rows.map((r) => [...r]);
      total = rows.length;
      if (columns.length === 0) columns = rows[0]?.map((_, i) => `col${i + 1}`) ?? [];
    } else if (section.fileId) {
      const file = project.data.files.find((f) => f.id === section.fileId);
      if (file) {
        const parsed = parseCsv(file.content ?? '');
        if (columns.length === 0) columns = parsed.columns;
        rows = parsed.rows;
        total = rows.length;
      }
    }
    tableData.push({ id: section.id, columns, rows, total });
  }

  const body: string[] = [];
  for (let i = 0; i < spec.sections.length; i += 1) {
    const section = spec.sections[i];
    if (!section) continue;

    if (section.type === 'heading') {
      const level = section.level ?? 2;
      body.push(`<h${level}>${escapeHtml(section.text)}</h${level}>`);
    } else if (section.type === 'markdown') {
      body.push(`<div class="markdown">${mdToHtml(section.text)}</div>`);
    } else if (section.type === 'figure') {
      let svg = section.svg ?? null;
      if (!svg && section.sheetId) {
        if (context.resolveFigure) {
          svg = (await context.resolveFigure(section.sheetId)) ?? null;
        }
        if (!svg) {
          const sheet = project.state.figureSheets?.find((f) => f.id === section.sheetId);
          if (sheet) {
            svg = sheet.panels.map((p) => sanitizeSvg(renderSVG(p.spec))).join('\n');
          }
        }
      }
      if (!svg) {
        body.push(
          `<figure><p class="warn">${labels.missingFigure} ${escapeHtml(section.sheetId ?? '?')}</p></figure>`,
        );
      } else {
        const caption = section.caption ? `<figcaption>${escapeHtml(section.caption)}</figcaption>` : '';
        body.push(`<figure>${sanitizeSvg(svg)}${caption}</figure>`);
      }
    } else if (section.type === 'table') {
      const data = tableData.find((t) => t.id === section.id);
      if (!data || (data.rows.length === 0 && section.fileId && !project.data.files.some((f) => f.id === section.fileId))) {
        body.push(
          `<div class="filter-card"><p class="warn">${labels.missingFile}</p></div>`,
        );
        continue;
      }
      if (!data || data.columns.length === 0) {
        body.push(section.title ? `<h3>${escapeHtml(section.title)}</h3>` : '');
        continue;
      }
      // Filters defined BEFORE this table apply to it.
      const applicable = spec.sections
        .slice(0, i)
        .filter(
          (s): s is FilterSection =>
            s.type === 'filter' &&
            data.columns.includes(s.field) &&
            (!s.targetTableIds || s.targetTableIds.includes(section.id)),
        )
        .map((s) => s.id);
      body.push(renderTableHtml(section, data.columns, data.rows, data.total, labels, applicable));
    } else if (section.type === 'runs-summary') {
      body.push(renderRunsSummary(section, context.runs ?? [], labels));
    } else if (section.type === 'filter') {
      // Filters only bind tables declared LATER in the document.
      const laterTableIds = new Set(
        spec.sections
          .slice(i + 1)
          .filter((s): s is TableSection => s.type === 'table')
          .map((s) => s.id),
      );
      const laterTables = tableData.filter((t) => laterTableIds.has(t.id));
      body.push(renderFilter(section, labels, laterTables));
    }
  }

  const generated = (context.now ?? new Date()).toISOString();
  const html = `<!doctype html>
<html lang="${lang}" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(spec.title)}</title>
<style>${reportCss(theme)}</style>
</head>
<body>
<div class="wrap">
<header class="report-head">
<h1>${escapeHtml(spec.title)}</h1>
${spec.subtitle ? `<p class="subtitle">${escapeHtml(spec.subtitle)}</p>` : ''}
<p class="meta">${escapeHtml(project.name)} · ${labels.generated} ${escapeHtml(generated)}</p>
</header>
${body.join('\n')}
</div>
<script>${reportJs()}</script>
</body>
</html>`;

  return new TextEncoder().encode(html);
}

/** Convenience: build and decode to an HTML string. */
export async function buildReportHtml(
  project: Project,
  spec: ReportSpec,
  context: ReportBuildContext = {},
): Promise<string> {
  const bytes = await buildReport(project, spec, context);
  return new TextDecoder().decode(bytes);
}
