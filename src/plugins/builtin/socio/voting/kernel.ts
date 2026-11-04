// ==========================================================================
// socio-voting — voting systems simulator (pure, deterministic, testable)
//
// A small social-choice laboratory built on full-preference profiles:
//   - preference profiles (voters x full rankings) drawn either from the
//     uniform impartial culture or from a 2-D spatial model (voters and
//     candidates live in issue space; rankings follow Euclidean distance);
//   - tallies under plurality, instant-runoff (IRV), Borda count, approval
//     voting (a distance threshold in issue space) and proportional
//     representation (D'Hondt on first-preference blocs);
//   - Condorcet analysis (pairwise majority matrix + beats-all winner),
//     per-rule Condorcet-criterion checks, spoiler detection via candidate
//     addition, basic strategic misrepresentation under plurality and a
//     1-D pack-and-crack gerrymandering demo.
// All functions are pure — no canvas, no DOM — and fully deterministic given
// a seeded RNG (mulberry32). Ties are always broken toward the lowest
// candidate id so every outcome is reproducible. Classic references:
// Condorcet (1785); Arrow (1951) "Social Choice and Individual Values".
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

// ---- types -----------------------------------------------------------------

export type Culture = 'uniform' | 'spatial';
export type ElectoralSystem = 'plurality' | 'irv' | 'borda' | 'approval' | 'pr';

/** Point in the 2-D issue space. */
export interface XY {
  x: number;
  y: number;
}

/** Voters x full rankings of candidates 0 .. nCandidates-1. */
export interface PreferenceProfile {
  /** Candidates are the ids 0 .. nCandidates-1. */
  nCandidates: number;
  /** rankings[v][r] = candidate ranked r-th by voter v (a full permutation). */
  rankings: number[][];
  culture: Culture;
  /** Issue-space positions (spatial model); absent for imported rank rows. */
  voterPos?: XY[];
  candidatePos?: XY[];
}

export interface VotingParams {
  nVoters: number;
  nCandidates: number;
  culture: Culture;
  system: ElectoralSystem;
  /** Approval threshold on the issue-space distance. */
  approvalThreshold: number;
  /** Seats for D'Hondt PR; also the district count of the gerrymander demo. */
  seats: number;
  gerrymander: boolean;
  gerrymanderStrength: number;
  seed: number;
}

export const DEFAULT_VOTING_PARAMS: VotingParams = {
  nVoters: 400,
  nCandidates: 4,
  culture: 'spatial',
  system: 'plurality',
  approvalThreshold: 0.3,
  seats: 10,
  gerrymander: false,
  gerrymanderStrength: 0.8,
  seed: 20261029,
};

// ---- profile generation ------------------------------------------------------

