// FR-1 input fingerprint capture.
//
// Reproduces the reported failure: a CSV that already lives in the project
// (imported before the fingerprint feature) is picked through the plugin's
// "project data" selector. The provenance record must still name a hash.
import { describe, expect, it } from 'vitest';
import { capturePluginInput } from '@/core/result/inputCapture';
import { getPluginDataSource, resetCurrentDataSource } from '@/core/result/activeData';
import { useProjectStore } from '@/stores/projectStore';
import { useDataEditorStore } from '@/stores/dataEditorStore';
import { usePluginStore } from '@/stores/pluginStore';
import type { Project } from '@/types/project';

const CSV = 'x,y\n1,2\n3,4\n';

function withProjectFile(hasHash: boolean): void {
  const project = {
    id: 'p1',
    name: 'p1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'standard',
    data: {
      files: [
        {
          id: 'f1',
          name: 'two-col.csv',
          size: CSV.length,
          mimeType: 'text/csv',
          format: 'csv',
          content: CSV,
          ...(hasHash ? { sha256: 'a'.repeat(64) } : {}),
        },
      ],
    },
    state: {
      parameters: {},
      results: [],
    },
  } as unknown as Project;
  useProjectStore.setState({ project });
}

describe('capturePluginInput (FR-1)', () => {
  it('cites the stored fingerprint of an existing project file', async () => {
    resetCurrentDataSource();
    withProjectFile(true);
    const source = await capturePluginInput({
      pluginId: 'chart.scatter',
      fileName: 'two-col.csv',
      text: CSV,
      fileId: 'f1',
      origin: 'project-file',
    });
    expect(source.hash).toBe('a'.repeat(64));
    expect(source.name).toBe('two-col.csv');
    expect(getPluginDataSource('chart.scatter')?.hash).toBe('a'.repeat(64));
  });

  it('hashes the payload when the project file predates fingerprints', async () => {
    resetCurrentDataSource();
    withProjectFile(false);
    const source = await capturePluginInput({
      pluginId: 'chart.scatter',
      fileName: 'two-col.csv',
      text: CSV,
      fileId: 'f1',
      origin: 'project-file',
    });
    expect(source.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(source.hash).not.toBe('');
    expect(getPluginDataSource('chart.scatter')?.hash).toBe(source.hash);
  });

  it('hashes a payload that has no project file behind it', async () => {
    resetCurrentDataSource();
    const source = await capturePluginInput({
      pluginId: 'chart.scatter',
      fileName: 'inline.csv',
      text: CSV,
    });
    expect(source.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(source.name).toBe('inline.csv');
  });

  // The reported failure: picking an existing project file through the
  // plugin's "project data" selector left the provenance hash empty.
  it('records a hash when a project file is ingested through the plugin', async () => {
    resetCurrentDataSource();
    withProjectFile(false);
    usePluginStore.setState({
      registry: [
        {
          id: 'example.scatter',
          name: 'Scatter',
          version: '1.0.0',
          author: 'test',
          description: '',
          loaded: true,
          active: true,
          formats: ['csv'],
          plugin: {
            manifest: { id: 'example.scatter', name: 'Scatter', version: '1.0.0' },
            init: async () => {},
            getParams: () => [],
            loadData: async () => {},
          },
        },
      ] as never,
    });

    const outcome = await useDataEditorStore.getState().ingestForPlugin({
      pluginId: 'example.scatter',
      fileName: 'two-col.csv',
      text: CSV,
      origin: 'project-file',
      fileId: 'f1',
    });
    expect(outcome.ok).toBe(true);

    const source = getPluginDataSource('example.scatter');
    expect(source?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(source?.name).toBe('two-col.csv');
  });
});
