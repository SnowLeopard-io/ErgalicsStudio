// ==========================================================================
// sim-des — discrete-event simulation kernel for queueing networks (pure TS)
//
// A seeded, fully deterministic future-event simulation engine:
//   - mulberry32 PRNG and the classic duration distributions
//     (exponential / uniform / triangular / deterministic / normal)
//   - a binary-heap event scheduler ordered by (time, seq) so simultaneous
//     events resolve in FIFO scheduling order
//   - a serializable station-network model (servers, queue discipline,
//     service distribution, routing) driven by a single source
//   - time-averaged statistics via area-under-curve accumulation (queue
//     length, server utilization, Little's law), per-time-bucket series for
//     plotting, and analytical M/M/1 & M/M/c (Erlang-C) references
//
// Every run with the same seed and model reproduces exactly; no dependency
// on host APIs, so the module is directly unit-testable.
// ==========================================================================

// ---- seeded PRNG -----------------------------------------------------------

/** Uniform [0,1) random generator (seeded, deterministic). */
export type Rng = () => number;

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash arbitrary text into a 32-bit seed (so any seed string is usable). */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- duration distributions ------------------------------------------------

/**
 * A random (or fixed) duration in model time units. All sampling is clamped
 * to be non-negative (strictly positive for unbounded distributions) so a
 * service time can never be negative.
 */
export type DurationSpec =
  | { type: 'exponential'; rate: number }
  | { type: 'uniform'; a: number; b: number }
  | { type: 'triangular'; low: number; mode: number; high: number }
  | { type: 'deterministic'; value: number }
  | { type: 'normal'; mu: number; sigma: number };

const MIN_DT = 1e-9;

/** Draw one sample from a duration spec with the given RNG. */
export function sampleDuration(spec: DurationSpec, rng: Rng): number {
  switch (spec.type) {
    case 'deterministic':
      return Math.max(0, spec.value);
    case 'exponential': {
      const rate = Math.max(1e-12, spec.rate);
      const u = Math.min(1 - 1e-12, Math.max(1e-12, rng()));
      return Math.max(MIN_DT, -Math.log(1 - u) / rate);
    }
    case 'uniform': {
      const a = Math.min(spec.a, spec.b);
      const b = Math.max(spec.a, spec.b);
      return Math.max(0, a + rng() * (b - a));
    }
    case 'triangular': {
      const low = spec.low;
      const high = spec.high;
      const u = rng();
      const span = Math.max(1e-12, high - low);
      const fc = Math.min(1, Math.max(0, (spec.mode - low) / span));
      if (u < fc) return Math.max(0, low + Math.sqrt(u * span * (spec.mode - low)));
      return Math.max(0, high - Math.sqrt((1 - u) * span * (high - spec.mode)));
    }
    case 'normal': {
      // Box-Muller transform; clamped to strictly positive durations.
      let u1 = rng();
      if (u1 < 1e-12) u1 = 1e-12;
      const u2 = rng();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.max(MIN_DT, spec.mu + spec.sigma * z);
    }
  }
}

// ---- event scheduler -------------------------------------------------------

/** A scheduled event; ties on `time` are broken by increasing `seq` (FIFO). */
export interface ScheduledEvent<T> {
  time: number;
  seq: number;
  data: T;
}

/**
 * Binary min-heap priority queue ordered by (time, seq). The sequence number
 * gives deterministic FIFO resolution of simultaneous events.
 */
export class EventHeap<T> {
  private heap: Array<ScheduledEvent<T>> = [];

  get size(): number {
    return this.heap.length;
  }

  clear(): void {
    this.heap.length = 0;
  }

  peek(): ScheduledEvent<T> | undefined {
    return this.heap[0];
  }