/** Box-Muller standard normal from a uniform [0,1) stream. */
function gauss(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function randomPermutation(n: number, rand: () => number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  return p;
}

/** Full ranking of the candidates by (Euclidean distance, id) from (x, y). */
function rankingByDistance(x: number, y: number, candidatePos: XY[]): number[] {
  const order = candidatePos
    .map((p, id) => ({ id, d: Math.hypot(p.x - x, p.y - y) }))
    .sort((a, b) => a.d - b.d || a.id - b.id)
    .map((e) => e.id);
  return order;
}

/**
 * Random preference profile. Spatial culture (default): candidates sit at
 * uniform random points of [0,1]^2 and each voter is drawn from a Gaussian
 * cluster around one of them (balanced blocs, sigma = 0.16), ranking the
 * candidates by Euclidean distance — the classic Downsonian spatial model.
 * Uniform culture: every voter draws an independent uniform random ranking
 * (impartial culture); positions are still generated so approval voting and
 * the issue-space scatter remain well defined.
 */
export function generateRandomProfile(
  nVoters: number,
  nCandidates: number,
  rand: () => number,
  culture: Culture,
): PreferenceProfile {
  const candidatePos: XY[] = [];
  for (let c = 0; c < nCandidates; c += 1) candidatePos.push({ x: rand(), y: rand() });
  const rankings: number[][] = [];
  const voterPos: XY[] = [];
  if (culture === 'spatial') {
    const sigma = 0.16;
    for (let v = 0; v < nVoters; v += 1) {
      const home = v % nCandidates;
      const x = clamp01(candidatePos[home]!.x + sigma * gauss(rand));
      const y = clamp01(candidatePos[home]!.y + sigma * gauss(rand));
      voterPos.push({ x, y });
      rankings.push(rankingByDistance(x, y, candidatePos));
    }
  } else {
    for (let v = 0; v < nVoters; v += 1) {
      voterPos.push({ x: rand(), y: rand() });
      rankings.push(randomPermutation(nCandidates, rand));
    }
  }
  return { nCandidates, rankings, culture, voterPos, candidatePos };
}

/** Remove one candidate from a profile (rankings re-compacted, order kept). */
export function projectProfile(profile: PreferenceProfile, remove: number): PreferenceProfile {
  const rankings = profile.rankings.map((r) => r.filter((c) => c !== remove));
  return {
    nCandidates: profile.nCandidates - 1,
    rankings,
    culture: profile.culture,
    voterPos: profile.voterPos,
    candidatePos: profile.candidatePos?.filter((_, c) => c !== remove),
  };
}

// ---- tallies -----------------------------------------------------------------

/** First-preference (plurality) vote counts per candidate. */
export function pluralityCounts(profile: PreferenceProfile): number[] {
  const counts = new Array<number>(profile.nCandidates).fill(0);
  for (const r of profile.rankings) {
    const top = r[0];
    if (top !== undefined) counts[top]! += 1;
  }
  return counts;
}

/** First-preference counts restricted to the still-active candidates. */
function activeFirstPrefs(profile: PreferenceProfile, active: boolean[]): number[] {
  const counts = new Array<number>(profile.nCandidates).fill(0);
  for (const r of profile.rankings) {
    for (const c of r) {
      if (active[c]) {
        counts[c]! += 1;
        break;
      }
    }
  }
  return counts;
}

/** Borda counts: position r scores nCandidates-1-r points per ballot. */
export function bordaCounts(profile: PreferenceProfile): number[] {
  const n = profile.nCandidates;
  const counts = new Array<number>(n).fill(0);
  for (const r of profile.rankings) {
    for (let i = 0; i < r.length && i < n; i += 1) counts[r[i]!]! += n - 1 - i;
  }
  return counts;
}

/**
 * Approval counts. With issue-space positions a voter approves every
 * candidate within `threshold` Euclidean distance (possibly none). Without
 * positions the rule degrades to top-half approval: each voter approves
 * their top ceil(n/2) candidates.
 */
export function approvalCounts(profile: PreferenceProfile, threshold: number): number[] {
  const n = profile.nCandidates;
  const counts = new Array<number>(n).fill(0);
  if (!profile.voterPos || !profile.candidatePos) {
    const k = Math.max(1, Math.ceil(n / 2));
    for (const r of profile.rankings) {
      for (let i = 0; i < r.length && i < k; i += 1) counts[r[i]!]! += 1;
    }
    return counts;
  }
  profile.rankings.forEach((_, v) => {
    const vp = profile.voterPos![v]!;
    for (let c = 0; c < n; c += 1) {
      const cp = profile.candidatePos![c]!;
      if (Math.hypot(cp.x - vp.x, cp.y - vp.y) <= threshold) counts[c]! += 1;
    }
  });
  return counts;
}

export interface IrvResult {
  winner: number;
  /** First-preference counts among active candidates at each round. */
  rounds: number[][];
}

/**
 * Instant-runoff: repeatedly eliminate the active candidate with the fewest
 * active first preferences (ties eliminate the lowest id) until one remains.
 */
export function instantRunoff(profile: PreferenceProfile): IrvResult {
  const n = profile.nCandidates;
  const active = new Array<boolean>(n).fill(true);
  let remaining = n;
  const rounds: number[][] = [];
  while (remaining > 1) {
    const counts = activeFirstPrefs(profile, active);
    rounds.push(counts);
    let minC = -1;
    let minV = Number.POSITIVE_INFINITY;
    for (let c = 0; c < n; c += 1) {
      if (active[c] && counts[c]! < minV) {
        minV = counts[c]!;
        minC = c;
      }
    }
    if (minC < 0) break;
    active[minC] = false;
    remaining -= 1;
  }
  const winner = active.findIndex((a) => a);
  return { winner: winner < 0 ? 0 : winner, rounds };
}

/**
 * D'Hondt highest-quotient seat allocation. `votes[p]` are a party's votes;
 * each round awards one seat to the max of votes / (seatsWon + 1), ties to
 * the lowest party id. Parties with zero votes never win a seat.
 */
export function dhondtAllocate(votes: number[], seats: number): number[] {
  const parties = votes.length;
  const seatsWon = new Array<number>(parties).fill(0);
  const total = votes.reduce((s, v) => s + v, 0);
  if (total <= 0) return seatsWon;
  for (let s = 0; s < seats; s += 1) {
    let best = -1;
    let bestQ = -1;
    for (let p = 0; p < parties; p += 1) {
      const q = votes[p]! / (seatsWon[p]! + 1);
      if (q > bestQ) {
        bestQ = q;
        best = p;
      }
    }
    if (best < 0) break;
    seatsWon[best]! += 1;
  }
  return seatsWon;
}

// ---- Condorcet analysis --------------------------------------------------------

export interface CondorcetResult {
  /** matrix[a][b] = number of voters ranking a strictly above b. */
  matrix: number[][];
  /** Beats-all winner (strict pairwise win against every rival), else null. */
  winner: number | null;
}

/** Pairwise majority matrix and beats-all (Condorcet) winner detection. */
export function condorcetAnalysis(profile: PreferenceProfile): CondorcetResult {
  const n = profile.nCandidates;
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const r of profile.rankings) {
    for (let i = 0; i < r.length; i += 1) {
      for (let j = i + 1; j < r.length; j += 1) {
        matrix[r[i]!]![r[j]!]! += 1;
      }
    }
  }
  let winner: number | null = null;
  for (let a = 0; a < n; a += 1) {
    let beatsAll = true;
    for (let b = 0; b < n; b += 1) {
      if (b !== a && matrix[a]![b]! <= matrix[b]![a]!) {
        beatsAll = false;
        break;
      }
    }
    if (beatsAll) {
      winner = a;
      break;
    }
  }
  return { matrix, winner };
}

