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

  it('setSessionLanguage translates lastCode from the IR hub into the dialect', () => {
    const session = useEditorStore.getState().createSession('code', 'python');
    const ir = makeProgram([
      { kind: 'VarAssign', name: 'df1', value: { kind: 'Random', count: { kind: 'Number', value: 10 } }, declare: true },
    ]);
    useEditorStore.getState().updateSessionIR(session.id, ir);

    useEditorStore.getState().setSessionLanguage(session.id, 'r');
    let updated = useEditorStore.getState().sessions[0]!;
    expect(updated.language).toBe('r');
    // R codegen: <- assignment and studio.* calls.
    expect(updated.lastCode).toContain('<-');
    // R reaches the DSL via the `studio` environment: `studio$random(...)`.
    expect(updated.lastCode).toMatch(/studio\$/);
    // IR itself is language-agnostic and unchanged in shape.
    expect(updated.ir.body).toHaveLength(1);

    useEditorStore.getState().setSessionLanguage(session.id, 'js');
    updated = useEditorStore.getState().sessions[0]!;
    expect(updated.language).toBe('js');
    expect(updated.lastCode).toMatch(/(const|let|var)\s+df1/);
  });

  it('setSessionLanguage is a no-op for the same language or unknown session', () => {
    const session = useEditorStore.getState().createSession('code', 'python');
    const before = useEditorStore.getState().sessions[0]!.updatedAt;
    useEditorStore.getState().setSessionLanguage(session.id, 'python');
    expect(useEditorStore.getState().sessions[0]!.updatedAt).toBe(before);
    useEditorStore.getState().setSessionLanguage('nope', 'r');
    expect(useEditorStore.getState().sessions).toHaveLength(1);
  });

  it('setSessionLanguage never wipes a session and translates imports into the new dialect', () => {
    // An import-only program previously translated to "" (Import emitted
    // nothing), so switching language would clear the buffer. The import must
    // now survive as a real statement of the target dialect.
    const session = useEditorStore.getState().createSession('code', 'python');
    useEditorStore.getState().updateSessionIR(
      session.id,
      makeProgram([{ kind: 'Import', module: 'studio' }]),
      'import studio',
    );
    useEditorStore.getState().setSessionLanguage(session.id, 'r');
    const updated = useEditorStore.getState().sessions[0]!;
    expect(updated.lastCode.trim().length).toBeGreaterThan(0);
    expect(updated.lastCode).toContain('studio');
  });

  it('setSessionLanguage translates a text-only session whose IR was empty', () => {
    // Code samples / wizard-cleaned scripts are created with an EMPTY IR and a
    // raw-text buffer. A switch on an empty IR used to codegen to "" and the
    // anti-wipe guard kept the old text, so the switch looked like nothing
    // happened. The store must re-parse the buffer and translate it for real.
    const session = useEditorStore.getState().createSession('code', 'python');
    const src =
      "import studio\nimport math\nvals = [v * v for v in studio.range(0, 10)]\nstudio.print(vals)\n";
    // Precondition: the empty-IR + text buffer shape used by loadCodeSample.
    useEditorStore.getState().updateSessionIR(session.id, makeProgram([], [], 'python'), src);

    useEditorStore.getState().setSessionLanguage(session.id, 'js');
    const updated = useEditorStore.getState().sessions[0]!;
    expect(updated.language).toBe('js');
    // Must be a real JS translation, not the python source kept verbatim.
    expect(updated.lastCode).toContain("import 'studio'");
    expect(updated.lastCode).toContain('studio.print');
    expect(updated.lastCode.trim().length).toBeGreaterThan(0);
    // The rebuilt IR was persisted, so a further switch still works.
    expect(updated.ir.body.length).toBeGreaterThan(0);
    useEditorStore.getState().setSessionLanguage(session.id, 'r');
    expect(useEditorStore.getState().sessions[0]!.lastCode).toContain('library(studio)');
  });

  it('persisted sessions survive a JSON stringify round-trip (plain JSON)', () => {
    const session = useEditorStore.getState().createSession('block', 'python');
    const ir = makeProgram([{ kind: 'VarAssign', name: 'x', value: { kind: 'Number', value: 5 }, declare: true }]);
    useEditorStore.getState().updateSessionIR(session.id, ir);
    const raw = JSON.stringify(useEditorStore.getState().toJSON());
    const parsed = JSON.parse(raw) as { sessions: EditorSession[] };
    expect(parsed.sessions[0]!.ir.body[0]!.kind).toBe('VarAssign');
  });

  it('applyLanguageWithCode writes an accepted translation verbatim', () => {
    const session = useEditorStore.getState().createSession('code', 'python');
    useEditorStore.getState().updateSessionIR(
      session.id,
      makeProgram([{ kind: 'Random', count: { kind: 'Number', value: 3 } }]),
      'df = studio.load(...)',
    );
    // Accept an edited version; it must be stored exactly, not re-translated.
    useEditorStore.getState().applyLanguageWithCode(session.id, 'r', 'df <- read.csv(\'x.csv\')');
    const s = useEditorStore.getState().sessions[0]!;
    expect(s.language).toBe('r');
    expect(s.lastCode).toBe("df <- read.csv('x.csv')");
    expect(s.forceBlank).toBe(false);
    expect(s.syncState).toBe('code-dirty');
    // IR was re-parsed from the accepted text so downstream sync works.
    expect(s.ir.body.length).toBeGreaterThan(0);
  });

  it('blankSession switches language with a blanked buffer and sets forceBlank', () => {
    const session = useEditorStore.getState().createSession('code', 'python');
    useEditorStore.getState().updateSessionIR(session.id, makeProgram([{ kind: 'Number', value: 1 }]), 'x = 1');
    useEditorStore.getState().blankSession(session.id, 'r');
    const s = useEditorStore.getState().sessions[0]!;
    expect(s.language).toBe('r');
    expect(s.lastCode).toBe('');
    expect(s.ir.body).toHaveLength(0);
    // The one-shot flag lets CodeEditor override the anti-wipe guard.
    expect(s.forceBlank).toBe(true);
  });

  it('restoreSessionSnapshot undoes a discard, and consumeForceBlank clears the flag', () => {
    const session = useEditorStore.getState().createSession('code', 'python');
    const origIR = makeProgram([{ kind: 'VarAssign', name: 'x', value: { kind: 'Number', value: 7 }, declare: true }]);
    useEditorStore.getState().updateSessionIR(session.id, origIR, 'x = 7');
    const snap = { language: 'python' as const, ir: origIR, lastCode: 'x = 7' };
    // Copy the state a discard would have produced, then undo it.
    useEditorStore.getState().blankSession(session.id, 'r');
    useEditorStore.getState().restoreSessionSnapshot(session.id, snap);
    const s = useEditorStore.getState().sessions[0]!;
    expect(s.language).toBe('python');
    expect(s.lastCode).toBe('x = 7');
    expect(s.ir).toBe(origIR);
    expect(s.forceBlank).toBe(false);

    useEditorStore.getState().blankSession(session.id, 'js');
    expect(useEditorStore.getState().sessions[0]!.forceBlank).toBe(true);
    useEditorStore.getState().consumeForceBlank(session.id);
    expect(useEditorStore.getState().sessions[0]!.forceBlank).toBe(false);
  });
});
