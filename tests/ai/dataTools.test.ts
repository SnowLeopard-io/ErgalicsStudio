import { describe, it, expect, beforeEach } from 'vitest';
import { ensureHostToolsRegistered, toolRegistry } from '@/core/ai/tools';
import { isMutatingTool, isReadOnlyTool } from '@/core/ai/tools/registry';
import { usePluginStore, setHostContainers } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { useDataEditorStore } from '@/stores/dataEditorStore';
import { sankeyManifest } from '@/plugins/builtin/charts/sankey/manifest';
import { networkGraphManifest } from '@/plugins/builtin/charts/networkGraph/manifest';
import type { Plugin } from '@/types/plugin';
import type { ToolResult } from '@/core/ai/tools/types';

function textOf(res: ToolResult): string {
  return res.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  ensureHostToolsRegistered();
  return toolRegistry.invoke(name, args);
}

describe('AI Agent Schema-Aware Data Tools', () => {
  const loadedCsvs: string[] = [];

  const mockSankey: Plugin = {
    manifest: sankeyManifest,
    init() {},
    getParams: () => [],
    async loadData(file) {
      loadedCsvs.push(await file.text());
    },
  };

  const mockNetwork: Plugin = {
    manifest: networkGraphManifest,
    init() {},
    getParams: () => [],
    async loadData(file) {
      loadedCsvs.push(await file.text());
    },
  };

  beforeEach(async () => {
    loadedCsvs.length = 0;
    setHostContainers({
      dom: {} as HTMLDivElement,
      canvas2d: {} as HTMLCanvasElement,
      reportDataScale: () => undefined,
    });
    useDataEditorStore.setState({
      bindings: {},
      staleBindings: {},
      mappingRequest: null,
      errorRequest: null,
      editorSession: null,
    });
    const ps = usePluginStore.getState();
    await ps.deactivate();
    for (const e of [...ps.registry]) await ps.unload(e.id);
    await useProjectStore.getState().createProject('AI Data Tools Test');
    await ps.load(mockSankey);
    await ps.load(mockNetwork);
    await ps.activate(sankeyManifest.id);
  });

  it('classifies get_plugin_data_schema as read-only and write tools as mutating', () => {
    expect(isReadOnlyTool('get_plugin_data_schema')).toBe(true);
    expect(isMutatingTool('get_plugin_data_schema')).toBe(false);

    for (const name of [
      'set_plugin_data',
      'patch_plugin_data',
      'load_data_file_to_plugin',
      'write_data_file',
    ]) {
      expect(isMutatingTool(name)).toBe(true);
      expect(isReadOnlyTool(name)).toBe(false);
    }
  });

  it('get_plugin_data_schema returns columns, constraints, and sample rows for the active plugin', async () => {
    const res = await callTool('get_plugin_data_schema');
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.pluginId).toBe(sankeyManifest.id);
    expect(payload.schemas[0].kind).toBe('tabular');
    expect(payload.schemas[0].columns.map((c: { key: string }) => c.key)).toEqual([
      'source',
      'target',
      'value',
    ]);
  });

  it('set_plugin_data rejects invalid rows with structured Zod issues (without opening UI modal) and applies valid rows + saves to project', async () => {
    // 1. Invalid negative value returns actionable Zod error to model
    const bad = await callTool('set_plugin_data', {
      rows: [{ source: 'Solar', target: 'Grid', value: -5 }],
    });
    expect(bad.isError).toBe(true);
    const errPayload = JSON.parse(textOf(bad));
    expect(errPayload.error).toBe('validation_failed');
    expect(errPayload.issues[0].field).toBe('value');
    expect(useDataEditorStore.getState().errorRequest).toBeNull(); // no blocking modal

    // 2. Valid rows succeed, save to project, and optionally open the docked editor
    const ok = await callTool('set_plugin_data', {
      rows: [
        { source: 'Solar', target: 'Grid', value: 40 },
        { source: 'Wind', target: 'Grid', value: 25 },
      ],
      fileName: 'energy.csv',
      saveToProject: true,
      openEditor: true,
    });
    expect(ok.isError).toBeFalsy();
    const okPayload = JSON.parse(textOf(ok));
    expect(okPayload.ok).toBe(true);
    expect(okPayload.savedToProject).toBe(true);
    expect(loadedCsvs.at(-1)).toContain('Solar,Grid,40');
    expect(useProjectStore.getState().project?.data.files.some((f) => f.name === 'energy.csv')).toBe(true);
    expect(useDataEditorStore.getState().editorSession?.fileName).toBe('energy.csv');
  });

  it('patch_plugin_data applies set_cell, append_rows, delete_rows atomically and rejects invalid patches', async () => {
    await callTool('set_plugin_data', {
      rows: [
        { source: 'A', target: 'B', value: 10 },
        { source: 'B', target: 'C', value: 20 },
        { source: 'C', target: 'D', value: 30 },
      ],
      fileName: 'flows.csv',
      saveToProject: true,
    });

    // Reject invalid patch (negative value) without corrupting current data
    const badPatch = await callTool('patch_plugin_data', {
      operations: [{ op: 'set_cell', row: 1, column: 'value', value: -99 }],
    });
    expect(badPatch.isError).toBe(true);
    expect(loadedCsvs.at(-1)).toContain('A,B,10');

    // Apply valid multi-op patch: edit row 1, delete row 2, append row
    const goodPatch = await callTool('patch_plugin_data', {
      operations: [
        { op: 'set_cell', row: 1, column: 'value', value: 55 },
        { op: 'delete_rows', rows: [2] },
        { op: 'append_rows', rows: [{ source: 'D', target: 'E', value: 15 }] },
      ],
      saveToProject: true,
    });
    expect(goodPatch.isError).toBeFalsy();
    const out = JSON.parse(textOf(goodPatch));
    expect(out.beforeRows).toBe(3);
    expect(out.afterRows).toBe(3);
    expect(loadedCsvs.at(-1)).toContain('A,B,55');
    expect(loadedCsvs.at(-1)).not.toContain('B,C,20');
    expect(loadedCsvs.at(-1)).toContain('D,E,15');
    // Persisted back to the same project file
    const saved = useProjectStore.getState().project?.data.files.find((f) => f.name === 'flows.csv');
    expect(saved?.content).toContain('A,B,55');
  });

  it('load_data_file_to_plugin guides autonomous column mapping when headers differ', async () => {
    await useProjectStore
      .getState()
      .addDataFile(
        new File(['alpha,beta,gamma\nSolar,Grid,50\nGrid,Home,30'], 'unmapped.csv', {
          type: 'text/csv',
        }),
      );

    // First call reports source headers instead of throwing
    const first = await callTool('load_data_file_to_plugin', { path: 'unmapped.csv' });
    expect(first.isError).toBe(true);
    const info = JSON.parse(textOf(first));
    expect(info.error).toBe('column_mapping_required');
    expect(info.sourceHeaders).toEqual(['alpha', 'beta', 'gamma']);

    // Second call with explicit columnMapping succeeds
    const second = await callTool('load_data_file_to_plugin', {
      path: 'unmapped.csv',
      columnMapping: { source: 'alpha', target: 'beta', value: 'gamma' },
    });
    expect(second.isError).toBeFalsy();
    expect(loadedCsvs.at(-1)).toContain('Solar,Grid,50');
  });

  it('write_data_file enforces overwrite guard and updates global project data cleanly', async () => {
    const createRes = await callTool('write_data_file', {
      name: 'graph.json',
      json: {
        nodes: [{ id: 'A' }, { id: 'B' }],
        links: [{ source: 'A', target: 'B', weight: 3 }],
      },
    });
    expect(createRes.isError).toBeFalsy();

    // Without overwrite: true, replacing an existing file is safely blocked
    const blocked = await callTool('write_data_file', {
      name: 'graph.json',
      json: { nodes: [{ id: 'X' }], links: [{ source: 'X', target: 'X', weight: 1 }] },
    });
    expect(blocked.isError).toBe(true);
    expect(textOf(blocked)).toContain('already exists');

    // With overwrite: true, updates in place and loads into networkGraph when requested
    await usePluginStore.getState().activate(networkGraphManifest.id);
    const updated = await callTool('write_data_file', {
      name: 'graph.json',
      json: {
        nodes: [{ id: 'N1' }, { id: 'N2' }],
        links: [{ source: 'N1', target: 'N2', weight: 5 }],
      },
      overwrite: true,
      loadIntoActivePlugin: true,
    });
    expect(updated.isError).toBeFalsy();
    const out = JSON.parse(textOf(updated));
    expect(out.overwritten).toBe(true);
    expect(out.loadedIntoPlugin).toBe(networkGraphManifest.id);
  });
});
