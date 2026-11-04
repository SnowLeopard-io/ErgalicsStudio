// Lazy-load entry for the socio-voting plugin.
export { default } from './plugin';
export { votingManifest } from './manifest';
export {
  approvalCounts,
  bordaCounts,
  condorcetAnalysis,
  dhondtAllocate,
  detectSpoiler,
  electionWinner,
  generateRandomProfile,
  gerrymanderDemo,
  instantRunoff,
  pluralityCounts,
  runElection,
  runVotingBenchmark,
} from './kernel';
