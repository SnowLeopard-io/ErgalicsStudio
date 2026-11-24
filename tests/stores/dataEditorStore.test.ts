import { describe, it, expect, beforeEach } from 'vitest';
import { useDataEditorStore, buildSchemaTemplateText } from '@/stores/dataEditorStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { resolvePluginDataSchemas } from '@/core/data-schema/presets';
import { scatterManifest } from '@/plugins/builtin/charts/scatter/manifest';
import { sankeyManifest } from '@/plugins/builtin/charts/sankey/manifest';
import { networkGraphManifest } from '@/plugins/builtin/charts/networkGraph/manifest';
import { statsSurvivalManifest } from '@/plugins/builtin/stats/survival/manifest';
import type { Plugin } from '@/types/plugin';

describe('Pilot Plugin Data Schemas & Builtin Bindings', () => {
  it('resolves schemas for all 4 pilot plugins (including signed stats-survival)', () => {
    const scatterSchemas = resolvePluginDataSchemas(scatterManifest);
    expect(scatterSchemas).toHaveLength(1);
    expect(scatterSchemas[0]?.presetId).toBe('ergalics:tabular/xy-series');

    const sankeySchemas = resolvePluginDataSchemas(sankeyManifest);
    expect(sankeySchemas).toHaveLength(1);
    expect(sankeySchemas[0]?.presetId).toBe('ergalics:tabular/edge-list');

    const netSchemas = resolvePluginDataSchemas(networkGraphManifest);
    expect(netSchemas).toHaveLength(2);
    expect(netSchemas.map((s) => s.kind)).toEqual(['tabular', 'json']);

    // Signed stats-survival resolves via BUILTIN_PLUGIN_DATA_SCHEMAS without touching manifest signature
    const survSchemas = resolvePluginDataSchemas(statsSurvivalManifest);
    expect(survSchemas).toHaveLength(1);
    expect(survSchemas[0]?.presetId).toBe('ergalics:tabular/survival-table');
  });
});

describe('dataEditorStore: Ingestion, Dual-Mode Editor & Project Sync', () => {
  const loadedPayloads: string[] = [];

  const mockSankeyPlugin: Plugin = {
    manifest: sankeyManifest,
    init() {},
    getParams: () => [],
    async loadData(file) {
      loadedPayloads.push(await file.text());
    },
  };

  beforeEach(async () => {
    loadedPayloads.length = 0;
    useDataEditorStore.setState({
      bindings: {},
      staleBindings: {},
      mappingRequest: null,
      errorRequest: null,
      editorSession: null,
    });
    const pluginStore = usePluginStore.getState();
    if (pluginStore.isLoaded(sankeyManifest.id)) {
      await pluginStore.unload(sankeyManifest.id);
    }
    await pluginStore.load(mockSankeyPlugin);
    await useProjectStore.getState().createProject('Sync Test Project');
  });

  it('ingests valid CSV, opens ColumnMappingModal on unknown headers, and opens ValidationErrorModal on invalid rows', async () => {
    const store = useDataEditorStore.getState();

    // 1. Valid CSV delivers directly to legacy loadData(file)
    const okRes = await store.ingestForPlugin({
      pluginId: sankeyManifest.id,
      fileName: 'flows.csv',
      text: 'source,target,value\nSolar,Grid,45\nGrid,Home,30',
      origin: 'upload',
      silent: true,
    });
    expect(okRes.ok).toBe(true);
    expect(loadedPayloads).toHaveLength(1);
    expect(loadedPayloads[0]).toContain('Solar,Grid,45');

    // 2. Unknown headers trigger mappingRequest instead of throwing
    const mapRes = await store.ingestForPlugin({
      pluginId: sankeyManifest.id,
      fileName: 'weird.csv',
      text: 'foo,bar,baz\nSolar,Grid,45',
      origin: 'upload',
      silent: true,
    });
    expect(mapRes.ok).toBe(false);
    expect(mapRes.pending).toBe('mapping');
    expect(useDataEditorStore.getState().mappingRequest?.fileName).toBe('weird.csv');

    // 3. Invalid negative value triggers errorRequest instead of throwing
    const errRes = await store.ingestForPlugin({
      pluginId: sankeyManifest.id,
      fileName: 'bad.csv',
      text: 'source,target,value\nSolar,Grid,-10',
      origin: 'upload',
      silent: true,
    });
    expect(errRes.ok).toBe(false);
    expect(errRes.pending).toBe('error');
    expect(useDataEditorStore.getState().errorRequest?.issues[0]?.row).toBe(1);
  });

  it('preserves draft text across docked <-> modal layout switches', () => {
    const schema = resolvePluginDataSchemas(sankeyManifest)[0]!;
    const store = useDataEditorStore.getState();
    store.openEditor({
      pluginId: sankeyManifest.id,
      schema,
      layout: 'docked',
    });
    expect(useDataEditorStore.getState().editorSession?.layout).toBe('docked');
    expect(useDataEditorStore.getState().editorSession?.text).toBe(buildSchemaTemplateText(schema));

    store.updateEditorDraftText('source,target,value\nA,B,99');
    store.setEditorLayout('modal');
    expect(useDataEditorStore.getState().editorSession?.layout).toBe('modal');
    expect(useDataEditorStore.getState().editorSession?.text).toBe('source,target,value\nA,B,99');
  });

  it('flags bound plugin as stale when linked global project file is updated externally and reloads cleanly', async () => {
    const projectStore = useProjectStore.getState();
    const initialCsv = 'source,target,value\nSolar,Grid,45';
    const fileId = await projectStore.addDataFile(
      new File([initialCsv], 'shared-flows.csv', { type: 'text/csv' }),
    );
    expect(fileId).toBeTruthy();

    await useDataEditorStore.getState().ingestForPlugin({
      pluginId: sankeyManifest.id,
      fileName: 'shared-flows.csv',
      text: initialCsv,
      origin: 'project-file',
      fileId: fileId!,
      silent: true,
    });

    const key = `${sankeyManifest.id}::primary`;
    expect(useDataEditorStore.getState().staleBindings[key]).toBeUndefined();

    // Another tool/plugin updates the same global project file
    const updatedCsv = 'source,target,value\nSolar,Grid,88\nWind,Grid,22';
    const updated = await useProjectStore
      .getState()
      .updateDataFile(fileId!, updatedCsv, 'example.network');
    expect(updated).toBe(true);

    // Sankey's binding should immediately be marked stale
    const staleNotice = useDataEditorStore.getState().staleBindings[key];
    expect(staleNotice).toBeDefined();
    expect(staleNotice?.fileName).toBe('shared-flows.csv');

    // Reloading pulls the updated content and clears the stale banner
    await useDataEditorStore.getState().reloadStaleBinding(sankeyManifest.id, 'primary');
    expect(useDataEditorStore.getState().staleBindings[key]).toBeUndefined();
    expect(loadedPayloads[loadedPayloads.length - 1]).toContain('Solar,Grid,88');
  });
});
