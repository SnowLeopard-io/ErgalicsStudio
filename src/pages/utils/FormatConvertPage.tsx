// ==========================================================================
// Ergalics Studio — Format Converter (utility toolkit)
//
// Converts tabular text between CSV / TSV / JSON / Markdown. Parsing is
// RFC-4180 aware (quoted cells, escaped quotes); JSON accepts arrays of
// objects, arrays of arrays and column-maps. No project data involved.
// ==========================================================================

import { useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { ClipboardIcon, DownloadIcon } from '@/components/icons';

type Fmt = 'csv' | 'tsv' | 'json' | 'md';

interface Table {
  header: string[] | null;
  rows: string[][];
}

const DELIMS: Array<{ id: string; char: string; key: string }> = [
  { id: 'comma', char: ',', key: 'fc.delim.comma' },
  { id: 'semicolon', char: ';', key: 'fc.delim.semicolon' },
  { id: 'tab', char: '\t', key: 'fc.delim.tab' },
  { id: 'pipe', char: '|', key: 'fc.delim.pipe' },
];

const EXT: Record<Fmt, string> = { csv: 'csv', tsv: 'tsv', json: 'json', md: 'md' };

// ---- CSV (RFC 4180) --------------------------------------------------------

function splitDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && (r[0] ?? '').trim() === ''));
}

