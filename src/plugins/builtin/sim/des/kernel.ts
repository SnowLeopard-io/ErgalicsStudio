// ==========================================================================
// sim-des kernel — discrete-event simulation core for queueing networks.
//
// Deterministic given a seed (mulberry32 PRNG). Provides:
//   - a binary-heap event scheduler
//   - arrival/service distributions via inverse transform (exponential,
//     uniform, triangular, deterministic, normal)
//   - a queueing network of stations (FIFO, c servers each, optional queue
//     capacity with blocking) with probabilistic routing (supports rework)
//   - per-station performance metrics: utilization, time-weighted queue
//     length, mean wait, mean sojourn, throughput (Little's law holds)
//   - analytic references: M/M/1 and M/M/c (Erlang-C)
//   - four templates: bank branch, hospital triage, call center,
//     production line with rework
// ==========================================================================

// ---- PRNG -------------------------------------------------------------------

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

// ---- Distributions (inverse transform, one uniform per draw) -----------------

export type DistSpec =
  | { kind: 'exponential'; mean: number }
  | { kind: 'uniform'; min: number; max: number }
  | { kind: 'triangular'; min: number; mode: number; max: number }
  | { kind: 'deterministic'; value: number }
  | { kind: 'normal'; mean: number; sd: number };

/** Acklam's inverse normal CDF (rational approximation, |eps| < 1.15e-9). */
export function normalInvCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export function distLabel(d: DistSpec): string {
  switch (d.kind) {
    case 'exponential':
      return `Exp(mean=${d.mean})`;
    case 'uniform':
      return `U(${d.min}, ${d.max})`;
    case 'triangular':
      return `Tri(${d.min}, ${d.mode}, ${d.max})`;
    case 'deterministic':
      return `Det(${d.value})`;
    case 'normal':
      return `N(${d.mean}, ${d.sd}^2)`;
  }
}

/** Sample a service/inter-arrival time; clamped to a small positive floor so
 * zero/negative draws (normal tails) cannot stall the clock. */
export function sampleDist(d: DistSpec, rng: Rng): number {
  const u = rng.next();
  const FLOOR = 1e-9;
  switch (d.kind) {
    case 'exponential':
      return Math.max(FLOOR, -Math.log(1 - u) * d.mean);
    case 'uniform':
      return d.min + u * (d.max - d.min);
    case 'triangular': {
      const fc = (d.mode - d.min) / (d.max - d.min);
      return u < fc
        ? d.min + Math.sqrt(u * fc) * (d.max - d.min)
        : d.max - Math.sqrt((1 - u) * (1 - fc)) * (d.max - d.min);
    }
    case 'deterministic':
      return d.value;
    case 'normal':
      return Math.max(FLOOR, d.mean + d.sd * normalInvCdf(u));
  }
}

// ---- Event heap ---------------------------------------------------------------

interface DesEvent {
  time: number;
  /** Monotonic sequence to keep FIFO order for equal times (determinism). */
  seq: number;
  kind: 'arrival' | 'departure';
  station: number;
  jobId: number;
}

/** Minimal binary min-heap on (time, seq). */
export class EventHeap {
  private a: DesEvent[] = [];

  get size(): number {
    return this.a.length;
  }

  push(e: DesEvent): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i]!, a[p]!)) {
        [a[i], a[p]] = [a[p]!, a[i]!];
        i = p;
      } else break;
    }
  }

  pop(): DesEvent | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }

  private less(x: DesEvent, y: DesEvent): boolean {
    return x.time < y.time || (x.time === y.time && x.seq < y.seq);
  }
}

// ---- Network spec --------------------------------------------------------------

export interface StationSpec {
  name: string;
  servers: number;
  service: DistSpec;
  /** Max jobs waiting in queue (excluding those in service). Default infinite. */
  capacity?: number;
}

export interface RouteSpec {
  from: number;
  /** Destination station index, or null = exit the system. */
  to: number | null;
  prob: number;
}

export interface NetworkSpec {
  /** Inter-arrival time distribution for the external source. */
  arrival: DistSpec;
  stations: StationSpec[];
  /** Routes out of each station; remaining probability exits the system. */
  routing: RouteSpec[];
}

export interface DesSimSettings {
  simTime: number;
  seed: number;
}

// ---- Job accounting -------------------------------------------------------------

interface JobVisit {
  queueEnter: number;
  serviceStart: number;
}

interface JobRecord {
  arrivalTime: number;
  exitTime: number | null;
  /** True if the job left because a station queue was full (not completed). */
  blocked: boolean;
  /** Cumulative queue wait across all visits. */
  totalWait: number;
  visits: number;
}

