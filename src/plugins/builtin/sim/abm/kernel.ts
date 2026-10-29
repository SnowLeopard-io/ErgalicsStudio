// ==========================================================================
// sim-abm kernel — agent-based modeling core.
//
// Supports grid worlds (torus) and continuous space (torus) with a declarative
// transition/move rule engine plus four built-in template dynamics:
// Schelling segregation, predator-prey (wolf-sheep style with grass),
// Deffuant opinion dynamics (continuous space) and Nagel-Schreckenberg
// traffic (1-lane ring). All randomness flows through a seeded PRNG so runs
// are bit-reproducible.
// ==========================================================================

export interface Rng {
  next(): number;
}

/** mulberry32 — small, fast, deterministic 32-bit PRNG. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

// ---- World and agents ------------------------------------------------------

export interface Agent {
  id: number;
  x: number;
  y: number;
  /** Agent type index (0, 1, ...). Meaning depends on the template. */
  type: number;
  /** Named numeric attributes (energy, opinion, speed, ...). */
  attrs: Record<string, number>;
  alive: boolean;
}

export interface ABMWorld {
  width: number;
  height: number;
  /** Grid worlds use cols x rows cells; continuous worlds ignore them. */
  gridMode: boolean;
  cols: number;
  rows: number;
  agents: Agent[];
  /** Grid resource field (predator-prey grass); undefined elsewhere. */
  grass?: Float32Array;
}

export type TemplateId = 'schelling' | 'predator-prey' | 'opinion' | 'traffic';

// ---- Grid helpers (toroidal) ----------------------------------------------

export function cellIndex(world: ABMWorld, cx: number, cy: number): number {
  const c = ((cx % world.cols) + world.cols) % world.cols;
  const r = ((cy % world.rows) + world.rows) % world.rows;
  return r * world.cols + c;
}

/** One-time per-step cell occupancy grid: map cell index -> per-type counts. */
export function buildTypeGrid(world: ABMWorld, maxTypes: number): Map<number, Int32Array> {
  const grid = new Map<number, Int32Array>();
  for (const a of world.agents) {
    if (!a.alive) continue;
    const idx = cellOf(world, a);
    let counts = grid.get(idx);
    if (!counts) {
      counts = new Int32Array(maxTypes);
      grid.set(idx, counts);
    }
    if (a.type < maxTypes) counts[a.type]!++;
  }
  return grid;
}

/** Count same-cell neighbors of a type around (cx,cy) from a prebuilt grid. */
export function countAround(grid: Map<number, Int32Array>, world: ABMWorld, cx: number, cy: number, type: number, radius: number, moore: boolean): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!moore && dx !== 0 && dy !== 0) continue;
      const counts = grid.get(cellIndex(world, cx + dx, cy + dy));
      if (counts && type < counts.length) count += counts[type]!;
    }
  }
  return count;
}

/** Count agents of a type in the neighborhood of a cell (torus).
 * neighborhood: 'von-neumann' | 'moore'. O(agents) — prefer building a type
 * grid once per step and using countAround instead. */
export function countNeighbors(world: ABMWorld, cx: number, cy: number, type: number, radius: number, moore: boolean): number {
  return countAround(buildTypeGrid(world, Math.max(type + 1, 8)), world, cx, cy, type, radius, moore);
}

export function cellOf(world: ABMWorld, a: Agent): number {
  const cx = Math.min(world.cols - 1, Math.max(0, Math.floor((a.x / world.width) * world.cols)));
  const cy = Math.min(world.rows - 1, Math.max(0, Math.floor((a.y / world.height) * world.rows)));
  return cy * world.cols + cx;
}

// ---- Generic rule engine ---------------------------------------------------

/** Declarative transition rule: agents of `from` type may become `to` type
 * with base probability, modulated by a neighbor-count condition. */
export interface TransitionRule {
  kind: 'transition';
  from: number;
  to: number;
  prob: number;
  neighborType?: number;
  op?: '>=' | '<=';
  count?: number;
  neighborhood?: 'von-neumann' | 'moore';
  radius?: number;
}

