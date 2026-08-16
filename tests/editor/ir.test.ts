// IR round-trip tests — type guards, hashing, validation, serialization.
import { describe, it, expect } from 'vitest';
import {
  makeProgram,
  hashIR,
  validateIR,
  serializeIR,
  deserializeIR,
  isRawCode,
} from '@/editor/ir';
import type { IRNode, IRProgram } from '@/editor/ir';

const load: IRNode = { kind: 'LoadCSV', path: 'galaxy.dat' };
const plot: IRNode = {
  kind: 'PlotScatter',
  data: { kind: 'VarRef', name: 'df' },
  x: 'x',
  y: 'y',
};

function program(body: IRNode[] = [load, plot]): IRProgram {
  return makeProgram(body, [], 'python');
}

describe('IR makeProgram / hash', () => {
  it('stamps version 1 and a content hash', () => {
    const p = program();
    expect(p.version).toBe(1);
    expect(p.hash).not.toBe('');
    expect(p.hash).toBe(hashIR(p));
  });

  it('hashIR is deterministic and ignores key order', () => {
    const a = program();
    const b = makeProgram([load, plot], [], 'python');
    expect(hashIR(a)).toBe(hashIR(b));
  });

  it('hashIR changes when the body changes', () => {
    const a = program();
    const b = program([{ kind: 'LoadCSV', path: 'other.csv' }]);
    expect(hashIR(a)).not.toBe(hashIR(b));
  });

  it('hashIR ignores the hash field itself (idempotent)', () => {
    const p = program();
    const h = hashIR(p);
    const stamped = { ...p, hash: h };
    expect(hashIR(stamped)).toBe(h);
  });
});

describe('IR serialize round-trip', () => {
  it('preserves body/functions/sourceLang and back-fills hash', () => {
    const p = program();
    const round = deserializeIR(serializeIR(p));
    expect(round.body).toEqual(p.body);
    expect(round.functions).toEqual([]);
    expect(round.sourceLang).toBe('python');
    expect(round.hash).toBe(hashIR(p));
  });

  it('rejects malformed JSON', () => {
    expect(() => deserializeIR('not json')).toThrow(/invalid IR JSON/);
  });

  it('rejects a program missing body', () => {
    expect(() => deserializeIR(JSON.stringify({ version: 1 }))).toThrow(/missing body/);
  });

  it('rejects an invalid node shape', () => {
    const p = program([{ kind: 'Number', value: 'nope' } as unknown as IRNode]);
    expect(() => deserializeIR(serializeIR(p))).toThrow(/invalid IR program/);
  });

  it('preserves a RawCode node verbatim (degradation guarantee)', () => {
    const raw: IRNode = { kind: 'RawCode', lang: 'python', text: "squares = [x**2 for x in df['x']]" };
    const p = program([load, raw, plot]);
    const round = deserializeIR(serializeIR(p));
    const node = round.body[1];
    expect(isRawCode(node!)).toBe(true);
    if (isRawCode(node!)) expect(node!.text).toBe("squares = [x**2 for x in df['x']]");
  });

  it('rejects a payload whose stored hash does not match its content', () => {
    const p = program();
    const json = JSON.parse(serializeIR(p)) as IRProgram;
    json.hash = 'beefbeef';
    // A tampered body would silently defeat sync dedup; verify it is refused.
    expect(() => deserializeIR(JSON.stringify(json))).toThrow(/hash mismatch/);
  });

  it('back-fills the hash only when absent (accepts a missing hash)', () => {
    const json = JSON.parse(serializeIR(program())) as IRProgram;
    delete json.hash;
    const round = deserializeIR(JSON.stringify(json));
    expect(round.hash).toBe(hashIR(program()));
  });
});

describe('IR validation', () => {
  it('accepts a valid program', () => {
    expect(validateIR(program())).toEqual([]);
  });

  it('flags an unsupported version', () => {
    const p = { ...program(), version: 99 as const } as unknown as IRProgram;
    expect(validateIR(p).some((d) => d.path === '$')).toBe(true);
  });

  it('flags an unknown node kind', () => {
    const p = program([{ kind: 'Whatever' } as unknown as IRNode]);
    expect(validateIR(p).some((d) => d.message.includes('unknown node kind'))).toBe(true);
  });

  it('flags empty If branches', () => {
    const p = program([{ kind: 'If', branches: [] } as unknown as IRNode]);
    expect(validateIR(p).some((d) => d.message.includes('non-empty array'))).toBe(true);
  });

  it('flags an unknown binary operator', () => {
    const p = program([
      { kind: 'BinaryOp', op: '??' as never, left: { kind: 'Number', value: 1 }, right: { kind: 'Number', value: 2 } },
    ]);
    expect(validateIR(p).some((d) => d.message.includes('binary operator'))).toBe(true);
  });

  it('diagnoses a null Dict entry instead of throwing', () => {
    const p = program([{ kind: 'Dict', entries: [null] } as unknown as IRNode]);
    expect(validateIR(p).some((d) => d.message.includes('must be an object'))).toBe(true);
  });

  it('diagnoses a null If branch instead of throwing', () => {
    const p = program([{ kind: 'If', branches: [null], elseBody: [] }] as unknown as IRNode[]);
    expect(validateIR(p).some((d) => d.message.includes('branch must be an object'))).toBe(true);
  });

  it('flags a non-comparison Filter operator', () => {
    const p = program([
      {
        kind: 'Filter',
        data: { kind: 'VarRef', name: 'df' },
        column: 'x',
        op: '+' as never,
        value: { kind: 'Number', value: 0 },
      },
    ]);
    expect(validateIR(p).some((d) => d.message.includes('filter operator'))).toBe(true);
  });

  it('flags a non-FuncDef in the functions list', () => {
    const p = makeProgram([], [load], 'python');
    expect(validateIR(p).some((d) => d.message.includes('only contain FuncDef'))).toBe(true);
  });

  it('detects hash mismatch when checkHash is on', () => {
    const p = { ...program(), hash: 'deadbeef' };
    expect(validateIR(p, { checkHash: true }).some((d) => d.message.includes('hash mismatch'))).toBe(true);
  });
});
