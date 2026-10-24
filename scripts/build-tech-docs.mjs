#!/usr/bin/env node
// ==========================================================================
// Ergalics Studio — technical-docs typesetting pipeline
//
// md → paged HTML → A4 PDF for docs/technical/*.md
//
// Why this exists: the previous md → HTML → PDF chain lived in an untracked
// scratch directory and was lost, leaving 9 hand-authored HTML files with a
// fixed-height `.page` layout whose content had to be balanced by hand — a
// job that silently clips content the moment any section grows. This script
// keeps the same visual language (cover / TOC with real page numbers /
// numbered section badges / callouts / same palette & fonts) but derives the
// page breaks by *measuring* the rendered blocks in a headless browser and
// packing them, so nothing overflows and the TOC numbers are always right.
//
// Mermaid fences are rendered to inline SVG at build time (no client-side
// script in the output), so the PDFs carry real vector diagrams.
//
// Usage:
//   node scripts/build-tech-docs.mjs                 # all docs: html + pdf
//   node scripts/build-tech-docs.mjs --only 05       # one doc (prefix match)
//   node scripts/build-tech-docs.mjs --html-only     # skip PDF printing
//   node scripts/build-tech-docs.mjs --keep-temp     # keep temp HTML for debug
// ==========================================================================

import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(ROOT, 'docs', 'technical');
// The product overview is a standalone volume, not part of the technical
// series: it reads from its own directory and carries its own cover brand,
// slogan and footnote instead of the series defaults.
const PRODUCT_DIR = path.join(ROOT, 'docs', 'product');
const PRODUCT_SLOGAN = '让科学计算 回归触手可及';
const PRODUCT_DOCS = {
  'Ergalics-Studio': {
    dir: PRODUCT_DIR,
    foot: '版本 2.0.0 · MIT License · SnowLeopard-io',
    brand: 'ERGALICS STUDIO',
  },
};
// Solver submission volumes are standalone deliverables: they carry their own
// repo address instead of the studio brand — no studio QR codes, no studio
// mission. Author attribution stays.
const SOLVER_DOCS = {
  '09-电磁谐振特征值求解器': {
    repo: 'https://gitee.com/cnt-code/em-eigensolver',
    tagline: 'em-eigensolver',
  },
  '10-流体双向耦合求解器': {
    repo: 'https://gitee.com/cnt-code/fluid-cfd-coupler',
    tagline: 'fluid-cfd-coupler',
  },
  '10-流体双向耦合求解器-容器化部署手册': {
    repo: 'https://gitee.com/cnt-code/fluid-cfd-coupler',
    tagline: 'fluid-cfd-coupler',
  },
};
function docDir(base) {
  return PRODUCT_DOCS[base]?.dir || DOCS_DIR;
}
const MERMAID_JS = path.join(ROOT, 'tmp', 'mdlib', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');

const argv = process.argv.slice(2);
const HTML_ONLY = argv.includes('--html-only');
const KEEP_TEMP = argv.includes('--keep-temp');
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 ? argv[i + 1] : null;
})();
// --solver: build the standalone solver submission volumes. Same file bases as
// the studio's own technical docs, but with solver-repo branding on the cover
// and back matter instead of the studio identity.
const SOLVER_MODE = argv.includes('--solver');

// --------------------------------------------------------------------------
// 1. Markdown subset parser → flat block list
// --------------------------------------------------------------------------

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline markdown: code spans, images, links, bold, emphasis. */
function inline(src) {
  // Code spans are masked first: the docs routinely bold a phrase that
  // *contains* an inline code span (e.g. **参数扫描（`sweeps`）**), and
  // splitting on backticks before bolding would cut the **…** pair in half.
  const codes = [];
  const masked = src.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  let t = esc(masked);
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s（(、])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

const CN_NUM = '一二三四五六七八九十';

/** "一、总体分层" → { num: '一', text: '总体分层' } */
function splitCjkNumeral(title) {
  const m = new RegExp(`^([${CN_NUM}]+)\\s*[、.]\\s*(.*)$`).exec(title);
  return m ? { num: m[1], text: m[2] } : { num: null, text: title };
}

/** "第一章 项目概览" → { num: '一', text: '项目概览' } (compendium chapters) */
function splitChapterHeading(title) {
  const m = new RegExp(`^第([${CN_NUM}\\d]+)章\\s*(.*)$`).exec(title);
  if (!m) return null;
  const digits = /^\d+$/.test(m[1])
    ? m[1]
    : String(
        m[1].split('').reduce((acc, c) => {
          const idx = CN_NUM.indexOf(c);
          if (idx < 0) return acc;
          return c === '十' ? (acc === 0 ? 10 : acc * 10) : acc + idx + 1;
        }, 0),
      );
  return { num: digits, text: m[2] || title };
}

function splitSubNumeral(title) {
  const m = /^(\d+(?:\.\d+)*)\s+(.*)$/.exec(title);
  return m ? { num: m[1], text: m[2] } : { num: null, text: title };
}

/**
 * Parse the markdown subset used across docs/technical into a flat list of
 * blocks. Each block is { html, kind, text } where `html` is emitted verbatim
 * into a `.page` and `kind` drives pagination rules.
 */
function parseMarkdown(md) {
  const lines = md.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let title = null;
  let i = 0;

  const flushParagraph = (buf) => {
    if (!buf.length) return;
    const text = buf.join(' ').trim();
    if (text) blocks.push({ kind: 'p', text, html: `<p>${inline(text)}</p>` });
    buf.length = 0;
  };

  let para = [];

  while (i < lines.length) {
    const line = lines[i];

    // explicit page break: `<!-- pagebreak -->` closes the current page
    if (/^\s*<!--\s*pagebreak\s*-->\s*$/.test(line)) {
      flushParagraph(para);
      blocks.push({ kind: 'pagebreak', text: '', html: '<div class="pb"></div>' });
      i++;
      continue;
    }

    // fenced code / mermaid
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushParagraph(para);
      const lang = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      const code = body.join('\n');
      if (lang === 'gallery') {
        // Thumbnail grid: one "src|caption" line per cell.
        const items = body
          .map((l) => {
            const at = l.indexOf('|');
            return at < 0 ? null : { src: l.slice(0, at).trim(), cap: l.slice(at + 1).trim() };
          })
          .filter(Boolean);
        blocks.push({
          kind: 'gallery',
          text: items.map((it) => it.cap).join('、'),
          html: `<div class="gallery">${items
            .map(
              (it) =>
                `<figure><img src="${it.src}" alt="${esc(it.cap)}"><figcaption>${inline(it.cap)}</figcaption></figure>`,
            )
            .join('')}</div>`,
        });
        continue;
      }
      if (lang === 'mermaid') {
        blocks.push({ kind: 'mermaid', text: code, html: null, mermaid: code });
      } else if (lang === 'card') {
        // Research-scene card: first line is the title, remaining lines are
        // "label｜body" rows rendered as a definition list. Used by the product
        // volume to explain what each research tool is for and why it exists.
        const rows = code
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const title = rows[0] ?? '';
        const items = rows
          .slice(1)
          .map((r) => {
            const sep = r.indexOf('｜');
            return sep > 0
              ? `<div><dt>${esc(r.slice(0, sep))}</dt><dd>${inline(r.slice(sep + 1))}</dd></div>`
              : `<div><dd>${inline(r)}</dd></div>`;
          })
          .join('');
        blocks.push({
          kind: 'card',
          text: title,
          html: `<div class="rcard"><div class="rcard-t">${esc(title)}</div><dl>${items}</dl></div>`,
        });
      } else {
        blocks.push({
          kind: 'code',
          text: code,
          html: `<pre><code>${esc(code)}</code></pre>`,
        });
      }
      continue;
    }

    // table
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flushParagraph(para);
      const rows = [];
      // Split on *unescaped* pipes only: `\|` is how a cell writes a literal
      // pipe (e.g. an absolute-value formula), and splitting on it would break
      // the row into an extra column.
      const splitRow = (l) =>
        l
          .trim()
          .replace(/^\|/, '')
          .replace(/(?<!\\)\|\s*$/, '')
          .split(/(?<!\\)\|/)
          .map((c) => c.trim().replace(/\\\|/g, '|'));
      const header = splitRow(lines[i]);
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
      const th = header.map((c) => `<th>${inline(c)}</th>`).join('');
      const body = rows
        .map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
        .join('');
      blocks.push({
        kind: 'table',
        text: header.join(' | '),
        html: `<table${header.length === 4 ? ' class="c4"' : ''}><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`,
      });
      continue;
    }

    // blockquote → callout
    if (/^>\s?/.test(line)) {
      flushParagraph(para);
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({
        kind: 'callout',
        text: buf.join(' '),
        html: `<div class="callout">${inline(buf.join(' ').trim())}</div>`,
      });
      continue;
    }

    // headings
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      const raw = h[2].trim();
      i++;
      if (level === 1) {
        title = raw;
        continue;
      }
      if (level === 2) {
        const chapter = splitChapterHeading(raw);
        const { num, text } = chapter ?? splitCjkNumeral(raw);
        blocks.push({
          kind: 'h2',
          text: raw,
          chapterTitle: text,
          num,
          html: `<h2 class="sec">${num ? `<span class="num">${num}</span>` : ''}${inline(text)}</h2>`,
        });
        continue;
      }
      if (level === 3) {
        const { num, text } = splitSubNumeral(raw);
        blocks.push({
          kind: 'h3',
          text: raw,
          sectionTitle: text,
          num,
          html: `<h3>${num ? `<span class="hn">${num}</span>` : ''}${inline(text)}</h3>`,
        });
        continue;
      }
      blocks.push({ kind: 'h4', text: raw, html: `<h4>${inline(raw)}</h4>` });
      continue;
    }

    // standalone image → figure (an italic-only line right after it is its caption)
    const imgOnly = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
    if (imgOnly) {
      flushParagraph(para);
      let cap = '';
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const capM = j < lines.length ? /^\*([^*][\s\S]*?)\*$/.exec(lines[j].trim()) : null;
      if (capM) {
        cap = capM[1];
        i = j + 1;
      } else {
        i++;
      }
      // An explicit italic caption wins; otherwise the alt text becomes the
      // caption, so a screenshot is never left uncaptioned in the PDF.
      const caption = cap || imgOnly[1];
      blocks.push({
        kind: 'figure',
        text: caption,
        html:
          `<figure><img src="${imgOnly[2]}" alt="${esc(imgOnly[1])}">` +
          (caption ? `<figcaption>${inline(caption)}</figcaption>` : '') +
          '</figure>',
      });
      continue;
    }

    // list (unordered / ordered, one nesting level)
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      flushParagraph(para);
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i])) {
        const indent = /^(\s*)/.exec(lines[i])[1].length;
        const content = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '');
        items.push({ indent, content });
        i++;
      }
      const base = Math.min(...items.map((x) => x.indent));
      let html = ordered ? '<ol>' : '<ul>';
      let depth = 0;
      for (const it of items) {
        const d = it.indent > base ? 1 : 0;
        while (depth < d) {
          html += ordered ? '<ol>' : '<ul>';
          depth++;
        }
        while (depth > d) {
          html += ordered ? '</ol>' : '</ul>';
          depth--;
        }
        html += `<li>${inline(it.content.trim())}</li>`;
      }
      while (depth > 0) {
        html += ordered ? '</ol>' : '</ul>';
        depth--;
      }
      html += ordered ? '</ol>' : '</ul>';
      blocks.push({ kind: 'list', text: items.map((x) => x.content).join(' '), html });
      continue;
    }

    // horizontal rule
    if (/^---+\s*$/.test(line)) {
      flushParagraph(para);
      blocks.push({ kind: 'hr', text: '', html: '<hr>' });
      i++;
      continue;
    }

    // blank
    if (/^\s*$/.test(line)) {
      flushParagraph(para);
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushParagraph(para);

  return { title, blocks };
}

