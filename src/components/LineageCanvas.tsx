import { useMemo } from 'react';
import { useT } from '@/i18n';
import { layoutDag } from '@/core/lineage/graph';
import type { LineageGraph } from '@/core/lineage/graph';

const NODE_W = 152;
const NODE_H = 36;

const MAX_LABEL = 20;

function clip(label: string): string {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

interface LineageCanvasProps {
  graph: LineageGraph;
}

/**
 * React SVG rendering of the lineage DAG (structure ≠ statistical plot, so
 * the plot engine is intentionally not used). Layout comes from the core
 * `layoutDag`; colors/typography ride on global.css design tokens.
 */
export function LineageCanvas({ graph }: LineageCanvasProps) {
  const t = useT();
  const layout = useMemo(() => layoutDag(graph, { nodeWidth: NODE_W, nodeHeight: NODE_H }), [graph]);

  if (graph.nodes.length === 0) return null;

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <svg
      className="lineage-svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={t('lineage.graph_label')}
    >
      {/* edges under nodes */}
      {graph.edges.map((e) => {
        const a = layout.positions[e.from];
        const b = layout.positions[e.to];
        if (!a || !b) return null;
        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        return (
          <path
            key={`${e.from}->${e.to}`}
            className="lineage-edge"
            d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
          />
        );
      })}

      {graph.nodes.map((n) => {
        const p = layout.positions[n.id];
        if (!p) return null;
        const cls =
          n.kind === 'file'
            ? 'lineage-node lineage-node-file'
            : `lineage-node lineage-node-run${n.failed ? ' lineage-node-failed' : ''}`;
        return (
          <g key={n.id} className={cls} transform={`translate(${p.x}, ${p.y})`}>
            <rect width={NODE_W} height={NODE_H} rx={6} ry={6} />
            <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle">
              {clip(byId.get(n.id)?.label ?? n.id)}
            </text>
            <title>{n.label}</title>
          </g>
        );
      })}
    </svg>
  );
}
