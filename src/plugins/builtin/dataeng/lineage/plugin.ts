// ==========================================================================
// Data Lineage Visualizer — plugin controller.
//
// Wires the pure lineage kernel to the plugin contract:
//  - builds the graph from the project data-file registry + the experiment
//    run records, merged with the host plugin-store run history;
//  - renders the full DAG through the host LineageCanvas inside a React
//    root (trusted sandbox) with an impact-analysis sidebar;
//  - annotates file nodes with git commits (graceful no-version degradation);
//  - exports JSON / GraphML through api.exportFile;
//  - publishes node/edge/file/run counts and the longest chain depth as
//    structured scientific outputs;
//  - persists view options (highlight mode, version display) via setParam.
// ==========================================================================

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { buildLineage } from '@/core/lineage/graph';
import type { LineageFile, LineageGraph } from '@/core/lineage/graph';
import type { RunRecord } from '@/core/experiment/record';
import { listRuns } from '@/core/storage';
import { getGitAdapter } from '@/core/git';
import { LINEAGE_CHANGED, on } from '@/core/events';
import type { BusSubscription } from '@/core/events';
import { clearScienceOutputs, setScienceOutputs } from '@/core/research/scienceOutput';
import { getProjectRepoPath, useProjectStore } from '@/stores/projectStore';
import { usePluginStore } from '@/stores/pluginStore';
import { lineageManifest } from './manifest';
import {
  annotateVersions,
  computeLineageStats,
  impactAnalysis,
  runsFromHistory,
  toGraphml,
  toLineageJson,
} from './kernel';
import type { CommitRef, LineageVersionInfo } from './kernel';
import { LineageView } from './view';
import type { HighlightMode } from './view';
import { tx } from './texts';

const HIGHLIGHT_MODES: readonly HighlightMode[] = ['both', 'upstream', 'downstream', 'off'];
const GIT_COMMIT_LIMIT = 50;

export class LineagePlugin implements Plugin {
  readonly manifest = lineageManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private root: Root | null = null;
  private rootEl: HTMLDivElement | null = null;
  private zh = false;
  private graph: LineageGraph = { nodes: [], edges: [] };
  private versions: Record<string, LineageVersionInfo> = {};
  private gitAvailable = false;
  private selectedId: string | null = null;
  private highlightMode: HighlightMode = 'both';
  private showVersions = true;
  private loading = false;
  /** Supersedes late listRuns/git responses after a newer rebuild started. */
  private rebuildSeq = 0;
  private lineageSub: BusSubscription | null = null;

  async init(api: PluginApi): Promise<void> {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((locale) => {
      this.zh = locale === 'zh-CN';
      this.draw();
    });
    // Restore persisted view options (authoritative restore happens in
    // updateParams when the project state replays them).
    const mode = api.getParam('highlightMode');
    if (typeof mode === 'string' && (HIGHLIGHT_MODES as readonly string[]).includes(mode)) {
      this.highlightMode = mode as HighlightMode;
    }
    const versions = api.getParam('showVersions');
    if (typeof versions === 'boolean') this.showVersions = versions;
    // Live refresh while a run completes / data finishes ingesting elsewhere.
    this.lineageSub = on<{ reason?: string }>(LINEAGE_CHANGED, () => {
      void this.rebuild();
    });
  }

  async destroy(): Promise<void> {
    this.lineageSub?.unsubscribe();
    this.lineageSub = null;
    clearScienceOutputs(this.manifest.id);
    this.deactivate();
  }

  activate(context: { container: ContainerCapabilities }): void {
    this.ctx = context.container;
  }

  deactivate(): void {
    this.ctx = null;
    // Release the React root so a deactivated plugin never keeps a live tree
    // over the shared DOM container.
    this.root?.unmount();
    this.root = null;
    this.rootEl = null;
  }

