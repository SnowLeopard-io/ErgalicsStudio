// ==========================================================================
// Regression tests for the terminal session store.
//
// Every session owns its directory: switching sessions must NOT inherit the
// previous session's `cd`, and `cd -` needs the directory the session was in
// before its last cd (the shell's OLDPWD).
// ==========================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import { RUN_SESSION_ID, useTerminalStore } from '@/stores/terminalStore';

const store = () => useTerminalStore.getState();

beforeEach(() => {
  useTerminalStore.setState({
    sessions: [{ id: RUN_SESSION_ID, cwd: '/workspace', prevCwd: '/workspace' }],
    activeId: RUN_SESSION_ID,
    transcripts: {},
    nextIndex: 2,
  });
});

describe('terminal sessions keep their own directory', () => {
  it('a new session starts at the workspace root, not where the other one was', () => {
    store().setCwd(RUN_SESSION_ID, '/workspace/data');
    expect(store().sessions[0]!.cwd).toBe('/workspace/data');

    store().createSession();
    const created = store().sessions[store().sessions.length - 1]!;
    expect(created.cwd).toBe('/workspace');
    expect(created.id).not.toBe(RUN_SESSION_ID);
  });

  it('switching back restores the other session\'s directory', () => {
    store().setCwd(RUN_SESSION_ID, '/workspace/docs');
    store().createSession();
    const second = store().sessions[store().sessions.length - 1]!;
    store().setCwd(second.id, '/workspace/python');
    expect(store().sessions[0]!.cwd).toBe('/workspace/docs');
    expect(store().sessions[1]!.cwd).toBe('/workspace/python');
  });

  it('remembers the previous directory for `cd -`', () => {
    store().setCwd(RUN_SESSION_ID, '/workspace/data');
    store().setCwd(RUN_SESSION_ID, '/workspace/data/raw');
    const session = store().sessions[0]!;
    expect(session.cwd).toBe('/workspace/data/raw');
    expect(session.prevCwd).toBe('/workspace/data');
  });

  it('does not touch the previous directory when it is told not to', () => {
    store().setCwd(RUN_SESSION_ID, '/workspace/data');
    store().setCwd(RUN_SESSION_ID, '/workspace/docs', false);
    const session = store().sessions[0]!;
    expect(session.cwd).toBe('/workspace/docs');
    expect(session.prevCwd).toBe('/workspace');
  });

  it('closing a session activates another one', () => {
    store().createSession();
    const second = store().sessions[store().sessions.length - 1]!;
    expect(store().activeId).toBe(second.id);
    store().closeSession(second.id);
    expect(store().activeId).toBe(RUN_SESSION_ID);
    expect(store().sessions).toHaveLength(1);
  });

  it('never closes the run session', () => {
    store().closeSession(RUN_SESSION_ID);
    expect(store().sessions).toHaveLength(1);
  });

  it('keeps one transcript per session', () => {
    store().createSession();
    const second = store().sessions[store().sessions.length - 1]!;
    store().append(second.id, { stream: 'stdout', text: 'hello', timestamp: 1 });
    expect(store().transcripts[second.id]).toHaveLength(1);
    store().clearSession(second.id);
    expect(store().transcripts[second.id]).toHaveLength(0);
  });
});
