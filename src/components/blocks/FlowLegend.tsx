// ==========================================================================
// Ergalics Studio — flow-mode legend + node statistics
//
// Bottom strip of the flow side panel toggled by the top-bar ☰ button:
// category colour legend plus live node/connection counts.
// ==========================================================================

import { useT } from '@/i18n';
import { useBlockStore } from '@/stores/blockStore';
import { BLOCK_CATEGORIES, blockRegistry } from '@/blocks/registry';
import type { BlockCategory } from '@/types/block';

const CATEGORY_LABEL_KEYS: Record<BlockCategory, string> = {
  data_source: 'blocks.category.data_source',
  transform: 'blocks.category.transform',
  filter: 'blocks.category.filter',
  math: 'blocks.category.math',
  statistics: 'blocks.category.statistics',
  signal: 'blocks.category.signal',
  visualize: 'blocks.category.visualize',
  output: 'blocks.category.output',
  utility: 'blocks.category.utility',
};

export function FlowLegend() {
  const t = useT();
  const nodeCount = useBlockStore((s) => s.instances.length);
  const connectionCount = useBlockStore((s) => s.connections.length);

  const legend = BLOCK_CATEGORIES.map((cat) => {
    const first = blockRegistry.listByCategory(cat)[0];
    return first ? { cat, color: first.color } : null;
  }).filter((x): x is { cat: BlockCategory; color: string } => x !== null);

  return (
    <div className="flow-legend">
      <div className="flow-legend-stats">
        <span className="flow-legend-stat">
          <span className="flow-legend-stat-num">{nodeCount}</span>
          {t('flow.legend.nodes')}
        </span>
        <span className="flow-legend-stat">
          <span className="flow-legend-stat-num">{connectionCount}</span>
          {t('flow.legend.connections')}
        </span>
      </div>
      <div className="flow-legend-title">{t('flow.legend.title')}</div>
      <ul className="flow-legend-list">
        {legend.map(({ cat, color }) => (
          <li key={cat} className="flow-legend-item">
            <span className="flow-legend-dot" style={{ background: color }} />
            {t(CATEGORY_LABEL_KEYS[cat])}
          </li>
        ))}
      </ul>
    </div>
  );
}