/** Pick the delimiter that appears most often outside quoted sections. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',';
}

// ---- format detection + parsers -------------------------------------------

function looksLikeJson(text: string): boolean {
  const s = text.trimStart();
  return s.startsWith('{') || s.startsWith('[');
}

function looksLikeMarkdown(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  return lines.length >= 2 && lines.every((l) => l.trim().startsWith('|'));
}

function parseJsonTable(text: string): Table {
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) {
    if (data.length === 0) return { header: null, rows: [] };
    if (data.every((r) => Array.isArray(r))) {
      return { header: null, rows: (data as unknown[][]).map((r) => r.map((c) => stringifyCell(c))) };
    }
    const keys: string[] = [];
    for (const item of data) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('unsupported JSON structure');
      }
      for (const k of Object.keys(item as Record<string, unknown>)) {
        if (!keys.includes(k)) keys.push(k);
      }
    }
    const rows = (data as Record<string, unknown>[]).map((item) => keys.map((k) => stringifyCell(item[k])));
    return { header: keys, rows };
  }
  if (data !== null && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return { header: null, rows: [] };
    if (entries.every(([, v]) => Array.isArray(v))) {
      const width = Math.max(...entries.map(([, v]) => (v as unknown[]).length));
      if (!entries.every(([, v]) => (v as unknown[]).length === width)) {
        throw new Error('column lengths differ');
      }
      return {
        header: entries.map(([k]) => k),
        rows: Array.from({ length: width }, (_, i) => entries.map(([, v]) => stringifyCell((v as unknown[])[i]))),
      };
    }
  }
  throw new Error('unsupported JSON structure');
}

function stringifyCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function parseMarkdown(text: string, hasHeader: boolean): Table {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const cells = lines.map((l) => {
    let s = l;
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  });
  const sepRow = cells[1];
  if (cells.length >= 2 && sepRow && sepRow.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) {
    cells.splice(1, 1);
  }
  if (cells.length === 0) throw new Error('empty table');
  if (hasHeader) return { header: cells[0] ?? [], rows: cells.slice(1) };
  return { header: null, rows: cells };
}

// ---- serializers -----------------------------------------------------------

function csvCell(v: string, delim: string): string {
  if (v.includes(delim) || v.includes('"') || /[\n\r]/.test(v)) {
    return `"${v.replaceAll('"', '""')}"`;
  }
  return v;
}

function toDelimited(table: Table, delim: string): string {
  const lines: string[] = [];
  if (table.header) lines.push(table.header.map((h) => csvCell(h, delim)).join(delim));
  for (const row of table.rows) lines.push(row.map((c) => csvCell(c, delim)).join(delim));
  return lines.join('\n');
}

function toMarkdown(table: Table): string {
  const cols = table.header?.length ?? Math.max(0, ...table.rows.map((r) => r.length));
  if (cols === 0) return '';
  const width = Array.from({ length: cols }, (_, i) => {
    const cells = [
      ...(table.header ? [table.header[i] ?? ''] : []),
      ...table.rows.map((r) => r[i] ?? ''),
    ];
    return Math.max(3, ...cells.map((c) => c.replaceAll('|', '\\|').length));
  });
  const fmt = (row: string[]) => `| ${width.map((w, i) => (row[i] ?? '').replaceAll('|', '\\|').padEnd(w)).join(' | ')} |`;
  const header = table.header ?? Array.from({ length: cols }, (_, i) => `col${i + 1}`);
  const sep = `| ${width.map((w) => '-'.repeat(w)).join(' | ')} |`;
  const body = table.rows.map(fmt);
  return [fmt(header), sep, ...body].join('\n');
}

function toNumericCell(raw: string): string | number {
  const s = raw.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

function toJson(table: Table, numbers: boolean): string {
  const conv = (c: string) => (numbers ? toNumericCell(c) : c);
  if (table.header) {
    const objs = table.rows.map((r) => {
      const o: Record<string, string | number> = {};
      table.header!.forEach((h, i) => { o[h] = conv(r[i] ?? ''); });
      return o;
    });
    return JSON.stringify(objs, null, 2);
  }
  return JSON.stringify(table.rows.map((r) => r.map(conv)), null, 2);
}

// ---- page ------------------------------------------------------------------

function detectFormat(text: string): Fmt | null {
  if (text.trim() === '') return null;
  if (looksLikeJson(text)) return 'json';
  if (looksLikeMarkdown(text)) return 'md';
  return 'csv';
}

export default function FormatConvertPage() {
  const t = useT();
  const [input, setInput] = useState('');
  const [outFmt, setOutFmt] = useState<Fmt>('json');
  const [hasHeader, setHasHeader] = useState(true);
  const [delimId, setDelimId] = useState('comma');
  const [jsonNumbers, setJsonNumbers] = useState(true);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const delim = DELIMS.find((d) => d.id === delimId)?.char ?? ',';

  const parsed = useMemo<{ table: Table | null; error: string; inFmt: Fmt | null; inDelim?: string }>(() => {
    if (input.trim() === '') return { table: null, error: '', inFmt: null };
    const inFmt = detectFormat(input);
    try {
      if (inFmt === 'json') return { table: parseJsonTable(input), error: '', inFmt };
      if (inFmt === 'md') return { table: parseMarkdown(input, hasHeader), error: '', inFmt };
      const d = detectDelimiter(input);
      const rows = splitDelimited(input, d);
      if (rows.length === 0) throw new Error('empty table');
      const table: Table = hasHeader ? { header: rows[0] ?? [], rows: rows.slice(1) } : { header: null, rows };
      return { table, error: '', inFmt, inDelim: d };
    } catch (err) {
      return { table: null, error: err instanceof Error ? err.message : String(err), inFmt };
    }
  }, [input, hasHeader]);

  const output = useMemo(() => {
    const { table } = parsed;
    if (!table) return '';
    try {
      if (outFmt === 'json') return toJson(table, jsonNumbers);
      if (outFmt === 'md') return toMarkdown(table);
      return toDelimited(table, outFmt === 'tsv' ? '\t' : delim);
    } catch {
      return '';
    }
  }, [parsed, outFmt, delim, jsonNumbers]);

  const detectedLabel = parsed.inFmt === null
    ? ''
    : t('fc.detected', { fmt: t(`fc.fmt.${parsed.inFmt}`) });

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '').replace(/^\uFEFF/, '');
      setInput(text);
      const fmt = detectFormat(text);
      if (fmt) setOutFmt(fmt === 'csv' ? 'json' : fmt === 'json' ? 'csv' : fmt);
    };
    reader.readAsText(file, 'utf-8');
  };

  const download = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converted.${EXT[outFmt]}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (private mode) — user can select manually */
    }
  };

  const dims = parsed.table
    ? t('fc.rows_cols', { rows: parsed.table.rows.length, cols: parsed.table.header?.length ?? parsed.table.rows[0]?.length ?? 0 })
    : '';

  return (
    <ToolShell toolId="format-convert">
      <div className="util-page util-page-wide">
        <div
          className={`fc-drop${dragging ? ' fc-drop-drag' : ''}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) readFile(file);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}
        >
          {t('fc.drop')}
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,.json,.md"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readFile(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className="util-card">
          <div className="util-row util-between">
            <h2 className="util-card-title">{t('fc.paste')}</h2>
            <span className="util-note">{detectedLabel} {dims}</span>
          </div>
          <textarea
            className="input util-mono fc-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            aria-label={t('fc.paste')}
          />
          {parsed.error && <p className="util-error">{t('fc.error_parse', { reason: parsed.error })}</p>}
        </div>

        <div className="util-card">
          <div className="util-row">
            <label className="field-label" htmlFor="fc-out">{t('fc.to')}</label>
            <select id="fc-out" className="select" value={outFmt} onChange={(e) => setOutFmt(e.target.value as Fmt)}>
              <option value="csv">{t('fc.fmt.csv')}</option>
              <option value="tsv">{t('fc.fmt.tsv')}</option>
              <option value="json">{t('fc.fmt.json')}</option>
              <option value="md">{t('fc.fmt.md')}</option>
            </select>
            {(outFmt === 'csv' || parsed.inFmt === 'csv') && (
              <>
                <label className="field-label" htmlFor="fc-delim">{t('fc.delimiter')}</label>
                <select
                  id="fc-delim"
                  className="select"
                  value={delimId}
                  onChange={(e) => setDelimId(e.target.value)}
                >
                  {DELIMS.map((d) => <option key={d.id} value={d.id}>{t(d.key)}</option>)}
                </select>
              </>
            )}
            <label className="fc-check">
              <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              {t('fc.header')}
            </label>
            {outFmt === 'json' && (
              <label className="fc-check">
                <input type="checkbox" checked={jsonNumbers} onChange={(e) => setJsonNumbers(e.target.checked)} />
                {t('fc.json_numbers')}
              </label>
            )}
            <span className="util-flex1" />
            <button type="button" className="btn btn-sm" disabled={!output} onClick={copy}>
              <ClipboardIcon size={13} /> {copied ? t('common.copied') : t('common.copy')}
            </button>
            <button type="button" className="btn btn-sm" disabled={!output} onClick={download}>
              <DownloadIcon size={13} /> {t('fc.download')}
            </button>
          </div>

          <textarea
            className="input util-mono fc-input"
            value={output}
            readOnly
            spellCheck={false}
            aria-label={t('fc.to')}
          />

          {parsed.table && (
            <>
              <h2 className="util-card-title">{t('fc.preview')}</h2>
              <div className="util-table-wrap">
                <table className="util-table">
                  {parsed.table.header && (
                    <thead>
                      <tr>{parsed.table.header.map((h, i) => <th key={i}>{h}</th>)}</tr>
                    </thead>
                  )}
                  <tbody>
                    {parsed.table.rows.slice(0, 8).map((row, ri) => (
                      <tr key={ri}>{row.map((c, ci) => <td key={ci}>{c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