// ---- winner helpers ---------------------------------------------------------------

function argmaxId(counts: number[]): number {
  let best = 0;
  for (let i = 1; i < counts.length; i += 1) {
    if (counts[i]! > counts[best]!) best = i;
  }
  return best;
}

/** Winner of an election under one rule (deterministic tie-breaking). */
export function electionWinner(
  profile: PreferenceProfile,
  system: ElectoralSystem,
  approvalThreshold: number,
  seats: number,
): number {
  switch (system) {
    case 'plurality':
      return argmaxId(pluralityCounts(profile));
    case 'irv':
      return instantRunoff(profile).winner;
    case 'borda':
      return argmaxId(bordaCounts(profile));
    case 'approval':
      return argmaxId(approvalCounts(profile, approvalThreshold));
    case 'pr':
      return argmaxId(dhondtAllocate(pluralityCounts(profile), seats));
  }
}

// ---- spoiler effect -----------------------------------------------------------------

export interface SpoilerResult {
  /** Candidate whose addition is analysed (the last id of the full profile). */
  spoilerCandidate: number;
  /** Winner of the election with the spoiler removed (projected profile). */
  baseWinner: number;
  /** Winner of the full election. */
  fullWinner: number;
  /** True when adding the spoiler changed the winner. */
  spoiled: boolean;
}

/**
 * Spoiler (vote-splitting) detection: project the profile onto the first
 * nCandidates-1 candidates — voters who ranked the spoiler first transfer to
 * their next preference, which reproduces their base-election ballot — and
 * compare the winners under the same rule.
 */
export function detectSpoiler(
  profile: PreferenceProfile,
  system: ElectoralSystem,
  approvalThreshold: number,
  seats: number,
): SpoilerResult {
  const spoilerCandidate = profile.nCandidates - 1;
  const fullWinner = electionWinner(profile, system, approvalThreshold, seats);
  if (spoilerCandidate < 1) {
    return { spoilerCandidate, baseWinner: fullWinner, fullWinner, spoiled: false };
  }
  const base = projectProfile(profile, spoilerCandidate);
  const baseWinner = electionWinner(base, system, approvalThreshold, Math.max(1, seats));
  return { spoilerCandidate, baseWinner, fullWinner, spoiled: baseWinner !== fullWinner };
}

