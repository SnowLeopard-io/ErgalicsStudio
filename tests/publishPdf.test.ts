// ==========================================================================
// Ergalics Studio — PDF export tests
//
// The built-in jsPDF fonts cannot encode CJK, so the exporter embeds a
// TrueType fallback on demand. These tests exercise the real font asset to
// prove that non-Latin titles no longer fall back to WinAnsi mojibake.
// ==========================================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { latexPreviewBody, renderLatex } from '@/core/publish/latex';
import { buildManuscriptPdf, buildTextPdf } from '@/core/publish/pdf';

const fontBytes = readFileSync(
  fileURLToPath(new URL('../public/fonts/DroidSansFallback.ttf', import.meta.url)),
);

function pdfText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

beforeAll(async () => {
  // jsdom is a test-only dependency without bundled types.
  const jsdomMod = (await import('jsdom' as any)) as {
    JSDOM: new (html: string) => { window: Record<string, unknown> };
  };
  const dom = new jsdomMod.JSDOM('<!doctype html><html><body></body></html>');
  (globalThis as unknown as { window: unknown }).window = dom.window;
  (globalThis as unknown as { document: unknown }).document = dom.window.document;
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = dom.window.DOMParser;

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () =>
        fontBytes.buffer.slice(
          fontBytes.byteOffset,
          fontBytes.byteOffset + fontBytes.byteLength,
        ),
    })),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('PDF export with CJK text', () => {
  it('embeds the CJK font and a ToUnicode map for Chinese text', async () => {
    const bytes = await buildTextPdf('我的实验论文', [
      { kind: 'text', text: '摘要：这是一段中文摘要，包含 English words 与标点。' },
    ]);
    const raw = pdfText(bytes);

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('DroidSansFallback');
    expect(raw).toContain('/ToUnicode');
    expect(raw).toContain('Identity-H');
  });

  it('embeds the CJK font for Chinese manuscript titles', async () => {
    const source = renderLatex({
      templateId: 'ieee',
      title: '我的第一篇实验论文',
      authors: [{ name: '张三', affiliation: '示例大学' }],
      abstract: '摘要内容。',
      keywords: ['可复现'],
      sections: [{ id: 'intro', heading: '引言', blocks: [{ type: 'text', text: '正文。' }] }],
    });
    expect(latexPreviewBody(source, { templateId: 'ieee' })).toContain('我的第一篇实验论文');

    const bytes = await buildManuscriptPdf(source, { templateId: 'ieee' });
    const raw = pdfText(bytes);

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('DroidSansFallback');
    expect(raw).toContain('/ToUnicode');
  });

  it('keeps Latin-only exports on the compact built-in fonts', async () => {
    const bytes = await buildTextPdf('Plain title', [{ kind: 'text', text: 'Hello world.' }]);
    const raw = pdfText(bytes);

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).not.toContain('DroidSansFallback');
  });
});