// --------------------------------------------------------------------------
// 2. Stylesheet (carried over from the previous hand-authored docs)
// --------------------------------------------------------------------------

const CSS = `
  :root {
    --ink: #0f172a; --body: #1e293b; --muted: #64748b;
    --accent: #0e7490; --accent-deep: #155e75; --accent-soft: #ecfeff;
    --gold: #b45309; --gold-soft: #fffbeb; --line: #e2e8f0; --soft: #f8fafc;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
    color: var(--body); font-size: 10.5pt; line-height: 1.8;
  }
  @page { size: A4; margin: 0; }
  .page {
    position: relative; width: 210mm; height: 296.5mm;
    padding: 16mm 15mm 18mm; page-break-after: always; overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  body { counter-reset: pn 0; }
  .page { counter-increment: pn; }
  .page::after {
    content: counter(pn, decimal-leading-zero);
    position: absolute; left: 70mm; right: 70mm; bottom: 7mm;
    text-align: center; border-top: 1px solid var(--line); padding-top: 2mm;
    font-size: 8.5pt; color: var(--accent-deep); letter-spacing: 2px;
  }
  .cover::after { content: none; }
  .cover { padding: 0; }
  .cover-panel {
    height: 100%; border-radius: 0;
    background: linear-gradient(160deg, #083344 0%, #155e75 55%, #0e7490 100%);
    color: #f0fdfa; padding: 26mm 20mm 22mm;
    display: flex; flex-direction: column;
  }
  .cover-brand { font-size: 11pt; letter-spacing: 8px; color: #67e8f9; margin-bottom: 5mm; }
  .cover h1 { font-size: 36pt; margin: 0; color: #ffffff; line-height: 1.25; letter-spacing: 1px; }
  .cover .sub { font-size: 13.5pt; color: #a5f3fc; margin-top: 4mm; letter-spacing: 1.5px; }
  .cover-rule { width: 34mm; height: 3px; background: #67e8f9; margin: 7mm 0; border-radius: 2px; }
  .cover-abstract { font-size: 11pt; line-height: 1.95; color: #ccfbf1; text-align: justify; max-width: 155mm; }
  /* Three QR codes — one per online home — side by side, each captioned
     underneath. Kept in flow (not absolutely placed) so a growing synopsis
     pushes the row down instead of sliding the text underneath it. */
  .cover-res {
    display: flex; justify-content: center; align-items: flex-start;
    gap: 9mm; margin-top: 8mm; padding-top: 5mm;
    border-top: 1px solid rgba(103, 232, 249, .3);
  }
  .cover-res .qr-item { width: 50mm; text-align: center; }
  .cover-res .qr-box {
    width: 38mm; height: 38mm; margin: 0 auto; padding: 1.7mm;
    background: #ffffff; border-radius: 3px;
  }
  .cover-res .qr-box svg { width: 100%; height: 100%; display: block; }
  .cover-res .qr-cap {
    display: block; margin-top: 2.6mm;
    font-size: 10pt; letter-spacing: 2px; color: #ffffff; text-decoration: none;
  }
  /* One line per address: at 6.8pt the longest of the three fits inside the
     50mm column, so it never breaks at a hyphen. */
  .cover-res .qr-sub {
    font-size: 6.8pt; color: #a5f3fc; margin-top: 1.2mm; line-height: 1.4;
  }
  .cover-modes { margin-top: auto; }
  .cover-modes .cap { font-size: 9.5pt; letter-spacing: 3px; color: #67e8f9; margin-bottom: 3mm; }
  .mode-chips { display: flex; flex-wrap: wrap; gap: 3mm; }
  .mode-chip {
    flex: 1 1 auto; min-width: 34mm; /* basis follows the title; extra space is shared */
    border: 1px solid rgba(103, 232, 249, .45); border-radius: 8px; padding: 3.2mm 3mm; text-align: center;
  }
  .mode-chip .t { font-size: 10.5pt; font-weight: bold; color: #ffffff; line-height: 1.4; white-space: nowrap; }
  .mode-chip .d { font-size: 8pt; color: #a5f3fc; margin-top: 1.4mm; line-height: 1.5; }
  .cover-foot { margin-top: 6mm; font-size: 9.5pt; color: #67e8f9; letter-spacing: 2px; }
  /* Closing page — the cover's counterpart, reached after the last chapter.
     It reuses the .cover page (no page number, no padding) and the
     .cover-panel shell (and so the cover's own overflow guard) on a slightly
     deeper gradient, so a volume opens and closes on the same note instead of
     ending on a dangling section. */
  .cover-panel.back { background: linear-gradient(155deg, #062c3a 0%, #0f4c5c 58%, #155e75 100%); padding: 30mm 22mm 22mm; }
  .back-brand { font-size: 10.5pt; letter-spacing: 8px; color: #67e8f9; }
  /* The statement occupies the space between the brand mark and the colophon
     and centres inside it. Centring via flex:1 rather than auto margins
     matters: an auto margin resolves to a used value, which the overflow guard
     would read as a real margin and flag as a phantom overflow. */
  .back-main { flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .back-rule { width: 34mm; height: 3px; background: #67e8f9; margin: 0 0 9mm; border-radius: 2px; }
  .back-tag .l1 { font-size: 13.5pt; letter-spacing: 6px; color: #a5f3fc; }
  .back-tag .l2 { font-size: 26pt; color: #ffffff; letter-spacing: 2px; line-height: 1.5; margin-top: 4mm; }
  .back-body { margin-top: 13mm; max-width: 152mm; text-align: justify; }
  .back-body p { margin: 0 0 5mm; font-size: 10.5pt; line-height: 2.05; color: #ccfbf1; }
  /* The signature is printed, not just linked: a PDF has no hover state, so a
     bare name would carry no address. */
  .back-sig { margin-top: 3mm; display: flex; align-items: baseline; gap: 3mm; }
  .back-sig .who { font-size: 8.4pt; letter-spacing: 2px; color: #67e8f9; }
  .back-sig a { font-size: 11.5pt; letter-spacing: 1px; color: #ffffff; text-decoration: none; }
  .back-sig .at { font-size: 8.6pt; color: #a5f3fc; }
  /* Sits at the panel foot because .back-main above it absorbs all the slack. */
  .back-foot {
    padding-top: 7mm;
    border-top: 1px solid rgba(103, 232, 249, .3);
    display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm;
  }
  .back-foot .homes { display: flex; flex-direction: column; gap: 1.6mm; }
  .back-foot .homes > div { display: flex; align-items: baseline; gap: 3mm; }
  .back-foot .homes .h { min-width: 11mm; font-size: 8.4pt; letter-spacing: 2px; color: #67e8f9; }
  .back-foot .homes a { font-size: 8.8pt; color: #ccfbf1; text-decoration: none; }
  .back-foot .colophon { font-size: 9pt; color: #67e8f9; letter-spacing: 2px; text-align: right; }
  .toc h1 { font-size: 22pt; color: var(--ink); margin: 10mm 0 12mm; }
  .toc-item { display: flex; align-items: baseline; margin: 7px 0; }
  .toc-item.l2 { margin-left: 10mm; color: var(--muted); font-size: 10pt; }
  .toc-item.l3 { margin-left: 20mm; color: var(--muted); font-size: 9.4pt; }
  .toc-item.l1 { font-weight: bold; color: var(--ink); font-size: 11.5pt; margin-top: 14px; }
  .toc-item .dots { flex: 1; border-bottom: 1.5px dotted #cbd5e1; margin: 0 8px; transform: translateY(-3px); }
  .toc-item .tp { color: var(--accent-deep); }
  h2.sec { font-size: 17pt; color: var(--ink); margin: 0 0 6mm; display: flex; align-items: center; gap: 10px; }
  /* Numeral badge. A fixed 26px square fits 一…十, but the CJK numerals for
     sections 11+ (十一 … 十四) are two glyphs wide and spill out of it. Use a
     min-width so single-glyph badges stay square and wider numerals grow into
     a pill instead of overflowing. */
  h2.sec .num {
    background: var(--accent); color: #fff; font-size: 11pt;
    min-width: 26px; height: 26px; padding: 0 6px; border-radius: 6px; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
    white-space: nowrap;
  }
  h3 { font-size: 12.5pt; color: var(--accent-deep); margin: 7mm 0 3mm; }
  h3 .hn { color: var(--accent); margin-right: 6px; }
  /* Product volume: figures span the full column width, centered. */
  .doc-product figure img { width: 100%; margin: 0 auto; }
  /* Two screenshot+caption units (~51% each at full width) must share one page:
     shaving vertical whitespace by ~2% per unit flips instance pages from
     ~51% singles to ~95% pairs. */
  .doc-product figure { margin: 3mm 0; }
  .doc-product figcaption { margin-top: 2mm; }
  /* Product volume: comparison tables span the full text width and keep their
     first (label) column on one line; the technical series is unaffected. */
  .doc-product table { width: 100%; }
  .doc-product th:first-child, .doc-product td:first-child { white-space: nowrap; }
  /* Nudge auto layout to give the inner columns more room (the first column
     is nowrap, the last tends to win width from its long code spans). Only
     four-column tables: on three-column ones the third column IS the last. */
  .doc-product table.c4 th:nth-child(2), .doc-product table.c4 td:nth-child(2),
  .doc-product table.c4 th:nth-child(3), .doc-product table.c4 td:nth-child(3) { width: 27%; }
  /* Product volume: a small mascot floats beside the page number on every
     content page; the four mascots rotate from page to page. */
  .doc-product .page-mascot {
    position: absolute; right: 9mm; bottom: 6mm; height: 13mm; width: auto;
    border: none; box-shadow: none; border-radius: 0; opacity: 0.95;
  }
  h4 { font-size: 11pt; color: var(--ink); margin: 5mm 0 2mm; }
  p { margin: 3mm 0; text-align: justify; }
  /* Tighter paragraph rhythm in the product volume: several screenshot pages
     miss two-up packing by only a few mm. */
  .doc-product p { margin: 2.4mm 0; }
  /* Chinese typography: body paragraphs open with a two-character indent.
     Caption lines (a paragraph that is only an <em>) and continuation
     fragments of a sentence-split paragraph stay flush left. */
  .doc-product p { text-indent: 2em; }
  /* Mermaid htmlLabels emit <p> inside the SVG foreignObject — indenting those
     shifts node and edge labels right and clips them out of their boxes. */
  .doc-product p:has(> em:only-child), .doc-product p.pfrag:not(.pfrag-first),
  .doc-product .svgbox p { text-indent: 0; }
  /* Sentence-split paragraph fragments: the packer may break a page inside a
     paragraph, the way a book flows text. Only the first fragment keeps the
     paragraph's top margin and only the last keeps the bottom one, so a
     paragraph that continues across a page break reads as one block. */
  p.pfrag { margin: 0; }
  p.pfrag-first { margin-top: 3mm; }
  p.pfrag-last { margin-bottom: 3mm; }
  ul, ol { margin: 2mm 0 4mm; padding-left: 7mm; }
  ul ul, ul ol, ol ul, ol ol { margin: 1mm 0 1mm; }
  li { margin: 2mm 0; }
  strong { color: var(--ink); }
  /* Product volume: key terms (bold lead-ins and inline keywords) pick up the
     accent so the eye can scan a page's structure without reading every line. */
  .doc-product p strong, .doc-product li strong { color: var(--accent-deep); }
  a { color: var(--accent); text-decoration: none; }
  hr { border: none; border-top: 1px solid var(--line); margin: 6mm 0; }
  /* Explicit page break: never laid out, only consumed by the paginator. */
  .pb { height: 0; margin: 0; padding: 0; }
  code {
    font-family: Consolas, "JetBrains Mono", monospace; font-size: 9.4pt;
    background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: 0 3px;
  }
  pre {
    background: var(--soft); border: 1px solid var(--line); border-radius: 8px;
    padding: 3.5mm 4mm; margin: 3mm 0; overflow: hidden;
  }
  pre code { background: none; border: none; padding: 0; font-size: 9pt; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; margin: 4mm 0 5mm; font-size: 9.6pt; }
  thead { display: table-header-group; }
  th { background: var(--accent-soft); color: var(--accent-deep); text-align: left; font-weight: bold; }
  th, td { border: 1px solid var(--line); padding: 2.4mm 3mm; vertical-align: top; line-height: 1.65; }
  figure { margin: 5mm 0; text-align: center; }
  /* Every demo image fills the text column: the screenshots carry dense UI at
     1.5–2.7k px, so scaling them down was wasting most of the available
     resolution. All of them are landscape, so full width never exceeds a page. */
  figure img {
    display: block; width: 100%; height: auto;
    border: 1px solid var(--line); border-radius: 6px;
    box-shadow: 0 2px 10px rgba(15, 23, 42, .07);
  }
  figcaption { font-size: 8.8pt; color: var(--muted); margin-top: 2.5mm; text-align: center; line-height: 1.6; }
  figcaption b { color: var(--accent-deep); font-weight: bold; }
  .svgbox { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 4mm 4mm 3mm; margin: 4mm 0; text-align: center; }
  /* A portrait diagram must not claim a whole page. At 234mm the box (padding,
     caption and margins included) measured 254mm against a 263mm column, so it
     could not share a page with its own heading and pushed ~10mm past the
     bottom. 190mm leaves room for a heading and a line of prose. Landscape
     diagrams never reach this cap, so nothing else changes. */
  .svgbox svg { max-width: 100%; max-height: 190mm; height: auto; display: block; margin: 0 auto; }
  /* Mermaid caps the diagram at its intrinsic width (inline max-width), which
     leaves wide empty margins on narrow-diagram pages. Stretch to the full box
     width instead; !important outranks the inline style. The height cap keeps
     the chapter-4 flowchart on the same page as its intro paragraphs. */
  .doc-product .svgbox svg { max-width: 100% !important; width: 100%; max-height: 172mm; }
  .svgcap { font-size: 8.8pt; color: var(--muted); text-align: center; margin: 1mm 0 3mm; }
  .svgbox .svgcap { margin: 2.5mm 0 0; }
  .callout {
    background: var(--gold-soft); border: 1px solid #fde68a; border-radius: 10px;
    padding: 4mm 5mm; margin: 4mm 0; color: #78350f; font-size: 10pt;
  }
  .rcard {
    margin: 2.5mm 0 0; padding: 2.8mm 4mm 3mm; background: #f2f7f9;
    border: 0.35mm solid #cfdfe6; border-radius: 1.8mm; break-inside: avoid;
  }
  .rcard-t { font-size: 9.5pt; font-weight: 700; color: var(--accent-deep); margin: 0 0 1.2mm; letter-spacing: 0.02em; }
  .rcard dl { margin: 0; }
  .rcard dl > div { display: flex; gap: 3mm; padding: 1mm 0; }
  .rcard dl > div + div { border-top: 0.2mm solid #e4ecf2; }
  .rcard dt { flex: 0 0 16mm; font-size: 8.8pt; font-weight: 600; color: #4a5b6d; line-height: 1.6; }
  .rcard dd { margin: 0; font-size: 8.8pt; line-height: 1.6; color: #35485c; text-align: justify; }
  .gallery { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.5mm; margin: 3mm 0 0; break-inside: avoid; }
  .gallery figure { margin: 0; }
  .gallery img { width: 100%; height: 36mm; object-fit: cover; border-radius: 1.2mm; border: 0.2mm solid #d8e4ea; display: block; }
  .gallery figcaption { font-size: 7.8pt; color: var(--muted); text-align: center; margin: 1mm 0 0; }
`;

