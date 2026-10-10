// Mode sync indicator: are the Block graph and the Code/Flow IR in agreement?
//
// editorStore holds the canonical IR; blockStore holds the Flow DAG. Editing
// either side converges through useFlowSync, but between edits the two can
// diverge (e.g. IR regenerated from code while the canvas still shows the old
// graph). This hook surfaces that as a single traffic-light state for the
// top-bar dot. rAF-throttled because toJSON() walks the whole graph.
import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useBlockStore } from '@/stores/blockStore';
import { useEditorStore } from '@/stores/editorStore';
import { irToFlow, flowGraphSignature } from '@/editor/flow/convert';

export type ModeSyncState = 'idle' | 'synced' | 'diverged';

export function useModeSync(): ModeSyncState {
  const mode = useAppStore((s) => s.mode);
  const [state, setState] = useState<ModeSyncState>('idle');

  useEffect(() => {
    if (mode === 'standard') {
      setState('idle');
      return;
    }

    let raf = 0;
    let disposed = false;
    const compute = () => {
      raf = 0;
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
      if (!raf) raf = requestAnimationFrame(compute);
    };

    compute();
    const unBlock = useBlockStore.subscribe(schedule);
    const unEditor = useEditorStore.subscribe(schedule);
    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      unBlock();
      unEditor();
    };
  }, [mode]);

  return state;
}
