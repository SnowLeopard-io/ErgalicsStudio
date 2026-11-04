import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/repro/random';
import {
  bordaCounts,
  condorcetAnalysis,
  detectSpoiler,
  dhondtAllocate,
  electionWinner,
  generateRandomProfile,
  instantRunoff,
  pluralityCounts,
  runElection,
  runVotingBenchmark,
  type PreferenceProfile,
} from '../src/plugins/builtin/socio/voting/kernel';

/** Expand weighted ballots into a uniform-culture preference profile. */
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

// Worked example (9 voters, candidates A=0, B=1, C=2):
//   4 x A > B > C, 3 x B > C > A, 2 x C > B > A
const hand = ballotsProfile(3, [
  { ranking: [0, 1, 2], n: 4 },
  { ranking: [1, 2, 0], n: 3 },
  { ranking: [2, 1, 0], n: 2 },
]);

const OPTS = { approvalThreshold: 0.3, seats: 5 } as const;

describe('socio-voting kernel (social choice)', () => {
  it('hand-computed plurality, Borda and IRV tallies and winners', () => {
    expect(pluralityCounts(hand)).toEqual([4, 3, 2]);
    expect(bordaCounts(hand)).toEqual([8, 12, 7]);

    const irv = instantRunoff(hand);
    // Round 1: A=4, B=3, C=2 -> eliminate C; final: A=4 vs B=5.
    expect(irv.rounds[0]).toEqual([4, 3, 2]);
    expect(irv.rounds[1]).toEqual([4, 5, 0]);
    expect(irv.winner).toBe(1);

    expect(electionWinner(hand, 'plurality', OPTS.approvalThreshold, OPTS.seats)).toBe(0);
    expect(electionWinner(hand, 'borda', OPTS.approvalThreshold, OPTS.seats)).toBe(1);
    expect(electionWinner(hand, 'irv', OPTS.approvalThreshold, OPTS.seats)).toBe(1);

    const plurality = runElection(hand, { system: 'plurality', ...OPTS });
    expect(plurality.winnerShare).toBeCloseTo(4 / 9, 12);
  });

  it('cyclic paradox profile has no Condorcet winner; hand profile violates the criterion', () => {
    // A>B>C, B>C>A, C>A>B once each: A beats B, B beats C, C beats A (2-1).
    const cyclic = ballotsProfile(3, [
      { ranking: [0, 1, 2], n: 1 },
      { ranking: [1, 2, 0], n: 1 },
      { ranking: [2, 0, 1], n: 1 },
    ]);
    const cyc = condorcetAnalysis(cyclic);
    expect(cyc.winner).toBeNull();
    expect(cyc.matrix[0]![1]).toBe(2);
    expect(cyc.matrix[1]![2]).toBe(2);
    expect(cyc.matrix[2]![0]).toBe(2);

    // Hand profile: B beats A 5-4 and C 7-2 -> beats-all winner B.
    const cond = condorcetAnalysis(hand);
    expect(cond.winner).toBe(1);
    expect(cond.matrix[1]![0]).toBe(5);
    expect(cond.matrix[1]![2]).toBe(7);

    // Plurality elects A (violating the criterion); Borda and IRV elect B.
    const plurality = runElection(hand, { system: 'plurality', ...OPTS });
    const borda = runElection(hand, { system: 'borda', ...OPTS });
    const irv = runElection(hand, { system: 'irv', ...OPTS });
    expect(plurality.winner).not.toBe(cond.winner);
    expect(borda.winner).toBe(cond.winner);
    expect(irv.winner).toBe(cond.winner);
  });

  it('detects the classic spoiler and passes a clean profile', () => {
    // Base election (A, B) won by A 6-5; adding spoiler C flips the win to B.
    const spoilerProfile = ballotsProfile(3, [
      { ranking: [0, 1, 2], n: 4 },
      { ranking: [2, 0, 1], n: 2 },
      { ranking: [1, 0, 2], n: 5 },
    ]);
    const sp = detectSpoiler(spoilerProfile, 'plurality', OPTS.approvalThreshold, OPTS.seats);
    expect(sp.spoilerCandidate).toBe(2);
    expect(sp.baseWinner).toBe(0);
    expect(sp.fullWinner).toBe(1);
    expect(sp.spoiled).toBe(true);

    // 5 x A>B>C, 3 x B>C>A, 1 x C>B>A: removing C leaves A the winner.
    const clean = ballotsProfile(3, [
      { ranking: [0, 1, 2], n: 5 },
      { ranking: [1, 2, 0], n: 3 },
      { ranking: [2, 1, 0], n: 1 },
    ]);
    const notSpoiled = detectSpoiler(clean, 'plurality', OPTS.approvalThreshold, OPTS.seats);
    expect(notSpoiled.baseWinner).toBe(0);
    expect(notSpoiled.fullWinner).toBe(0);
    expect(notSpoiled.spoiled).toBe(false);
  });

  it("D'Hondt allocates the classic 100/80/30 example as [4,3,1]", () => {
    expect(dhondtAllocate([100, 80, 30], 8)).toEqual([4, 3, 1]);
    // Larger parties are favoured; zero-vote parties never win a seat.
    expect(dhondtAllocate([60, 0, 40], 5)).toEqual([3, 0, 2]);
    // PR winner = largest bloc; seat-vote gap is reported by runElection.
    const pr = runElection(hand, { system: 'pr', ...OPTS });
    expect(pr.winner).toBe(0);
    expect(pr.prSeats).toEqual([2, 2, 1]);
  });

  it('profile generation is fully deterministic under a fixed seed', () => {
    const a = generateRandomProfile(50, 4, mulberry32(20261029), 'spatial');
    const b = generateRandomProfile(50, 4, mulberry32(20261029), 'spatial');
    expect(a.rankings).toEqual(b.rankings);
    expect(a.voterPos).toEqual(b.voterPos);
    const u1 = generateRandomProfile(30, 3, mulberry32(7), 'uniform');
    const u2 = generateRandomProfile(30, 3, mulberry32(7), 'uniform');
    expect(u1.rankings).toEqual(u2.rankings);
  });

  it('embedded benchmark battery passes', () => {
    const b = runVotingBenchmark();
    expect(b.pluralityExact).toBe(true);
    expect(b.bordaExact).toBe(true);
    expect(b.irvExact).toBe(true);
    expect(b.condorcetWinnerFound).toBe(true);
    expect(b.criterionViolationDetected).toBe(true);
    expect(b.criterionHonoured).toBe(true);
    expect(b.cyclicNoWinner).toBe(true);
    expect(b.spoilerDetected).toBe(true);
    expect(b.dhondtExact).toBe(true);
    expect(b.gerrymanderGapGrows).toBe(true);
    expect(b.deterministic).toBe(true);
    expect(b.pass).toBe(true);
  });
});