// --------------------------------------------------------------------------
// 3. Browser helpers (mermaid render + layout measurement + PDF print)
// --------------------------------------------------------------------------

function edgeExecutable() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        ]
      : [
          '/usr/bin/microsoft-edge',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ];
  for (const c of candidates) if (existsSync(c)) return c;
  return undefined;
}

const MERMAID_CONFIG = {
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize: '13px',
    primaryColor: '#ecfeff',
    primaryBorderColor: '#22d3ee',
    primaryTextColor: '#155e75',
    lineColor: '#0e7490',
    secondaryColor: '#f0fdf4',
    tertiaryColor: '#fefce8',
    clusterBkg: '#f8fafc',
    clusterBorder: '#cbd5e1',
    actorBkg: '#ecfeff',
    actorBorder: '#22d3ee',
    actorTextColor: '#155e75',
    signalColor: '#334155',
    signalTextColor: '#334155',
    labelBoxBkgColor: '#ecfeff',
    labelBoxBorderColor: '#22d3ee',
    noteBkgColor: '#fefce8',
    noteBorderColor: '#fde047',
  },
  flowchart: { curve: 'basis', htmlLabels: true, useMaxWidth: true },
  sequence: { actorMargin: 60, width: 150, useMaxWidth: true },
};

async function launchBrowser() {
  const executablePath = edgeExecutable();
  return chromium.launch({
    executablePath,
    headless: true,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none'],
  });
}

/** Render every mermaid diagram in `blocks` to inline SVG (mutates blocks). */
async function renderMermaid(page, blocks) {
  const diagrams = blocks.filter((b) => b.kind === 'mermaid');
  if (!diagrams.length) return;
  await page.addScriptTag({ path: MERMAID_JS });
  await page.evaluate((cfg) => {
    // eslint-disable-next-line no-undef
    window.mermaid.initialize(cfg);
  }, MERMAID_CONFIG);

  let n = 0;
  for (const d of diagrams) {
    n++;
    try {
      const svg = await page.evaluate(
        async ([id, code, cfg]) => {
          // eslint-disable-next-line no-undef
          const { svg } = await window.mermaid.render(id, code);
          return svg;
        },
        [`mmd-${n}-${Math.random().toString(36).slice(2, 8)}`, d.mermaid, MERMAID_CONFIG],
      );
      d.html = `<div class="svgbox">${svg}<div class="svgcap">图 ${n}</div></div>`;
    } catch (err) {
      // Never silently drop a diagram: keep the source visible in the PDF so
      // a broken render is obvious instead of missing.
      console.warn(`  ! mermaid diagram ${n} failed: ${err.message.split('\n')[0]}`);
      d.html =
        `<div class="svgbox"><pre><code>${esc(d.mermaid)}</code></pre>` +
        `<div class="svgcap">图 ${n}（渲染失败，已回退为源码）</div></div>`;
    }
  }
}

