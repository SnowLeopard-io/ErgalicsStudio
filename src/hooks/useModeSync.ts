// Mode sync indicator: are the Block graph and the Code/Flow IR in agreement?
//
// editorStore holds the canonical IR; blockStore holds the Flow DAG. Editing
// either side converges through useFlowSync, but between edits the two can
// diverge (e.g. IR regenerated from code while the canvas still shows the old
// graph). This hook surfaces that as a single traffic-light state for the
// top-bar dot. Computing it means cloning the whole graph (`toJSON()`) and
// converting the IR to a flow, so it is debounced: an rAF used to run it once
// per animation frame while typing/dragging, competing with the editor for
// the main thread. A short idle delay is plenty for a status light.
import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useBlockStore } from '@/stores/blockStore';
import { useEditorStore } from '@/stores/editorStore';
import { irToFlow, flowGraphSignature } from '@/editor/flow/convert';

export type ModeSyncState = 'idle' | 'synced' | 'diverged';

const SYNC_RECOMPUTE_DELAY_MS = 250;

export function useModeSync(): ModeSyncState {
  const mode = useAppStore((s) => s.mode);
  const [state, setState] = useState<ModeSyncState>('idle');

  useEffect(() => {
    if (mode === 'standard') {
      setState('idle');
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const compute = () => {
      timer = null;
      if (disposed) return;
      const sid = useEditorStore.getState().activeSessionId;
      if (!sid) {
        setState('idle');
        return;
      }
      const session = useEditorStore.getState().sessions.find((s) => s.id === sid);
      if (!session) {
        setState('idle');
        return;
      }
      try {
        const graph = useBlockStore.getState().toJSON();
        const flow = irToFlow(session.ir);
        setState(flowGraphSignature(graph) === flowGraphSignature(flow) ? 'synced' : 'diverged');
      } catch {
        // Signature conversion may fail on a half-built graph — show no dot.
        setState('idle');
      }
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(compute, SYNC_RECOMPUTE_DELAY_MS);
    };

    compute();
    const unBlock = useBlockStore.subscribe(schedule);
    const unEditor = useEditorStore.subscribe(schedule);
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      unBlock();
      unEditor();
    };
  }, [mode]);

  return state;
}