interface StationRun {
  busyTime: number;
  /** Time-integral of queue length (time-weighted mean = area / simTime). */
  queueArea: number;
  served: number;
  blocked: number;
  totalWait: number;
  maxQueue: number;
  /** Number of times any job entered this station (counts rework loops). */
  visitCount: number;
}

// ---- Core simulation -------------------------------------------------------------

export interface StationMetrics {
  name: string;
  servers: number;
  utilization: number;
  meanQueueLength: number;
  maxQueueLength: number;
  meanWait: number;
  served: number;
  blocked: number;
  /** Mean visits per job (captures rework loops). */
  meanVisits: number;
}

export interface QueueSample {
  t: number;
  lengths: number[];
}

export interface DesRunResult {
  simTime: number;
  stations: StationMetrics[];
  /** Time series of per-station queue lengths (sampled at events, decimated). */
  queueSeries: QueueSample[];
  /** Per-job total wait times for completed jobs (histogram source). */
  waitTimes: number[];
  /** Per-job sojourn (arrival -> exit) times for completed jobs. */
  sojournTimes: number[];
  totalArrivals: number;
  completed: number;
  blockedTotal: number;
  /** Mean number of jobs in system (time-weighted, Little's L). */
  meanJobsInSystem: number;
  throughput: number;
}

export function runDes(spec: NetworkSpec, settings: DesSimSettings): DesRunResult {
  const nSt = spec.stations.length;
  const rng = createRng(settings.seed);
  const heap = new EventHeap();
  let seq = 0;

  // Per-station mutable state.
  const queues: number[][] = spec.stations.map(() => []); // job ids waiting
  const inService: (number | null)[][] = spec.stations.map((st) => Array.from({ length: st.servers }, () => null));
  const visits: Map<number, JobVisit>[] = spec.stations.map(() => new Map());
  const runs: StationRun[] = spec.stations.map(() => ({ busyTime: 0, queueArea: 0, served: 0, blocked: 0, totalWait: 0, maxQueue: 0, visitCount: 0 }));
  const jobs: JobRecord[] = [];
  let now = 0;
  let jobsInSystemArea = 0;
  let totalArrivals = 0;

  const jobsInSystem = (): number => {
    let n = 0;
    for (let s = 0; s < nSt; s++) {
      for (const x of inService[s]!) if (x !== null) n++;
      n += queues[s]!.length;
    }
    return n;
  };

  const scheduleArrival = (): void => {
    const dt = sampleDist(spec.arrival, rng);
    heap.push({ time: now + dt, seq: seq++, kind: 'arrival', station: 0, jobId: -1 });
  };

  /** Try to move waiting jobs into idle servers at a station. */
  const pump = (s: number): void => {
    const st = spec.stations[s]!;
    const srv = inService[s]!;
    for (let k = 0; k < srv.length; k++) {
      if (srv[k] !== null || queues[s]!.length === 0) continue;
      const id = queues[s]!.shift()!;
      const v = visits[s]!.get(id);
      if (!v) continue;
      v.serviceStart = now;
      const wait = now - v.queueEnter;
      runs[s]!.totalWait += wait;
      jobs[id]!.totalWait += wait;
      const dur = sampleDist(st.service, rng);
      runs[s]!.busyTime += dur;
      runs[s]!.served++;
      srv[k] = id;
      heap.push({ time: now + dur, seq: seq++, kind: 'departure', station: s, jobId: id });
    }
  };

  const enterStation = (jobId: number, s: number): void => {
    const st = spec.stations[s]!;
    const cap = st.capacity ?? Infinity;
    if (queues[s]!.length >= cap && inService[s]!.every((x) => x !== null)) {
      // Queue full: job is rejected (lost) — it leaves but is not completed.
      runs[s]!.blocked++;
      const j = jobs[jobId]!;
      j.exitTime = now;
      j.blocked = true;
      return;
    }
    queues[s]!.push(jobId);
    visits[s]!.set(jobId, { queueEnter: now, serviceStart: -1 });
    runs[s]!.visitCount++;
    runs[s]!.maxQueue = Math.max(runs[s]!.maxQueue, queues[s]!.length);
    pump(s);
  };

  const routeFrom = (jobId: number, s: number): void => {
    const routes = spec.routing.filter((r) => r.from === s);
    if (routes.length === 0) {
      jobs[jobId]!.exitTime = now;
      return;
    }
    const u = rng.next();
    let acc = 0;
    for (const r of routes) {
      acc += r.prob;
      if (u < acc) {
        if (r.to === null) jobs[jobId]!.exitTime = now;
        else enterStation(jobId, r.to);
        return;
      }
    }
    // Residual probability exits.
    jobs[jobId]!.exitTime = now;
  };

  // Seed the first arrival, then process the event loop.
  scheduleArrival();

  // Queue-length trace: sample at each event, decimate to <= 600 points.
  const trace: QueueSample[] = [];
  const recordTrace = (): void => {
    trace.push({ t: now, lengths: queues.map((q) => q.length) });
  };

  while (heap.size > 0) {
    const e = heap.pop()!;
    if (e.time > settings.simTime) break;
    const dt = e.time - now;
    for (let s = 0; s < nSt; s++) runs[s]!.queueArea += queues[s]!.length * dt;
    jobsInSystemArea += jobsInSystem() * dt;
    now = e.time;

    if (e.kind === 'arrival') {
      totalArrivals++;
      const jobId = jobs.length;
      jobs.push({ arrivalTime: now, exitTime: null, blocked: false, totalWait: 0, visits: 0 });
      enterStation(jobId, e.station);
      scheduleArrival(); // next external arrival
      recordTrace();
    } else {
      const s = e.station;
      const srv = inService[s]!;
      const k = srv.indexOf(e.jobId);
      if (k >= 0) srv[k] = null;
      jobs[e.jobId]!.visits++;
      visits[s]!.delete(e.jobId);
      routeFrom(e.jobId, s);
      pump(s);
      recordTrace();
    }
  }

  // Close the area integrals at the horizon.
  const dtEnd = settings.simTime - now;
  if (dtEnd > 0) {
    for (let s = 0; s < nSt; s++) runs[s]!.queueArea += queues[s]!.length * dtEnd;
    jobsInSystemArea += jobsInSystem() * dtEnd;
  }

  // Decimate trace to at most ~600 samples.
  const step = Math.max(1, Math.ceil(trace.length / 600));
  const queueSeries = trace.filter((_, i) => i % step === 0);

  const waitTimes: number[] = [];
  const sojournTimes: number[] = [];
  for (const j of jobs) {
    // Blocked jobs leave the system but do not count as completed throughput.
    if (j.exitTime !== null && !j.blocked) {
      waitTimes.push(j.totalWait);
      sojournTimes.push(j.exitTime - j.arrivalTime);
    }
  }

  const T = settings.simTime;
  const stations: StationMetrics[] = spec.stations.map((st, s) => {
    const r = runs[s]!;
    return {
      name: st.name,
      servers: st.servers,
      utilization: Math.min(1, r.busyTime / (st.servers * T)),
      meanQueueLength: r.queueArea / T,
      maxQueueLength: r.maxQueue,
      meanWait: r.served > 0 ? r.totalWait / r.served : 0,
      served: r.served,
      blocked: r.blocked,
      meanVisits: totalArrivals > 0 ? r.visitCount / totalArrivals : 0,
    };
  });

  const completed = waitTimes.length;
  return {
    simTime: T,
    stations,
    queueSeries,
    waitTimes,
    sojournTimes,
    totalArrivals,
    completed,
    blockedTotal: runs.reduce((a, r) => a + r.blocked, 0),
    meanJobsInSystem: jobsInSystemArea / T,
    throughput: completed / T,
  };
}

