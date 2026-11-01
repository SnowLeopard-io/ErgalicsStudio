// ==========================================================================
// Data Lineage Visualizer — React view.
//
// Academic calm low-saturation palette, no emoji. Reuses the host
// LineageCanvas (SVG DAG) and adds an impact-analysis sidebar: clicking a
// node highlights its upstream data sources (blue) and downstream affected
// outputs (orange) and lists them with depths. Scoped styles are injected
// with the component so no global stylesheet changes are needed.
// ==========================================================================

import { LineageCanvas } from '@/components/LineageCanvas';
import type { LineageGraph } from '@/core/lineage/graph';
import type { ImpactNode, LineageVersionInfo } from './kernel';
import { tx } from './texts';

export type HighlightMode = 'both' | 'upstream' | 'downstream' | 'off';

const ACCENT_UPSTREAM = '#5b7fa6';
const ACCENT_DOWNSTREAM = '#b87f4f';
const ACCENT_SELECTED = '#3d5a76';
const ACCENT_MUTED = '#8b95a1';

const CSS = `
.dlv-root { display:flex; flex-direction:column; height:100%; min-height:320px; color:#3a4450;
  font: 13px/1.5 var(--font-ui, system-ui, sans-serif); background:transparent; }
.dlv-toolbar { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; padding:10px 14px;
  border-bottom:1px solid #e3e8ee; }
.dlv-title { font-size:15px; font-weight:600; letter-spacing:.02em; color:#2e3947; }
.dlv-subtitle { color:${ACCENT_MUTED}; font-size:12px; max-width:420px; }
.dlv-spacer { flex:1; }
.dlv-btn { border:1px solid #cdd6df; background:#f7fafc; color:#3a4450; border-radius:6px;
  padding:4px 12px; font-size:12px; cursor:pointer; }
.dlv-btn:hover { background:#eef3f8; border-color:${ACCENT_UPSTREAM}; }
.dlv-btn:disabled { opacity:.55; cursor:default; }
.dlv-body { display:flex; flex:1; min-height:0; }
.dlv-canvas { flex:1; overflow:auto; padding:16px; }
.dlv-sidebar { width:250px; flex:none; overflow:auto; border-left:1px solid #e3e8ee;
  padding:12px 14px; display:flex; flex-direction:column; gap:14px; }
.dlv-section-title { font-size:12px; font-weight:600; color:#2e3947; letter-spacing:.03em;
  margin:0 0 6px; }
.dlv-section-title .dlv-count { color:${ACCENT_MUTED}; font-weight:400; }
.dlv-badge { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:6px;
  vertical-align:baseline; }
.dlv-item { display:flex; gap:8px; align-items:baseline; padding:3px 6px; border-radius:4px;
  cursor:pointer; }
.dlv-item:hover { background:#f0f4f8; }
.dlv-item-depth { color:${ACCENT_MUTED}; font-size:11px; flex:none; min-width:26px;
  font-variant-numeric:tabular-nums; }
.dlv-item-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dlv-item.up .dlv-item-label { color:${ACCENT_UPSTREAM}; }
.dlv-item.down .dlv-item-label { color:${ACCENT_DOWNSTREAM}; }
.dlv-muted { color:${ACCENT_MUTED}; font-size:12px; }
.dlv-kv { display:flex; justify-content:space-between; gap:10px; font-size:12px; padding:2px 0; }
.dlv-kv .k { color:${ACCENT_MUTED}; }
.dlv-kv .v { font-variant-numeric:tabular-nums; }
.dlv-version { margin-top:6px; padding:8px 10px; background:#f4f7fa; border-left:2px solid ${ACCENT_SELECTED};
  border-radius:0 4px 4px 0; font-size:12px; }
.dlv-version .hash { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; color:${ACCENT_SELECTED}; }
.dlv-version .msg { color:#5a6572; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dlv-meta { display:flex; gap:14px; flex-wrap:wrap; font-size:12px; color:${ACCENT_MUTED}; }
.dlv-node-selected rect { stroke:${ACCENT_SELECTED}; stroke-width:2; }
.dlv-node-upstream rect { stroke:${ACCENT_UPSTREAM}; stroke-width:2; fill:#e9f0f7; }
.dlv-node-downstream rect { stroke:${ACCENT_DOWNSTREAM}; stroke-width:2; fill:#f9f1e9; }
.dlv-empty { flex:1; display:flex; align-items:center; justify-content:center; color:${ACCENT_MUTED}; }
`;

export interface LineageViewProps {
  graph: LineageGraph;
  versions: Record<string, LineageVersionInfo>;
  selectedId: string | null;
  upstream: ImpactNode[];
  downstream: ImpactNode[];
  highlightMode: HighlightMode;
  showVersions: boolean;
  gitAvailable: boolean;
  loading: boolean;
  zh: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onExportJson: () => void;
  onExportGraphml: () => void;
}