export interface MoveRandomRule {
  kind: 'move-random';
  /** Agent types affected; empty = all. */
  types?: number[];
  speed: number;
}

export type ABMRule = TransitionRule | MoveRandomRule;

/** Apply declarative rules once to a grid world (returns a new world). */
export function stepRules(world: ABMWorld, rules: ABMRule[], rng: Rng): ABMWorld {
  const next: ABMWorld = { ...world, agents: world.agents.map((a) => ({ ...a, attrs: { ...a.attrs } })) };
  for (const rule of rules) {
    if (rule.kind === 'transition') {
      const moore = (rule.neighborhood ?? 'moore') === 'moore';
      const radius = rule.radius ?? 1;
      for (const a of next.agents) {
        if (!a.alive || a.type !== rule.from) continue;
        let prob = rule.prob;
        if (rule.neighborType !== undefined && rule.count !== undefined) {
          const cnt = countNeighbors(next, cellOfX(next, a), cellOfY(next, a), rule.neighborType, radius, moore);
          const op = rule.op ?? '>=';
          const met = op === '>=' ? cnt >= rule.count : cnt <= rule.count;
          prob = met ? rule.prob : 0;
        }
        if (prob > 0 && rng.next() < prob) a.type = rule.to;
      }
    } else if (rule.kind === 'move-random') {
      const types = rule.types;
      for (const a of next.agents) {
        if (!a.alive || (types && !types.includes(a.type))) continue;
        const dx = (rng.next() * 2 - 1) * rule.speed;
        const dy = (rng.next() * 2 - 1) * rule.speed;
        a.x = mod(a.x + dx, next.width);
        a.y = mod(a.y + dy, next.height);
      }
    }
  }
  return next;
}

function cellOfX(world: ABMWorld, a: Agent): number {
  return Math.min(world.cols - 1, Math.max(0, Math.floor((a.x / world.width) * world.cols)));
}
function cellOfY(world: ABMWorld, a: Agent): number {
  return Math.min(world.rows - 1, Math.max(0, Math.floor((a.y / world.height) * world.rows)));
}
function mod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

// ---- Template: Schelling segregation ---------------------------------------

export function initSchelling(cols: number, rows: number, density: number, rng: Rng): ABMWorld {
  const agents: Agent[] = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng.next() < density) {
        const type = rng.next() < 0.5 ? 0 : 1;
        agents.push({ id: id++, x: ((c + 0.5) / cols), y: ((r + 0.5) / rows), type, attrs: {}, alive: true });
      }
    }
  }
  return { width: 1, height: 1, gridMode: true, cols, rows, agents };
}

/** One Schelling step: unhappy agents (same-type neighbor share < tolerance)
 * move to a (preferably satisfying) random empty cell. Works on a copy. */