  push(time: number, seq: number, data: T): void {
    const heap = this.heap;
    heap.push({ time, seq, data });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.before(heap[i]!, heap[parent]!)) {
        const tmp = heap[i]!;
        heap[i] = heap[parent]!;
        heap[parent] = tmp;
        i = parent;
      } else {
        break;
      }
    }
  }

  pop(): ScheduledEvent<T> | undefined {
    const heap = this.heap;
    if (heap.length === 0) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && this.before(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && this.before(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        const tmp = heap[i]!;
        heap[i] = heap[m]!;
        heap[m] = tmp;
        i = m;
      }
    }
    return top;
  }

  private before(a: ScheduledEvent<T>, b: ScheduledEvent<T>): boolean {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }
}

// ---- network model ---------------------------------------------------------

export type QueueDiscipline = 'fifo' | 'lifo' | 'priority';

/**
 * Routing of a finished entity:
 * - `next`          → always to station `id`
 * - `exit`          → leave the system
 * - `probabilities` → random draw among station ids (the id `'exit'` leaves)
 * - `rework`        → always back to (usually earlier) station `id`
 */
export type RoutingSpec =
  | { kind: 'exit' }
  | { kind: 'next'; id: string }
  | { kind: 'probabilities'; options: Array<{ id: string; p: number }> }
  | { kind: 'rework'; id: string };

export interface StationSpec {
  id: string;
  name?: string;
  nameZh?: string;
  /** Number of parallel servers (capacity c ≥ 1). */
  servers: number;
  /** Queue selection rule; `priority` serves high-priority entities first. */
  queueDiscipline?: QueueDiscipline;
  serviceTime: DurationSpec;
  routing: RoutingSpec;
}

export interface SourceSpec {
  /** Interarrival-time distribution (e.g. deterministic interval or exponential rate). */
  arrival: DurationSpec;
  /** Total number of entities the source creates (finite ⇒ guaranteed termination). */
  entityLimit: number;
  /** Fraction of entities created with priority = 1 (VIP share, 0..1). */
  priorityShare?: number;
}

/** Serializable queueing-network model. Entities enter `stations[0]` first. */
export interface DesModel {
  source: SourceSpec;
  stations: StationSpec[];
}

export interface DesSettings {
  /** PRNG seed (same seed + model ⇒ identical run). */
  seed: number;
  /** Number of time buckets for the plotting series (default 200). */
  buckets?: number;
}

// ---- model validation & JSON parsing ---------------------------------------

function durationError(spec: unknown, where: string): string | null {
  if (typeof spec !== 'object' || spec === null) return `${where}: duration spec must be an object`;
  const s = spec as Record<string, unknown>;
  const num = (k: string): number => Number(s[k]);
  switch (s.type) {
    case 'deterministic':
      if (!Number.isFinite(num('value')) || num('value') < 0) return `${where}: deterministic value must be ≥ 0`;
      return null;
    case 'exponential':
      if (!Number.isFinite(num('rate')) || num('rate') <= 0) return `${where}: exponential rate must be > 0`;
      return null;
    case 'uniform':
      if (!Number.isFinite(num('a')) || !Number.isFinite(num('b'))) return `${where}: uniform a/b must be finite`;
      return null;
    case 'triangular':
      if (!Number.isFinite(num('low')) || !Number.isFinite(num('mode')) || !Number.isFinite(num('high'))) {
        return `${where}: triangular low/mode/high must be finite`;
      }
      if (num('low') > num('mode') || num('mode') > num('high')) return `${where}: triangular needs low ≤ mode ≤ high`;
      return null;
    case 'normal':
      if (!Number.isFinite(num('mu')) || !Number.isFinite(num('sigma')) || num('sigma') < 0) {
        return `${where}: normal needs finite mu and sigma ≥ 0`;
      }
      return null;
    default:
      return `${where}: unknown duration type "${String(s.type)}"`;
  }
}

