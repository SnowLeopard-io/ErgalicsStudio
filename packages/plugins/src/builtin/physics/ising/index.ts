// Lazy-load entry for the physics-ising plugin.
export { default } from './plugin';
export { isingManifest } from './manifest';
export {
  ONSAGER_TC,
  estimateTcFromChi,
  exact2x2,
  mulberry32,
  onsagerMagnetization,
  runIsingPoint,
} from './kernel';