export function stepSchelling(world: ABMWorld, tolerance: number, rng: Rng): ABMWorld {
  const next: ABMWorld = { ...world, agents: world.agents.map((a) => ({ ...a, attrs: { ...a.attrs } })) };
  const occupied = new Set<number>();
  for (const a of next.agents) occupied.add(cellOf(next, a));
  const empty: number[] = [];
  for (let i = 0; i < next.cols * next.rows; i++) if (!occupied.has(i)) empty.push(i);
  // Type grid built once per step (movement decisions use the start-of-step
  // occupancy, the standard synchronous-update convention).
  const grid = buildTypeGrid(next, 2);
  // Fisher-Yates over empty cells with the run's rng for reproducibility.
  for (let i = empty.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = empty[i]!;
    empty[i] = empty[j]!;
    empty[j] = t;
  }
  for (const a of next.agents) {
    const cx = cellOfX(next, a);
    const cy = cellOfY(next, a);
    const same = countAround(grid, next, cx, cy, a.type, 1, true);
    const other = countAround(grid, next, cx, cy, 1 - a.type, 1, true);
    const share = same + other > 0 ? same / (same + other) : 1;
    if (share < tolerance && empty.length > 0) {
      // Prefer an empty cell that already satisfies the tolerance (probe a
      // random sample), else fall back to a uniformly random empty cell.
      let chosen = -1;
      const probes = Math.min(empty.length, 24);
      for (let p = 0; p < probes && chosen < 0; p++) {
        const pi = Math.floor(rng.next() * empty.length);
        const cand = empty[pi]!;
        const ccx = cand % next.cols;
        const ccy = Math.floor(cand / next.cols);
        const s = countAround(grid, next, ccx, ccy, a.type, 1, true);
        const o = countAround(grid, next, ccx, ccy, 1 - a.type, 1, true);
        if (s + o === 0 || s / (s + o) >= tolerance) chosen = pi;
      }
      const idx = chosen >= 0 ? chosen : Math.floor(rng.next() * empty.length);
      const to = empty.splice(idx, 1)[0]!;
      a.x = ((to % next.cols) + 0.5) / next.cols;
      a.y = (Math.floor(to / next.cols) + 0.5) / next.rows;
    }
  }
  return next;
}

/** Fraction of same-type neighbors among unlike-or-same Moore neighbors. */
export function segregationIndex(world: ABMWorld): number {
  const grid = buildTypeGrid(world, 2);
  let same = 0;
  let total = 0;
  for (const a of world.agents) {
    const cx = cellOfX(world, a);
    const cy = cellOfY(world, a);
    const s = countAround(grid, world, cx, cy, a.type, 1, true);
    const o = countAround(grid, world, cx, cy, 1 - a.type, 1, true);
    if (s + o > 0) {
      same += s / (s + o);
      total += 1;
    }
  }
  return total > 0 ? same / total : 0;
}

// ---- Template: predator-prey (wolf-sheep-grass) -----------------------------

export interface PredatorPreyParams {
  preyReproduce: number;
  predatorReproduce: number;
  predatorEnergyLoss: number;
  preyGain: number;
  grassRegrow: number;
}

export function initPredatorPrey(cols: number, rows: number, nPrey: number, nPred: number, rng: Rng): ABMWorld {
  const agents: Agent[] = [];
  let id = 0;
  for (let i = 0; i < nPrey; i++) {
    agents.push({ id: id++, x: rng.next(), y: rng.next(), type: 0, attrs: { energy: 5 }, alive: true });
  }
  for (let i = 0; i < nPred; i++) {
    agents.push({ id: id++, x: rng.next(), y: rng.next(), type: 1, attrs: { energy: 12 }, alive: true });
  }
  const grass = new Float32Array(cols * rows);
  for (let i = 0; i < grass.length; i++) grass[i] = rng.next() < 0.5 ? 1 : Math.floor(rng.next() * 10);
  return { width: 1, height: 1, gridMode: true, cols, rows, agents, grass };
}