/** Validate a model; returns a human-readable error or null when valid. */
export function validateModel(model: unknown): string | null {
  if (typeof model !== 'object' || model === null) return 'Model must be a JSON object';
  const m = model as Record<string, unknown>;
  if (typeof m.source !== 'object' || m.source === null) return 'Missing "source" object';
  if (!Array.isArray(m.stations) || m.stations.length === 0) return 'Model needs at least one station';
  const src = m.source as Record<string, unknown>;
  const arrErr = durationError(src.arrival, 'source.arrival');
  if (arrErr) return arrErr;
  if (!Number.isFinite(Number(src.entityLimit)) || Number(src.entityLimit) < 1) {
    return 'source.entityLimit must be a number ≥ 1';
  }
  if (src.priorityShare !== undefined) {
    const ps = Number(src.priorityShare);
    if (!Number.isFinite(ps) || ps < 0 || ps > 1) return 'source.priorityShare must be within [0, 1]';
  }
  const ids = new Set<string>();
  for (const raw of m.stations as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return 'Each station must be an object';
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== 'string' || s.id.length === 0) return 'Station needs a non-empty "id"';
    if (ids.has(s.id)) return `Duplicate station id "${s.id}"`;
    ids.add(s.id);
  }
  for (const raw of m.stations as unknown[]) {
    const s = raw as Record<string, unknown>;
    const where = `station "${String(s.id)}"`;
    if (!Number.isFinite(Number(s.servers)) || Number(s.servers) < 1) return `${where}: servers must be ≥ 1`;
    const svcErr = durationError(s.serviceTime, `${where}.serviceTime`);
    if (svcErr) return svcErr;
    if (s.queueDiscipline !== undefined) {
      const d = s.queueDiscipline;
      if (d !== 'fifo' && d !== 'lifo' && d !== 'priority') {
        return `${where}: queueDiscipline must be "fifo" | "lifo" | "priority"`;
      }
    }
    if (typeof s.routing !== 'object' || s.routing === null) return `${where}: missing "routing"`;
    const r = s.routing as Record<string, unknown>;
    if (r.kind === 'exit') continue;
    if (r.kind === 'next' || r.kind === 'rework') {
      if (typeof r.id !== 'string' || !ids.has(r.id)) return `${where}: routing target "${String(r.id)}" is not a station id`;
      continue;
    }
    if (r.kind === 'probabilities') {
      if (!Array.isArray(r.options) || r.options.length === 0) return `${where}: probabilities needs a non-empty options list`;
      let total = 0;
      for (const o of r.options as unknown[]) {
        if (typeof o !== 'object' || o === null) return `${where}: each probability option must be an object`;
        const opt = o as Record<string, unknown>;
        const p = Number(opt.p);
        if (!Number.isFinite(p) || p < 0) return `${where}: option probability must be a number ≥ 0`;
        total += p;
        if (opt.id !== 'exit' && (typeof opt.id !== 'string' || !ids.has(opt.id))) {
          return `${where}: option target "${String(opt.id)}" is not a station id or "exit"`;
        }
      }
      if (total <= 0) return `${where}: probabilities must sum to a positive value`;
      continue;
    }
    return `${where}: unknown routing kind "${String(r.kind)}"`;
  }
  return null;
}

export type ParsedModel = { ok: true; model: DesModel } | { ok: false; error: string };

/** Parse + validate a model from JSON text (as edited in the plugin panel). */
export function parseDesModel(text: string): ParsedModel {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const err = validateModel(obj);
  if (err) return { ok: false, error: err };
  return { ok: true, model: obj as DesModel };
}

// ---- simulation result -----------------------------------------------------

export interface StationStats {
  id: string;
  name: string;
  nameZh?: string;
  servers: number;
  /** Time-averaged busy fraction: busy time / (servers × sim time). */
  utilization: number;
  /** Time-weighted average queue length. */
  avgQueue: number;
  maxQueue: number;
  /** Mean per-visit wait in queue (includes revisits). */
  avgWait: number;
  maxWait: number;
  avgService: number;
  arrivals: number;
  departures: number;
  /** Arrivals by entities that had already visited this station (rework loops). */
  revisits: number;
  /** |Lq − λq·Wq| / Lq per-station Little's-law check (0 when degenerate). */
  littleResidual: number;
  /** Individual per-visit queue waits (dequeue order). */
  waitTimes: number[];
}

