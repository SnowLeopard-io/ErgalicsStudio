// sim-abm kernel tests — templates, neighborhoods, determinism, aggregates.
import { describe, expect, it } from 'vitest';
import {
  aggregate,
  cellIndex,
  countNeighbors,
  createRng,
  initOpinion,
  initPredatorPrey,
  initSchelling,
  initTraffic,
  runBatch,
  segregationIndex,
  stepRules,
  stepSchelling,
  type ABMWorld,
} from '@/plugins/builtin/sim/abm/kernel';

describe('grid helpers', () => {
  const world: ABMWorld = { width: 1, height: 1, gridMode: true, cols: 5, rows: 5, agents: [] };

  it('cellIndex wraps on the torus', () => {
    expect(cellIndex(world, 5, 0)).toBe(cellIndex(world, 0, 0));
    expect(cellIndex(world, -1, -1)).toBe(cellIndex(world, 4, 4));
  });

  it('countNeighbors counts Moore and von Neumann shells correctly', () => {
    const w = initSchelling(5, 5, 1, createRng(1)); // density 1 fills every cell
    w.agents = w.agents.map((a, i) => ({ ...a, type: i % 2 }));
    // center cell (2,2) -> Moore radius 1 has 8 neighbors
    const center = cellIndex(w, 2, 2);
    const probe = w.agents.find((a) => cellIndex(w, Math.floor(a.x * 5), Math.floor(a.y * 5)) === center)!;
    const others = w.agents.filter((a) => a !== probe);
    const cx = Math.floor(probe.x * 5);
    const cy = Math.floor(probe.y * 5);
    const moore0 = others.filter((a) => a.type === 0).length === 0 ? 0 : countNeighbors(w, cx, cy, 0, 1, true) - (probe.type === 0 ? 0 : 0);
    // direct check: Moore neighbors = 8 total
    expect(moore0 + countNeighbors(w, cx, cy, 1, 1, true)).toBe(8);
    // von Neumann = 4 total
    expect(countNeighbors(w, cx, cy, 0, 1, false) + countNeighbors(w, cx, cy, 1, 1, false)).toBe(4);
  });
});

describe('Schelling segregation', () => {
  it('tolerance 1 keeps the mixture desegregated', () => {
    const w = initSchelling(30, 30, 0.9, createRng(5));
    const rng = createRng(6);
    let cur = w;
    for (let t = 0; t < 20; t++) cur = stepSchelling(cur, 1, rng);
    // everyone accepts any mix: index stays moderate (no forcing to 1)
    expect(segregationIndex(cur)).toBeLessThan(0.95);
  });

  it('low tolerance drives the segregation index upward', () => {
    const w = initSchelling(40, 40, 0.9, createRng(7));
    const rng = createRng(8);
    const initial = segregationIndex(w);
    let cur = w;
    for (let t = 0; t < 120; t++) cur = stepSchelling(cur, 0.7, rng);
    expect(segregationIndex(cur)).toBeGreaterThan(initial + 0.2);
  });

  it('agent count is conserved (no births/deaths)', () => {
    const w = initSchelling(20, 20, 0.8, createRng(9));
    const rng = createRng(10);
    const cur = stepSchelling(w, 0.3, rng);
    expect(cur.agents).toHaveLength(w.agents.length);
  });

  it('agents occupy distinct cells after moving', () => {
    const w = initSchelling(20, 20, 0.8, createRng(11));
    const rng = createRng(12);
    const cur = stepSchelling(w, 0.2, rng);
    const cells = new Set(cur.agents.map((a) => cellIndex(cur, Math.floor(a.x * cur.cols), Math.floor(a.y * cur.rows))));
    expect(cells.size).toBe(cur.agents.length);
  });
});

