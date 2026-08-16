// ==========================================================================
// Ergalics Studio — block palette (block system)
//
// Grouped list of registered blocks. Clicking a block drops it onto the
// canvas near the current viewport center.
// ==========================================================================

import { useLocale, useT } from '@/i18n';
import { useBlockStore } from '@/stores/blockStore';
import { BLOCK_CATEGORIES, blockRegistry } from '@/blocks/registry';
import { blockDescription, blockName } from '@/blocks/l10n';
import { screenToWorld } from './geometry';
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
  logic: 'blocks.category.logic',
  utility: 'blocks.category.utility',
};

export function BlockPalette() {
  const t = useT();
  const { locale } = useLocale();
  const addInstance = useBlockStore((s) => s.addInstance);
  const viewport = useBlockStore((s) => s.viewport);
  const canvasSize = useBlockStore((s) => s.canvasSize);

  const drop = (blockId: string) => {
    // Drop at the centre of the visible canvas (in world coordinates), so
    // zoom/pan no longer sends new blocks to a screen corner.
    const center = screenToWorld(
      { x: canvasSize.width / 2, y: canvasSize.height / 2 },
      viewport,
    );
    addInstance(blockId, { x: center.x + 40, y: center.y + 30 });
  };

  return (
    <div className="block-palette">
      {BLOCK_CATEGORIES.map((cat) => {
        const blocks = blockRegistry.listByCategory(cat);
        if (blocks.length === 0) return null;
        return (
          <div key={cat} className="block-palette-category">
            <div className="block-palette-cat-title">{t(CATEGORY_LABEL_KEYS[cat])}</div>
            {blocks.map((meta) => (
              <button
                key={meta.id}
                type="button"
                className="block-palette-item"
                onClick={() => drop(meta.id)}
                title={blockDescription(meta, locale)}
              >
                <span className="block-palette-dot" style={{ background: meta.color }} />
                <span className="block-palette-name">{blockName(meta, locale)}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