export interface BucketSeries {
  count: number;
  width: number;
  /** Time-averaged queue length per bucket: [station][bucket]. */
  queueLen: number[][];
  /** Utilization per bucket: [station][bucket]. */
  utilization: number[][];
  /** Time-averaged total entities in system per bucket. */
  inSystem: number[];
}

export interface DesResult {
  simTime: number;
  entitiesCreated: number;
  entitiesExited: number;
  /** Exits per unit time. */
  throughput: number;
  /** Mean end-to-end time in system over exited entities. */
  meanSojourn: number;
  /** Mean total queue wait (all stations accumulated) per exited entity. */
  meanQueueWait: number;
  /** Time-averaged number of entities in the system (L). */
  meanInSystem: number;
  /** |L − λW| / L over the whole system. */
  littlesResidual: number;
  stations: StationStats[];
  bottleneckId: string;
  bottleneckUtilization: number;
  /** Stations sorted by utilization (descending) — bottleneck first. */
  ranking: Array<{ id: string; utilization: number; avgQueue: number }>;
  series: BucketSeries;
  /** End-to-end sojourn time of every exited entity. */
  sojourns: number[];
  /** End-to-end accumulated queue wait of every exited entity. */
  queueWaits: number[];
  /** True when the hard event-count safety cap stopped the run early. */
  truncated: boolean;
}

// ---- the simulator ---------------------------------------------------------

/** Hard cap on processed events — a safety valve against degenerate models. */
const MAX_EVENTS = 5_000_000;

interface DesEntity {
  priority: number;
  tEnter: number;
  tStationArrive: number;
  tServiceStart: number;
  waitAcc: number;
  visited: boolean[];
}

type EventData =
  | { kind: 'spawn' }
  | { kind: 'arrive'; st: number; ent: number }
  | { kind: 'done'; st: number; ent: number };

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * Run the future-event simulation of `model` with a seeded RNG. The finite
 * entity limit guarantees termination even at ρ ≥ 1; a hard event cap guards
 * against pathological zero-time rework loops.
 */