/**
 * Measure the rendered height of every block (including margins) and the
 * usable content height of one page, so the packer works on real numbers
 * instead of estimates.
 */
let probeSeq = 0;

async function measureBlocks(page, blocks, base) {
  // The probe must sit next to the .html it feeds: figures reference assets by
  // relative path (`../Estudio.png`), and a probe elsewhere would measure
  // broken-image boxes instead of the real thing. The name carries the pid and
  // a counter because Windows holds a handle on the file for a moment after
  // the browser navigates away — a fixed name turns one killed run into EBUSY
  // for every later one.
  const probePath = path.join(DOCS_DIR, `.measure-${process.pid}-${++probeSeq}.html`);
  // The probe carries the same page-level doc class as the final HTML, so
  // class-scoped rules (e.g. the small .mascot stickers) measure at their
  // real rendered size instead of their intrinsic one.
  const probeCls = PRODUCT_DOCS[base] ? ' doc-product' : '';
  writeFileSync(
    probePath,
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<style>${CSS}
  #measure { height: auto !important; overflow: visible !important; page-break-after: auto !important; }
  #measure::after { content: none !important; }
</style></head><body>
<div class="page${probeCls}" id="measure">
${blocks.map((b) => b.html).join('\n')}
</div>
</body></html>`,
    'utf8',
  );

  try {
    await page.goto(pathToFileURL(probePath).href, { waitUntil: 'load' });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
    const res = await page.evaluate(() => {
      const host = document.getElementById('measure');
      const cs = getComputedStyle(host);
      // `#measure` is forced to height:auto, so the usable height has to come
      // from a probe with the real page box, minus the page padding.
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:absolute; visibility:hidden; width:210mm; height:296.5mm; left:-9999px;';
      document.body.appendChild(probe);
      const contentHeight =
        probe.getBoundingClientRect().height -
        parseFloat(cs.paddingTop || '0') -
        parseFloat(cs.paddingBottom || '0');
      probe.remove();
      const items = [...host.children].map((el) => {
        const s = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const rows = [...el.querySelectorAll('tbody > tr')].map(
          (tr) => tr.getBoundingClientRect().height,
        );
        const thead = el.querySelector('thead');
        return {
          height: rect.height + parseFloat(s.marginTop || '0') + parseFloat(s.marginBottom || '0'),
          rows,
          headHeight: thead ? thead.getBoundingClientRect().height : 0,
          text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 50),
        };
      });
      // Index alignment is load-bearing: every block must render as exactly one
      // top-level element, otherwise heights get attributed to the wrong block.
      if (items.length !== host.children.length) {
        throw new Error(`block/measure mismatch: ${items.length} vs ${host.children.length}`);
      }
      return { contentHeight, items, rendered: host.children.length };
    });
    // Hard failure, not a warning: a mismatch silently shifts every measured
    // height by one and ships a PDF with clipped tables.
    if (res.rendered !== blocks.length) {
      throw new Error(
        `${base}: ${blocks.length} blocks rendered as ${res.rendered} elements — heights would be misattributed`,
      );
    }
    if (process.env.DEBUG_TECH_DOCS) {
      res.items.forEach((it, i) => {
        console.log(
          `    [${String(i).padStart(3)}] ${it.height.toFixed(1).padStart(7)}px  ${it.text.slice(0, 46)}`,
        );
      });
      console.log(`    limit = ${res.contentHeight.toFixed(1)}px`);
    }
    return res;
  } finally {
    // A probe left behind in the temp dir is harmless; failing to delete it is
    // never a reason to abort the build.
    try {
      rmSync(probePath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Split a table's rows into fragments that fit the space available, repeating
 * the header row on every fragment.
 *
 * `firstCapacity` is what is left on the current page, so a table that does not
 * fit in the remaining space fills it before continuing on the next page —
 * pushing the whole table down instead leaves a half-empty page, which is what
 * made the long reference tables look broken.
 *
 * Returns null when splitting is not worthwhile (fewer than two rows would fit
 * at the foot of the page, or the row geometry is unavailable).
 */
function fragmentTable(block, info, limit, firstCapacity) {
  const theadMatch = /<thead[\s\S]*?<\/thead>/.exec(block.html);
  const tbodyMatch = /<tbody>([\s\S]*)<\/tbody>/.exec(block.html);
  const bodyRows = tbodyMatch ? tbodyMatch[1].match(/<tr>[\s\S]*?<\/tr>/g) || [] : [];
  const rowHeights = info.rows || [];
  const headH = info.headHeight || 0;
  if (!bodyRows.length || rowHeights.length !== bodyRows.length) return null;

  // The table's own vertical margins+border, which `rows`/`headHeight` exclude.
  const overhead = Math.max(0, info.height - headH - rowHeights.reduce((a, b) => a + b, 0));

  const groups = [];
  let idx = 0;
  let cap = firstCapacity;
  while (idx < rowHeights.length) {
    const group = [];
    let acc = headH + overhead;
    // `group.length === 0` guarantees progress even if a single row is taller
    // than the space available.
    while (idx < rowHeights.length && (group.length === 0 || acc + rowHeights[idx] <= cap)) {
      acc += rowHeights[idx];
      group.push(idx++);
    }
    groups.push({ rows: group, height: acc });
    cap = limit;
  }

  // A single row stranded on the last page reads badly; borrow one from the
  // fragment before it when that evens the two out.
  const last = groups[groups.length - 1];
  const prev = groups[groups.length - 2];
  if (groups.length > 1 && last.rows.length === 1 && prev.rows.length > 2) {
    const moved = prev.rows.pop();
    prev.height -= rowHeights[moved];
    last.rows.unshift(moved);
    last.height += rowHeights[moved];
  }

  // Nothing to gain from splitting when the whole table already fits up front.
  if (groups.length === 1) return null;
  // Too little room at the foot of the page — a stub of one row is worse than
  // starting the table on a fresh page.
  if (groups[0].rows.length < 2) return null;

  return { groups, bodyRows, thead: theadMatch ? theadMatch[0] : '' };
}

/**
 * Greedy pack measured blocks into pages.
 * - keeps a heading from being the last block on a page
 * - splits a table that does not fit the remaining space, repeating the header
 */
/**
 * Block kinds that can introduce a screenshot. Used to keep a figure and the
 * sentence that explains it on the same page — a screenshot never drags another
 * screenshot along, otherwise a gallery collapses to one image per page.
 */
const INTRO_KINDS = new Set(['p', 'list', 'callout']);

/**
 * Split `p` blocks into sentence-level fragments so the packer can break a
 * page inside a paragraph — the same way a book flows text — instead of
 * pushing the whole paragraph to the next page and stranding a void above a
 * figure. Inline tags are tracked while scanning, so a cut never lands inside
 * an open <strong>/<code>/…; fragments shorter than PFRAG_MIN visible chars
 * merge back upstream so a break never isolates a few characters.
 *
 * Fragment classes redistribute the paragraph's 3mm margins (which
 * measureBlocks includes in each height), keeping measurements honest. Plain
 * blocks pass through untouched, so the whole transform is inert for text
 * that already packs tightly.
 */
const PFRAG_MIN = 34;

function splitParagraphBlocks(blocks) {
  const out = [];
  let paraSeq = 0;
  for (const b of blocks) {
    if (b.kind !== 'p' || !/^<p>[\s\S]*<\/p>$/.test(b.html)) {
      out.push(b);
      continue;
    }
    const inner = b.html.slice(3, -4);
    // Cut candidates: right after sentence-final CJK punctuation, never
    // inside a tag and never while an inline tag is still open.
    const cuts = [];
    let depth = 0;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '<') {
        const end = inner.indexOf('>', i);
        if (end < 0) break;
        const tag = inner.slice(i + 1, end);
        if (tag.startsWith('/')) depth--;
        else if (!/\/>$/.test(tag) && /^(strong|em|a|code|span)\b/.test(tag)) depth++;
        i = end;
        continue;
      }
      if (depth === 0 && '。？！'.includes(c) && i + 1 < inner.length) cuts.push(i + 1);
    }
    const visible = (s) => s.replace(/<[^>]+>/g, '').length;
    const merged = [];
    let from = 0;
    for (const cut of cuts) {
      if (visible(inner.slice(from, cut)) >= PFRAG_MIN) {
        merged.push(cut);
        from = cut;
      }
    }
    // A trailing fragment below the minimum would read as a stranded stub.
    if (merged.length && visible(inner.slice(merged[merged.length - 1])) < PFRAG_MIN) merged.pop();
    if (!merged.length) {
      out.push(b);
      continue;
    }
    const parts = [];
    let prev = 0;
    for (const cut of merged) {
      parts.push(inner.slice(prev, cut));
      prev = cut;
    }
    parts.push(inner.slice(prev));
    const pid = ++paraSeq; // fragments of one paragraph share this id
    parts.forEach((part, i) => {
      const cls = ['pfrag', i === 0 ? 'pfrag-first' : '', i === parts.length - 1 ? 'pfrag-last' : '']
        .filter(Boolean)
        .join(' ');
      out.push({ kind: 'p', pid, fi: i, fc: parts.length, text: part.replace(/<[^>]+>/g, ''), ih: part, html: `<p class="${cls}">${part}</p>` });
    });
  }
  return out;
}

/**
 * Even out a chapter whose final page is notably emptier than the rest: a
 * greedy pack fills the first pages to the brim and dumps the remainder on
 * the last one, which reads as "content ran out". Re-packing against the
 * mean per-page budget spreads the tail text upward. Only applied when the
 * page count does not grow — a figure that no longer fits keeps the original
 * packing, and a tail already at least half full is left alone.
 */
function rebalanceTail(packed, blocks, measured) {
  if (packed.length < 2) return packed;
  const limit = measured.contentHeight;
  const heightOf = new Map(blocks.map((b, i) => [b, measured.items[i]?.height ?? 0]));
  const sum = (pg) => pg.reduce((a, b) => a + (heightOf.get(b) || 0), 0);
  const fill = (pg) => sum(pg) / limit;
  const minFill = (pages) => Math.min(...pages.map(fill));
  if (fill(packed[packed.length - 1]) >= 0.62 && minFill(packed) >= 0.6) return packed;
  const total = packed.reduce((a, pg) => a + sum(pg), 0);
  const baseCount = packed.length;
  const baseMin = minFill(packed);
  // Escalating budgets: the exact even split usually strands figure+intro
  // pairs and *grows* the page count, so each failed step relaxes the budget
  // slightly until a repack fits within the original count and lifts the
  // emptiest page above the greedy result.
  let best = packed;
  for (let k = 0; k <= 6; k++) {
    const target = Math.min(limit, (total / packed.length) * (1.02 + k * 0.03));
    const cand = packPages(blocks, { ...measured, contentHeight: target });
    if (cand.length !== baseCount) continue;
    if (minFill(cand) > Math.max(baseMin, minFill(best)) + 0.02) best = cand;
  }
  return best;
}

function packPages(blocks, measured) {
  const limit = measured.contentHeight;
  const pages = [];
  // forcedAfter[k] marks a page boundary the author asked for with
  // `<!-- pagebreak -->`, so the keep-together passes below never undo it.
  const forcedAfter = [];
  let current = [];
  let used = 0;

  const pushPage = (forced) => {
    if (current.length) {
      pages.push(current);
      forcedAfter[pages.length - 1] = !!forced;
    }
    current = [];
    used = 0;
  };

  const heightOf = new Map(blocks.map((b, k) => [b, measured.items[k]?.height ?? 0]));
  const pageSum = (pg) => pg.reduce((a, b) => a + (heightOf.get(b) || 0), 0);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const info = measured.items[i];
    let height = info.height;

    // A forced break (`<!-- pagebreak -->`) closes the current page. When the
    // page is still empty the marker is a no-op, so two in a row never produce
    // a blank sheet.
    if (block.kind === 'pagebreak') {
      pushPage(true);
      continue;
    }

    // A paragraph fragment that overflows reunites on the next page when its
    // paragraph leads straight into a figure: a screenshot must never be read
    // with only the tail of its introduction. Earlier fragments already on
    // this page travel down so the paragraph reads as one piece, figure
    // included. Paragraphs not followed by a figure flow page to page like
    // normal book text.
    if (
      block.kind === 'p' &&
      block.pid != null &&
      used + height > limit &&
      current.length &&
      blocks[i + 1]?.kind === 'figure'
    ) {
      const carried = [];
      while (current.length && current[current.length - 1].pid === block.pid) {
        carried.unshift(current.pop());
      }
      if (carried.length && current.length) {
        pushPage();
        current.push(...carried);
        used = pageSum(current);
      } else {
        // The paragraph owns the whole page; leave fragments in place.
        current.push(...carried);
      }
    }

    if (block.kind === 'table' && used + height > limit) {
      // First try filling whatever is left on this page; if that is too little
      // to be worth it and the table does not fit a whole page either, start a
      // fresh page and split against a full page instead.
      let frag = fragmentTable(block, info, limit, limit - used);
      if (!frag && height > limit) {
        if (current.length) pushPage();
        frag = fragmentTable(block, info, limit, limit);
      }
      if (frag) {
        const openTag = block.html.slice(0, block.html.indexOf('<thead>'));
        for (let gi = 0; gi < frag.groups.length; gi++) {
          if (gi > 0) pushPage();
          const g = frag.groups[gi];
          current.push({
            kind: 'table',
            text: block.text,
            html:
              openTag +
              frag.thead +
              '<tbody>' +
              g.rows.map((r) => frag.bodyRows[r]).join('') +
              '</tbody></table>',
          });
          used = g.height;
        }
        continue;
      }
    }

    // A screenshot must not be torn from the sentence that introduces it. When
    // a figure does not fit in the space left, the block above it travels to
    // the next page as well, so the two are always read together. If the
    // introduction is a split paragraph, the *whole* paragraph moves — not
    // just its last fragment. Only text counts as an introduction: a run of
    // consecutive screenshots (a gallery) must pack normally, or every one of
    // them lands on a page of its own.
    if (
      block.kind === 'figure' &&
      used + height > limit &&
      current.length > 1 &&
      blocks[i - 1] &&
      current[current.length - 1] === blocks[i - 1] &&
      INTRO_KINDS.has(blocks[i - 1].kind)
    ) {
      const pid = blocks[i - 1].pid;
      const carried = [current.pop()];
      if (pid != null) {
        while (current.length > 1 && current[current.length - 1].pid === pid) {
          carried.unshift(current.pop());
        }
      }
      pushPage();
      current.push(...carried);
      used = carried.reduce((a, b) => a + (heightOf.get(b) || 0), 0);
    }

    if (used + height > limit && current.length) pushPage();
    // Keep the original block object so the TOC can map heading → page.
    current.push(block);
    used += height;
  }
  pushPage();

  // A screenshot that opens a page has lost the sentence introducing it, which
  // is what makes the demo images read as detached from their text. Pull the
  // preceding block down so the figure travels with its explanation.
  const sum = pageSum;
  for (let p = 1; p < pages.length; p++) {
    // An explicit `<!-- pagebreak -->` outranks page filling.
    if (forcedAfter[p - 1]) continue;
    if (pages[p][0]?.kind !== 'figure') continue;
    const prev = pages[p - 1];
    // Keep at least one block on the page above, or the packer emits a blank.
    if (prev.length < 2) continue;
    const candidate = prev[prev.length - 1];
    if (!INTRO_KINDS.has(candidate.kind)) continue;
    // A split introduction moves as a whole paragraph, never as a lone tail
    // fragment that would read detached from its own beginning.
    const pid = candidate.pid;
    const carry = [candidate];
    let avail = limit - sum(pages[p]) - (heightOf.get(candidate) || 0);
    if (pid != null) {
      for (let k = prev.length - 2; k >= 1; k--) {
        const b = prev[k];
        if (b.pid !== pid) break;
        const h = heightOf.get(b) || 0;
        if (h > avail) break;
        avail -= h;
        carry.unshift(b);
      }
    }
    if (carry.length === prev.length) continue; // keep one block above
    prev.splice(prev.length - carry.length, carry.length);
    pages[p].unshift(...carry);
  }

  // Pull a trailing heading down to the next page (avoid orphaned headings).
  // A pull can expose the heading that sat above it, so each page is drained
  // until it no longer ends on a heading — checking once leaves the newly
  // uncovered heading stranded at the foot of the page. The extra height this
  // adds to the next page is absorbed by the shrink-and-repack pass rather
  // than being refused here, otherwise a nearly full next page freezes the
  // orphan in place.
  for (let p = 0; p < pages.length - 1; p++) {
    if (forcedAfter[p]) continue;
    // A pull must never overflow the target page: the shrink-and-repack pass
    // is capped, so a pull onto a nearly full page used to ship as clipped
    // content. If the moved blocks would not fit, leave the heading at the
    // foot of the page — an orphaned heading is the lesser evil.
    const fitsBelow = (moved) =>
      moved.reduce((a, b) => a + (heightOf.get(b) || 0), 0) + sum(pages[p + 1]) <= limit;
    for (;;) {
      const pg = pages[p];
      const last = pg[pg.length - 1];
      if (!last) break;
      if (/^<h[234]/.test(last.html)) {
        // Never drain a page to nothing: an empty page becomes a blank sheet.
        if (pg.length <= 1) break;
        if (!fitsBelow([last])) break;
        pg.pop();
        pages[p + 1].unshift(last);
        continue;
      }
      // A section heading followed by exactly one paragraph at the foot — its
      // figure having moved to the next page — reads as a stranded section
      // start. Reunite the pair with the rest of the section below.
      if (last.kind !== 'p') break;
      let start = pg.length - 1;
      if (last.pid != null) {
        while (start > 0 && pg[start].kind === 'p' && pg[start].pid === last.pid) start--;
      } else if (start > 0 && /^<h[234]/.test(pg[start - 1].html)) {
        start -= 1;
      } else break;
      if (start <= 0 || !/^<h[234]/.test(pg[start].html)) break;
      const moved = pg.splice(start, pg.length - start);
      if (!fitsBelow(moved)) {
        pg.push(...moved);
        break;
      }
      pages[p + 1].unshift(...moved);
    }
  }
  // Coalesce sentence-split fragments that landed on the same page back into
  // one paragraph: a flush-left continuation line reads as broken wrapping
  // under the two-character indent. Only fragments that actually straddle a
  // page break stay split. Merged blocks are strictly shorter than the fragment
  // run they replace (margins 2.4/2.4 vs 3/3), so measured heights stay valid.
  for (const pg of pages) {
    const out = [];
    for (let i = 0; i < pg.length; i++) {
      const b = pg[i];
      if (b.kind !== 'p' || b.pid == null) { out.push(b); continue; }
      let j = i;
      while (j + 1 < pg.length && pg[j + 1].kind === 'p' && pg[j + 1].pid === b.pid) j++;
      if (j === i) { out.push(b); continue; }
      const run = pg.slice(i, j + 1);
      const initial = run[0].fi === 0;
      const final = run[run.length - 1].fi === run[run.length - 1].fc - 1;
      // Join the fragments' inner HTML (not the tag-stripped text) so inline
      // formatting such as <strong> lead-ins survives the merge.
      const html = run.map((r) => r.ih ?? r.text).join('');
      const cls = initial ? '' : final ? 'pfrag pfrag-last' : 'pfrag';
      out.push({ kind: 'p', pid: b.pid, text: run.map((r) => r.text).join(''), html: `<p${cls ? ` class="${cls}"` : ''}>${html}</p>` });
      i = j;
    }
    pg.length = 0;
    pg.push(...out);
  }
  if (process.env.DEBUG_TECH_DOCS) {
    pages.forEach((pg, i) => {
      const total = pg.reduce((a, b) => a + (heightOf.get(b) || 0), 0);
      console.log(
        `    page ${String(i + 1).padStart(2)}  ${total.toFixed(0).padStart(4)}px  ` +
          pg.map((b) => `${b.kind.slice(0, 3)}:${(heightOf.get(b) || 0).toFixed(0)}`).join(' '),
      );
    });
  }
  return pages;
}

