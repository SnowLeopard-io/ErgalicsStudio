// ==========================================================================
// Result store — the only writer of project.state.results (FR-1 / FR-2)
//
// `publishResult` mints one immutable record per computation and appends it
// to the portable project snapshot. Display surfaces read from these records;
// they never reach into plugin internals for numbers.
// ==========================================================================

import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import { usePluginStore } from './pluginStore';
import { getGpuBackend } from '@/core/gpu';
import {
  createResultRecord,
  compareResults,
  type CreateResultRecordArgs,
} from '@/core/result/record';
import type { ResultComparisonRow, ResultRecord } from '@/core/result/types';
import { setResultPublisher, type ScienceMetric } from '@ergalics/plugin-sdk/bridges';
import { setExportSidecarHook } from '@/core/result/exportHook';
import { buildSidecar, downloadSidecar, hashDownloadData } from '@/core/result/sidecar';
import {
  getCurrentDataHash,
  getPluginDataSource,
  setCurrentDataHash,
} from '@/core/result/activeData';

// Data-loading paths report their fingerprint through core/result/activeData
// (see projectStore.addDataFile / updateDataFile / useFileRouting). Re-exported
// here for existing import sites.
export { setCurrentDataHash, getCurrentDataHash };
export {
  getCurrentDataSource,
  setCurrentDataSource,
  resetCurrentDataSource,
  getPluginDataSource,
  setPluginDataSource,
} from '@/core/result/activeData';

interface ResultStore {
  /** Mirror of project.state.results for reactive consumers. */
  records: ResultRecord[];
  /** Fast lookup of the last result id per plugin. */
  latestByPlugin: Record<string, string>;
  publishResult: (args: CreateResultRecordArgs) => ResultRecord;
  publishMetrics: (pluginId: string, metrics: ScienceMetric[]) => ResultRecord;
  getResult: (resultId: string) => ResultRecord | undefined;
  getLatest: (pluginId: string) => ResultRecord | undefined;
  compare: (originalId: string, reproduced: ResultRecord) => ResultComparisonRow[];
  syncFromProject: (records: ResultRecord[]) => void;
}

function indexRecords(records: ResultRecord[]): Record<string, string> {
  const latest: Record<string, string> = {};
  for (const r of records) latest[r.pluginId] = r.resultId;
  return latest;
}

export const useResultStore = create<ResultStore>((set, get) => ({
  records: [],
  latestByPlugin: {},

  syncFromProject: (records) => set({ records, latestByPlugin: indexRecords(records) }),

  publishResult: (args) => {
    const projectStore = useProjectStore.getState();
    const project = projectStore.project;
    const pluginId = args.pluginId;
    const pluginVersion =
      args.pluginVersion ??
      usePluginStore.getState().registry.find((e) => e.id === pluginId)?.version ??
      'unknown';
    const snapshotParams = project?.state.parameters?.[pluginId] ?? {};
    // Real execution backend, not the settings preference: "auto" + a live
    // device means WebGPU; fallback / no device means CPU.
    const gpu = getGpuBackend();
    const resolvedBackend = gpu.available && !gpu.fallback ? 'webgpu' : 'cpu';
    const backend = args.environment?.backend ?? resolvedBackend;
    // FR-1: default the input fingerprint to the data this plugin was fed.
    // Plugin-scoped first (a project may hold several datasets at once),
    // then the global fallback for plugin-agnostic load paths.
    const activeSource = getPluginDataSource(pluginId);
    const record = createResultRecord({
      ...args,
      pluginId,
      pluginVersion,
      dataHash: args.dataHash || activeSource?.hash || '',
      sources:
        args.sources ??
        (activeSource ? [{ name: activeSource.name, hash: activeSource.hash }] : []),
      params: { ...snapshotParams, ...(args.params ?? {}) },
      environment: { backend, ...(args.environment ?? {}) },
    });

    if (project) {
      const results = [...(project.state.results ?? []), record];
      useProjectStore.setState({
        project: { ...project, state: { ...project.state, results } },
      });
      projectStore.setDirty(true);
    }
    set((s) => ({
      records: [...s.records, record],
      latestByPlugin: { ...s.latestByPlugin, [pluginId]: record.resultId },
    }));
    return record;
  },

  /**
   * Adapter for the existing `setScienceOutputs` bus: every plugin that
   * publishes metrics gets a ResultRecord without changing plugin code.
   */
  publishMetrics: (pluginId, metrics) =>
    get().publishResult({
      pluginId,
      metrics: metrics.map((m) => ({
        key: m.key,
        label: m.label,
        value: m.value,
        display: m.value,
        ...(m.unit ? { unit: m.unit } : {}),
        ...(m.severity ? { severity: m.severity } : {}),
        ...(m.hint ? { hint: m.hint } : {}),
      })),
    }),

  getResult: (resultId) => get().records.find((r) => r.resultId === resultId),

  getLatest: (pluginId) => {
    const id = get().latestByPlugin[pluginId];
    return id ? get().getResult(id) : undefined;
  },

  compare: (originalId, reproduced) => {
    const original = get().getResult(originalId);
    return original ? compareResults(original, reproduced) : [];
  },
}));

/** Keep the reactive mirror in step with project open / share-link loads. */
useProjectStore.subscribe((state, prev) => {
  if (state.project !== prev.project) {
    useResultStore.getState().syncFromProject(state.project?.state.results ?? []);
  }
});

/** Register the metrics→record bridge once at app boot. */
export function initResultStore(): void {
  setResultPublisher((pluginId, metrics) =>
    useResultStore.getState().publishMetrics(pluginId, metrics),
  );
  setExportSidecarHook((fileName, data, _mimeType, pluginId) => {
    const match = /\.(svg|png|pdf|csv)$/i.exec(fileName);
    if (!match) return;
    const record = useResultStore.getState().getLatest(pluginId);
    if (!record) return;
    void hashDownloadData(data).then((hash) => {
      downloadSidecar(
        buildSidecar(
          record,
          { name: fileName, hash },
          { format: match[1]?.toLowerCase() ?? 'bin', colorSpace: 'rgb' },
          [record.resultId],
        ),
      );
    });
  });
  useResultStore.getState().syncFromProject(
    useProjectStore.getState().project?.state.results ?? [],
  );
}