export function runDES(model: DesModel, settings: DesSettings): DesResult {
  const stations = model.stations;
  const n = stations.length;
  const rng = mulberry32(settings.seed);
  const limit = Math.max(1, Math.floor(Number(model.source.entityLimit) || 1));
  const priorityShare = Math.min(1, Math.max(0, Number(model.source.priorityShare ?? 0) || 0));
  const idIndex = new Map<string, number>();
  stations.forEach((s, i) => idIndex.set(s.id, i));

  // Per-station runtime state and area accumulators.
  const busy = new Array<number>(n).fill(0);
  const queues: number[][] = stations.map(() => []);
  const servers = stations.map((s) => Math.max(1, Math.floor(Number(s.servers) || 1)));
  const qArea = new Array<number>(n).fill(0);
  const busyArea = new Array<number>(n).fill(0);
  const maxQ = new Array<number>(n).fill(0);
  const arrivals = new Array<number>(n).fill(0);
  const departures = new Array<number>(n).fill(0);
  const revisits = new Array<number>(n).fill(0);
  const waitSum = new Array<number>(n).fill(0);
  const waitMax = new Array<number>(n).fill(0);
  const svcSum = new Array<number>(n).fill(0);
  const svcCount = new Array<number>(n).fill(0);
  const waitTimes: number[][] = stations.map(() => []);
  // Change-point logs (time, value) for exact bucket integration afterwards.
  const qLog: Array<Array<[number, number]>> = stations.map(() => [[0, 0]]);
  const busyLog: Array<Array<[number, number]>> = stations.map(() => [[0, 0]]);

  // Whole-system state (for Little's law).
  let inSystem = 0;
  let sysLastT = 0;
  let sysArea = 0;
  const sysLog: Array<[number, number]> = [[0, 0]];

  let now = 0;
  const lastT = new Array<number>(n).fill(0);

  function touchStation(i: number, t: number): void {
    const dt = t - lastT[i]!;
    if (dt > 0) {
      qArea[i]! += dt * queues[i]!.length;
      busyArea[i]! += dt * busy[i]!;
    }
    lastT[i] = t;
  }

  function logChange(log: Array<[number, number]>, t: number, v: number): void {
    const last = log[log.length - 1]!;
    if (last[1] !== v) log.push([t, v]);
  }

  function touchSystem(t: number): void {
    const dt = t - sysLastT;
    if (dt > 0) sysArea += dt * inSystem;
    sysLastT = t;
  }

  const entities: DesEntity[] = [];
  const sojourns: number[] = [];
  const queueWaits: number[] = [];
  let created = 0;
  let exited = 0;

  function disciplineOf(i: number): QueueDiscipline {
    return stations[i]!.queueDiscipline ?? 'fifo';
  }

  /** Take the next entity from station i's queue per its discipline. */
  function takeNext(i: number): number {
    const q = queues[i]!;
    const disc = disciplineOf(i);
    if (disc === 'lifo') return q.pop()!;
    if (disc === 'priority') {
      let best = 0;
      for (let k = 1; k < q.length; k += 1) {
        if (entities[q[k]!]!.priority > entities[q[best]!]!.priority) best = k;
      }
      return q.splice(best, 1)[0]!;
    }
    return q.shift()!;
  }

  function startService(i: number, ent: number, t: number): void {
    const e = entities[ent]!;
    e.tServiceStart = t;
    busy[i]! += 1;
    logChange(busyLog[i]!, t, busy[i]!);
  }

  /** Route a finished entity: exit (record stats) or arrive at the target. */
  function route(i: number, ent: number, t: number, push: (t: number, d: EventData) => void): void {
    const r = stations[i]!.routing;
    let target: string | null = null;
    if (r.kind === 'next' || r.kind === 'rework') {
      target = r.id;
    } else if (r.kind === 'probabilities') {
      let total = 0;
      for (const o of r.options) total += Math.max(0, o.p);
      if (total > 0) {
        let u = rng() * total;
        target = r.options[r.options.length - 1]!.id;
        for (const o of r.options) {
          u -= Math.max(0, o.p);
          if (u <= 0) {
            target = o.id;
            break;
          }
        }
      }
    }
    if (target === null || target === 'exit' || !idIndex.has(target)) {
      exited += 1;
      const e = entities[ent]!;
      sojourns.push(t - e.tEnter);
      queueWaits.push(e.waitAcc);
      touchSystem(t);
      inSystem -= 1;
      logChange(sysLog, t, inSystem);
      return;
    }
    push(t, { kind: 'arrive', st: idIndex.get(target)!, ent });
  }

  const heap = new EventHeap<EventData>();
  let seq = 0;
  const push = (t: number, d: EventData): void => {
    seq += 1;
    heap.push(t, seq, d);
  };

  // First entity arrives at t = 0; subsequent arrivals follow the spec.
  push(0, { kind: 'spawn' });

  let processed = 0;
  let truncated = false;

  while (heap.size > 0) {
    processed += 1;
    if (processed > MAX_EVENTS) {
      truncated = true;
      break;
    }
    const ev = heap.pop()!;
    now = ev.time;
    const d = ev.data;

    if (d.kind === 'spawn') {
      const ent = entities.length;
      entities.push({
        priority: rng() < priorityShare ? 1 : 0,
        tEnter: now,
        tStationArrive: now,
        tServiceStart: now,
        waitAcc: 0,
        visited: new Array<boolean>(n).fill(false),
      });
      created += 1;
      touchSystem(now);
      inSystem += 1;
      logChange(sysLog, now, inSystem);
      push(now, { kind: 'arrive', st: 0, ent });
      if (created < limit) {
        push(now + sampleDuration(model.source.arrival, rng), { kind: 'spawn' });
      }
    } else if (d.kind === 'arrive') {
      const st = d.st;
      const ent = d.ent;
      arrivals[st]! += 1;
      const e = entities[ent]!;
      if (e.visited[st]) revisits[st]! += 1;
      e.visited[st] = true;
      e.tStationArrive = now;
      touchStation(st, now);
      if (busy[st]! < servers[st]!) {
        startService(st, ent, now);
        push(now + sampleDuration(stations[st]!.serviceTime, rng), { kind: 'done', st, ent });
      } else {
        queues[st]!.push(ent);
        logChange(qLog[st]!, now, queues[st]!.length);
        if (queues[st]!.length > maxQ[st]!) maxQ[st] = queues[st]!.length;
      }
    } else {
      // Service completion at station st.
      const st = d.st;
      const ent = d.ent;
      const e = entities[ent]!;
      touchStation(st, now);
      busy[st]! -= 1;
      logChange(busyLog[st]!, now, busy[st]!);
      svcSum[st]! += now - e.tServiceStart;
      svcCount[st]! += 1;
      departures[st]! += 1;
      // Promote the next waiting entity (if any) into the freed server.
      const q = queues[st]!;
      if (q.length > 0) {
        const nxt = takeNext(st);
        const e2 = entities[nxt]!;
        const w = now - e2.tStationArrive;
        e2.waitAcc += w;
        waitSum[st]! += w;
        if (w > waitMax[st]!) waitMax[st] = w;
        waitTimes[st]!.push(w);
        startService(st, nxt, now);
        logChange(qLog[st]!, now, q.length);
        push(now + sampleDuration(stations[st]!.serviceTime, rng), { kind: 'done', st, ent: nxt });
      }
      route(st, ent, now, push);
    }
  }

  const simTime = Math.max(now, 1e-12);

  // ---- per-station statistics ----
  const stats: StationStats[] = stations.map((s, i) => {
    const util = busyArea[i]! / (servers[i]! * simTime);
    const avgQ = qArea[i]! / simTime;
    const avgWait = mean(waitTimes[i]!);
    // Per-station Little's law on the queue: Lq = λq · Wq with λq = departures / T.
    const lamQ = departures[i]! / simTime;
    const little = avgQ > 1e-9 ? Math.abs(avgQ - lamQ * avgWait) / avgQ : 0;
    return {
      id: s.id,
      name: s.name ?? s.id,
      nameZh: s.nameZh,
      servers: servers[i]!,
      utilization: util,
      avgQueue: avgQ,
      maxQueue: maxQ[i]!,
      avgWait,
      maxWait: waitMax[i]!,
      avgService: svcCount[i]! > 0 ? svcSum[i]! / svcCount[i]! : 0,
      arrivals: arrivals[i]!,
      departures: departures[i]!,
      revisits: revisits[i]!,
      littleResidual: little,
      waitTimes: waitTimes[i]!,
    };
  });

  // ---- bottleneck ranking (utilization, then time-averaged queue) ----
  const ranking = stats
    .map((s) => ({ id: s.id, utilization: s.utilization, avgQueue: s.avgQueue }))
    .sort((a, b) => (b.utilization - a.utilization) || (b.avgQueue - a.avgQueue));
  const bottleneck = ranking[0] ?? { id: n > 0 ? stations[0]!.id : '', utilization: 0, avgQueue: 0 };

  // ---- whole-system Little's law: L = λW ----
  const meanInSystem = sysArea / simTime;
  const throughput = exited / simTime;
  const meanSojourn = mean(sojourns);
  const littlesResidual =
    meanInSystem > 1e-9 ? Math.abs(meanInSystem - throughput * meanSojourn) / meanInSystem : 0;

  // ---- bucket series (exact integration of the change-point logs) ----
  const B = Math.max(10, Math.min(1000, Math.floor(settings.buckets ?? 200)));
  const width = simTime / B;
  const bucketize = (log: Array<[number, number]>, factor: number): number[] => {
    const out = new Array<number>(B).fill(0);
    for (let k = 0; k < log.length; k += 1) {
      const t0 = log[k]![0];
      const v = log[k]![1];
      const t1 = k + 1 < log.length ? log[k + 1]![0] : simTime;
      if (t1 <= t0 || v === 0) continue;
      const b0 = Math.min(B - 1, Math.max(0, Math.floor(t0 / width)));
      const b1 = Math.min(B - 1, Math.max(0, Math.floor((t1 - 1e-12) / width)));
      for (let b = b0; b <= b1; b += 1) {
        const s = Math.max(t0, b * width);
        const e2 = Math.min(t1, (b + 1) * width);
        if (e2 > s) out[b]! += (e2 - s) * v;
      }
    }
    return out.map((a) => (a / width) * factor);
  };

  return {
    simTime,
    entitiesCreated: created,
    entitiesExited: exited,
    throughput,
    meanSojourn,
    meanQueueWait: mean(queueWaits),
    meanInSystem,
    littlesResidual,
    stations: stats,
    bottleneckId: bottleneck.id,
    bottleneckUtilization: bottleneck.utilization,
    ranking,
    series: {
      count: B,
      width,
      queueLen: stats.map((_, i) => bucketize(qLog[i]!, 1)),
      utilization: stats.map((_, i) => bucketize(busyLog[i]!, 1 / servers[i]!)),
      inSystem: bucketize(sysLog, 1),
    },
    sojourns,
    queueWaits,
    truncated,
  };
}

