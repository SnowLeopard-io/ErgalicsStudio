// ==========================================================================
// Ergalics Studio — block palette (block system)
//
// Grouped list of registered blocks. Clicking a block drops it onto the
// canvas near the current viewport center.
// ==========================================================================

import { memo } from 'react';
import { useLocale, useT } from '@/i18n';
import { useGraphStore } from './graphStore';
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
  utility: 'blocks.category.utility',
};

function BlockPaletteImpl() {
  const t = useT();
  const { locale } = useLocale();
  const store = useGraphStore();
  // Subscribe to nothing else: the palette used to select `viewport` and
  // `canvasSize`, so every pan/zoom frame re-rendered the entire block list
  // (hundreds of buttons) even though those values are only read on click.
  const addInstance = store((s) => s.addInstance);

  const drop = (blockId: string) => {
    // Read the live viewport/canvas size at drop time (same values as before,
    // without a render per pointermove).
    const { canvasSize, viewport } = store.getState();
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

/** The registry list never changes at runtime and this component no longer
 *  subscribes to the viewport, so keep parent re-renders (e.g. a 300 ms buffer
 *  push while editing a flow file) from rebuilding the whole list. */
export const BlockPalette = memo(BlockPaletteImpl);
