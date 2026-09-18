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
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useAiPanelStore, type AiRunResult } from '@/stores/aiPanelStore';
import { useBlockStore } from '@/stores/blockStore';
import { useEditorStore } from '@/stores/editorStore';
import { parseCodeToIR } from '@/editor/code/parse';
import { irToFlow } from '@/editor/flow/convert';

export function BlockWorkbench() {
  const panelOpen = useAppStore((s) => s.modePanelOpen);

  // FR-07: expose the flow canvas to the global floating AI panel. Drafts are
  // parsed to the canonical IR, pushed back into the IR hub (so Block/Code
  // regenerate too) and hydrated into the DAG — same path useFlowSync uses on
  // entering flow mode.
  const runRef = useRef(async (code: string): Promise<AiRunResult> => {
    const { program } = parseCodeToIR(code, 'python');
    const sid = useEditorStore.getState().activeSessionId;
    if (sid) useEditorStore.getState().updateSessionIR(sid, program);
    useBlockStore.getState().fromJSON(irToFlow(program));
    return { ok: true, insertedOnly: true };
  });
  useEffect(() => {
    return useAiPanelStore.getState().registerRun((code) => runRef.current(code));
  }, []);

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
