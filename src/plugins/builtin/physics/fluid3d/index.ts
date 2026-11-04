import type { Plugin } from '@/types/plugin';
import { Fluid3dPlugin } from './plugin';

export { fluid3dManifest } from './manifest';

export default function createFluid3dPlugin(): Plugin {
  return new Fluid3dPlugin();
}