// ---- analytical queueing formulas ------------------------------------------

export interface QueueingFormula {
  /** Server utilization ρ = λ / (cμ). */
  rho: number;
  /** Probability an arrival must wait (Erlang-C for c > 1; ρ for M/M/1). */
  pWait: number;
  /** Mean wait in queue. */
  wq: number;
  /** Mean number waiting in queue. */
  lq: number;
  /** Mean sojourn (wait + service). */
  w: number;
  /** Mean number in system. */
  l: number;
}

/**
 * Steady-state M/M/c formulas (Erlang-C delay probability). Returns null
 * outside the stability region (ρ ≥ 1) or for invalid inputs.
 */
export function mmcFormulas(lambda: number, mu: number, c: number): QueueingFormula | null {
  if (!(lambda > 0) || !(mu > 0) || !(c >= 1)) return null;
  const a = lambda / mu;
  const rho = a / c;
  if (rho >= 1) return null;
  if (c === 1) {
    const wq = rho / (mu - lambda);
    const lq = lambda * wq;
    return { rho, pWait: rho, wq, lq, w: wq + 1 / mu, l: lq + a };
  }
  // Erlang-C: sum of a^k / k! for k < c, then the delayed-call fraction.
  let sum = 0;
  let term = 1;
  for (let k = 0; k < c; k += 1) {
    sum += term;
    term *= a / (k + 1);
  }
  // term == a^c / c! here.
  const waitTerm = term / (1 - rho);
  const pWait = waitTerm / (sum + waitTerm);
  const wq = pWait / (c * mu - lambda);
  const lq = lambda * wq;
  return { rho, pWait, wq, lq, w: wq + 1 / mu, l: lq + a };
}

