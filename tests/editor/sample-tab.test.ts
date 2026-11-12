// ==========================================================================
// Regression tests: a sample must never take over the open file.
//
// The sample dialog used to load its program into whatever session happened
// to be active — the one bound to the file the user was editing. The sample
// therefore replaced the file's content in the canvas, and the sample's text
// could be mirrored back into that workspace file. A sample now gets its own
// session (no `filePath`) and its own tab.
// ==========================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';
import { editorStoreOpenInMode, syncSurfaceTabSession } from '@/components/editor/fileEditors/openInMode';

/** A surface tab (the tab strip mixes several kinds). */
type SurfaceTab = Extract<
  ReturnType<typeof useAppStore.getState>['canvasTabs'][number],
  { kind: 'surface' }
>;

/** The surface tab with the given key (the tab strip mixes several kinds). */
function surface(key: string): SurfaceTab | undefined {
  const tab = useAppStore.getState().canvasTabs.find((t) => t.key === key);
  return tab?.kind === 'surface' ? tab : undefined;
}

describe('sample tabs', () => {
  beforeEach(() => {
    useAppStore.setState({ canvasTabs: [], activeTab: null, mode: 'standard' });
    useEditorStore.setState({ sessions: [], activeSessionId: null });
  });

  it('openSampleTab creates a tab bound to the sample session, not to a file', () => {
    const sid = useEditorStore.getState().createSession('code', 'python').id;
    useAppStore.getState().openSampleTab({ mode: 'code', sessionId: sid, label: 'Sample A' });

    const tab = surface(`sample:code:${sid}`);
    expect(tab).toBeDefined();
    expect(tab?.sessionId).toBe(sid);
    // A sample surface is NOT bound to a workspace file.
    expect(tab?.path).toBeUndefined();
    expect(useAppStore.getState().activeTab).toBe(tab?.key);
  });

  it('a sample tab does not hijack an open file surface', () => {
    // The user opens code/foo.py → a file-bound surface + session.
    editorStoreOpenInMode({ mode: 'code', language: 'python', code: 'print(1)', path: 'code/foo.py' });
    const fileKey = useAppStore.getState().canvasTabs.find((t) => t.kind === 'surface')?.key ?? '';
    expect(surface(fileKey)?.path).toBe('code/foo.py');

    // Loading a sample opens its own tab; the file's tab is untouched.
    const sid = useEditorStore.getState().createSession('code', 'python').id;
    useAppStore.getState().openSampleTab({ mode: 'code', sessionId: sid, label: 'Sample A' });

    const stillThere = surface(fileKey);
    expect(stillThere?.path).toBe('code/foo.py');
    expect(stillThere?.sessionId).toBeUndefined();
    // Two surfaces now: the file's and the sample's.
    expect(useAppStore.getState().canvasTabs.filter((t) => t.kind === 'surface')).toHaveLength(2);
  });

  it('re-activating a sample tab restores the sample session, the file tab restores the file', () => {
    editorStoreOpenInMode({ mode: 'code', language: 'python', code: 'print(1)', path: 'code/foo.py' });
    const fileSession = useEditorStore.getState().sessions.find((s) => s.filePath === 'code/foo.py');

    const sid = useEditorStore.getState().createSession('code', 'python').id;
    useAppStore.getState().openSampleTab({ mode: 'code', sessionId: sid, label: 'Sample A' });
    const sampleTab = surface(`sample:code:${sid}`)!;

    // Clicking the sample tab activates the sample's session.
    syncSurfaceTabSession(sampleTab);
    expect(useEditorStore.getState().activeSessionId).toBe(sid);

    // Clicking the file tab activates the file's session again — the sample
    // never stole it.
    const fileTab = useAppStore
      .getState()
      .canvasTabs.find((t) => t.kind === 'surface' && t.path === 'code/foo.py')!;
    syncSurfaceTabSession(fileTab);
    expect(useEditorStore.getState().activeSessionId).toBe(fileSession?.id);
  });

  it('a sample session has no filePath, so its buffer is never mirrored into a file', () => {
    const sid = useEditorStore.getState().createSession('code', 'python').id;
    const sample = useEditorStore.getState().sessions.find((s) => s.id === sid);
    expect(sample?.filePath).toBeUndefined();
  });

  it('closing a sample tab drops its session', async () => {
    const sid = useEditorStore.getState().createSession('code', 'python').id;
    useAppStore.getState().openSampleTab({ mode: 'code', sessionId: sid, label: 'Sample A' });
    const key = `sample:code:${sid}`;
    useAppStore.getState().closeTab(key);
    // The session removal is a lazy import (breaks a store cycle) — flush it.
    await Promise.resolve();
    await Promise.resolve();
    expect(useAppStore.getState().canvasTabs.find((t) => t.key === key)).toBeUndefined();
  });
});
