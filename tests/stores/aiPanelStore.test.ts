// aiPanelStore — global floating AI-panel state (open/close, run-handler
// registration with safe cleanup on editor unmount).
import { describe, expect, it, beforeEach } from 'vitest';
import { useAiPanelStore } from '@/stores/aiPanelStore';

beforeEach(() => {
  useAiPanelStore.setState({ open: false, runHandler: null });
});

describe('aiPanelStore', () => {
  it('toggles the open flag', () => {
    expect(useAiPanelStore.getState().open).toBe(false);
    useAiPanelStore.getState().toggle();
    expect(useAiPanelStore.getState().open).toBe(true);
    useAiPanelStore.getState().toggle();
    expect(useAiPanelStore.getState().open).toBe(false);
  });

  it('setOpen forces an explicit value', () => {
    useAiPanelStore.getState().setOpen(true);
    expect(useAiPanelStore.getState().open).toBe(true);
    useAiPanelStore.getState().setOpen(false);
    expect(useAiPanelStore.getState().open).toBe(false);
  });

  it('registerRun stores the active editor hook', () => {
    const run = async () => ({ ok: true });
    useAiPanelStore.getState().registerRun(run);
    expect(useAiPanelStore.getState().runHandler).toBe(run);
  });

  it('an older editor cleanup never clears a newer editor hook', () => {
    const runA = async () => ({ ok: true });
    const runB = async () => ({ ok: false });
    const unregA = useAiPanelStore.getState().registerRun(runA);
    const unregB = useAiPanelStore.getState().registerRun(runB);
    // A unmounts first while B holds the slot — B must survive.
    unregA();
    expect(useAiPanelStore.getState().runHandler).toBe(runB);
    // B later unmounts and clears its own slot.
    unregB();
    expect(useAiPanelStore.getState().runHandler).toBeNull();
  });

  it('registerRun cleanup clears a lone handle on unmount', () => {
    const run = async () => ({ ok: true });
    const unreg = useAiPanelStore.getState().registerRun(run);
    unreg();
    expect(useAiPanelStore.getState().runHandler).toBeNull();
  });
});