/** M/M/1 special case of `mmcFormulas`. */
export function mm1Formulas(lambda: number, mu: number): QueueingFormula | null {
  return mmcFormulas(lambda, mu, 1);
}

// ---- built-in templates ----------------------------------------------------

export interface DesTemplate {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  model: DesModel;
}

const BANK_MODEL: DesModel = {
  source: { arrival: { type: 'exponential', rate: 0.9 }, entityLimit: 5000 },
  stations: [
    {
      id: 'tellers',
      name: 'Tellers',
      nameZh: '柜员窗口',
      servers: 3,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'exponential', rate: 0.5 },
      routing: { kind: 'exit' },
    },
  ],
};

const HOSPITAL_MODEL: DesModel = {
  source: { arrival: { type: 'exponential', rate: 0.15 }, entityLimit: 3000 },
  stations: [
    {
      id: 'triage',
      name: 'Triage',
      nameZh: '分诊台',
      servers: 2,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'uniform', a: 2, b: 5 },
      routing: { kind: 'next', id: 'rooms' },
    },
    {
      id: 'rooms',
      name: 'Treatment rooms',
      nameZh: '诊室',
      servers: 5,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'triangular', low: 10, mode: 20, high: 45 },
      routing: { kind: 'next', id: 'discharge' },
    },
    {
      id: 'discharge',
      name: 'Discharge desk',
      nameZh: '出院结算',
      servers: 1,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'deterministic', value: 3 },
      routing: { kind: 'exit' },
    },
  ],
};

