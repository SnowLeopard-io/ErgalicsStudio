import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { writeFileSync } from 'node:fs';
import { latexPreviewBody, starterLatex } from '@/core/publish/latex';

describe('tmp pdf inspect', () => {
  it('dumps', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;
    (globalThis as any).DOMParser = dom.window.DOMParser;

    const src = starterLatex('ieee');
    const fragment = latexPreviewBody(src, { templateId: 'ieee' });
    const parsed = new dom.window.DOMParser().parseFromString(`<div>${fragment}</div>`, 'text/html');
    const header = parsed.body.firstElementChild?.querySelector('header');
    console.log('HEADER_HTML=' + (header?.outerHTML ?? 'NONE'));
    console.log('TITLE_TEXT=' + JSON.stringify(header?.querySelector('h1')?.textContent));

    const { buildManuscriptPdf } = await import('@/core/publish/pdf');
    const bytes = await buildManuscriptPdf(src, { templateId: 'ieee' });
    writeFileSync('C:/Users/Administrator/AppData/Local/Temp/opencode/manuscript.pdf', bytes);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