export function stepPredatorPrey(world: ABMWorld, p: PredatorPreyParams, rng: Rng): ABMWorld {
  const next: ABMWorld = { ...world, agents: world.agents.map((a) => ({ ...a, attrs: { ...a.attrs } })), grass: new Float32Array(world.grass!) };
  const cell = (a: Agent): number => cellOf(next, a);

  // Grass regrowth.
  for (let i = 0; i < next.grass!.length; i++) next.grass![i] = Math.min(next.grass![i]! + p.grassRegrow, 1);

  // Prey eat grass and move.
  for (const a of next.agents) {
    if (!a.alive || a.type !== 0) continue;
    const idx = cell(a);
    if (next.grass![idx]! >= 1) {
      next.grass![idx] = 0;
      a.attrs.energy = a.attrs.energy! + p.preyGain;
    }
    a.x = mod(a.x + (rng.next() * 2 - 1) * 0.06, next.width);
    a.y = mod(a.y + (rng.next() * 2 - 1) * 0.06, next.height);
  }

  // Predators hunt prey in the same cell.
  const byCell = new Map<number, Agent[]>();
  for (const a of next.agents) {
    if (!a.alive) continue;
    const idx = cell(a);
    const list = byCell.get(idx) ?? [];
    list.push(a);
    byCell.set(idx, list);
  }
  for (const [, list] of byCell) {
    const preds = list.filter((a) => a.type === 1 && a.alive);
    const preys = list.filter((a) => a.type === 0 && a.alive);
    for (const pr of preds) {
      if (!preys.length) break;
      const victim = preys.pop()!;
      victim.alive = false;
      pr.attrs.energy = pr.attrs.energy! + Math.max(victim.attrs.energy!, 1) * 0.5 + 4;
    }
  }

  // Predator energy decay and death.
  for (const a of next.agents) {
    if (!a.alive || a.type !== 1) continue;
    a.attrs.energy = a.attrs.energy! - p.predatorEnergyLoss;
    if (a.attrs.energy! <= 0) a.alive = false;
  }

  // Reproduction (split energy).
  const born: Agent[] = [];
  let nextId = next.agents.reduce((m, a) => Math.max(m, a.id), 0) + 1;
  for (const a of next.agents) {
    if (!a.alive) continue;
    const rate = a.type === 0 ? p.preyReproduce : p.predatorReproduce;
    if (rng.next() < rate) {
      const child: Agent = { id: nextId++, x: mod(a.x + 0.01, next.width), y: mod(a.y + 0.01, next.height), type: a.type, attrs: { energy: a.attrs.energy! / 2 }, alive: true };
      a.attrs.energy = a.attrs.energy! / 2;
      born.push(child);
    }
  }
  next.agents.push(...born);
  next.agents = next.agents.filter((a) => a.alive);
  return next;
}

// ---- Template: opinion dynamics (Deffuant, continuous space) ----------------

export function initOpinion(n: number, rng: Rng): ABMWorld {
  const agents: Agent[] = [];
  for (let i = 0; i < n; i++) {
    agents.push({ id: i, x: rng.next(), y: rng.next(), type: 0, attrs: { opinion: rng.next() }, alive: true });
  }
  return { width: 1, height: 1, gridMode: false, cols: 0, rows: 0, agents };
}

/** Deffuant update: random pairs within interaction radius average opinions
 * when |opinion difference| <= confidence threshold. */
export function stepOpinion(world: ABMWorld, confidence: number, mu: number, interactRadius: number, rng: Rng): ABMWorld {
  const next: ABMWorld = { ...world, agents: world.agents.map((a) => ({ ...a, attrs: { ...a.attrs } })) };
  const n = next.agents.length;
  const pairs = Math.floor(n / 2);
  for (let t = 0; t < pairs; t++) {
    const i = Math.floor(rng.next() * n);
    const j = Math.floor(rng.next() * n);
    if (i === j) continue;
    const a = next.agents[i]!;
    const b = next.agents[j]!;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (dx * dx + dy * dy > interactRadius * interactRadius) continue;
    if (Math.abs(a.attrs.opinion! - b.attrs.opinion!) > confidence) continue;
    const oa = a.attrs.opinion!;
    const ob = b.attrs.opinion!;
    a.attrs.opinion = oa + mu * (ob - oa);
    b.attrs.opinion = ob + mu * (oa - ob);
  }
  return next;
}

// ---- Template: traffic flow (Nagel-Schreckenberg ring) ----------------------

export function initTraffic(ncells: number, density: number, rng: Rng): ABMWorld {
  const agents: Agent[] = [];
  let id = 0;
  const slots = new Set<number>();
  for (let c = 0; c < ncells; c++) {
    if (rng.next() < density) {
      let pos = Math.floor(rng.next() * ncells);
      while (slots.has(pos)) pos = (pos + 1) % ncells;
      slots.add(pos);
      agents.push({ id: id++, x: pos, y: 0, type: 0, attrs: { speed: 0 }, alive: true });
    }
  }
  return { width: ncells, height: 1, gridMode: true, cols: ncells, rows: 1, agents };
}