  render(container: ContainerCapabilities): void {
    this.ctx = container;
    this.draw();
    if (this.graph.nodes.length === 0 && !this.loading) void this.rebuild();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameter panel -----------------------------------------------------

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'highlightMode',
        label: 'Highlight mode',
        labelI18n: { 'zh-CN': '高亮模式', 'en-US': 'Highlight mode' },
        type: 'select',
        value: this.highlightMode,
        options: [
          { value: 'both', label: 'Upstream + downstream', labelI18n: { 'zh-CN': '上游 + 下游', 'en-US': 'Upstream + downstream' } },
          { value: 'upstream', label: 'Upstream only', labelI18n: { 'zh-CN': '仅上游数据源', 'en-US': 'Upstream only' } },
          { value: 'downstream', label: 'Downstream only', labelI18n: { 'zh-CN': '仅受影响输出', 'en-US': 'Downstream only' } },
          { value: 'off', label: 'Off', labelI18n: { 'zh-CN': '关闭', 'en-US': 'Off' } },
        ],
      },
      {
        key: 'showVersions',
        label: 'Show git versions',
        labelI18n: { 'zh-CN': '显示 Git 版本', 'en-US': 'Show git versions' },
        type: 'checkbox',
        value: this.showVersions,
      },
    ];
  }

  async updateParams(params: Record<string, unknown>): Promise<void> {
    let changed = false;
    const mode = params['highlightMode'];
    if (
      typeof mode === 'string' &&
      (HIGHLIGHT_MODES as readonly string[]).includes(mode) &&
      mode !== this.highlightMode
    ) {
      this.highlightMode = mode as HighlightMode;
      this.api.setParam('highlightMode', mode);
      changed = true;
    }
    const versions = params['showVersions'];
    if (typeof versions === 'boolean' && versions !== this.showVersions) {
      this.showVersions = versions;
      this.api.setParam('showVersions', versions);
      changed = true;
    }
    if (changed) {
      this.publishScience();
      this.draw();
    }
  }

  // ---- graph construction ---------------------------------------------------

  /** Rebuild the lineage graph from project files + runs + run history. */
  private async rebuild(): Promise<void> {
    if (!this.api) return;
    const seq = ++this.rebuildSeq;
    this.loading = true;
    this.draw();

    const project = useProjectStore.getState().project;
    const entries = project?.data?.files ?? [];
    const files: LineageFile[] = entries.map((f) => ({ id: f.id, name: f.name }));

    const runs: RunRecord[] = [];
    if (project) {
      try {
        runs.push(...(await listRuns(project.id)));
      } catch {
        // Storage unavailable — degrade to the run history below.
      }
    }
    // Merge the host plugin-store run history (imports/computes recorded by
    // the host), deduped by run id against the experiment records.
    const seen = new Set(runs.map((r) => r.id));
    for (const run of runsFromHistory(usePluginStore.getState().runHistory, files)) {
      if (!seen.has(run.id)) {
        seen.add(run.id);
        runs.push(run);
      }
    }

    const graph = buildLineage(files, runs);
    const commits = await this.readCommits();
    if (seq !== this.rebuildSeq) return; // a newer rebuild superseded this one

    const annotated = annotateVersions(graph, commits);
    this.graph = annotated.graph;
    this.versions = annotated.versions;
    this.gitAvailable = commits.length > 0;
    if (this.selectedId && !graph.nodes.some((n) => n.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.loading = false;
    this.publishScience();
    this.draw();
  }

  /**
   * Read the project repo's commit history through the git adapter. Any
   * failure (not a repo, FS unavailable) degrades to an empty list — the
   * plugin then runs in no-version mode instead of crashing.
   */
  private async readCommits(): Promise<CommitRef[]> {
    try {
      const project = useProjectStore.getState().project;
      if (!project) return [];
      const adapter = getGitAdapter();
      const repoPath = getProjectRepoPath(project);
      if (!(await adapter.isRepo(repoPath))) return [];
      const commits = await adapter.log(repoPath, { limit: GIT_COMMIT_LIMIT });
      return commits.map((c) => ({
        hash: c.hash,
        shortHash: c.shortHash,
        message: c.message,
        timestamp: c.timestamp,
      }));
    } catch {
      return [];
    }
  }

  // ---- outputs --------------------------------------------------------------

  /** Publish the graph's structural statistics as scientific metrics. */
  private publishScience(): void {
    const stats = computeLineageStats(this.graph, this.versions);
    const metrics = [
      { key: 'nodes', label: tx('nodes', this.zh), value: String(stats.nodes) },
      { key: 'edges', label: tx('edges', this.zh), value: String(stats.edges) },
      { key: 'files', label: tx('files', this.zh), value: String(stats.files) },
      { key: 'runs', label: tx('runs', this.zh), value: String(stats.runs) },
      { key: 'depth', label: tx('depth', this.zh), value: String(stats.longestChainDepth) },
    ];
    if (this.gitAvailable) {
      metrics.push({
        key: 'versioned',
        label: tx('versioned', this.zh),
        value: `${stats.versionedFiles}/${stats.files}`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportJson(): void {
    this.runTrackedExport('lineage.json', 'Export lineage JSON', () => {
      const json = JSON.stringify(toLineageJson(this.graph, this.versions), null, 2);
      this.api.exportFile('lineage.json', json, 'application/json');
    });
  }

  private exportGraphml(): void {
    this.runTrackedExport('lineage.graphml', 'Export lineage GraphML', () => {
      const xml = toGraphml(this.graph, this.versions);
      this.api.exportFile('lineage.graphml', xml, 'application/xml');
    });
  }

  /** Wrap an export in a tracked run record; never throws. */
  private runTrackedExport(fileName: string, label: string, action: () => void): void {
    const store = usePluginStore.getState();
    const runId = store.beginRun({ pluginId: this.manifest.id, kind: 'custom', label });
    try {
      action();
      usePluginStore.getState().finishRun(runId, true);
      this.api.notify('success', `${tx('exportDone', this.zh)} · ${fileName}`);
    } catch (err) {
      usePluginStore.getState().finishRun(runId, false, err instanceof Error ? err.message : String(err));
      this.api.notify('error', `${tx('exportDone', this.zh)} failed · ${fileName}`);
    }
  }

  // ---- rendering --------------------------------------------------------------

  private draw(): void {
    const dom = this.ctx?.dom;
    if (!dom) return;
    if (!this.root || this.rootEl !== dom) {
      this.root?.unmount();
      this.root = createRoot(dom);
      this.rootEl = dom;
    }
    const impact = this.selectedId ? impactAnalysis(this.graph, this.selectedId) : null;
    this.root.render(
      createElement(LineageView, {
        graph: this.graph,
        versions: this.versions,
        selectedId: this.selectedId,
        upstream: impact?.upstream ?? [],
        downstream: impact?.downstream ?? [],
        highlightMode: this.highlightMode,
        showVersions: this.showVersions,
        gitAvailable: this.gitAvailable,
        loading: this.loading,
        zh: this.zh,
        onSelect: (id: string) => {
          this.selectedId = this.selectedId === id ? null : id;
          this.draw();
        },
        onRefresh: () => void this.rebuild(),
        onExportJson: () => this.exportJson(),
        onExportGraphml: () => this.exportGraphml(),
      }),
    );
  }
}

/** Plugin factory (ESM default export per the plugin contract). */
export default function createLineagePlugin(): Plugin {
  return new LineagePlugin();
}
