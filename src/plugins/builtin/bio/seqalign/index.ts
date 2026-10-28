// Lazy-load entry for the bio-seqalign plugin.
export { default } from './plugin';
export { bioSeqalignManifest } from './manifest';
export { alignGlobal, alignLocal, baseStats, gcWindow, makeMatrix } from './align';