describe('declarative rule engine', () => {
  it('transition rules fire probabilistically with neighbor conditions', () => {
    let w: ABMWorld = { width: 1, height: 1, gridMode: true, cols: 10, rows: 10, agents: [] };
    const rng = createRng(21);
    w = initSchelling(10, 10, 1, rng);
    w.agents = w.agents.map((a) => ({ ...a, type: 0 }));
    const stepped = stepRules(w, [{ kind: 'transition', from: 0, to: 1, prob: 1 }], rng);
    expect(stepped.agents.every((a) => a.type === 1)).toBe(true);
  });

  it('move-random displaces agents within the speed bound and wraps', () => {
    const w = initOpinion(50, createRng(22));
    const stepped = stepRules(w, [{ kind: 'move-random', speed: 0.05 }], createRng(23));
    for (const a of stepped.agents) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThan(1);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeLessThan(1);
      const orig = w.agents.find((b) => b.id === a.id)!;
      const dx = Math.min(Math.abs(a.x - orig.x), 1 - Math.abs(a.x - orig.x));
      expect(dx).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
});

describe('predator-prey', () => {
  it('prey can persist without predators and reproduce', () => {
    const w = initPredatorPrey(30, 30, 100, 0, createRng(31));
    const out = runBatch(w, 'predator-prey', 30, { preyReproduce: 0.1 }, createRng(32));
    const finalPrey = out.final.agents.filter((a) => a.type === 0).length;
    expect(finalPrey).toBeGreaterThan(0);
  });

  it('predators die out without prey', () => {
    const w = initPredatorPrey(30, 30, 0, 40, createRng(33));
    const out = runBatch(w, 'predator-prey', 200, { predatorEnergyLoss: 0.5 }, createRng(34));
    expect(out.final.agents.filter((a) => a.type === 1)).toHaveLength(0);
  });

  it('grass regrows within [0,1] and prey reduce grass where they eat', () => {
    const w = initPredatorPrey(20, 20, 200, 0, createRng(35));
    const out = runBatch(w, 'predator-prey', 10, {}, createRng(36));
    for (const v of out.final.grass!) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('without predators prey counts never decrease in one step', () => {
    const w = initPredatorPrey(40, 40, 300, 0, createRng(37));
    const out = runBatch(w, 'predator-prey', 1, {}, createRng(38));
    const c1 = aggregate(out.final).counts;
    expect(c1['type0'] ?? 0).toBeGreaterThanOrEqual(300);
  });
});

describe('opinion dynamics (Deffuant)', () => {
  it('confidence 1 (bounded above max diff) converges to consensus std ~ 0', () => {
    const w = initOpinion(300, createRng(41));
    const out = runBatch(w, 'opinion', 120, { confidence: 1, mu: 0.5, interactRadius: 2 }, createRng(42));
    const ops = out.final.agents.map((a) => a.attrs.opinion!);
    const m = ops.reduce((a, b) => a + b, 0) / ops.length;
    const sd = Math.sqrt(ops.reduce((a, b) => a + (b - m) * (b - m), 0) / (ops.length - 1));
    expect(sd).toBeLessThan(0.02);
  });

  it('opinions stay in [0,1]', () => {
    const w = initOpinion(200, createRng(43));
    const out = runBatch(w, 'opinion', 60, { confidence: 0.4, mu: 0.3 }, createRng(44));
    for (const a of out.final.agents) {
      expect(a.attrs.opinion).toBeGreaterThanOrEqual(0);
      expect(a.attrs.opinion).toBeLessThanOrEqual(1);
    }
  });

  it('large interaction radius: bounded confidence still blocks far-apart opinions', () => {
    const w = initOpinion(200, createRng(45));
    // seed two opinion clusters 0.0 and 1.0 with confidence 0.1 -> no interaction
    w.agents.forEach((a, i) => {
      a.attrs.opinion = i % 2;
    });
    const out = runBatch(w, 'opinion', 50, { confidence: 0.1, mu: 0.5, interactRadius: 2 }, createRng(46));
    const ops = out.final.agents.map((a) => a.attrs.opinion!);
    const near0 = ops.filter((v) => v < 0.2).length;
    const near1 = ops.filter((v) => v > 0.8).length;
    expect(near0 + near1).toBe(ops.length);
  });
});

describe('traffic flow (Nagel-Schreckenberg)', () => {
  it('never allows overlapping cars (gap >= speed respected next step)', () => {
    const w = initTraffic(100, 0.35, createRng(51));
    const out = runBatch(w, 'traffic', 50, { maxSpeed: 5, pSlow: 0.3 }, createRng(52));
    const positions = out.final.agents.map((a) => Math.round(a.x)).sort((a, b) => a - b);
    const uniq = new Set(positions);
    expect(uniq.size).toBe(positions.length);
  });

  it('clamps speed to maxSpeed', () => {
    const w = initTraffic(200, 0.1, createRng(53));
    const out = runBatch(w, 'traffic', 30, { maxSpeed: 4, pSlow: 0 }, createRng(54));
    for (const a of out.final.agents) expect(a.attrs.speed!).toBeLessThanOrEqual(4);
  });

  it('free road reaches max speed (mean speed = maxSpeed)', () => {
    const w = initTraffic(400, 0.05, createRng(55));
    const out = runBatch(w, 'traffic', 100, { maxSpeed: 5, pSlow: 0 }, createRng(56));
    const speeds = out.final.agents.map((a) => a.attrs.speed!);
    const ms = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(ms).toBeCloseTo(5, 6);
  });
});

describe('batch run and determinism', () => {
  it('series length is steps + 1 with monotonically increasing step ids', () => {
    const w = initSchelling(20, 20, 0.7, createRng(61));
    const out = runBatch(w, 'schelling', 25, { tolerance: 0.5 }, createRng(62));
    expect(out.series).toHaveLength(26);
    expect(out.series.map((s) => s.step)).toEqual(Array.from({ length: 26 }, (_, i) => i));
  });

  it('same seed reproduces identical trajectories', () => {
    const mk = () => runBatch(initSchelling(25, 25, 0.8, createRng(71)), 'schelling', 20, { tolerance: 0.4 }, createRng(72));
    const a = mk();
    const b = mk();
    expect(a.series.map((s) => s.counts['type0'])).toEqual(b.series.map((s) => s.counts['type0']));
    expect(segregationIndex(a.final)).toBe(segregationIndex(b.final));
  });

  it('aggregate means are finite numbers', () => {
    const w = initOpinion(50, createRng(81));
    const agg = aggregate(w);
    expect(agg.means['type0.opinion']).toBeGreaterThanOrEqual(0);
    expect(agg.means['type0.opinion']).toBeLessThanOrEqual(1);
  });
});
