// ==========================================================================
// Ergalics Studio — data lineage page (/studio/lineage).
//
// Files → runs → artifacts DAG. Rebuilds on mount and keeps live-updating
// while a run finishes underneath (LINEAGE_CHANGED → version). Extends the
// plain viewer with impact analysis (click a node to highlight its upstream
// sources in blue and downstream affected outputs in orange), JSON / GraphML
// exports and git-commit version annotation of file nodes.
// ==========================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { LineageCanvas } from '@/components/LineageCanvas';
import { useLineageStore } from '@/stores/lineageStore';
import { ToolShell } from '@/components/ToolShell';
import {
  annotateVersions,
  impactAnalysis,
  toGraphml,
  toLineageJson,
} from '@/core/lineage/analysis';
import type { ImpactAnalysisResult, LineageVersionInfo } from '@/core/lineage/analysis';
import { getGitAdapter } from '@/core/git';
import { getProjectRepoPath, useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { downloadBlob } from '@/core/download';

const GIT_LOG_LIMIT = 50;

export default function LineagePage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const graph = useLineageStore((s) => s.graph);
  const version = useLineageStore((s) => s.version);
  const loading = useLineageStore((s) => s.loading);
  const rebuild = useLineageStore((s) => s.rebuild);
  const project = useProjectStore((s) => s.project);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactAnalysisResult | null>(null);
  const [versions, setVersions] = useState<Record<string, LineageVersionInfo>>({});

  useEffect(() => {
    void rebuild();
  }, [rebuild]);

  // Git version annotation: attach the latest commit mentioning each file
  // name to its node. Degrades silently to the unversioned mode when the
  // project has no git repo or history is unavailable.
  useEffect(() => {
    let cancelled = false;
    setVersions({});
    if (!project || graph.nodes.length === 0) return;
    const run = async (): Promise<void> => {
      try {
        const adapter = getGitAdapter();
        const repoPath = getProjectRepoPath(project);
        if (!(await adapter.isRepo(repoPath))) return;
        const commits = await adapter.log(repoPath, { limit: GIT_LOG_LIMIT });
        if (cancelled) return;
        setVersions(annotateVersions(graph, commits).versions);
      } catch {
        // No usable git history — keep the unversioned mode.
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [graph, project]);

  // A rebuild may remove the selected node; clear stale selections.
  useEffect(() => {
    if (selectedId && !graph.nodes.some((n) => n.id === selectedId)) {
      setSelectedId(null);
      setImpact(null);
    }
  }, [graph, selectedId]);

  const handleNodeClick = useCallback(
    (id: string) => {
      if (selectedId === id) {
        setSelectedId(null);
        setImpact(null);
        return;
      }
      setSelectedId(id);
      setImpact(impactAnalysis(graph, id));
    },
    [graph, selectedId],
  );

  const nodeLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of graph.nodes) map.set(n.id, n.label);
    return map;
  }, [graph]);

  const upstreamSet = useMemo(
    () => (impact ? new Set(impact.upstream.map((n) => n.id)) : null),
    [impact],
  );
  const downstreamSet = useMemo(
    () => (impact ? new Set(impact.downstream.map((n) => n.id)) : null),
    [impact],
  );

  const exportJson = async (): Promise<void> => {
    await downloadBlob(
      'lineage.json',
      JSON.stringify(toLineageJson(graph, versions), null, 2),
      'application/json;charset=utf-8',
    );
    notify('success', t('lineage.export_done', { name: 'lineage.json' }));
  };

  const exportGraphml = async (): Promise<void> => {
    await downloadBlob('lineage.graphml', toGraphml(graph, versions), 'application/xml;charset=utf-8');
    notify('success', t('lineage.export_done', { name: 'lineage.graphml' }));
  };

  const versionedCount = Object.keys(versions).length;
  const versionedNodes = graph.nodes.filter((n) => versions[n.id] !== undefined);

  return (
    <ToolShell toolId="lineage">
      <div className="lineage-dialog">
        {graph.nodes.length === 0 && !loading && <p className="lineage-empty">{t('lineage.empty')}</p>}
        {graph.nodes.length > 0 && (
          <>
            <div className="lineage-legend">
              <span className="lineage-legend-file">{t('lineage.legend_file')}</span>
              <span className="lineage-legend-run">{t('lineage.legend_run')}</span>
              <span className="lineage-legend-failed">{t('research.runs.failed')}</span>
              <span className="lineage-legend-meta">
                {t('lineage.files', { files: graph.nodes.filter((n) => n.kind === 'file').length })}
                {' · '}
                {t('lineage.runs', { runs: graph.nodes.filter((n) => n.kind === 'run').length })}
                {versionedCount > 0 && (
                  <>
                    {' · '}
                    {t('lineage.versioned', { n: versionedCount })}
                  </>
                )}
              </span>
            </div>
            <div className="analysis-row">
              <span className="figures-panel-meta">{t('lineage.click_hint')}</span>
              <button type="button" className="btn" onClick={() => void exportJson()}>
                {t('lineage.export_json')}
              </button>
              <button type="button" className="btn" onClick={() => void exportGraphml()}>
                {t('lineage.export_graphml')}
              </button>
            </div>
            <div className="lineage-scroll" key={version}>
              <LineageCanvas
                graph={graph}
                selectedId={selectedId}
                highlightUpstream={upstreamSet}
                highlightDownstream={downstreamSet}
                onNodeClick={handleNodeClick}
              />
            </div>
            {impact && (
              <div className="lineage-impact">
                <div className="lineage-impact-col">
                  <div className="share-section-title">{t('lineage.upstream_list')}</div>
                  {impact.upstream.length === 0 ? (
                    <span className="figures-panel-meta">—</span>
                  ) : (
                    <ul className="lineage-impact-list">
                      {impact.upstream.map((u) => (
                        <li key={u.id}>
                          <span>{nodeLabels.get(u.id) ?? u.id}</span>
                          <span className="lineage-impact-depth">d{u.depth}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="lineage-impact-col">
                  <div className="share-section-title">{t('lineage.downstream_list')}</div>
                  {impact.downstream.length === 0 ? (
                    <span className="figures-panel-meta">—</span>
                  ) : (
                    <ul className="lineage-impact-list">
                      {impact.downstream.map((d) => (
                        <li key={d.id}>
                          <span>{nodeLabels.get(d.id) ?? d.id}</span>
                          <span className="lineage-impact-depth">d{d.depth}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {versionedNodes.length > 0 && (
              <div className="lineage-versions">
                {versionedNodes.map((n) => {
                  const v = versions[n.id]!;
                  return (
                    <div key={n.id} className="lineage-version-row">
                      <span>{n.label}</span>
                      <span className="mono">{v.shortHash}</span>
                      <span className="figures-panel-meta">{v.message}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}
