// Lazy-load entry for the med-biostat plugin.
import type { Plugin } from '@ergalics/plugin-sdk';
import { MedBiostatPlugin } from './plugin';

export { medBiostatManifest } from './manifest';

export default function createMedBiostatPlugin(): Plugin {
  return new MedBiostatPlugin();
}