function ImpactList(props: {
  title: string;
  accent: string;
  items: ImpactNode[];
  zh: boolean;
  onSelect: (id: string) => void;
}) {
  const { title, accent, items, zh, onSelect } = props;
  return (
    <div>
      <p className="dlv-section-title">
        <span className="dlv-badge" style={{ background: accent }} />
        {title} <span className="dlv-count">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="dlv-muted">{tx('none', zh)}</p>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className={`dlv-item ${accent === ACCENT_UPSTREAM ? 'up' : 'down'}`}
            onClick={() => onSelect(item.id)}
          >
            <span className="dlv-item-depth">d{item.depth}</span>
            <span className="dlv-item-label" title={item.id}>{item.id}</span>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * Full lineage view: toolbar, canvas (host LineageCanvas) and impact sidebar.
 */
export function LineageView(props: LineageViewProps) {
  const {
    graph, versions, selectedId, upstream, downstream, highlightMode, showVersions,
    gitAvailable, loading, zh, onSelect, onRefresh, onExportJson, onExportGraphml,
  } = props;

  const files = graph.nodes.filter((n) => n.kind === 'file').length;
  const runs = graph.nodes.length - files;
  const selected = selectedId ? graph.nodes.find((n) => n.id === selectedId) ?? null : null;
  const selectedVersion = selectedId ? versions[selectedId] : undefined;

  const showUpstream = highlightMode === 'both' || highlightMode === 'upstream';
  const showDownstream = highlightMode === 'both' || highlightMode === 'downstream';
  const upstreamSet = showUpstream ? new Set(upstream.map((n) => n.id)) : null;
  const downstreamSet = showDownstream ? new Set(downstream.map((n) => n.id)) : null;

  return (
    <div className="dlv-root">
      <style>{CSS}</style>
      <div className="dlv-toolbar">
        <span className="dlv-title">{tx('title', zh)}</span>
        <span className="dlv-subtitle">{tx('subtitle', zh)}</span>
        <span className="dlv-spacer" />
        <span className="dlv-meta">
          <span>{tx('nodes', zh)} {graph.nodes.length}</span>
          <span>{tx('edges', zh)} {graph.edges.length}</span>
          <span>{tx('files', zh)} {files}</span>
          <span>{tx('runs', zh)} {runs}</span>
        </span>
        <button className="dlv-btn" onClick={onRefresh} disabled={loading}>
          {loading ? tx('refreshing', zh) : tx('refresh', zh)}
        </button>
        <button className="dlv-btn" onClick={onExportJson} disabled={graph.nodes.length === 0}>
          {tx('exportJson', zh)}
        </button>
        <button className="dlv-btn" onClick={onExportGraphml} disabled={graph.nodes.length === 0}>
          {tx('exportGraphml', zh)}
        </button>
      </div>
      <div className="dlv-body">
        <div className="dlv-canvas">
          {graph.nodes.length === 0 ? (
            <p className="dlv-empty">{loading ? tx('loading', zh) : tx('empty', zh)}</p>
          ) : (
            <LineageCanvas
              graph={graph}
              selectedId={selectedId}
              highlightUpstream={upstreamSet}
              highlightDownstream={downstreamSet}
              onNodeClick={onSelect}
            />
          )}
        </div>
        <div className="dlv-sidebar">
          <p className="dlv-muted">{tx('hint', zh)}</p>
          <div>
            <p className="dlv-section-title">{tx('selection', zh)}</p>
            {!selected ? (
              <p className="dlv-muted">{tx('none', zh)}</p>
            ) : (
              <>
                <div className="dlv-kv"><span className="k">{selected.kind === 'file' ? tx('files', zh) : tx('runs', zh)}</span><span className="v">{selected.label}</span></div>
                {showVersions && (
                  <div className="dlv-version">
                    {selectedVersion ? (
                      <>
                        <div className="hash">{selectedVersion.shortHash}</div>
                        <div className="msg" title={selectedVersion.message}>{selectedVersion.message}</div>
                      </>
                    ) : (
                      <span className="dlv-muted">
                        {gitAvailable ? tx('versionMissing', zh) : tx('gitModeOff', zh)}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <ImpactList title={tx('upstream', zh)} accent={ACCENT_UPSTREAM} items={upstream} zh={zh} onSelect={onSelect} />
          <ImpactList title={tx('downstream', zh)} accent={ACCENT_DOWNSTREAM} items={downstream} zh={zh} onSelect={onSelect} />
          <div>
            <p className="dlv-section-title">
              {gitAvailable ? tx('gitModeOn', zh) : tx('gitModeOff', zh)}
            </p>
            {gitAvailable && (
              <div className="dlv-kv">
                <span className="k">{tx('versioned', zh)}</span>
                <span className="v">{Object.keys(versions).length}/{files}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