// ---- strategic voting ----------------------------------------------------------------

export interface StrategicResult {
  honestWinner: number;
  strategicWinner: number;
  /** Ballots recast toward the preferred of the projected top two. */
  strategicVoters: number;
  changed: boolean;
}

/**
 * Basic strategic misrepresentation under plurality: with the honest top two
 * {A, B}, any voter whose favourite is outside that pair casts their ballot
 * for whichever of A/B they rank higher (one-shot, no iterated reasoning).
 */
export function strategicPlurality(profile: PreferenceProfile): StrategicResult {
  const n = profile.nCandidates;
  const honest = pluralityCounts(profile);
  const honestWinner = argmaxId(honest);
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => honest[b]! - honest[a]! || a - b,
  );
  const top2 = [order[0]!, order[1]!];
  const strategic = new Array<number>(n).fill(0);
  let strategicVoters = 0;
  for (const r of profile.rankings) {
    const top = r[0]!;
    if (top === top2[0] || top === top2[1]) {
      strategic[top]! += 1;
    } else {
      const pick = r.find((c) => c === top2[0] || c === top2[1]) ?? top2[0]!;
      strategic[pick]! += 1;
      strategicVoters += 1;
    }
  }
  const strategicWinner = argmaxId(strategic);
  return { honestWinner, strategicWinner, strategicVoters, changed: strategicWinner !== honestWinner };
}

// ---- gerrymandering demo ------------------------------------------------------------

export interface DistrictPlan {
  /** Mean party-blue support of each district. */
  means: number[];
  /** District winners (true = blue wins the district). */
  blueWins: boolean[];
  blueSeats: number;
  redSeats: number;
}

export interface GerrymanderResult {
  seats: number;
  /** Popular vote share of the blue party (mean of the support values). */
  blueVoteShare: number;
  /** The map-drawing party is the popular-vote majority. */
  drawerBlue: boolean;
  /** Contiguous equal-population districts (the "neutral" map). */
  neutral: DistrictPlan;
  /** Pack-and-crack map at the requested strength. */
  gerrymandered: DistrictPlan;
  /** seat share - vote share of the map-drawing party, per map. */
  neutralGap: number;
  gerrymanderGap: number;
}

function planOf(support: number[], members: number[][]): DistrictPlan {
  const means = members.map((idxs) => {
    if (idxs.length === 0) return 0;
    return idxs.reduce((s, i) => s + support[i]!, 0) / idxs.length;
  });
  const blueWins = means.map((m) => m > 0.5);
  const blueSeats = blueWins.filter(Boolean).length;
  return { means, blueWins, blueSeats, redSeats: blueWins.length - blueSeats };
}

function chunkBy(sizes: number[], take: (k: number) => number[]): number[][] {
  const out: number[][] = [];
  let cursor = 0;
  for (const size of sizes) {
    out.push(take(cursor + size).slice(cursor));
    cursor += size;
  }
  return out;
}

/**
 * District-win computation for a 1-D electorate. `support[i]` in [0,1] is
 * cell i's blue-party support; a district won by blue iff its mean support
 * is > 0.5. Neutral map = contiguous equal-size chunks in spatial order.
 * Gerrymandered map: the popular-vote majority ("drawer") packs the
 * opposition into k = strength x seats x oppShare / 2 districts (the classic
 * pack-and-crack overrun — half the opposition's proportional share at full
 * strength) filled with the most opposition-heavy cells, and cracks the
 * remaining cells round-robin across the other districts so each gets a
 * similar, drawer-favouring mix.
 */
