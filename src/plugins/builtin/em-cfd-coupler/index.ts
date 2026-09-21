// EM-CFD Coupler plugin — factory export (plugin contract §6).

import type { Plugin } from '@/types/plugin';
import { EmCfdCouplerPlugin } from './plugin';

export default function createEmCfdCouplerPlugin(): Plugin {
  return new EmCfdCouplerPlugin();
}