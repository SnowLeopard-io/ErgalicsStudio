import { describe, expect, it } from 'vitest';
import {
  mercalliFromPga,
  nodalPlanes,
  travelTimeAtDelta,
  setCustomVelocityModel,
  resetVelocityModel,
} from '../src/plugins/builtin/geo/seismic/kernel';
import { crystalSystemFromCell } from '../src/plugins/builtin/geo/minerals/kernel';
import { sampleSobol } from '../src/plugins/builtin/sim/montecarlo/kernel';

describe('tmp', () => {
  it('seismic', () => {
    const t30 = travelTimeAtDelta(30, 'P');
    const t90 = travelTimeAtDelta(90, 'P');
    console.log('T30', t30, 'T90', t90, 'MMI', mercalliFromPga(0.322));
    console.log('planes', JSON.stringify(nodalPlanes(0, 45, 90)));
    expect(t30).toBeGreaterThan(0);
    setCustomVelocityModel([{ depthKm: 0, vp: 10, vs: 6 }, { depthKm: 6371, vp: 10, vs: 6 }]);
    console.log('custom T30', travelTimeAtDelta(30, 'P'));
    resetVelocityModel();
  });
  it('crystals', () => {
    console.log(
      crystalSystemFromCell({ a: 5, b: 6, c: 5, alpha: 90, beta: 90, gamma: 90 }),
      crystalSystemFromCell({ a: 5, b: 5, c: 5, alpha: 75, beta: 75, gamma: 75 }),
      crystalSystemFromCell({ a: 5, b: 6, c: 7, alpha: 90, beta: 90, gamma: 100 }),
    );
  });
  it('sobol unique', () => {
    const pts = sampleSobol(1024, 8);
    for (let a = 0; a < 8; a += 1) {
      for (let b = a + 1; b < 8; b += 1) {
        let same = true;
        for (let i = 0; i < pts.length; i += 1) if (pts[i]![a] !== pts[i]![b]) same = false;
        if (same) console.log('identical cols', a, b);
        expect(same).toBe(false);
      }
    }
  });
});
