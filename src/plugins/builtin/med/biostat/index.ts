// Lazy-load entry for the med-biostat plugin.
import type { Plugin } from '@/types/plugin';
import { MedBiostatPlugin } from './plugin';

export { medBiostatManifest } from './manifest';

export default function createMedBiostatPlugin(): Plugin {
  return new MedBiostatPlugin();
}
