// ==========================================================================
// Ergalics Studio — block workbench (block system)
//
// The three-pane block editor: palette (left), canvas + toolbar (center),
// param editor (right). Mounted by WorkbenchPage when block mode is active.
// ==========================================================================

import { BlockPalette } from './BlockPalette';
import { BlockCanvas } from './BlockCanvas';
import { BlockToolbar } from './BlockToolbar';
import { ParamEditor } from './ParamEditor';
import { BlockPreview } from './BlockPreview';

export function BlockWorkbench() {
  return (
    <div className="block-workbench">
      <div className="block-workbench-left">
        <BlockPalette />
      </div>
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