export function gerrymanderDemo(support: number[], seats: number, strength: number): GerrymanderResult {
  const n = support.length;
  const safeSeats = Math.max(1, Math.floor(seats));
  const per = Math.floor(n / safeSeats);
  const rem = n - per * safeSeats;
  const sizes = Array.from({ length: safeSeats }, (_, d) => per + (d < rem ? 1 : 0));
  const blueVoteShare = n > 0 ? support.reduce((s, v) => s + v, 0) / n : 0;
  const drawerBlue = blueVoteShare >= 0.5;

  const neutral = planOf(
    support,
    chunkBy(sizes, (k) => Array.from({ length: k }, (_, i) => i)),
  );

  // Sort cells most-opposition-heavy first ("opposition-ness" descending).
  const oppness = support.map((v) => (drawerBlue ? 1 - v : v));
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => oppness[b]! - oppness[a]! || a - b,
  );
  const oppShare = drawerBlue ? 1 - blueVoteShare : blueVoteShare;
  let k = Math.round(Math.min(1, Math.max(0, strength)) * safeSeats * oppShare * 0.5);
  k = Math.max(strength > 0 ? 1 : 0, Math.min(safeSeats - 1, k));

  // Packed districts: consecutive blocks of the most opposition-heavy cells
  // (each keeps its neutral-map population size).
  const packedCells: number[][] = [];
  let cursor = 0;
  for (let d = 0; d < k; d += 1) {
    packedCells.push(order.slice(cursor, cursor + sizes[d]!));
    cursor += sizes[d]!;
  }
  // Cracked districts: the remaining cells (still most-opposition-first) are
  // dealt round-robin, so every cracked district gets a similar mix.
  const rest = order.slice(cursor);
  const m = Math.max(1, safeSeats - k);
  const cracked: number[][] = [];
  for (let d = 0; d < m; d += 1) cracked.push(rest.filter((_, i) => i % m === d));
  const gerrymandered = planOf(support, [...packedCells, ...cracked]);

  const drawerSeats = (p: DistrictPlan) => (drawerBlue ? p.blueSeats : p.redSeats);
  const gap = (p: DistrictPlan) => drawerSeats(p) / safeSeats - blueVoteShare;
  return {
    seats: safeSeats,
    blueVoteShare,
    drawerBlue,
    neutral,
    gerrymandered,
    neutralGap: gap(neutral),
    gerrymanderGap: gap(gerrymandered),
  };
}

/**
 * Deterministic 1-D electorate: a smooth two-wave support landscape plus
 * noise, clamped to [0.02, 0.98] so every cell has supporters of both parties.
 */
export function generateGerrymanderElectorate(nCells: number, rand: () => number): number[] {
  const phase = rand() * Math.PI * 2;
  const waves = 2;
  const out: number[] = [];
  for (let i = 0; i < nCells; i += 1) {
    const x = nCells > 1 ? i / (nCells - 1) : 0;
    const v = 0.5 + 0.28 * Math.sin(2 * Math.PI * waves * x + phase) + 0.18 * (2 * rand() - 1);
    out.push(clampSupport(v));
  }
  return out;
}

function clampSupport(v: number): number {
  return Math.min(0.98, Math.max(0.02, v));
}

// ---- one-shot election ------------------------------------------------------------

export interface ElectionOptions {
  system: ElectoralSystem;
  approvalThreshold: number;
  seats: number;
}

export interface ElectionResult {
  system: ElectoralSystem;
  /** Tally per candidate under the active rule (votes / points / approvals / seats). */
  counts: number[];
  firstPrefs: number[];
  borda: number[];
  approvals: number[];
  /** D'Hondt seats on first-preference blocs (`seats` in total). */
  prSeats: number[];
  winner: number;
  /** counts[winner] / sum(counts). */
  winnerShare: number;
  /** Unit of `counts`, for chart labels. */
  tallyLabel: { en: string; zh: string };
  condorcet: CondorcetResult;
  spoiler: SpoilerResult;
  /** Strategic-voting analysis, only produced for plurality. */
  strategic: StrategicResult | null;
}

const TALLY_LABELS: Record<ElectoralSystem, { en: string; zh: string }> = {
  plurality: { en: 'first-preference votes', zh: '首轮票数' },
  irv: { en: 'first-round votes', zh: '首轮票数' },
  borda: { en: 'Borda points', zh: 'Borda 得分' },
  approval: { en: 'approval votes', zh: '赞成票数' },
  pr: { en: 'PR seats', zh: '比例代表席位' },
};

