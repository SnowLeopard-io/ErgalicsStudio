// ==========================================================================
// Ergalics Studio — block workbench (block system)
//
// The three-pane block editor: palette (left), canvas + toolbar (center),
// param editor (right). Mounted by WorkbenchPage when block mode is active.
// The left pane (palette + legend/stats) is toggled by the top-bar ☰ button
// via appStore.modePanelOpen, so ☰ always has an effect in flow mode.
// ==========================================================================

import { BlockPalette } from './BlockPalette';
import { BlockCanvas } from './BlockCanvas';
import { BlockToolbar } from './BlockToolbar';
import { ParamEditor } from './ParamEditor';
import { BlockPreview } from './BlockPreview';
import { FlowLegend } from './FlowLegend';
import { useAppStore } from '@/stores/appStore';

export function BlockWorkbench() {
  const panelOpen = useAppStore((s) => s.modePanelOpen);
  return (
    <div className="block-workbench">
      {panelOpen && (
        <div className="block-workbench-left">
          <BlockPalette />
          <FlowLegend />
        </div>
      )}
      <div className="block-workbench-center">
        <BlockToolbar />
        <div className="block-workbench-canvas">
          <BlockCanvas />
        </div>
        <BlockPreview />
      </div>
      <div className="block-workbench-right">
        <ParamEditor />
      </div>
    </div>
  );
}