const CALLCENTER_MODEL: DesModel = {
  source: { arrival: { type: 'exponential', rate: 1.2 }, entityLimit: 5000, priorityShare: 0.2 },
  stations: [
    {
      id: 'agents',
      name: 'Agents',
      nameZh: '坐席',
      servers: 5,
      queueDiscipline: 'priority',
      serviceTime: { type: 'exponential', rate: 1 / 3 },
      routing: { kind: 'exit' },
    },
  ],
};

const PRODUCTION_MODEL: DesModel = {
  source: { arrival: { type: 'deterministic', value: 10 }, entityLimit: 3000 },
  stations: [
    {
      id: 's1',
      name: 'Assembly',
      nameZh: '装配',
      servers: 1,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'uniform', a: 4, b: 6 },
      routing: { kind: 'next', id: 's2' },
    },
    {
      id: 's2',
      name: 'Machining',
      nameZh: '机加工',
      servers: 1,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'triangular', low: 6, mode: 8, high: 12 },
      routing: { kind: 'next', id: 's3' },
    },
    {
      id: 's3',
      name: 'Coating',
      nameZh: '涂装',
      servers: 1,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'uniform', a: 3, b: 5 },
      routing: { kind: 'next', id: 's4' },
    },
    {
      id: 's4',
      name: 'Inspection',
      nameZh: '检验',
      servers: 1,
      queueDiscipline: 'fifo',
      serviceTime: { type: 'uniform', a: 4, b: 6 },
      routing: {
        kind: 'probabilities',
        options: [
          { id: 's2', p: 0.05 },
          { id: 'exit', p: 0.95 },
        ],
      },
    },
  ],
};

/** Built-in example models (all stable: ρ < 1 at every station). */
export const DES_TEMPLATES: DesTemplate[] = [
  {
    id: 'bank',
    name: 'Bank tellers (M/M/c)',
    nameZh: '银行柜台 (M/M/c)',
    description: 'Single FIFO queue, 3 exponential tellers — the classic M/M/3 against Erlang-C.',
    descriptionZh: '单队列 3 个指数服务柜台的经典 M/M/3 模型，可与 Erlang-C 理论值对比。',
    model: BANK_MODEL,
  },
  {
    id: 'hospital',
    name: 'Emergency department',
    nameZh: '急诊科流程',
    description: 'Triage → treatment rooms → discharge, mixed uniform / triangular / deterministic service.',
    descriptionZh: '分诊 → 诊室 → 出院结算的串行流程，混合均匀 / 三角 / 确定性服务时间。',
    model: HOSPITAL_MODEL,
  },
  {
    id: 'callcenter',
    name: 'Call center (priority)',
    nameZh: '呼叫中心（优先级）',
    description: 'Erlang-C style agent pool with a 20% VIP priority share.',
    descriptionZh: 'Erlang-C 式坐席群，20% 来电为 VIP 优先处理。',
    model: CALLCENTER_MODEL,
  },
  {
    id: 'production',
    name: 'Production line (rework)',
    nameZh: '生产线（返工回路）',
    description: 'Four serial stations with different speeds and a 5% rework loop back to machining.',
    descriptionZh: '四道工序串行生产线，速度不一，5% 概率返工回机加工工站。',
    model: PRODUCTION_MODEL,
  },
];

/** Look up a template by id. */
export function templateById(id: string): DesTemplate | undefined {
  return DES_TEMPLATES.find((t) => t.id === id);
}

/** Pretty-printed JSON of a template model (for the editable text param). */
export function templateJson(id: string): string {
  const t = templateById(id) ?? DES_TEMPLATES[0]!;
  return JSON.stringify(t.model, null, 2);
}