/** Full one-shot election analysis of a profile under the given options. */
export function runElection(profile: PreferenceProfile, opts: ElectionOptions): ElectionResult {
  const firstPrefs = pluralityCounts(profile);
  const borda = bordaCounts(profile);
  const approvals = approvalCounts(profile, opts.approvalThreshold);
  const prSeats = dhondtAllocate(firstPrefs, opts.seats);
  let counts: number[];
  switch (opts.system) {
    case 'plurality':
      counts = firstPrefs;
      break;
    case 'irv':
      counts = firstPrefs;
      break;
    case 'borda':
      counts = borda;
      break;
    case 'approval':
      counts = approvals;
      break;
    case 'pr':
      counts = prSeats;
      break;
  }
  // Under IRV the displayed tally is the first-round votes, so the winner must
  // come from the elimination pass, not from argmax of that tally.
  const winner = opts.system === 'irv' ? instantRunoff(profile).winner : argmaxId(counts);
  const total = counts.reduce((s, v) => s + v, 0);
  return {
    system: opts.system,
    counts,
    firstPrefs,
    borda,
    approvals,
    prSeats,
    winner,
    winnerShare: total > 0 ? counts[winner]! / total : 0,
    tallyLabel: TALLY_LABELS[opts.system],
    condorcet: condorcetAnalysis(profile),
    spoiler: detectSpoiler(profile, opts.system, opts.approvalThreshold, opts.seats),
    strategic: opts.system === 'plurality' ? strategicPlurality(profile) : null,
  };
}

// ---- preference file parsing (CSV rank rows / JSON) -------------------------------

export interface ParsedProfile {
  profile: PreferenceProfile | null;
  error: string | null;
}

