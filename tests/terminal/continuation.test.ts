// ==========================================================================
// Regression tests for the terminal's Python block continuation.
//
// The terminal input is a multi-line buffer: a plain Enter continues an
// unfinished block (a line ending with ':' or open brackets) and only
// submits when the statement is complete — otherwise a `def` block could
// never be typed.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { needsContinuation } from '@/components/terminal/TerminalPanel';

describe('needsContinuation', () => {
  it('continues a Python block header', () => {
    expect(needsContinuation('def f():')).toBe(true);
    expect(needsContinuation('for i in range(3):')).toBe(true);
    expect(needsContinuation('if x:')).toBe(true);
  });

  it('submits a complete statement', () => {
    expect(needsContinuation('x = 1')).toBe(false);
    expect(needsContinuation('print("hi")')).toBe(false);
    expect(needsContinuation('def f(): pass')).toBe(false);
  });

  it('continues while brackets are open', () => {
    expect(needsContinuation('values = [1, 2')).toBe(true);
    expect(needsContinuation('values = [1, 2]')).toBe(false);
    expect(needsContinuation('call(a, (b)')).toBe(true);
  });

  it('treats an empty buffer as complete', () => {
    expect(needsContinuation('')).toBe(false);
    expect(needsContinuation('   ')).toBe(false);
  });
});
