import { describe, expect, it } from 'vitest';
import {
  BLOSUM62_STR,
  alignGlobal,
  alignLocal,
  baseStats,
  codonGc,
  gcWindow,
  makeMatrix,
  revcomp,
} from '../src/plugins/builtin/bio-seqalign/align';

const blosum = makeMatrix('BLOSUM62');
const nuc = makeMatrix('NUC.4.4');

describe('bio-seqalign kernel', () => {
  it('reads canonical BLOSUM62 values', () => {
    expect(blosum.build('A', 'A')).toBe(4);
    expect(blosum.build('W', 'W')).toBe(11);
    expect(blosum.build('A', 'D')).toBe(-2);
    expect(blosum.build('Y', 'I')).toBe(-1);
    expect(blosum.build('C', 'C')).toBe(9);
    // BLOSUM62_STR table is a coherent 20×20
    expect(BLOSUM62_STR.length).toBe(20);
    expect(BLOSUM62_STR.every((r) => r.length === 20)).toBe(true);
  });

  it('scores nucleotides with NUC.4.4 semantics', () => {
    expect(nuc.build('A', 'A')).toBe(5);
    expect(nuc.build('A', 'C')).toBe(-4);
    expect(nuc.build('A', 'N')).toBe(-1);
  });

  it('computes GC / AT / composition correctly', () => {
    const s = baseStats('GCGC');
    expect(s.gcFraction).toBe(1);
    expect(s.gc).toBe(4);
    const a = baseStats('ATAT');
    expect(a.gcFraction).toBe(0);
    expect(a.at).toBe(4);
    const mix = baseStats('AACCGGTT');
    expect(mix.composition.find((c) => c.base === 'G')!.count).toBe(2);
  });

  it('computes codon-position GC content', () => {
    // "GCT" + "GTA": pos1 G,G; pos2 C,T; pos3 T,A
    const r = codonGc('GCTGTA');
    expect(r.gc1).toBeCloseTo(1, 9);
    expect(r.gc2).toBeCloseTo(0.5, 9);
    expect(r.gc3).toBeCloseTo(0, 9);
  });

  it('computes a sliding-window GC profile', () => {
    const { gc } = gcWindow('AAAAAAAAAACCCCCCCCCC', 10);
    expect(gc[0]).toBeCloseTo(0); // first window all A
    expect(gc[10]).toBeCloseTo(1); // window starting at the C block
  });

  it('reverse-complements DNA', () => {
    expect(revcomp('ATGC')).toBe('GCAT');
    expect(revcomp('AATT')).toBe('AATT'); // palindromic
  });

  it('global alignment of identical sequences has identity 1 and 5·diagA score', () => {
    const r = alignGlobal('AAAAA', 'AAAAA', blosum, { open: -11, extend: -1 });
    expect(r.identity).toBe(1);
    expect(r.score).toBe(5 * 4);
    expect(r.alignedA).toBe('AAAAA');
    expect(r.alignedB).toBe('AAAAA');
  });

  it('global alignment uses gaps to align shifted sequences', () => {
    const r = alignGlobal('ABC', 'ABXC', nuc, { open: -5, extend: -1 });
    // must have consumed all characters; identity reflects the X gap
    expect(r.alignedA.replace(/-/g, '')).toBe('ABC');
    expect(r.alignedB.replace(/-/g, '')).toBe('ABXC');
    expect(r.gaps).toBeGreaterThan(0);
    expect(r.score).toBeGreaterThan(3);
  });

  it('local alignment finds a shared motif even with long flanks', () => {
    const r = alignLocal('TTTTACGTACGGGGG', 'CCCCACGTACGCCC', nuc, { open: -5, extend: -1 });
    // shared mustard "ACGTACG" → present, high identity, no flanking gaps
    expect(r.alignedA).toContain('ACGTACG');
    expect(r.alignedB).toContain('ACGTACG');
    expect(r.identity).toBeGreaterThan(0.9);
    expect(r.score).toBeGreaterThan(20);
  });

  it('dot-oriented sanity: untranslated empty handling does not crash', () => {
    expect(alignGlobal('', 'A', nuc, { open: -5, extend: -1 }).score).toBe(0);
  });
});