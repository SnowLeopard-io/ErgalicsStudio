// ==========================================================================
// git ref-name validation (issue #24) — argument-injection guard.
//
// NodeGitAdapter inserts ref names into the raw git argv array; a name
// starting with '-' would be parsed as an option. The adapter must reject
// those BEFORE touching simple-git (which is not even installed in the test
// environment — if the guard were missing these calls would crash on
// `require('simple-git')`, which is exactly what the last assertion pins).
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { isValidGitRef, assertValidGitRef } from '@/core/git/refname';
import { NodeGitAdapter } from '@/core/git/node-adapter';

describe('isValidGitRef (git-check-ref-format subset)', () => {
  it.each(['main', 'feature/x-1', 'v1.0.2', 'release_2', 'user@host', 'fix/a.b', 'ünïcode-分支'])(
    'accepts %s',
    (name) => {
      expect(isValidGitRef(name)).toBe(true);
    },
  );

  it.each([
    ['-c core.pager=cat', 'option injection'],
    ['--upload-pack=evil', 'long option injection'],
    ['', 'empty'],
    ['a..b', 'double dot'],
    ['a b', 'space'],
    ['a~b', 'tilde'],
    ['a^b', 'caret'],
    ['a:b', 'colon'],
    ['a?b', 'question mark'],
    ['a*b', 'glob'],
    ['a[b', 'bracket'],
    ['a\\b', 'backslash'],
    ['/leading', 'leading slash'],
    ['trailing/', 'trailing slash'],
    ['a//b', 'double slash'],
    ['a/.b', 'dot component after slash'],
    ['a.lock', 'lock suffix'],
    ['a.', 'trailing dot'],
    ['.hidden', 'leading dot'],
    ['a@{u}', 'at-brace'],
    ['@', 'bare at'],
    ['a\x01b', 'control character'],
  ])('rejects %s (%s)', (name) => {
    expect(isValidGitRef(name)).toBe(false);
  });

  it('assertValidGitRef throws with a readable message', () => {
    expect(() => assertValidGitRef('-c x', 'branch')).toThrow(/invalid branch name/);
    expect(() => assertValidGitRef('main')).not.toThrow();
  });
});

describe('NodeGitAdapter — refs are validated before any git call', () => {
  const adapter = new NodeGitAdapter();

  it.each([
    ['checkout', (a: NodeGitAdapter) => a.checkout('/repo', '-c core.pager=cat')],
    ['branch', (a: NodeGitAdapter) => a.branch('/repo', '--upload-pack=evil')],
    ['deleteBranch', (a: NodeGitAdapter) => a.deleteBranch('/repo', '-x')],
    ['merge', (a: NodeGitAdapter) => a.merge('/repo', '-c core.pager=cat')],
    ['push', (a: NodeGitAdapter) => a.push('/repo', { remote: 'origin', branch: '-x' })],
    ['pull', (a: NodeGitAdapter) => a.pull('/repo', { remote: '-x', branch: 'main' })],
  ])('%s rejects option-shaped refs without spawning git', async (_name, op) => {
    await expect(op(adapter)).rejects.toThrow(/invalid/);
  });

  it('accepts ordinary ref names (fails only when git itself would be invoked)', async () => {
    // simple-git is not installed in the test environment: the guard passes
    // and the failure happens at `require('simple-git')`, not at validation.
    await expect(adapter.checkout('/repo', 'main')).rejects.not.toThrow(/invalid/);
  });
});