function isPermutation(row: number[], n: number): boolean {
  if (row.length !== n) return false;
  const seen = new Set<number>();
  for (const v of row) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

/**
 * Parse a preference profile from `.csv` (one rank row per voter, candidate
 * indices most preferred first; an optional non-numeric header line is
 * skipped) or `.json` (`{ rankings, voterPos?, candidatePos? }`).
 */
export function parsePreferenceFile(text: string): ParsedProfile {
  const trimmed = text.trim();
  if (!trimmed) return { profile: null, error: 'empty file' };
  try {
    if (trimmed.startsWith('{')) {
      const obj = JSON.parse(trimmed) as {
        rankings?: unknown;
        voterPos?: unknown;
        candidatePos?: unknown;
      };
      if (!Array.isArray(obj.rankings) || obj.rankings.length === 0) {
        return { profile: null, error: 'JSON profile needs a non-empty "rankings" array' };
      }
      const first = obj.rankings[0];
      if (!Array.isArray(first)) return { profile: null, error: 'rankings must be rows of numbers' };
      const n = first.length;
      if (n < 2) return { profile: null, error: 'need at least 2 candidates' };
      const rankings: number[][] = [];
      for (const row of obj.rankings) {
        if (!Array.isArray(row)) return { profile: null, error: 'rankings must be rows of numbers' };
        const r = row.map((v) => Number(v));
        if (!isPermutation(r, n)) return { profile: null, error: 'each ranking must be a permutation of 0..n-1' };
        rankings.push(r);
      }
      const profile: PreferenceProfile = { nCandidates: n, rankings, culture: 'uniform' };
      if (Array.isArray(obj.voterPos) && Array.isArray(obj.candidatePos)) {
        profile.voterPos = obj.voterPos as XY[];
        profile.candidatePos = obj.candidatePos as XY[];
      }
      return { profile, error: null };
    }
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return { profile: null, error: 'no rank rows found' };
    const rows: number[][] = [];
    for (const line of lines) {
      const cells = line.split(/[,;\t]/).map((c) => c.trim());
      if (cells.some((c) => c !== '' && !/^-?\d+$/.test(c))) continue; // header line
      const r = cells.filter((c) => c !== '').map((c) => Number(c));
      if (r.length > 0) rows.push(r);
    }
    if (rows.length === 0) return { profile: null, error: 'no numeric rank rows found' };
    const n = rows[0]!.length;
    if (n < 2) return { profile: null, error: 'need at least 2 candidates per row' };
    for (const r of rows) {
      if (!isPermutation(r, n)) {
        return { profile: null, error: 'each rank row must be a permutation of 0..n-1' };
      }
    }
    return {
      profile: { nCandidates: n, rankings: rows, culture: 'uniform' },
      error: null,
    };
  } catch (err) {
    return { profile: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- embedded validation benchmark --------------------------------------------------

export const VOTING_BENCHMARK_IDS = ['condorcet-criterion', 'plurality-exact'] as const;

export interface VotingBenchmark {
  /** 'plurality-exact': hand profile plurality counts [4,3,2], winner A. */
  pluralityExact: boolean;
  /** Hand profile Borda counts [8,12,7], winner B. */
  bordaExact: boolean;
  /** Hand profile IRV: eliminate C, then B beats A 5-4. */
  irvExact: boolean;
  /** 'condorcet-criterion': hand profile has Condorcet winner B. */
  condorcetWinnerFound: boolean;
  /** The hand profile's plurality violation of the criterion is detected. */
  criterionViolationDetected: boolean;
  /** Criterion honoured when the plurality winner is the Condorcet winner. */
  criterionHonoured: boolean;
  /** The classic 3-cycle paradox profile has no Condorcet winner. */
  cyclicNoWinner: boolean;
  /** The classic spoiler scenario flips A's win to B. */
  spoilerDetected: boolean;
  /** D'Hondt: [100,80,30] votes, 8 seats -> [4,3,1]. */
  dhondtExact: boolean;
  /** Pack-and-crack map overperforms the neutral map for the drawer. */
  gerrymanderGapGrows: boolean;
  /** Same seed reproduces the same profile (spatial and uniform cultures). */
  deterministic: boolean;
  pass: boolean;
}

function ballotsProfile(
  nCandidates: number,
  ballots: Array<{ ranking: number[]; n: number }>,
): PreferenceProfile {
  const rankings: number[][] = [];
  for (const b of ballots) {
    for (let i = 0; i < b.n; i += 1) rankings.push([...b.ranking]);
  }
  return { nCandidates, rankings, culture: 'uniform' };
}

/**
 * Run the embedded social-choice validation battery.
 *
 * Worked example used throughout (9 voters, candidates A=0, B=1, C=2):
 *   ballots: 4 x A > B > C, 3 x B > C > A, 2 x C > B > A
 *   plurality : A=4, B=3, C=2              -> winner A (candidate 0)
 *   Borda     : A=8, B=12, C=7             -> winner B (candidate 1)
 *   IRV       : eliminate C (2); A=4 vs B=5 -> winner B
 *   pairwise  : B>A 5-4, B>C 7-2, C>A 5-4  -> Condorcet winner B
 *   => plurality elects A and violates the Condorcet criterion here,
 *      while Borda and IRV select the Condorcet winner.
 */
export function runVotingBenchmark(): VotingBenchmark {
  // (1) hand-computed election counts.
  const hand = ballotsProfile(3, [
    { ranking: [0, 1, 2], n: 4 },
    { ranking: [1, 2, 0], n: 3 },
    { ranking: [2, 1, 0], n: 2 },
  ]);
  const handPlurality = pluralityCounts(hand);
  const handBorda = bordaCounts(hand);
  const handIrv = instantRunoff(hand);
  const handCondorcet = condorcetAnalysis(hand);
  const pluralityExact = handPlurality[0] === 4 && handPlurality[1] === 3 && handPlurality[2] === 2;
  const bordaExact = handBorda[0] === 8 && handBorda[1] === 12 && handBorda[2] === 7;
  const irvExact =
    handIrv.winner === 1 &&
    handIrv.rounds.length === 2 &&
    handIrv.rounds[0]![0] === 4 &&
    handIrv.rounds[0]![1] === 3 &&
    handIrv.rounds[0]![2] === 2 &&
    handIrv.rounds[1]![0] === 4 &&
    handIrv.rounds[1]![1] === 5;
  const condorcetWinnerFound = handCondorcet.winner === 1;

  // (2) Condorcet criterion per rule on the hand profile.
  const pluralityResult = runElection(hand, { system: 'plurality', approvalThreshold: 0.3, seats: 5 });
  const bordaResult = runElection(hand, { system: 'borda', approvalThreshold: 0.3, seats: 5 });
  const irvResult = runElection(hand, { system: 'irv', approvalThreshold: 0.3, seats: 5 });
  const criterionViolationDetected =
    handCondorcet.winner !== null && pluralityResult.winner !== handCondorcet.winner;
  const criterionHonoured =
    bordaResult.winner === handCondorcet.winner && irvResult.winner === handCondorcet.winner;

  // (3) classic cyclic-paradox profile: A>B>C, B>C>A, C>A>B once each — no
  // beats-all winner exists (A beats B beats C beats A, 2-1 each).
  const cyclic = ballotsProfile(3, [
    { ranking: [0, 1, 2], n: 1 },
    { ranking: [1, 2, 0], n: 1 },
    { ranking: [2, 0, 1], n: 1 },
  ]);
  const cyclicNoWinner = condorcetAnalysis(cyclic).winner === null;

  // (4) criterion honoured on a profile where plurality picks the Condorcet
  // winner: 5 x A>B>C, 3 x B>C>A, 1 x C>B>A — A beats B 5-4 and C 5-4.
  const agreeing = ballotsProfile(3, [
    { ranking: [0, 1, 2], n: 5 },
    { ranking: [1, 2, 0], n: 3 },
    { ranking: [2, 1, 0], n: 1 },
  ]);
  const agreeingResult = runElection(agreeing, { system: 'plurality', approvalThreshold: 0.3, seats: 5 });
  const agreeingCondorcet = condorcetAnalysis(agreeing);
  const criterionHonouredBoth =
    criterionHonoured &&
    agreeingResult.winner === agreeingCondorcet.winner &&
    agreeingCondorcet.winner === 0;

  // (5) classic spoiler: base election (A, B) won by A 6-5; adding spoiler C
  // (a clone drawing two A voters) flips the plurality win to B.
  const spoilerProfile = ballotsProfile(3, [
    { ranking: [0, 1, 2], n: 4 },
    { ranking: [2, 0, 1], n: 2 },
    { ranking: [1, 0, 2], n: 5 },
  ]);
  const spoiler = detectSpoiler(spoilerProfile, 'plurality', 0.3, 5);
  const spoilerDetected = spoiler.baseWinner === 0 && spoiler.fullWinner === 1 && spoiler.spoiled;

  // (6) D'Hondt known example (classic 100k / 80k / 30k, 8 seats).
  const dhondtExact =
    JSON.stringify(dhondtAllocate([100, 80, 30], 8)) === JSON.stringify([4, 3, 1]);

  // (7) gerrymandering: fixed 20-cell electorate (10 blue cells at 0.9 in the
  // middle, 10 red cells at 0.2 around them), 4 districts. Blue has 55% of
  // the vote: the neutral contiguous map gives it 2/4 seats (gap -5%), the
  // pack-and-crack map packs red into one district and cracks the rest,
  // giving blue 3/4 seats (gap +20%).
  const support: number[] = [
    ...Array<number>(5).fill(0.2),
    ...Array<number>(10).fill(0.9),
    ...Array<number>(5).fill(0.2),
  ];
  const gerry = gerrymanderDemo(support, 4, 1);
  const gerrymanderGapGrows =
    gerry.drawerBlue &&
    gerry.neutral.blueSeats === 2 &&
    gerry.gerrymandered.blueSeats === 3 &&
    gerry.gerrymanderGap > gerry.neutralGap;

  // (8) determinism of profile generation under a fixed seed.
  const a = generateRandomProfile(40, 3, mulberry32(777), 'spatial');
  const b = generateRandomProfile(40, 3, mulberry32(777), 'spatial');
  const u1 = generateRandomProfile(40, 3, mulberry32(778), 'uniform');
  const u2 = generateRandomProfile(40, 3, mulberry32(778), 'uniform');
  const deterministic =
    JSON.stringify(a.rankings) === JSON.stringify(b.rankings) &&
    JSON.stringify(u1.rankings) === JSON.stringify(u2.rankings);

  return {
    pluralityExact,
    bordaExact,
    irvExact,
    condorcetWinnerFound,
    criterionViolationDetected,
    criterionHonoured: criterionHonouredBoth,
    cyclicNoWinner,
    spoilerDetected,
    dhondtExact,
    gerrymanderGapGrows,
    deterministic,
    pass:
      pluralityExact &&
      bordaExact &&
      irvExact &&
      condorcetWinnerFound &&
      criterionViolationDetected &&
      criterionHonoured &&
      cyclicNoWinner &&
      spoilerDetected &&
      dhondtExact &&
      gerrymanderGapGrows &&
      deterministic,
  };
}