// --------------------------------------------------------------------------
// 4. Document assembly
// --------------------------------------------------------------------------

/** Cover tagline — the series carries one brand line instead of a chapter list. */
const TAGLINE = '让每一次科学计算，都发生在离思想最近的地方';

/** Attribution for the closing page. One author, credited in every volume. */
const AUTHOR = {
  name: 'SnowLeopard-io',
  v: 'github.com/SnowLeopard-io',
  href: 'https://github.com/SnowLeopard-io',
};

/**
 * What the tagline means in full sentences. Kept to two short paragraphs: the
 * closing page is deliberately sparse, since a reader reaching it has just
 * finished the argument and only needs the conclusion restated.
 */
const MISSION = [
  'Ergalics Studio 把复杂度收进浏览器：安装、配置与数据搬运都不该出现在科研的路上。打开即可计算，数据留在本机，四种工作模式共享同一份数据——一张图、一条流程与一行代码，都是同一次工作的不同表达。',
  '工具越安静，思想就越清楚。我们做的每一处取舍，都为了把注意力还给问题本身。',
];

/**
 * The three online homes, each printed as its own QR code with a caption
 * underneath. `qr` is the asset basename; `v` is what the caption shows.
 */
const COVER_LINKS = [
  {
    k: '官网',
    v: 'snowleopard-io.github.io/ErgalicsStudio',
    href: 'https://snowleopard-io.github.io/ErgalicsStudio/',
    qr: 'qr-official-site',
  },
  {
    k: 'GitHub',
    v: 'github.com/SnowLeopard-io/ErgalicsStudio',
    href: 'https://github.com/SnowLeopard-io/ErgalicsStudio',
    qr: 'qr-github',
  },
  {
    k: 'Gitee',
    v: 'gitee.com/cnt-code/ergalics-studio',
    href: 'https://gitee.com/cnt-code/ergalics-studio',
    qr: 'qr-gitee',
  },
];

