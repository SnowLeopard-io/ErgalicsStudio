// ==========================================================================
// Ergalics Studio — collaborative notebook exporters (HTML / DOCX / Jupyter)
//
// All exporters are pure TS and dependency-light: DOCX is a minimal but valid
// WordprocessingML package built with fflate, Jupyter is nbformat v4 with one
// markdown/code cell per notebook cell, and HTML is a self-contained document
// (no external assets) that also serves as the print-to-PDF target.
// ==========================================================================

import { strToU8, zipSync } from 'fflate';
import { crdtText, type CollabNote } from './collab';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'notebook'
  );
}

/** Export file stem derived from the notebook title. */
export function notebookFileStem(note: CollabNote): string {
  return slug(note.title);
}

/** Minimal Markdown → HTML for the standalone export (headings, lists, code). */
function markdownToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(inCode ? '</code></pre>' : '<pre class="code"><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${escapeXml(line)}\n`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      const level = heading[1]?.length ?? 1;
      out.push(`<h${level}>${escapeXml(heading[2] ?? '')}</h${level}>`);
      continue;
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${escapeXml(item[1] ?? '')}</li>`);
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    if (line.trim()) out.push(`<p>${escapeXml(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

/** Self-contained HTML export (also used for print-to-PDF). */
export function notebookToHtml(note: CollabNote): string {
  const cells = note.cells
    .map((cell) => {
      const text = crdtText(cell.crdt);
      return cell.type === 'code'
        ? `<section class="cell code"><pre><code>${escapeXml(text)}</code></pre></section>`
        : `<section class="cell md">${markdownToHtml(text)}</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeXml(note.title)}</title>
<style>
body{margin:0;background:#eef0f3;color:#1a1c1e;font:16px/1.65 Georgia,"Times New Roman",serif}
main{max-width:860px;margin:24px auto;background:#fff;padding:48px 56px;box-shadow:0 2px 18px rgba(0,0,0,.12)}
h1,h2,h3{line-height:1.25}
.cell{margin:14px 0}
.cell.code pre{background:#f6f7f9;border:1px solid #dfe1e5;border-radius:8px;padding:12px;overflow:auto;font:13px/1.5 ui-monospace,Consolas,monospace}
ul{padding-left:24px}
@media print{body{background:#fff}main{box-shadow:none;margin:0;padding:0;max-width:none}}
</style>
</head>
<body><main><h1>${escapeXml(note.title)}</h1>${cells}</main></body>
</html>`;
}

/** Jupyter nbformat v4 export. */
export function notebookToIpynb(note: CollabNote): string {
  const cells = note.cells.map((cell) => ({
    cell_type: cell.type === 'code' ? 'code' : 'markdown',
    metadata: {},
    source: crdtText(cell.crdt).split('\n').map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line)),
    ...(cell.type === 'code' ? { execution_count: null, outputs: [] } : {}),
  }));
  return JSON.stringify(
    {
      cells,
      metadata: {
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
        language_info: { name: 'python', version: '3' },
        title: note.title,
      },
      nbformat: 4,
      nbformat_minor: 5,
    },
    null,
    2,
  );
}

/** Minimal WordprocessingML document. */
function docxDocument(note: CollabNote): string {
  const paragraphs: string[] = [];
  paragraphs.push(
    `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(note.title)}</w:t></w:r></w:p>`,
  );
  for (const cell of note.cells) {
    const text = crdtText(cell.crdt);
    const chunks = cell.type === 'code' ? text.split('\n') : markdownToPlain(text).split('\n');
    for (const line of chunks) {
      paragraphs.push(
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
}

function markdownToPlain(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

/** DOCX export (a zip with the four required WordprocessingML parts). */
export function notebookToDocx(note: CollabNote): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
      'word/document.xml': strToU8(docxDocument(note)),
      'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`),
    },
    { level: 6 },
  );
}
