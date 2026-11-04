import type { Plugin } from '@/types/plugin';
import { MedEcgPlugin } from './plugin';

export { medEcgManifest } from './manifest';

export default function createMedEcgPlugin(): Plugin {
  return new MedEcgPlugin();
}
