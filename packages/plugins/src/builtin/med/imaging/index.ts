// Lazy-load entry for the med-imaging plugin.
import type { Plugin } from '@ergalics/plugin-sdk';
import { MedImagingPlugin } from './plugin';

export { medImagingManifest } from './manifest';

export default function createMedImagingPlugin(): Plugin {
  return new MedImagingPlugin();
}