/** Nagel-Schreckenberg: accelerate, brake by gap, random slowdown, advance.
 * Positions are integer cells on a ring; speed in [0, maxSpeed]. */
export function stepTraffic(world: ABMWorld, maxSpeed: number, pSlow: number, rng: Rng): ABMWorld {
  const n = world.width;
  const next: ABMWorld = { ...world, agents: world.agents.map((a) => ({ ...a, attrs: { ...a.attrs } })) };
  const sorted = [...next.agents].sort((a, b) => Math.round(a.x) - Math.round(b.x));
  for (let i = 0; i < sorted.length; i++) {
    const car = sorted[i]!;
    const lead = sorted[(i + 1) % sorted.length]!;
    const gap = i + 1 === sorted.length
      ? n - (Math.round(car.x) - Math.round(lead.x))
      : Math.round(lead.x) - Math.round(car.x);
    // 1. accelerate
    car.attrs.speed = Math.min(car.attrs.speed! + 1, maxSpeed);
    // 2. brake to keep gap >= speed (gap counts cells between cars)
    car.attrs.speed = Math.min(car.attrs.speed!, Math.max(gap - 1, 0));
    // 3. random slowdown
    if (car.attrs.speed! > 0 && rng.next() < pSlow) car.attrs.speed = car.attrs.speed! - 1;
    // 4. advance (ring)
    car.x = mod(car.x + car.attrs.speed!, n);
  }
  return next;
}

// ---- Aggregation and batch runs ---------------------------------------------

export interface Aggregate {
  step: number;
  counts: Record<string, number>;
  means: Record<string, number>;
}

/** Aggregate a world into per-type counts and mean attribute values. */
export function aggregate(world: ABMWorld): Omit<Aggregate, 'step'> {
  const counts: Record<string, number> = {};
  const sums: Record<string, number> = {};
  const nums: Record<string, number> = {};
  for (const a of world.agents) {
    if (!a.alive) continue;
    const key = `type${a.type}`;
    counts[key] = (counts[key] ?? 0) + 1;
    for (const [k, v] of Object.entries(a.attrs)) {
      sums[`${key}.${k}`] = (sums[`${key}.${k}`] ?? 0) + v;
      nums[`${key}.${k}`] = (nums[`${key}.${k}`] ?? 0) + 1;
    }
  }
  const means: Record<string, number> = {};
  for (const k of Object.keys(sums)) means[k] = sums[k]! / nums[k]!;
  return { counts, means };
}

/** Run a template for `steps` iterations collecting per-step aggregates. */
export function runBatch(
  world: ABMWorld,
  template: TemplateId,
  steps: number,
  params: Record<string, number>,
  rng: Rng,
): { series: Aggregate[]; final: ABMWorld } {
  const series: Aggregate[] = [{ step: 0, ...aggregate(world) }];
  let w = world;
  for (let t = 1; t <= steps; t++) {
    switch (template) {
      case 'schelling': w = stepSchelling(w, params.tolerance ?? 0.5, rng); break;
      case 'predator-prey': w = stepPredatorPrey(w, {
        preyReproduce: params.preyReproduce ?? 0.04,
        predatorReproduce: params.predatorReproduce ?? 0.05,
        predatorEnergyLoss: params.predatorEnergyLoss ?? 0.4,
        preyGain: params.preyGain ?? 4,
        grassRegrow: params.grassRegrow ?? 0.05,
      }, rng); break;
      case 'opinion': w = stepOpinion(w, params.confidence ?? 0.3, params.mu ?? 0.3, params.interactRadius ?? 0.1, rng); break;
      case 'traffic': w = stepTraffic(w, params.maxSpeed ?? 5, params.pSlow ?? 0.3, rng); break;
    }
    series.push({ step: t, ...aggregate(w) });
  }
  return { series, final: w };
}
