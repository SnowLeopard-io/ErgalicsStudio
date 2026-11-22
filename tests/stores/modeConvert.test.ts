// Regression: flow → code on an unbound session must publish the generated
// program to the session. Previously only language targets wrote text, so
// confirming the conversion switched the surface and left the editor empty.

import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';
import { useModeConvert } from '@/stores/useModeConvert';
import { makeProgram } from '@/editor/ir';
import { createEditorSession } from '@/types/editor';

const program = makeProgram([
  { kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'hi' }] },
]);

describe('mode conversion without a bound file', () => {
  beforeEach(() => {
    const sess = createEditorSession('code', 'python', program);
    useEditorStore.setState({
      sessions: [sess],
      activeSessionId: sess.id,
      flowGraphs: {},
      pendingFlowGraph: null,
    });
    useAppStore.setState({ mode: 'flow' });
    useModeConvert.setState({ pending: null });
  });

  it('writes the generated program when converting flow → code', () => {
    useModeConvert.getState().requestTarget({ kind: 'mode', mode: 'code' });
    expect(useModeConvert.getState().pending?.code).toContain('hi');

    useModeConvert.getState().confirm();

    expect(useAppStore.getState().mode).toBe('code');
    const sess = useEditorStore.getState().sessions[0]!;
    expect(sess.lastCode.trim()).not.toBe('');
    expect(sess.lastCode).toContain('hi');
    expect(sess.ir.body.length).toBe(1);
  });

  it('still translates when only the language changes', () => {
    useModeConvert.getState().requestTarget({ kind: 'language', language: 'js' });

    useModeConvert.getState().confirm();

    const sess = useEditorStore.getState().sessions[0]!;
    expect(sess.language).toBe('js');
    expect(sess.lastCode).toContain('hi');
  });
});
