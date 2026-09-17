// ==========================================================================
// Tests for the builtin-plugin enhancement helpers (PNG/CSV export,
// localized button factories).
// ==========================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  actionButton,
  actionFired,
  csvCell,
  toCsv,
  dataUrlToBlob,
  exportCanvasPng,
  exportRowsCsv,
  exportSnapshotPng,
} from '@/plugins/builtin/shared/enhance';
import type { ButtonParam, PluginApi } from '@/types/plugin';

function fakeApi(locale = 'en-US') {
  const exportFile = vi.fn();
  const notify = vi.fn();
  return {
    exportFile,
    notify,
    api: { locale, exportFile, notify } as unknown as PluginApi,
  };
}

describe('actionButton', () => {
  it('builds a button param whose action equals its key with zh/en labels', () => {
    const def = actionButton('exportPng', 'Export PNG', '导出 PNG', 'primary');
    expect(def.type).toBe('button');
    const btn = def as ButtonParam;
    expect(btn.key).toBe('exportPng');
    expect(btn.action).toBe('exportPng');
    expect(btn.variant).toBe('primary');
    expect(btn.label).toBe('Export PNG');
    expect(btn.labelI18n).toEqual({ 'zh-CN': '导出 PNG', 'en-US': 'Export PNG' });
  });
});

describe('actionFired', () => {
  it('accepts the host payload {key:{action:key}} and the boolean form', () => {
    expect(actionFired({ exportPng: { action: 'exportPng' } }, 'exportPng')).toBe(true);
    expect(actionFired({ exportPng: true }, 'exportPng')).toBe(true);
  });

  it('rejects missing, foreign and mismatched actions', () => {
    expect(actionFired({}, 'exportPng')).toBe(false);
    expect(actionFired({ exportCsv: true }, 'exportPng')).toBe(false);
    expect(actionFired({ exportPng: { action: 'exportCsv' } }, 'exportPng')).toBe(false);
    expect(actionFired({ exportPng: false }, 'exportPng')).toBe(false);
    expect(actionFired({ exportPng: null }, 'exportPng')).toBe(false);
  });
});

describe('csvCell / toCsv', () => {
  it('leaves simple values untouched', () => {
    expect(csvCell(1.5)).toBe('1.5');
    expect(csvCell('abc')).toBe('abc');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes cells with commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('joins header and rows with CRLF', () => {
    const csv = toCsv(['x', 'y'], [[1, 2], ['a,b', 3]]);
    expect(csv).toBe('x,y\r\n1,2\r\n"a,b",3');
  });
});

describe('dataUrlToBlob', () => {
  it('decodes a base64 PNG data URL', async () => {
    const payload = 'PNG\r\n\u001a\n\u0000\u0001\u00ff';
    const b64 = btoa(payload);
    const blob = dataUrlToBlob(`data:image/png;base64,${b64}`);
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('image/png');
    const buf = new Uint8Array(await blob!.arrayBuffer());
    expect(Array.from(buf)).toEqual([...payload].map((c) => c.charCodeAt(0)));
  });

  it('decodes a URL-encoded payload', () => {
    const blob = dataUrlToBlob('data:text/plain,hello%20world');
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('text/plain');
  });

  it('returns null for garbage input', () => {
    expect(dataUrlToBlob('not a data url')).toBeNull();
  });
});

describe('exportRowsCsv', () => {
  it('exports a CSV blob and refuses when there is no data row', () => {
    const { api, exportFile, notify } = fakeApi();
    expect(exportRowsCsv(api, 'my data', ['x', 'y'], [[1, 2], [3, 4]])).toBe(true);
    expect(exportFile).toHaveBeenCalledTimes(1);
    const [name, blob, mime] = exportFile.mock.calls[0]!;
    expect(name).toBe('my data.csv');
    expect(mime).toBe('text/csv;charset=utf-8');
    expect(blob).toBeInstanceOf(Blob);

    expect(exportRowsCsv(api, 'empty', ['x', 'y'], [])).toBe(false);
    expect(notify).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('sanitizes illegal file-name characters', () => {
    const { api, exportFile } = fakeApi();
    exportRowsCsv(api, 'a/b:c?', ['x'], [[1]]);
    expect(exportFile.mock.calls[0]![0]).toBe('a_b_c_.csv');
  });

  it('warns in Chinese under zh-CN locale on empty export', () => {
    const { api, notify } = fakeApi('zh-CN');
    exportRowsCsv(api, 'x', ['x'], []);
    expect(notify.mock.calls[0]![1]).toContain('数据');
  });
});

describe('exportCanvasPng', () => {
  it('exports the canvas PNG and handles a missing canvas', () => {
    const { api, exportFile } = fakeApi();
    const canvas = { toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=' } as unknown as HTMLCanvasElement;
    expect(exportCanvasPng(api, canvas, 'plot')).toBe(true);
    expect(exportFile).toHaveBeenCalledWith('plot.png', expect.any(Blob), 'image/png');

    expect(exportCanvasPng(api, null, 'plot')).toBe(false);
  });
});

describe('exportSnapshotPng', () => {
  it('exports a Three.js snapshot data URL', () => {
    const { api, exportFile } = fakeApi();
    expect(exportSnapshotPng(api, 'data:image/png;base64,iVBORw0KGgo=', 'view')).toBe(true);
    expect(exportFile.mock.calls[0]![0]).toBe('view.png');
    expect(exportSnapshotPng(api, null, 'view')).toBe(false);
  });
});
