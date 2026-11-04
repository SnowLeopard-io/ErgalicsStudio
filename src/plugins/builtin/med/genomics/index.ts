// Lazy-load entry for the med-genomics plugin.
import type { Plugin } from '@/types/plugin';
import { MedGenomicsPlugin } from './plugin';

export { medGenomicsManifest } from './manifest';

export default function createMedGenomicsPlugin(): Plugin {
  return new MedGenomicsPlugin();
}
