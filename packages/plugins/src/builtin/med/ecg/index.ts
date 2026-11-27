import type { Plugin } from '@ergalics/plugin-sdk';
import { MedEcgPlugin } from './plugin';

export { medEcgManifest } from './manifest';

export default function createMedEcgPlugin(): Plugin {
  return new MedEcgPlugin();
}