// ---- Analytic queueing references ----------------------------------------------

export interface MM1Result {
  rho: number;
  L: number;
  Lq: number;
  W: number;
  Wq: number;
  stable: boolean;
}

/** M/M/1 analytic solution. lambda = arrival rate, mu = per-server service rate. */
export function mm1Analytic(lambda: number, mu: number): MM1Result {
  const rho = lambda / mu;
  const stable = rho < 1;
  const Lq = stable ? (rho * rho) / (1 - rho) : NaN;
  return { rho, L: stable ? rho / (1 - rho) : NaN, Lq, W: stable ? 1 / (mu - lambda) : NaN, Wq: stable ? lambda / (mu * (mu - lambda)) : NaN, stable };
}

/** Erlang-C: probability an arrival must wait in M/M/c. */
export function erlangC(lambda: number, mu: number, c: number): number {
  const a = lambda / mu;
  if (a >= c) return 1;
  // sum_{k=0}^{c-1} a^k / k!
  let sum = 0;
  let term = 1;
  for (let k = 0; k < c; k++) {
    sum += term;
    term = (term * a) / (k + 1);
  }
  // term is now a^c / c!
  const peak = (term * c) / (c - a);
  return peak / (sum + peak);
}

export interface MMCResult {
  rho: number;
  erlangC: number;
  L: number;
  Lq: number;
  W: number;
  Wq: number;
  stable: boolean;
}

