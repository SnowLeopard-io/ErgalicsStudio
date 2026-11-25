import { describe, expect, it } from 'vitest';
import {
  buildSidecar,
  hashDownloadData,
  sidecarName,
  sidecarText,
} from '@/core/result/sidecar';
import { sha256Text } from '@/core/result/hash';
import { createResultRecord } from '@/core/result/record';
import { runSubmissionCheck, type SubmissionDoc } from '@/core/submit/checklist';

const record = createResultRecord({
  pluginId: 'stats.demo',
  pluginVersion: '1.0.0',
  dataHash: 'b'.repeat(64),
  params: { n: 10 },
  metrics: [{ key: 'mean', label: 'mean', value: 2.5, display: '2.5' }],
});

describe('sidecar', () => {
  it('uses the artifact stem and carries the artifact hash', () => {
    expect(sidecarName('figure.svg')).toBe('figure.json');
    expect(sidecarName('figure (2).png')).toBe('figure (2).json');
    const sidecar = buildSidecar(
      record,
      { name: 'figure.svg', hash: sha256Text('<svg/>') },
      { format: 'svg', template: 'ieee_single', dpi: 600, colorSpace: 'rgb' },
    );
    const text = sidecarText(sidecar);
    const parsed = JSON.parse(text);
    expect(parsed.resultId).toBe(record.resultId);
    expect(parsed.metrics[0].value).toBe(2.5);
    expect(parsed.export.sha256).toBe(sha256Text('<svg/>'));
    expect(parsed.export.template).toBe('ieee_single');
  });

  it('hashes string, ArrayBuffer and Blob payloads identically', async () => {
    const text = 'exported csv\n1,2\n';
    const bytes = new TextEncoder().encode(text);
    expect(await hashDownloadData(text)).toBe(sha256Text(text));
    expect(await hashDownloadData(bytes.buffer)).toBe(sha256Text(text));
    expect(await hashDownloadData(new Blob([bytes]))).toBe(sha256Text(text));
  });
});

describe('submission provenance check', () => {
  const doc: SubmissionDoc = {
    templateId: 'ieee_single',
    caption: 'caption',
    panels: [{ row: 0, col: 0, sourceResultId: record.resultId, spec: { series: [], width: 100, height: 100, xLabel: 'x', yLabel: 'y' } }],
    export: { format: 'svg', rasterDpi: 600, colorMode: 'rgb', fontEmbedded: true },
    hasProvenance: false,
  };

  it('fails when provenance is missing', () => {
    const result = runSubmissionCheck(doc, 'ieee');
    expect(result.items.find((i) => i.id === 'provenance_present')?.passed).toBe(false);
  });

  it('passes when a sidecar exists', () => {
    const result = runSubmissionCheck({ ...doc, hasProvenance: true }, 'ieee');
    expect(result.items.find((i) => i.id === 'provenance_present')?.passed).toBe(true);
  });
});
