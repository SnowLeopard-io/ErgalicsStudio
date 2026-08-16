// Editor store tests — session lifecycle + JSON round-trip + dirty event.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore, EDITOR_STATE_CHANGED } from '@/stores/editorStore';
import { on } from '@/core/events';
import { makeProgram } from '@/editor/ir';
import type { EditorSession } from '@/types/editor';

function reset() {
  useEditorStore.setState({
    sessions: [],
    activeSessionId: null,
    variables: {},
    console: [],
    isRunning: false,
    error: null,
    pendingLoad: null,
  });
}

describe('editorStore', () => {
  beforeEach(() => reset());

  it('createSession adds a session and activates it', () => {
    const session = useEditorStore.getState().createSession('block', 'python');
    const { sessions, activeSessionId } = useEditorStore.getState();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(session.id);
    expect(activeSessionId).toBe(session.id);
    expect(session.ir.version).toBe(1);
  });

  it('updateSessionIR updates ir/lastCode and emits a change event', () => {
    const spy = vi.fn();
    const sub = on(EDITOR_STATE_CHANGED, spy);
    const session = useEditorStore.getState().createSession('code', 'python');
    const ir = makeProgram([{ kind: 'LoadCSV', path: 'a.csv' }]);
    useEditorStore.getState().updateSessionIR(session.id, ir, 'df = studio.load(...)');
    const updated = useEditorStore.getState().sessions[0]!;
    expect(updated.ir).toBe(ir);
    expect(updated.lastCode).toBe('df = studio.load(...)');
    expect(spy).toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('removeSession falls back to the next session when active is removed', () => {
    const a = useEditorStore.getState().createSession('block', 'python');
    const b = useEditorStore.getState().createSession('code', 'python');
    useEditorStore.getState().removeSession(a.id);
    const { sessions, activeSessionId } = useEditorStore.getState();
    expect(sessions.map((s) => s.id)).toEqual([b.id]);
    expect(activeSessionId).toBe(b.id);
  });

  it('toJSON/fromJSON round-trips sessions and active id', () => {
    const session = useEditorStore.getState().createSession('code', 'python');
    useEditorStore.getState().updateSessionIR(session.id, makeProgram([{ kind: 'Number', value: 1 }]));
    const snapshot = useEditorStore.getState().toJSON();

    reset();
    useEditorStore.getState().fromJSON(snapshot);
    const restored = useEditorStore.getState();
    expect(restored.sessions).toHaveLength(1);
    expect(restored.activeSessionId).toBe(session.id);
    expect((restored.sessions[0]!.ir.body[0] as { kind: string }).kind).toBe('Number');
  });

  it('appendConsole stamps timestamps and streams', () => {
    useEditorStore.getState().appendConsole({ stream: 'stdout', text: 'hi' });
    const entry = useEditorStore.getState().console[0]!;
    expect(entry.stream).toBe('stdout');
    expect(entry.text).toBe('hi');
    expect(typeof entry.timestamp).toBe('number');
  });

  it('setVariables replaces the snapshot', () => {
    const fake = { x: { kind: 'scalar' as const, value: 1 } };
    useEditorStore.getState().setVariables(fake);
    expect(useEditorStore.getState().variables).toBe(fake);
  });

  it('fromJSON resets transient run state', () => {
    useEditorStore.getState().setVariables({ x: { kind: 'scalar', value: 1 } });
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().setError('boom');
    useEditorStore.getState().fromJSON({ sessions: [], activeSessionId: null });
    const s = useEditorStore.getState();
    expect(s.variables).toEqual({});
    expect(s.isRunning).toBe(false);
    expect(s.error).toBeNull();
  });

  it('resetRunOutputs clears variables/console/error and stops the run', () => {
    useEditorStore.getState().setVariables({ x: { kind: 'scalar', value: 1 } });
    useEditorStore.getState().appendConsole({ stream: 'stdout', text: 'previous run' });
    useEditorStore.getState().setError('boom');
    useEditorStore.getState().setRunning(true);
    useEditorStore.getState().resetRunOutputs();
    const s = useEditorStore.getState();
    expect(s.variables).toEqual({});
    expect(s.console).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.isRunning).toBe(false);
  });

  it('requestLoad / consumeLoad round-trip a pending program', () => {
    expect(useEditorStore.getState().pendingLoad).toBeNull();
    const program = makeProgram([{ kind: 'Number', value: 1 }]);
    useEditorStore.getState().requestLoad(program);
    expect(useEditorStore.getState().pendingLoad).toBe(program);
    useEditorStore.getState().consumeLoad();
    expect(useEditorStore.getState().pendingLoad).toBeNull();
  });

  it('persisted sessions survive a JSON stringify round-trip (plain JSON)', () => {
    const session = useEditorStore.getState().createSession('block', 'python');
    const ir = makeProgram([{ kind: 'VarAssign', name: 'x', value: { kind: 'Number', value: 5 }, declare: true }]);
    useEditorStore.getState().updateSessionIR(session.id, ir);
    const raw = JSON.stringify(useEditorStore.getState().toJSON());
    const parsed = JSON.parse(raw) as { sessions: EditorSession[] };
    expect(parsed.sessions[0]!.ir.body[0]!.kind).toBe('VarAssign');
  });
});