/** M/M/c analytic solution (Erlang-C delay model). */
export function mmcAnalytic(lambda: number, mu: number, c: number): MMCResult {
  const rho = lambda / (c * mu);
  const stable = rho < 1;
  const pw = erlangC(lambda, mu, c);
  const Wq = stable ? pw / (c * mu - lambda) : NaN;
  const Lq = stable ? lambda * Wq : NaN;
  return { rho, erlangC: pw, L: stable ? Lq + lambda / mu : NaN, Lq, W: stable ? Wq + 1 / mu : NaN, Wq, stable };
}

// ---- Templates -------------------------------------------------------------------

export type DesTemplateId = 'bank' | 'hospital' | 'call-center' | 'production';

export const DES_TEMPLATE_LABEL: Record<DesTemplateId, { en: string; zh: string }> = {
  bank: { en: 'Bank branch (M/M/c)', zh: '银行网点（M/M/c）' },
  hospital: { en: 'Hospital triage & treatment', zh: '医院分诊与诊疗' },
  'call-center': { en: 'Call center with capacity blocking', zh: '呼叫中心（容量阻塞）' },
  production: { en: 'Production line with rework', zh: '带返工的生产线' },
};

export function templateNetwork(id: DesTemplateId): NetworkSpec {
  switch (id) {
    case 'bank':
      // Classic M/M/3: single queue, 3 tellers.
      return {
        arrival: { kind: 'exponential', mean: 4 }, // 1 per 4 min
        stations: [{ name: 'Tellers', servers: 3, service: { kind: 'exponential', mean: 10 } }],
        routing: [{ from: 0, to: null, prob: 1 }],
      };
    case 'hospital':
      // Triage routes patients to consultation or treatment.
      return {
        arrival: { kind: 'exponential', mean: 5 },
        stations: [
          { name: 'Triage', servers: 2, service: { kind: 'triangular', min: 2, mode: 4, max: 8 } },
          { name: 'Consultation', servers: 2, service: { kind: 'exponential', mean: 15 } },
          { name: 'Treatment', servers: 1, service: { kind: 'uniform', min: 10, max: 25 } },
        ],
        routing: [
          { from: 0, to: 1, prob: 0.6 },
          { from: 0, to: 2, prob: 0.4 },
          { from: 1, to: null, prob: 1 },
          { from: 2, to: null, prob: 1 },
        ],
      };
    case 'call-center':
      // Finite queue (capacity 8 waiting) -> blocking/loss when full.
      return {
        arrival: { kind: 'exponential', mean: 0.5 },
        stations: [{ name: 'Agents', servers: 5, service: { kind: 'exponential', mean: 2 }, capacity: 8 }],
        routing: [{ from: 0, to: null, prob: 1 }],
      };
    case 'production':
      // Four stages; stage 3 sends 10% back to stage 2 (rework).
      return {
        arrival: { kind: 'deterministic', value: 6 },
        stations: [
          { name: 'Assembly', servers: 1, service: { kind: 'triangular', min: 3, mode: 4, max: 6 } },
          { name: 'Paint', servers: 1, service: { kind: 'triangular', min: 3, mode: 5, max: 7 } },
          { name: 'Inspect', servers: 1, service: { kind: 'triangular', min: 1, mode: 2, max: 3 } },
          { name: 'Pack', servers: 1, service: { kind: 'triangular', min: 2, mode: 3, max: 5 } },
        ],
        routing: [
          { from: 0, to: 1, prob: 1 },
          { from: 1, to: 2, prob: 1 },
          { from: 2, to: 3, prob: 0.9 },
          { from: 2, to: 1, prob: 0.1 }, // rework loop
          { from: 3, to: null, prob: 1 },
        ],
      };
  }
}

/** Bottleneck identification: the station with the highest utilization. */
export function findBottleneck(stations: StationMetrics[]): { index: number; name: string; utilization: number } | null {
  if (stations.length === 0) return null;
  let best = 0;
  for (let i = 1; i < stations.length; i++) {
    if (stations[i]!.utilization > stations[best]!.utilization) best = i;
  }
  return { index: best, name: stations[best]!.name, utilization: stations[best]!.utilization };
}

/** Histogram of wait times into n bins over [0, max]. */
export function waitHistogram(waits: number[], bins: number): { binStart: number; binWidth: number; counts: number[] } {
  let max = 0;
  for (const w of waits) if (w > max) max = w;
  const width = max > 0 ? max / bins : 1;
  const counts = new Array<number>(bins).fill(0);
  for (const w of waits) {
    const b = Math.min(bins - 1, Math.floor(w / width));
    counts[b]!++;
  }
  return { binStart: 0, binWidth: width, counts };
}
