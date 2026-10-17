import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CircuitError,
  parseNetlist,
  solveMna,
} from '../src/plugins/builtin/eng-circuit/kernel';

/** Unified relative-error yardstick: |computed − analytic| / |analytic|. */
function relErr(computed: number, analytic: number): number {
  return Math.abs(computed - analytic) / Math.abs(analytic);
}

function voltageOf(result: ReturnType<typeof solveMna>, node: string): number {
  const hit = result.nodeVoltages.find((nv) => nv.node === node);
  if (!hit) throw new Error(`node ${node} missing`);
  return hit.voltage;
}

describe('eng-circuit MNA kernel', () => {
  it('voltage divider matches V·R2/(R1+R2) (rel. err < 1e-10)', () => {
    // 12 V source, R1 = 1 kΩ from vcc to out, R2 = 1 kΩ from out to gnd.
    const netlist = parseNetlist(
      JSON.stringify({
        nodes: ['gnd', 'vcc', 'out'],
        elements: [
          { type: 'V', from: 'vcc', to: 'gnd', value: 12 },
          { type: 'R', from: 'vcc', to: 'out', value: 1000 },
          { type: 'R', from: 'out', to: 'gnd', value: 1000 },
        ],
      }),
    );
    const r = solveMna(netlist);
    const analytic = (12 * 1000) / (1000 + 1000);
    expect(relErr(voltageOf(r, 'vcc'), 12)).toBeLessThan(1e-10);
    expect(relErr(voltageOf(r, 'out'), analytic)).toBeLessThan(1e-10);
    // Dissipation: two 6 mA branches over 1 kΩ each → 36 mW + 36 mW.
    expect(relErr(r.totalDissipatedPower, 0.072)).toBeLessThan(1e-10);
    expect(Math.abs(r.powerBalance)).toBeLessThan(1e-12);
  });

  it('two-stage T ladder (12 V, R1=1k, R2=R3=2k) matches hand solution (rel. err < 1e-9)', () => {
    // Open output: no current through R3 → v_mid = v_out = 12·R2/(R1+R2) = 8 V.
    const netlist = parseNetlist(
      JSON.stringify({
        nodes: ['gnd', 'vcc', 'mid', 'out'],
        elements: [
          { type: 'V', from: 'vcc', to: 'gnd', value: 12 },
          { type: 'R', from: 'vcc', to: 'mid', value: 1000 },
          { type: 'R', from: 'mid', to: 'gnd', value: 2000 },
          { type: 'R', from: 'mid', to: 'out', value: 2000 },
        ],
      }),
    );
    const r = solveMna(netlist);
    expect(relErr(voltageOf(r, 'mid'), 8)).toBeLessThan(1e-9);
    expect(relErr(voltageOf(r, 'out'), 8)).toBeLessThan(1e-9);
    // V-source branch current: 4 mA drawn from the divider (negative = delivering).
    const iVs = r.sourceCurrents[0]!.current;
    expect(relErr(Math.abs(iVs), 0.004)).toBeLessThan(1e-9);
    expect(iVs).toBeLessThan(0);
  });

  it('bundled sample netlist (eng-ladder-netlist.json) solves to the analytic 8 V / 8 V node pair', () => {
    const text = readFileSync(
      new URL('../examples/data/eng-ladder-netlist.json', import.meta.url),
      'utf8',
    );
    const r = solveMna(parseNetlist(text));
    expect(relErr(voltageOf(r, 'mid'), 8)).toBeLessThan(1e-9);
    expect(relErr(voltageOf(r, 'out'), 8)).toBeLessThan(1e-9);
  });

  it('mixed V/I source circuit matches the hand-derived KCL solution incl. power bookkeeping', () => {
    // Circuit: 10 V source (gnd→n1), R1 = 2 Ω (n1→n2), 3 A source (n2→gnd),
    // 2 V source (n2→n3), R2 = 1 Ω (n3→gnd).
    // Hand KCL: v2 = 8/3 V, v3 = 2/3 V; i(2V source) = 2/3 A.
    // Dissipation: (22/3)²/2 + (2/3)²/1 = 242/9 + 4/9 = 246/9 W.
    const netlist = parseNetlist(
      JSON.stringify({
        nodes: ['gnd', 'n1', 'n2', 'n3'],
        elements: [
          { type: 'V', from: 'n1', to: 'gnd', value: 10, name: 'V1' },
          { type: 'R', from: 'n1', to: 'n2', value: 2, name: 'R1' },
          { type: 'I', from: 'n2', to: 'gnd', value: 3, name: 'I1' },
          { type: 'V', from: 'n2', to: 'n3', value: 2, name: 'V2' },
          { type: 'R', from: 'n3', to: 'gnd', value: 1, name: 'R2' },
        ],
      }),
    );
    const r = solveMna(netlist);
    expect(relErr(voltageOf(r, 'n1'), 10)).toBeLessThan(1e-9);
    expect(relErr(voltageOf(r, 'n2'), 8 / 3)).toBeLessThan(1e-9);
    expect(relErr(voltageOf(r, 'n3'), 2 / 3)).toBeLessThan(1e-9);
    expect(relErr(r.totalDissipatedPower, 246 / 9)).toBeLessThan(1e-9);
    // Tellegen: generated (10 V source) − absorbed (3 A source, 2 V source) − dissipated = 0.
    expect(Math.abs(r.powerBalance)).toBeLessThan(1e-9);
    // The 3 A source draws current out of n2; the 2 V source carries i = 2/3 A
    // from n2 to n3 through itself.
    const iV2 = r.sourceCurrents.find((s) => s.name === 'V2')!.current;
    expect(relErr(iV2, 2 / 3)).toBeLessThan(1e-9);
  });

  it('rejects a netlist with no ground reference', () => {
    const netlist = parseNetlist(
      JSON.stringify({
        nodes: ['a', 'b'],
        elements: [
          { type: 'V', from: 'a', to: 'b', value: 5 },
          { type: 'R', from: 'a', to: 'b', value: 10 },
        ],
      }),
    );
    expect(() => solveMna(netlist)).toThrow(CircuitError);
    expect(() => solveMna(netlist)).toThrow(/ground/i);
  });

  it('rejects a floating voltage-source subcircuit (singular MNA matrix)', () => {
    // V2 between n2/n3 with no DC path to the reference — the n2/n3 KCL rows
    // become linearly dependent, so partial pivoting must hit a zero pivot.
    const netlist = parseNetlist(
      JSON.stringify({
        nodes: ['gnd', 'n1', 'n2', 'n3'],
        elements: [
          { type: 'V', from: 'n1', to: 'gnd', value: 12, name: 'V1' },
          { type: 'V', from: 'n2', to: 'n3', value: 5, name: 'V2' },
        ],
      }),
    );
    expect(() => solveMna(netlist)).toThrow(CircuitError);
    expect(() => solveMna(netlist)).toThrow(/singular/i);
  });

  it('netlist parser rejects bad references, duplicates and non-positive resistances', () => {
    const base = { nodes: ['gnd', 'a'], elements: [] as unknown[] };
    expect(() =>
      parseNetlist(JSON.stringify({ ...base, elements: [{ type: 'R', from: 'a', to: 'zz', value: 1 }] })),
    ).toThrow(/unknown node/);
    expect(() =>
      parseNetlist(JSON.stringify({ nodes: ['gnd', 'a', 'a'], elements: [{ type: 'R', from: 'a', to: 'gnd', value: 1 }] })),
    ).toThrow(/duplicate/);
    expect(() =>
      parseNetlist(JSON.stringify({ ...base, elements: [{ type: 'R', from: 'a', to: 'gnd', value: 0 }] })),
    ).toThrow(/> 0/);
    expect(() => parseNetlist('not json at all')).toThrow(/JSON/);
  });

  it('solve is deterministic for repeated runs on the same netlist', () => {
    const netlist = parseNetlist(
      JSON.stringify({
        nodes: ['gnd', 'a', 'b'],
        elements: [
          { type: 'V', from: 'a', to: 'gnd', value: 5 },
          { type: 'R', from: 'a', to: 'b', value: 100 },
          { type: 'I', from: 'b', to: 'gnd', value: 0.01 },
        ],
      }),
    );
    const r1 = solveMna(netlist);
    const r2 = solveMna(netlist);
    expect(r1).toEqual(r2);
    // Hand check: (5 − vb)/100 = 0.01 → vb = 4 V.
    expect(relErr(voltageOf(r1, 'b'), 4)).toBeLessThan(1e-10);
  });
});
