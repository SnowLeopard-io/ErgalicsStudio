// Fluid-CFD Coupler plugin — factory export (plugin contract §6).

import type { Plugin } from '@/types/plugin';
import { FluidCfdCouplerPlugin } from './plugin';

export default function createFluidCfdCouplerPlugin(): Plugin {
  return new FluidCfdCouplerPlugin();
}