function buildCover({ title, subtitle, abstract, chips, foot, links = [], brand = 'ERGALICS STUDIO · 技术文档' }) {
  const chipHtml = chips
    .map((c) => `<div class="mode-chip"><div class="t">${esc(c)}</div></div>`)
    .join('');
  // Only include entries whose QR asset actually resolved, so a missing asset
  // degrades to a shorter row instead of a broken image.
  const coded = links.filter((l) => l.svg);
  const resHtml = coded.length
    ? `<div class="cover-res">
      ${coded
        .map(
          (l) =>
            `<div class="qr-item">
        <div class="qr-box">${l.svg}</div>
        <a class="qr-cap" href="${esc(l.href)}">${esc(l.k)}</a>
        <div class="qr-sub">${esc(l.v)}</div>
      </div>`,
        )
        .join('\n      ')}
    </div>`
    : '';
  return `<div class="page cover">
  <div class="cover-panel">
    <div class="cover-brand">${esc(brand)}</div>
    <h1>${esc(title).replace(/·/, '<br>')}</h1>
    <div class="sub">${esc(subtitle)}</div>
    <div class="cover-rule"></div>
    <div class="cover-abstract">${esc(abstract)}</div>
    ${resHtml}
    <div class="cover-modes">
      <div class="cap">本篇章节</div>
      <div class="mode-chips">${chipHtml}</div>
    </div>
    <div class="cover-foot">${esc(foot)}</div>
  </div>
</div>`;
}

/**
 * Closing page. Every volume opens on the brand line and closes by restating
 * the mission behind it, then signs off — so the last thing a reader sees is
 * the point of the whole thing, not a dangling section heading.
 *
 * It is built outside the paginator (fixed back matter, like the cover), so it
 * can never steal height from a content page or shift a TOC number.
 */
function buildBack({ foot, links = [], brand = 'ERGALICS STUDIO · 宗旨', tagline = TAGLINE, mission = MISSION }) {
  const homes = links
    .map(
      (l) =>
        `<div><span class="h">${esc(l.k)}</span><a href="${esc(l.href)}">${esc(l.v)}</a></div>`,
    )
    .join('\n      ');
  // Split the tagline at its comma (or, for comma-free slogans, at the space)
  // so the clause break is a typographic decision instead of whatever the line
  // happens to wrap at.
  const parts = tagline.includes('，') ? tagline.split('，') : tagline.split(' ');
  const [lead, rest] = [parts[0], parts.slice(1).join(' ')];
  // Only re-attach the comma when the slogan actually had one.
  const sep = tagline.includes('，') ? '，' : '';
  return `<div class="page cover back">
  <div class="cover-panel back">
    <div class="back-brand">${esc(brand)}</div>
    <div class="back-main">
      <div class="back-rule"></div>
      <div class="back-tag">
        <div class="l1">${esc(lead)}${sep}</div>
        <div class="l2">${esc(rest)}</div>
      </div>
      <div class="back-body">
        ${mission.map((t) => `<p>${esc(t)}</p>`).join('\n        ')}
      </div>
      <div class="back-sig">
        <span class="who">作者</span>
        <a href="${esc(AUTHOR.href)}">${esc(AUTHOR.name)}</a>
        <span class="at">${esc(AUTHOR.v)}</span>
      </div>
    </div>
    <div class="back-foot">
      <div class="homes">
      ${homes}
      </div>
      <div class="colophon">${esc(foot)}</div>
    </div>
  </div>
</div>`;
}

function buildToc(entries) {
  const items = entries
    .map((e) => {
      const cls = e.level === 2 ? 'l1' : e.level === 3 ? 'l2' : 'l3';
      return `<div class="toc-item ${cls}"><span>${inline(e.text)}</span><span class="dots"></span><span class="tp">${String(
        e.page,
      ).padStart(2, '0')}</span></div>`;
    })
    .join('\n');
  return items;
}

/** Entries shown in the TOC: h2 always, h3 only for short chapters. */
function tocEntriesFrom(blocks) {
  const out = [];
  let chapterH3Count = 0;
  for (const b of blocks) {
    if (b.kind === 'h2') {
      out.push({ level: 2, text: b.text, block: b });
      chapterH3Count = 0;
    } else if (b.kind === 'h3') {
      if (chapterH3Count < 12) {
        out.push({ level: 3, text: b.text, block: b });
        chapterH3Count++;
      }
    }
  }
  // A compendium has far too many sections for one TOC page; fall back to
  // chapter-level entries rather than spilling onto a second TOC page.
  //
  // The budget is measured, not counted. The previous test was a raw entry
  // count (more than 44), which has a blind spot: a document with ~36 entries
  // sits under the count but still overflows the page, and that overflow then
  // feeds the repack loop below. Per-entry heights are the rendered ones
  // (.toc-item.l1 is 11.5pt bold with a 14px lead-in, .toc-item.l2 is 10pt),
  // and the page leaves about 880px under its h1.
  const TOC_BUDGET_PX = 880;
  const entryHeight = (e) => (e.level === 2 ? 42 : 31);
  const estimated = out.reduce((a, e) => a + entryHeight(e), 0);
  return estimated > TOC_BUDGET_PX ? out.filter((e) => e.level === 2) : out;
}

