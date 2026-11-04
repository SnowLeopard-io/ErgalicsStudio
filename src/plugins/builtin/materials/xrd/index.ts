// Lazy-load entry for the mats-xrd plugin.
export { default } from './plugin';
export { matsXrdManifest } from './manifest';
export {
  parseXrd,
  findPeaks,
  braggD,
  refineCubicLattice,
  matchReferencePhases,
  ANODES,
  type XrdAnode,
  type XrdPoint,
  type XrdPeak,
  type LatticeRefinement,
} from './kernel';
