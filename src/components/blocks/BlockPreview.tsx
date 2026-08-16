// ==========================================================================
// Ergalics Studio — block result preview (block system)
//
// Renders the result of the selected (or last) executed node. The block
// executor stays pure; this component bridges the output to the right
// surface depending on its type:
//   - RenderedView → live plugin render (scatter/histogram/...)
//   - DataTable    → read-only table (summary/histogram bins/...)
//   - Scalar       → inline value
// A chip switcher lets the user pick which node's output to inspect.
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/i18n';
import { setHostContainers, usePluginStore, rerenderActivePlugin } from '@/stores/pluginStore';
import { useBlockStore } from '@/stores/blockStore';
import { useAppStore } from '@/stores/appStore';
import { renderView } from '@/blocks/render';
import type { ViewRenderHost } from '@/blocks/render';
import { isDataTable, isRenderedView, isScalar } from '@/types/datatable';
import { blockRegistry } from '@/blocks/registry';
import { blockName } from '@/blocks/l10n';
import { DataTablePreview } from './DataTablePreview';

export function BlockPreview() {
  const t = useT();
  const { locale } = useLocale();
  const domRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeOutputs = useBlockStore((s) => s.nodeOutputs);
  const selectedIds = useBlockStore((s) => s.selectedIds);
  const instances = useBlockStore((s) => s.instances);
  const [pickedNode, setPickedNode] = useState<string | null>(null);
  // Once the user explicitly picks a node via the chip switcher, canvas
  // selection must stop yanking the preview away from their choice.
  const manualPick = useRef(false);

  // Register a render container for the preview area (2D plugins only).
  useEffect(() => {
    if (!domRef.current || !canvasRef.current) return;
    setHostContainers({
      dom: domRef.current,
      canvas2d: canvasRef.current,
      reportDataScale: (n) => useAppStore.getState().setDataScale(n),
      clearCanvas2d: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const g = canvas.getContext('2d');
        if (g) g.clearRect(0, 0, canvas.width, canvas.height);
      },
    });
    // If a plugin is still active (e.g. the preview remounted after a mode
    // toggle), redraw it into the fresh containers — otherwise its cached
    // container points at a detached canvas and re-rendering silently no-ops.
    rerenderActivePlugin();
    return () => setHostContainers(null);
  }, []);

  const outputIds = Object.keys(nodeOutputs);

  // Follow canvas selection when it points at an output node.
  useEffect(() => {
    if (manualPick.current) return;
    const selected = selectedIds.find((id) => id in nodeOutputs);
    if (selected) setPickedNode(selected);
  }, [selectedIds, nodeOutputs]);

  const targetId =
    (pickedNode && nodeOutputs[pickedNode] ? pickedNode : null) ??
    outputIds.find((id) => isRenderedView(nodeOutputs[id])) ??
    outputIds[outputIds.length - 1];
  const target = targetId ? nodeOutputs[targetId] : undefined;
  const isView = target !== undefined && isRenderedView(target);

  // Render RenderedView outputs through the plugin bridge.
  useEffect(() => {
    if (!target || !isRenderedView(target)) return;
    const host: ViewRenderHost = {
      activate: async (pluginId) => {
        const store = usePluginStore.getState();
        if (store.activeId !== pluginId) {
          await store.activate(pluginId);
        }
        // When the plugin is already active, do NOT re-render it here:
        // renderView() immediately loads the new payload, and the preview's
        // mount effect already rebound the containers after a remount.
        // Rerendering with the *old* data first produced a stale frame.
        return store.getActive();
      },
    };
    void renderView(target, host);
  }, [target]);

  function nodeName(id: string): string {
    const inst = instances.find((i) => i.id === id);
    const meta = inst ? blockRegistry.get(inst.blockId) : undefined;
    return meta ? blockName(meta, locale) : id;
  }

  return (
    <div className="block-preview">
      <div className="block-preview-title">
        {t('blocks.preview.title')}{outputIds.length > 0 ? `（${outputIds.length}）` : ''}
      </div>
      {outputIds.length > 1 && (
        <div className="block-preview-chips">
          {outputIds.map((id) => (
            <button
              key={id}
              type="button"
              className={`block-preview-chip${id === targetId ? ' is-active' : ''}`}
              onClick={() => {
                manualPick.current = true;
                setPickedNode(id);
              }}
            >
              {nodeName(id)}
            </button>
          ))}
        </div>
      )}
      <div className="block-preview-host">
        <div
          ref={domRef}
          className="block-preview-dom"
          style={{ display: isView ? undefined : 'none' }}
        />
        <canvas
          ref={canvasRef}
          className="block-preview-canvas"
          style={{ display: isView ? undefined : 'none' }}
        />
        {!isView && target && isDataTable(target) && <DataTablePreview table={target} />}
        {!isView && target && isScalar(target) && (
          <div className="block-preview-scalar">
            <span className="block-preview-scalar-label">{t('blocks.preview.scalar')}</span>
            <span className="block-preview-scalar-value">{String(target.value)}</span>
          </div>
        )}
        {!target && <div className="block-preview-empty">{t('blocks.preview.empty')}</div>}
      </div>
    </div>
  );
}