function assembleHtml({ cover, tocHtml, pages, back = '', docClass = '', deco = null, tocPageCount = 1 }) {
  const cls = docClass ? ` ${docClass}` : '';
  const tocPagesHtml = (Array.isArray(tocHtml) ? tocHtml : [tocHtml])
    .map(
      (chunk, ti) =>
        `<div class="page toc${cls}">\n${ti === 0 ? '<h1>目 录</h1>\n' : ''}${chunk}${
          ti === (Array.isArray(tocHtml) ? tocHtml.length : 1) - 1 && cover.tocNote
            ? `\n<div class="callout" style="margin-top:14mm">${cover.tocNote}</div>`
            : ''
        }\n</div>`,
    )
    .join('\n\n');
  const body = pages
    .map(
      (p, i) =>
        `<!-- P${i + 2 + tocPageCount} -->\n<div class="page${cls}">\n${deco ? deco(i) : ''}\n${p.map((b) => b.html).join('\n')}\n</div>`,
    )
    .join('\n\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${esc(cover.title)}</title>
<style>${CSS}</style>
</head>
<body>

${cover.html}

${tocPagesHtml}

${body}

${back}

</body>
</html>
`;
}

/**
 * Post-render guard: `.page` has `overflow: hidden`, so anything that does not
 * fit is silently clipped in the PDF. Measure every page and report the ones
 * whose content crosses the bottom padding, with the offending block's text.
 *
 * The cover is measured one level deeper: it is a single `height:100%` flex
 * panel, so a page-level check compares the panel's bottom against the page's
 * own bottom and always passes — internal cover overflow stays invisible. Its
 * children are therefore measured against the panel's padding box.
 */
async function verifyLayout(page, htmlPath) {
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
  return page.evaluate(() => {
    const bad = [];
    document.querySelectorAll('.page').forEach((pg, i) => {
      const cs = getComputedStyle(pg);
      const limit = pg.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom || '0');
      let maxBottom = -Infinity;
      let culprit = null;
      for (const el of pg.children) {
        // Absolutely positioned decorations (page-corner mascots) live outside
        // the content flow and cannot overflow the column.
        if (getComputedStyle(el).position === 'absolute') continue;
        const b =
          el.getBoundingClientRect().bottom + parseFloat(getComputedStyle(el).marginBottom || '0');
        if (b > maxBottom) {
          maxBottom = b;
          culprit = el;
        }
      }
      if (maxBottom > limit + 1) {
        bad.push({
          // The TOC is assembled outside `packPages`, so re-packing can never
          // make room for it — flag it the way the cover is flagged so the
          // caller reports it instead of trying to shrink the content height.
          toc: pg.classList.contains('toc'),
          page: i + 1,
          overflowMm: +((maxBottom - limit) / 3.7795).toFixed(1),
          text: (culprit?.textContent || '').replace(/\s+/g, ' ').slice(0, 60),
        });
      }

      const panel = pg.querySelector(':scope > .cover-panel');
      if (!panel) return;
      const pcs = getComputedStyle(panel);
      const plimit = panel.getBoundingClientRect().bottom - parseFloat(pcs.paddingBottom || '0');
      let pmax = -Infinity;
      let pculprit = null;
      for (const el of panel.children) {
        const b =
          el.getBoundingClientRect().bottom + parseFloat(getComputedStyle(el).marginBottom || '0');
        if (b > pmax) {
          pmax = b;
          pculprit = el;
        }
      }
      if (pmax > plimit + 1) {
        bad.push({
          cover: true,
          page: i + 1,
          overflowMm: +((pmax - plimit) / 3.7795).toFixed(1),
          text: `封面内部: ${(pculprit?.textContent || '').replace(/\s+/g, ' ').slice(0, 48)}`,
        });
      }
    });
    return bad;
  });
}

// --------------------------------------------------------------------------
// 5. Per-document driver
// --------------------------------------------------------------------------

const DOC_ORDER = [
  '01-产品介绍',
  '02-系统架构',
  '03-插件系统',
  '04-四大工作模式',
  '05-科研工具集',
  '06-GPU计算与原生核心',
  '07-科学计算子系统',
  '08-测试与质量保障',
  '09-电磁谐振特征值求解器',
  '10-流体双向耦合求解器',
  '10-流体双向耦合求解器-容器化部署手册',
  '11-应用场景库',
  'Ergalics Studio',
  'Ergalics-Studio',
];

const TOTAL_NUM = 8;

// Documents delivered as standalone notes rather than numbered instalments of
// the series. They build like any other document but carry their own footnote
// instead of "第 N 篇（共 M 篇）", and they do not raise the series count.
const FOOT_OVERRIDES = {
  '09-电磁谐振特征值求解器': '独立专题文档 · Standalone Note',
  '10-流体双向耦合求解器': '独立专题文档 · Standalone Note',
  '10-流体双向耦合求解器-容器化部署手册': '独立专题文档 · Standalone Note',
  '11-应用场景库': '独立专题文档 · Standalone Note',
};

// Hand-written cover abstracts, for documents whose opening paragraph is too
// long or too technical to serve as a cover synopsis. The auto-derived abstract
// is the lead paragraph truncated at 200 chars, which can wrap to four lines and
// crowd the chapter chips — these are bounded to roughly two lines.
const ABSTRACT_OVERRIDES = {
  '09-电磁谐振特征值求解器':
    '面向微波器件、天线与电磁兼容的稀疏厄密非正定本征问题。纯 Python 与 NumPy 实现，内置厚重启 Lanczos、块 LOBPCG、Jacobi-Davidson 三种内核，按真实残差认证收敛。',
  '10-流体双向耦合求解器':
    '管网与场域的双向耦合。多速率时间子循环协调毫秒级 1D 管网与亚毫秒级 3D 场，正向注入质量与焓、反向反馈出口背压，配守恒审计、毫秒级阀门控制、精度-效率权衡与误差归属分析。',
  '10-流体双向耦合求解器-容器化部署手册':
    '在任意装有 Docker 的主机上一条命令运行双向耦合可运行原型，并在容器内复现 26 项验证断言与基准。含一键编排、CLI 复现、生产静态模式与故障排查。',
};

function metaFor(base) {
  if (SOLVER_MODE && SOLVER_DOCS[base]) {
    const repo = SOLVER_DOCS[base].repo.replace('https://', '');
    return {
      order: 99,
      foot: `SnowLeopard-io · ${repo}`,
      coverBrand: '求解器技术文档',
      // No studio QR codes: the solver repo address itself is the contact.
      qrOnCover: false,
      repo,
      // Neutral subtitle — the studio series slogan would be off-brand here.
      tagline: '独立求解器交付文档 · 结果可本地复现',
    };
  }
  if (PRODUCT_DOCS[base]) {
    return {
      order: 99,
      foot: PRODUCT_DOCS[base].foot,
      brand: PRODUCT_DOCS[base].brand,
      tagline: PRODUCT_SLOGAN,
      qrOnCover: true,
      chapterPerPage: true,
      // The lead paragraph is cover matter: it becomes the cover synopsis and
      // is suppressed in the body so chapter one opens the document.
      promoteLead: true,
    };
  }
  if (FOOT_OVERRIDES[base]) {
    return {
      order: 9,
      foot: FOOT_OVERRIDES[base],
      // The standalone note carries the same three QR codes as the compendium
      // cover, so a printed copy of either volume reaches the same homes.
      qrOnCover: true,
    };
  }
  const m = /^(\d+)-(.+)$/.exec(base);
  if (m) {
    const n = Number(m[1]);
    return {
      order: n,
      foot: `技术文档系列 · 第 ${'一二三四五六七八九十'[n - 1]} 篇（共 ${TOTAL_NUM} 篇）`,
      // Numbered instalments carry the same three QR codes on their covers so
      // a printed copy of any volume reaches the same online homes.
      qrOnCover: true,
    };
  }
  return {
    order: 99,
    foot: '完整技术总结 · Complete Technical Summary',
    // The compendium's lead is cover matter: a one-line synopsis shown as the
    // cover abstract plus a provenance note shown under the TOC. Both are
    // suppressed in the body so the first content page opens on chapter one.
    promoteLead: true,
    // The three QR codes for the project's online homes go on the cover.
    qrOnCover: true,
  };
}

const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function chipLabel(block, idx) {
  // cover chips: "一 项目背景" style, kept short
  const num = block.num || NUM_CN[idx] || String(idx + 1);
  const t = (block.chapterTitle || block.text).replace(/[（(].*?[)）]/g, '').trim();
  return `${num} ${t.length > 12 ? t.slice(0, 12) : t}`;
}

async function buildDoc(browser, page, base, opts = {}) {
  // Mermaid rendering and layout measurement both need a pristine,
  // stylesheet-only document; the caller may have left the page elsewhere.
  await page.goto('about:blank');
  await page.addStyleTag({ content: CSS });

  const mdPath = path.join(docDir(base), `${base}.md`);
  const md = readFileSync(mdPath, 'utf8');
  const meta = metaFor(base);
  const { title, blocks } = parseMarkdown(md);
  if (!title) throw new Error(`${base}: no H1 title`);

  // A TOC note derived from the doc's own reading-path hints, when present.
  const noteBlock = blocks.find((b) => b.kind === 'callout');
  const tocNote = noteBlock ? noteBlock.html.replace(/^<div class="callout">/, '').replace(/<\/div>$/, '') : '';

  // Promote the lead out of the body when the document's head is cover matter.
  let bodyBlocks = blocks;
  if (meta.promoteLead) {
    const firstH2 = blocks.findIndex((b) => b.kind === 'h2');
    const head = firstH2 < 0 ? blocks : blocks.slice(0, firstH2);
    const rest = firstH2 < 0 ? [] : blocks.slice(firstH2);
    bodyBlocks = [...head.filter((b) => b.kind !== 'p' && b.kind !== 'callout'), ...rest];
  } else if (noteBlock) {
    // The note callout was promoted to the TOC page; drop the original so it
    // does not appear a second time in the body.
    bodyBlocks = bodyBlocks.filter((b) => b !== noteBlock);
  }
  // Chapter-per-page layout: every H2 (except the first body block) opens on a
  // fresh page via the same forced-break marker an author can write by hand.
  if (meta.chapterPerPage) {
    const withBreaks = [];
    bodyBlocks.forEach((b, i) => {
      if (b.kind === 'h2' && i > 0 && withBreaks[withBreaks.length - 1]?.kind !== 'pagebreak') {
        withBreaks.push({ kind: 'pagebreak', text: '', html: '<div class="pb"></div>' });
      }
      withBreaks.push(b);
    });
    bodyBlocks = withBreaks;
  }

  // Cover QR codes: one committed SVG per online home, inlined so the HTML
  // (and the PDF printed from it) stays self-contained and crisp at print
  // resolution. The XML declaration is dropped — it is noise inside HTML.
  const coverLinks = meta.qrOnCover
    ? COVER_LINKS.map((l) => {
        const p = path.join(DOCS_DIR, 'assets', `${l.qr}.svg`);
        if (!existsSync(p)) {
          console.warn(`  ! missing QR asset for ${base}: assets/${l.qr}.svg`);
          return l;
        }
        return { ...l, svg: readFileSync(p, 'utf8').replace(/^<\?xml[^>]*\?>\s*/, '').trim() };
      })
    : [];

  await renderMermaid(page, bodyBlocks);

  const h2s = blocks.filter((b) => b.kind === 'h2');
  const subtitle = meta.tagline || TAGLINE;

  const firstP = blocks.find((b) => b.kind === 'p');
  // The cover carries the document's own lead paragraph only, bounded so it
  // can never push the chapter chips or the colophon past the panel edge. A
  // document may override it with a purpose-written synopsis (see
  // ABSTRACT_OVERRIDES) when its lead runs long.
  const rawAbstract = ABSTRACT_OVERRIDES[base] || (firstP ? firstP.text : '');
  const abstract = rawAbstract.length > 200 ? rawAbstract.slice(0, 198) + '…' : rawAbstract;

  // Measurement must run against a clean, stylesheet-only page: the print
  // pass navigates away, so the caller resets the measure page between docs.
  let pages;
  if (meta.brand) {
    // Product volume: chapters are force-broken, so a chapter whose content
    // spills a few lines onto a final page strands a large void there. Repack
    // each chapter independently across slightly smaller figure widths and
    // keep the packing with the fewest pages (ties go to the packing whose
    // last page is fuller, then to the larger figures).
    const chapters = [];
    for (const b of bodyBlocks) {
      if (b.kind === 'pagebreak') {
        // Explicit break: close the current group so the next block starts a
        // fresh page even mid-chapter (e.g. a summary table after a unit).
        if (chapters.length && chapters[chapters.length - 1].length) chapters.push([]);
        continue;
      }
      if (b.kind === 'h2' || chapters.length === 0) chapters.push([]);
      chapters[chapters.length - 1].push(b);
    }
    const splitChapters = chapters.filter((c) => c.length).map(splitParagraphBlocks);
    pages = [];
    for (const ch of splitChapters) {
      const hasFig = ch.some((b) => b.kind === 'figure');
      const cands = [];
      for (const scale of [1]) {
        const scaled =
          scale === 1
            ? ch
            : ch.map((b) =>
                b.kind === 'figure' ? { ...b, html: setWidth(b.html, Math.round(82 * scale)) } : b,
              );
        const m = await measureBlocks(page, scaled, base);
        if (opts.shrink) m.contentHeight -= opts.shrink;
        const packed = packPages(scaled, m);
        const indexOf = new Map(scaled.map((b, i) => [b, i]));
        const lastSum = packed[packed.length - 1].reduce(
          (a, b) => a + (m.items[indexOf.get(b)]?.height || 0),
          0,
        );
        cands.push({
          scale,
          scaled,
          m,
          packed,
          pageCount: packed.length,
          tailFill: lastSum / m.contentHeight,
        });
      }
      const minPages = Math.min(...cands.map((c) => c.pageCount));
      // Fewest pages wins; among equals take the largest figures whose last
      // page is at least half full, falling back to the fullest tail.
      const best =
        cands
          .slice()
          .reverse()
          .find((c) => c.pageCount === minPages && c.tailFill >= 0.5) ||
        cands
          .slice()
          .reverse()
          .find((c) => c.pageCount === minPages) ||
        cands[0];
      pages.push(...rebalanceTail(best.packed, best.scaled, best.m));
      if (best.scale !== 1) {
        console.log(`  ~ ${base}: chapter scaled to ${Math.round(82 * best.scale)}% figure width`);
      }
    }
  } else {
    const measured = await measureBlocks(page, bodyBlocks, base);
    // The caller shrinks the usable height when a previous pass reported an
    // overflow, so measurement noise can never ship a clipped page.
    if (opts.shrink) measured.contentHeight -= opts.shrink;
    pages = packPages(bodyBlocks, measured);
  }

  const pageOf = new Map();
  // The product volume expands every h3 into the TOC, which can outgrow one
  // page; chunk entries into TOC pages first (the first page also hosts the
  // 目录 h1) so the content-page offset used in page numbers can be derived.
  const entryH = (e) => (e.level === 2 ? 42 : 31);
  let tocEntries = tocEntriesFrom(bodyBlocks);
  if (meta.brand) {
    tocEntries = [];
    for (const b of bodyBlocks) {
      if (b.kind === 'h2') tocEntries.push({ level: 2, text: b.text, block: b });
      else if (b.kind === 'h3') tocEntries.push({ level: 3, text: b.text, block: b });
    }
  }
  const tocChunks = [];
  {
    let cur = [];
    let curH = 0;
    let first = true; // the first TOC page shares its budget with the 目录 h1
    for (const e of tocEntries) {
      const h = entryH(e);
      if (curH + h > (first ? 780 : 880) && cur.length) {
        tocChunks.push(cur);
        cur = [];
        curH = 0;
        first = false;
      }
      cur.push(e);
      curH += h;
    }
    if (cur.length) tocChunks.push(cur);
  }
  const nToc = tocChunks.length;
  pages.forEach((p, pi) => {
    for (const packed of p) {
      if ((packed.kind === 'h2' || packed.kind === 'h3') && !pageOf.has(packed)) {
        pageOf.set(packed, pi + 2 + nToc);
      }
    }
  });

  const tocHtml = tocChunks.map((chunk) =>
    buildToc(chunk.map((e) => ({ ...e, page: pageOf.get(e.block) ?? 2 + nToc }))),
  );

  const coverHtml = buildCover({
    title:
      base.startsWith('Ergalics') ||
      meta.order >= 99 ||
      /^\d+\s/.test(title) ||
      FOOT_OVERRIDES[base]
        ? title
        : `${String(meta.order).padStart(2, '0')} ${title.replace(/^Ergalics Studio\s*/, '')}`,
    subtitle,
    abstract: abstract || firstP?.text || '',
    chips: h2s.map(chipLabel),
    foot: meta.foot,
    links: coverLinks,
    brand: meta.brand || meta.coverBrand,
  });

  // Fixed back matter: the mission statement plus the online homes as plain
  // links. The QR codes stay on the cover so the two ends of the volume do not
  // repeat the same block. Solver volumes swap the studio identity for their
  // own repo address and a factual one-line note.
  const solverMeta = SOLVER_MODE ? metaFor(base) : null;
  const backHtml = solverMeta?.repo
    ? buildBack({
        foot: meta.foot,
        links: [{ k: 'Gitee', v: solverMeta.repo, href: `https://${solverMeta.repo}` }],
        brand: '求解器技术文档',
        tagline: `${title} 独立求解器交付文档`,
        mission: ['求解内核、验证基准与复现命令均在同一仓库内，可按下方地址获取并复现全部结果。'],
      })
    : buildBack({ foot: meta.foot, links: COVER_LINKS, brand: 'ERGALICS STUDIO · 宗旨', tagline: meta.tagline || TAGLINE });

  const html = assembleHtml({
    cover: { html: coverHtml, title, tocNote },
    tocHtml,
    tocPageCount: nToc,
    pages,
    back: backHtml,
    docClass: meta.brand ? 'doc-product' : '',
    // A small mascot floats beside the page number on every content page;
    // the four mascots rotate with the page index.
    deco: meta.brand
      ? (i) =>
          `<img class="page-mascot" src="../assets/brand/${
            ['mascot-wave', 'mascot-pipeline', 'mascot-blocks', 'mascot-laptop'][i % 4]
          }.jpg" alt="">`
      : null,
  });

  return { html, pages: pages.length + 3 };
}

// --------------------------------------------------------------------------
// 6. main
// --------------------------------------------------------------------------

/** Drop probe files an interrupted run left behind (best effort). */
function sweepProbes() {
  let files;
  try {
    files = readdirSync(DOCS_DIR).filter((f) => /^\.measure-.*\.html$/.test(f));
  } catch {
    return;
  }
  for (const f of files) {
    try {
      rmSync(path.join(DOCS_DIR, f), { force: true });
    } catch {
      // Still held by a dying browser process; it is gitignored either way.
    }
  }
}

async function main() {
  if (!existsSync(MERMAID_JS)) {
    console.warn(`! mermaid bundle missing: ${MERMAID_JS}\n  diagrams will fall back to source blocks.`);
  }
  const browser = await launchBrowser();
  sweepProbes();
  const measurePage = await browser.newPage();
  await measurePage.setViewportSize({ width: 1240, height: 1754 });
  const printPage = await browser.newPage();

  let list = DOC_ORDER;
  if (ONLY) list = list.filter((b) => b.startsWith(ONLY));
  if (!list.length) throw new Error(`no document matches --only ${ONLY}`);

  const results = [];
  for (const base of list) {
    const srcDir = docDir(base);
    const mdPath = path.join(srcDir, `${base}.md`);
    if (!existsSync(mdPath)) {
      console.log(`skip (missing): ${mdPath}`);
      continue;
    }
    // A pristine, stylesheet-only page per document: the print pass
    // navigates elsewhere, so the measuring context must be rebuilt.
    const htmlPath = path.join(srcDir, `${base}.html`);

    // Build → verify → if any page's content crosses the bottom padding,
    // shrink the usable height by the worst deficit and rebuild. Four attempts
    // is plenty: the deficits shrink as the pages get shorter.
    // See the guard inside the loop: never cut the usable height by more than
    // a fifth of the column, however stubborn a deficit turns out to be.
    const MAX_SHRINK_PX = 200;
    let shrink = 0;
    let pages = 0;
    let remaining = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const built = await buildDoc(browser, measurePage, base, { shrink });
      writeFileSync(htmlPath, built.html, 'utf8');
      pages = built.pages;
      remaining = await verifyLayout(measurePage, htmlPath);
      // Only content pages can be helped by re-packing. The cover and the TOC
      // are laid out outside `packPages`, so shrinking the usable height can
      // never make room for them; re-adding such a deficit on every pass used
      // to drive the usable height to zero and collapse the document to one
      // block per page. Both are reported by the caller instead.
      const repairable = remaining.filter((o) => !o.cover && !o.toc);
      if (!remaining.length || !repairable.length) break;
      const worst = Math.max(...repairable.map((o) => o.overflowMm));
      console.warn(
        `  ~ ${base}: pass ${attempt + 1} overflowed by up to ${worst}mm — repacking`,
      );
      // Deficit that a pass could not clear: add it to the running shrink.
      shrink += worst * 3.7795 + 10;
      // Hard guard. These deficits are expected to shrink as the pages get
      // shorter; one that refuses to (an unsplittable block, or a page the
      // packer cannot rearrange) would otherwise be re-added on every pass and
      // cut the usable height by half, blowing the document up to one block
      // per page. Cap the total at about a fifth of the column and let the
      // residual overflow be reported as a warning instead.
      if (shrink > MAX_SHRINK_PX) break;
    }

    let pdfNote = '';
    if (!HTML_ONLY) {
      await printPage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      await printPage.evaluate(() => (document.fonts ? document.fonts.ready : null));
      await printPage.pdf({
        path: path.join(srcDir, `${base}.pdf`),
        printBackground: true,
        preferCSSPageSize: true,
      });
      pdfNote = ' + pdf';
    }
    results.push({ base, pages, overflow: remaining.length });
    console.log(`built: ${base}.html${pdfNote}  (${pages} pages)`);
    for (const o of remaining) {
      console.warn(`  ! ${base}.html page ${o.page} overflows by ${o.overflowMm}mm — "${o.text}"`);
    }
  }

  await browser.close();

  // temp artefacts are only kept when explicitly requested
  if (!KEEP_TEMP) {
    sweepProbes();
    const stray = path.join(os.tmpdir(), 'ergalics-tech-docs');
    if (existsSync(stray)) rmSync(stray, { recursive: true, force: true });
  }

  console.log(`\ndone: ${results.length} document(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
